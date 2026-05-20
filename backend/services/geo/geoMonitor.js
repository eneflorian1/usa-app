/**
 * Geo Monitor — monitorizare autonomă anunțuri imobiliare
 * "monitorizează centru sibiu sub 95k" → scanează periodic, alertă WhatsApp
 */

const mongoose = require('mongoose');
const { buildSearchPlan } = require('./searchPlanner');
const { executeSearchPlan } = require('./olxAgent');
const { runLeadIntelligencePipeline } = require('../leadIntelligence');
const { callMcpTool } = require('../../mcpBridgeService');

function getGeoPreferenceModel() {
    return mongoose.model('GeoPreference');
}

/**
 * Rulează un singur ciclu de monitorizare pentru o preferință
 */
async function runMonitorCycle(pref) {
    console.log(`[GeoMonitor] Running cycle for pref ${pref._id} (${pref.city} / ${pref.resolved_area})`);

    const plan = await buildSearchPlan({
        text: pref.raw_input || `${pref.property_type || 'apartament'} ${pref.resolved_area || pref.city}`,
        city: pref.city,
        zone_text: pref.resolved_area || '',
        price_max: pref.price_max,
        price_min: pref.price_min,
        rooms: pref.rooms && pref.rooms.length > 0 ? pref.rooms[0] : null,
    }, {
        preferred_areas: pref.resolved_area ? [pref.resolved_area] : [],
        price_max: pref.price_max,
        rooms: pref.rooms,
        city: pref.city,
    });

    const { listings } = await executeSearchPlan(plan);

    // Filtrează anunțuri noi (nu le-am văzut)
    const newListings = listings.filter(l => l.url && !alreadySeen(pref, l.url)).slice(0, 5);

    if (newListings.length === 0) {
        console.log(`[GeoMonitor] No new listings for pref ${pref._id}`);
        await updateLastRun(pref._id);
        return { new_count: 0 };
    }

    console.log(`[GeoMonitor] Found ${newListings.length} new listings for pref ${pref._id}`);

    // Analizează top 3 cu Lead Intelligence
    const analyzed = [];
    for (const listing of newListings.slice(0, 3)) {
        if (!listing.url) continue;
        try {
            const result = await runLeadIntelligencePipeline({
                url: listing.url,
                chatId: pref.monitor?.whatsapp_chatId,
                userId: pref.userId || 'default',
            });
            if (result.score.score >= (pref.monitor?.min_score || 6)) {
                analyzed.push(result);
            }
        } catch (err) {
            console.warn(`[GeoMonitor] Lead intel failed for ${listing.url}:`, err.message);
        }
    }

    // Trimite rezumat WhatsApp dacă există chatId
    if (pref.monitor?.whatsapp_chatId && analyzed.length > 0) {
        const summary = buildMonitorSummary(analyzed, pref);
        try {
            await callMcpTool('nego_send_whatsapp', {
                userId: pref.userId || 'default',
                chatId: pref.monitor.whatsapp_chatId,
                message: summary,
            });
        } catch (err) {
            console.warn(`[GeoMonitor] WhatsApp send failed:`, err.message);
        }
    }

    // Marchează URL-urile ca văzute și actualizează last_run
    await markSeen(pref._id, newListings.map(l => l.url).filter(Boolean));
    await updateLastRun(pref._id);

    return { new_count: newListings.length, analyzed_count: analyzed.length };
}

// Tracking URL-uri văzute — simplu în memorie + MongoDB
const seenCache = new Map(); // prefId → Set<url>

function alreadySeen(pref, url) {
    const key = pref._id.toString();
    return seenCache.has(key) && seenCache.get(key).has(url);
}

async function markSeen(prefId, urls) {
    const key = prefId.toString();
    if (!seenCache.has(key)) seenCache.set(key, new Set());
    urls.forEach(u => seenCache.get(key).add(u));
    // Keep cache sub 1000 URLs
    const s = seenCache.get(key);
    if (s.size > 1000) {
        const arr = Array.from(s);
        seenCache.set(key, new Set(arr.slice(arr.length - 500)));
    }
}

async function updateLastRun(prefId) {
    try {
        const GeoPreference = getGeoPreferenceModel();
        await GeoPreference.updateOne(
            { _id: prefId },
            { 'monitor.last_run': new Date(), updatedAt: new Date() }
        );
    } catch { }
}

function buildMonitorSummary(analyzed, pref) {
    const area = pref.resolved_area || pref.city;
    const budget = pref.price_max ? ` sub ${pref.price_max} EUR` : '';
    const lines = [
        `🔔 *Monitor Imobiliar — ${area}${budget}*`,
        ``,
        `${analyzed.length} anunț${analyzed.length > 1 ? 'uri' : ''} nou${analyzed.length > 1 ? 'i' : ''} cu scor ridicat:`,
        ``,
    ];

    for (const r of analyzed) {
        const vc = r.score.verdict === 'hot' ? '🔥' : r.score.verdict === 'warm' ? '🟡' : '❄️';
        lines.push(`${vc} *${r.listing.title}*`);
        lines.push(`💰 ${r.listing.price} ${r.listing.currency} — ${r.listing.location}`);
        lines.push(`⭐ ${r.score.score}/10 — ${r.score.scoreReason}`);
        if (r.listing.url) lines.push(`🔗 ${r.listing.url}`);
        lines.push(``);
    }

    return lines.join('\n');
}

/**
 * Rulează toate monitoarele active (apelat din cronService)
 */
async function runAllActiveMonitors() {
    const GeoPreference = getGeoPreferenceModel();
    const prefs = await GeoPreference.find({ 'monitor.active': true }).lean();

    const now = new Date();
    const results = [];

    for (const pref of prefs) {
        const lastRun = pref.monitor?.last_run ? new Date(pref.monitor.last_run) : null;
        const intervalMs = (pref.monitor?.interval_hours || 6) * 3600 * 1000;

        if (lastRun && now - lastRun < intervalMs) {
            console.log(`[GeoMonitor] Skipping pref ${pref._id} — too soon`);
            continue;
        }

        try {
            const result = await runMonitorCycle(pref);
            results.push({ prefId: pref._id, ...result });
        } catch (err) {
            console.error(`[GeoMonitor] Cycle error for ${pref._id}:`, err.message);
            results.push({ prefId: pref._id, error: err.message });
        }
    }

    return results;
}

/**
 * Creează sau actualizează o preferință de monitorizare
 */
async function upsertMonitorPreference({ userId = 'default', city = 'Sibiu', resolved_area, resolved_area_id, geo, price_max, price_min, rooms, property_type, whatsapp_chatId, interval_hours = 6, raw_input, lifestyle_tags }) {
    const GeoPreference = getGeoPreferenceModel();
    const filter = { userId, type: 'monitor', city };
    const update = {
        resolved_area, resolved_area_id, geo,
        price_max, price_min,
        rooms: rooms ? (Array.isArray(rooms) ? rooms : [rooms]) : [],
        property_type: property_type || 'any',
        lifestyle_tags: lifestyle_tags || [],
        raw_input,
        'monitor.active': true,
        'monitor.interval_hours': interval_hours,
        'monitor.whatsapp_chatId': whatsapp_chatId || null,
        'monitor.alert_on_new': true,
        updatedAt: new Date(),
    };
    const result = await GeoPreference.findOneAndUpdate(filter, { $set: update }, { upsert: true, new: true });
    return result;
}

module.exports = { runMonitorCycle, runAllActiveMonitors, upsertMonitorPreference };
