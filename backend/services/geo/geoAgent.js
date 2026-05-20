/**
 * Geo Agent — entry point pentru toți agenții geo
 * Primește intent textual + memorie → execută pipeline complet
 * Izolat de orchestrator: el apelează geoAgent, nu cunoaște detalii interne
 */

const { buildSearchPlan } = require('./searchPlanner');
const { executeSearchPlan } = require('./olxAgent');
const { infer: geoInfer } = require('./geoInferenceEngine');
const { resolve: geoResolve } = require('./geoResolver');
const { runLeadIntelligencePipeline } = require('../leadIntelligence');
const { upsertMonitorPreference, runAllActiveMonitors } = require('./geoMonitor');
const mongoose = require('mongoose');

function getGeoPreference() { return mongoose.model('GeoPreference'); }

/**
 * Parsează intent din text — ce vrea utilizatorul
 */
function parseIntent(text) {
    const lower = text.toLowerCase();
    if (/monitorizeaz[aă]|urm[aă]re[sş]te|alerte[aă]z[aă]|seteaz[aă]\s+alert/i.test(lower)) return 'monitor';
    if (/caut[aă]|g[aă]se[sş]te|arat[aă]-mi|afl[aă]|list[aă]/i.test(lower)) return 'search';
    if (/analizeaz[aă]|evalueaz[aă]|scor/i.test(lower)) return 'analyze';
    if (/zon[aă]|cartier|unde|ce zon/i.test(lower)) return 'zone_info';
    if (/prefer[aă]|seteaz[aă]\s+zon[aă]|zona\s+mea/i.test(lower)) return 'set_preference';
    return 'search'; // default
}

/**
 * Extrage parametrii din text
 */
function extractParams(text) {
    const lower = text.toLowerCase();
    const params = {};

    // City
    if (/sibiu/i.test(lower)) params.city = 'Sibiu';
    else if (/cluj/i.test(lower)) params.city = 'Cluj-Napoca';
    else if (/brasov/i.test(lower)) params.city = 'Brașov';
    else params.city = 'Sibiu'; // default

    // Rooms
    const roomMatch = lower.match(/(\d)\s*cam(?:ere)?/i) ||
                      lower.match(/([23])\s*room/i) ||
                      lower.match(/(dou[aă]|trei|patru)\s*cam/i);
    if (roomMatch) {
        const n = { 'doua': 2, 'două': 2, 'trei': 3, 'patru': 4 }[roomMatch[1]] || parseInt(roomMatch[1]);
        if (n >= 1 && n <= 5) params.rooms = n;
    }

    // Price max
    const priceMatch = lower.match(/sub\s+(\d{2,3})[k\s]/) ||
                       lower.match(/max(?:im)?\s+(\d{2,3})[k\s]/) ||
                       lower.match(/p[aâ]n[aă]\s+la\s+(\d{2,3})[k\s]/);
    if (priceMatch) params.price_max = parseInt(priceMatch[1]) * 1000;

    const priceExact = lower.match(/(\d{5,6})\s*(?:eur|euro|€)/);
    if (priceExact && !params.price_max) params.price_max = parseInt(priceExact[1]);

    // Zone text — remove intent words to isolate zone
    const zoneText = text
        .replace(/monitorizeaz[aă]|caut[aă]|g[aă]se[sş]te|analizeaz[aă]/gi, '')
        .replace(/apartament(?:e)?|garsonier[aă]|cas[aă]/gi, '')
        .replace(/sub\s+\d+k?|p[aâ]n[aă]\s+la\s+\d+/gi, '')
        .replace(/\d+\s*cam(?:ere)?/gi, '')
        .replace(/sibiu|cluj|brasov/gi, '')
        .trim();
    if (zoneText) params.zone_text = zoneText;

    // WhatsApp chatId
    const waMatch = text.match(/(\d{8,15}@c\.us)/);
    if (waMatch) params.whatsapp_chatId = waMatch[1];

    return params;
}

/**
 * Funcția principală — procesează orice cerere geo
 * @param {string} userText - input natural ("caută apartament 2 camere în centru sub 90k")
 * @param {object} opts - { userId, chatId, memory: GeoPreference }
 */
async function processGeoRequest(userText, opts = {}) {
    const { userId = 'default', chatId } = opts;

    const intent = parseIntent(userText);
    const params = extractParams(userText);
    if (chatId && !params.whatsapp_chatId) params.whatsapp_chatId = chatId;

    // Citește preferința salvată
    let savedPref = null;
    try {
        const GeoPreference = getGeoPreference();
        savedPref = await GeoPreference.findOne({ userId, type: { $in: ['preferred_area', 'monitor'] } })
            .sort({ updatedAt: -1 }).lean();
    } catch { }

    // Merge parametrii cu preferința salvată
    const city = params.city || savedPref?.city || 'Sibiu';
    const price_max = params.price_max || savedPref?.price_max;
    const price_min = params.price_min || savedPref?.price_min;
    const rooms = params.rooms || (savedPref?.rooms?.length > 0 ? savedPref.rooms[0] : null);
    const zone_text = params.zone_text || savedPref?.resolved_area || '';

    console.log(`[GeoAgent] Intent: ${intent}, City: ${city}, Zone: "${zone_text}", Price: ${price_max}, Rooms: ${rooms}`);

    // ── MONITOR ─────────────────────────────────────────────────────────────
    if (intent === 'monitor') {
        const resolved = zone_text ? await geoResolve(zone_text, { city }) : null;
        const area = resolved?.zones?.[0];

        const pref = await upsertMonitorPreference({
            userId, city,
            resolved_area: area?.name || zone_text || city,
            resolved_area_id: area?.id,
            geo: area ? { lat: area.lat, lng: area.lng } : null,
            price_max, price_min, rooms,
            raw_input: userText,
            whatsapp_chatId: params.whatsapp_chatId,
            interval_hours: 6,
        });

        return {
            intent: 'monitor',
            success: true,
            message: `✅ Monitor activ pentru ${area?.name || zone_text || city}${price_max ? ` sub ${price_max} EUR` : ''}.\nVoi scana la fiecare 6h și îți trimit alertă${params.whatsapp_chatId ? ' pe WhatsApp' : ''} când apar anunțuri noi.`,
            preference: pref,
        };
    }

    // ── SET PREFERENCE ───────────────────────────────────────────────────────
    if (intent === 'set_preference') {
        const resolved = zone_text ? await geoResolve(zone_text, { city }) : null;
        const area = resolved?.zones?.[0];

        const GeoPreference = getGeoPreference();
        const pref = await GeoPreference.findOneAndUpdate(
            { userId, type: 'preferred_area' },
            {
                $set: {
                    city, resolved_area: area?.name || zone_text,
                    resolved_area_id: area?.id,
                    geo: area ? { lat: area.lat, lng: area.lng } : null,
                    price_max, price_min, rooms,
                    raw_input: userText,
                    updatedAt: new Date(),
                }
            },
            { upsert: true, new: true }
        );

        return {
            intent: 'set_preference',
            success: true,
            message: `✅ Zona preferată setată: ${area?.name || zone_text || city}${price_max ? `, buget ${price_max} EUR` : ''}${rooms ? `, ${rooms} camere` : ''}`,
            preference: pref,
        };
    }

    // ── ZONE INFO ─────────────────────────────────────────────────────────────
    if (intent === 'zone_info') {
        const resolved = await geoResolve(zone_text || userText, { city });
        const inference = await geoInfer(zone_text || userText, { useGemini: false });

        return {
            intent: 'zone_info',
            success: true,
            resolved_zones: resolved.zones.map(z => ({
                name: z.name, tags: z.tags, price_index: z.price_index,
                student_friendly: z.student_friendly, family_friendly: z.family_friendly,
                noise_level: z.noise_level, poi: z.poi,
            })),
            inference: { tags: inference.tags, lifestyles: inference.lifestyles },
            message: formatZoneInfo(resolved.zones),
        };
    }

    // ── SEARCH ───────────────────────────────────────────────────────────────
    const memory = {
        preferred_areas: savedPref?.resolved_area ? [savedPref.resolved_area] : [],
        price_max: savedPref?.price_max,
        rooms: savedPref?.rooms,
        city,
    };

    const plan = await buildSearchPlan(
        { text: userText, city, zone_text, price_max, price_min, rooms },
        memory
    );

    console.log(`[GeoAgent] Search plan: ${plan.zones.length} zones, ${plan.sources.length} sources`);

    const { listings, stats } = await executeSearchPlan(plan);

    // Analizează top listinguri cu Lead Intelligence (max 3 cu URL valid)
    const toAnalyze = listings.filter(l => l.url).slice(0, 3);
    const analyzed = [];
    for (const listing of toAnalyze) {
        try {
            const result = await runLeadIntelligencePipeline({
                url: listing.url,
                chatId,
                userId,
            });
            analyzed.push(result);
        } catch (err) {
            console.warn(`[GeoAgent] Lead intel failed for ${listing.url}:`, err.message);
        }
    }

    return {
        intent: 'search',
        success: true,
        plan_meta: plan.meta,
        total_found: listings.length,
        analyzed_count: analyzed.length,
        stats,
        listings: listings.slice(0, 10), // raw listings
        analyzed, // Lead Intelligence results
        message: formatSearchResult(listings, analyzed, plan),
    };
}

function formatZoneInfo(zones) {
    if (zones.length === 0) return 'Nu am găsit zone pentru această căutare.';
    const z = zones[0];
    const lines = [
        `📍 **${z.name}**`,
        `🏷️ ${z.tags.join(', ')}`,
        `💰 Indice preț: ${z.price_index}x față de media Sibiu`,
        z.student_friendly ? '🎓 Potrivit pentru studenți' : '',
        z.family_friendly ? '👨‍👩‍👧 Potrivit pentru familii' : '',
        `🔊 Zgomot: ${z.noise_level}`,
        z.poi?.length > 0 ? `📌 POI: ${z.poi.slice(0, 3).join(', ')}` : '',
    ].filter(Boolean);
    return lines.join('\n');
}

function formatSearchResult(listings, analyzed, plan) {
    const zones = plan.zones.map(z => z.name).slice(0, 3).join(', ');
    const lines = [
        `🔍 **Căutare Sibiu — ${zones}**`,
        `📊 Găsite: ${listings.length} anunțuri | Analizate: ${analyzed.length}`,
        ``,
    ];

    for (const r of analyzed) {
        const vc = r.score.verdict === 'hot' ? '🔥' : r.score.verdict === 'warm' ? '🟡' : '❄️';
        lines.push(`${vc} **${r.listing.title}**`);
        lines.push(`   💰 ${r.listing.price} ${r.listing.currency} · ${r.listing.location}`);
        lines.push(`   ⭐ ${r.score.score}/10 — ${r.score.scoreReason}`);
        if (r.score.suggestedOffer) lines.push(`   🎯 Ofertă: ${r.score.suggestedOffer} ${r.score.suggestedOfferCurrency}`);
        lines.push(``);
    }

    if (listings.length > analyzed.length) {
        lines.push(`... și ${listings.length - analyzed.length} anunțuri neanalizate disponibile`);
    }

    return lines.join('\n');
}

module.exports = { processGeoRequest, parseIntent, extractParams };
