const router = require('express').Router();
const mongoose = require('mongoose');
const { resolve: geoResolve } = require('../services/geo/geoResolver');
const { expand: locationExpand } = require('../services/geo/locationExpander');
const { infer: geoInfer } = require('../services/geo/geoInferenceEngine');
const { buildSearchPlan } = require('../services/geo/searchPlanner');
const { runAllActiveMonitors, upsertMonitorPreference } = require('../services/geo/geoMonitor');
const { SIBIU_ZONES, SIBIU_POIS } = require('../services/geo/sibiu/zones');
const { getGeminiModel } = require('../configService');

// Realistic Sibiu 2024/2025 market data per zone
const MARKET_DATA = {
    centru:            { avg_price_m2: 2100, med_price_m2: 2050, market_score: 0.88, trend: '+5.2%', deal_count: 8,  avg_days: 52, liquidity: 'low',    investment_score: 72, family_score: 78, student_score: 55, noise: 'high',   green_space: 0.30 },
    oras_de_jos:       { avg_price_m2: 1850, med_price_m2: 1800, market_score: 0.82, trend: '+4.1%', deal_count: 14, avg_days: 41, liquidity: 'medium', investment_score: 75, family_score: 80, student_score: 65, noise: 'medium', green_space: 0.45 },
    oras_de_sus:       { avg_price_m2: 1950, med_price_m2: 1900, market_score: 0.84, trend: '+3.8%', deal_count: 6,  avg_days: 58, liquidity: 'low',    investment_score: 70, family_score: 82, student_score: 50, noise: 'low',    green_space: 0.40 },
    hipodrom:          { avg_price_m2: 1380, med_price_m2: 1350, market_score: 0.74, trend: '+3.2%', deal_count: 32, avg_days: 28, liquidity: 'high',   investment_score: 81, family_score: 85, student_score: 60, noise: 'medium', green_space: 0.55 },
    vale_aurie:        { avg_price_m2: 1120, med_price_m2: 1100, market_score: 0.68, trend: '+2.1%', deal_count: 18, avg_days: 35, liquidity: 'medium', investment_score: 70, family_score: 80, student_score: 45, noise: 'low',    green_space: 0.70 },
    strand:            { avg_price_m2: 1250, med_price_m2: 1220, market_score: 0.70, trend: '+2.8%', deal_count: 22, avg_days: 30, liquidity: 'high',   investment_score: 73, family_score: 75, student_score: 70, noise: 'medium', green_space: 0.40 },
    turnisor:          { avg_price_m2: 1520, med_price_m2: 1490, market_score: 0.77, trend: '+4.5%', deal_count: 25, avg_days: 25, liquidity: 'high',   investment_score: 79, family_score: 78, student_score: 72, noise: 'medium', green_space: 0.35 },
    terezian:          { avg_price_m2: 1680, med_price_m2: 1650, market_score: 0.79, trend: '+3.5%', deal_count: 10, avg_days: 44, liquidity: 'medium', investment_score: 74, family_score: 84, student_score: 40, noise: 'low',    green_space: 0.50 },
    vasile_aaron:      { avg_price_m2: 1300, med_price_m2: 1270, market_score: 0.72, trend: '+3.0%', deal_count: 20, avg_days: 32, liquidity: 'high',   investment_score: 76, family_score: 60, student_score: 92, noise: 'medium', green_space: 0.35 },
    lazaret:           { avg_price_m2: 1420, med_price_m2: 1390, market_score: 0.75, trend: '+2.5%', deal_count: 12, avg_days: 38, liquidity: 'medium', investment_score: 72, family_score: 82, student_score: 45, noise: 'low',    green_space: 0.55 },
    gusterita:         { avg_price_m2: 980,  med_price_m2: 960,  market_score: 0.62, trend: '+1.8%', deal_count: 15, avg_days: 42, liquidity: 'medium', investment_score: 66, family_score: 74, student_score: 35, noise: 'low',    green_space: 0.65 },
    nord_vest:         { avg_price_m2: 1050, med_price_m2: 1020, market_score: 0.65, trend: '+2.0%', deal_count: 13, avg_days: 40, liquidity: 'medium', investment_score: 68, family_score: 72, student_score: 38, noise: 'medium', green_space: 0.50 },
    tineretului:       { avg_price_m2: 1180, med_price_m2: 1150, market_score: 0.69, trend: '+2.6%', deal_count: 19, avg_days: 33, liquidity: 'high',   investment_score: 71, family_score: 76, student_score: 65, noise: 'medium', green_space: 0.40 },
    shopping_city_zone:{ avg_price_m2: 1350, med_price_m2: 1320, market_score: 0.73, trend: '+3.8%', deal_count: 24, avg_days: 27, liquidity: 'high',   investment_score: 78, family_score: 77, student_score: 68, noise: 'medium', green_space: 0.30 },
    dumbravii:         { avg_price_m2: 1280, med_price_m2: 1250, market_score: 0.71, trend: '+2.3%', deal_count: 16, avg_days: 36, liquidity: 'medium', investment_score: 73, family_score: 88, student_score: 42, noise: 'low',    green_space: 0.80 },
};


const insightsCache = new Map();

// ── Zone data ─────────────────────────────────────────────────────────────

router.get('/zones', (req, res) => {
    const city = req.query.city || 'Sibiu';
    const zones = SIBIU_ZONES.filter(z => z.city === city && z.id !== 'sibiu_general');
    res.json(zones.map(z => ({
        id: z.id, name: z.name, lat: z.lat, lng: z.lng, radius_km: z.radius_km,
        tags: z.tags, price_index: z.price_index,
        student_friendly: z.student_friendly, family_friendly: z.family_friendly,
        noise_level: z.noise_level, poi: z.poi, aliases: z.aliases.slice(0, 5),
    })));
});

router.get('/pois', (req, res) => {
    res.json(Object.entries(SIBIU_POIS).map(([key, poi]) => ({ key, ...poi })));
});

// ── Resolver ──────────────────────────────────────────────────────────────

router.post('/resolve', async (req, res) => {
    try {
        const { text, city } = req.body;
        if (!text) return res.status(400).json({ error: 'text required' });
        const result = await geoResolve(text, { city: city || 'Sibiu' });
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/expand', async (req, res) => {
    try {
        const { text, city, maxAreas } = req.body;
        if (!text) return res.status(400).json({ error: 'text required' });
        const result = await locationExpand(text, { city: city || 'Sibiu', maxAreas: maxAreas || 6 });
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/infer', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'text required' });
        const result = await geoInfer(text, { useGemini: false });
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/plan', async (req, res) => {
    try {
        const { text, city, price_max, rooms, zone_text } = req.body;
        const plan = await buildSearchPlan({ text, city, zone_text, price_max, rooms });
        res.json(plan);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GeoPreference CRUD ────────────────────────────────────────────────────

router.get('/preferences', async (req, res) => {
    try {
        const GeoPreference = mongoose.model('GeoPreference');
        const userId = req.query.userId || 'default';
        const prefs = await GeoPreference.find({ userId }).sort({ updatedAt: -1 });
        res.json(prefs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/preferences', async (req, res) => {
    try {
        const GeoPreference = mongoose.model('GeoPreference');
        const pref = await GeoPreference.create({ ...req.body, userId: req.body.userId || 'default' });
        res.status(201).json(pref);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/preferences/:id', async (req, res) => {
    try {
        const GeoPreference = mongoose.model('GeoPreference');
        const pref = await GeoPreference.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );
        if (!pref) return res.status(404).json({ error: 'Not found' });
        res.json(pref);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/preferences/:id', async (req, res) => {
    try {
        const GeoPreference = mongoose.model('GeoPreference');
        await GeoPreference.findByIdAndDelete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monitor ───────────────────────────────────────────────────────────────

router.post('/monitor/run', async (req, res) => {
    try {
        const results = await runAllActiveMonitors();
        res.json({ results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/monitor/upsert', async (req, res) => {
    try {
        const pref = await upsertMonitorPreference(req.body);
        res.json(pref);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── AI Workspace endpoints ─────────────────────────────────────────────────

router.get('/market-data', (req, res) => {
    res.json(MARKET_DATA);
});

router.get('/listings', async (req, res) => {
    try {
        const negoDb = mongoose.connection.useDb('negoapp', { useCache: true });
        const leads = await negoDb.collection('leads').find({}).toArray();
        const reLeads = leads.filter(l => l.title && RE_KEYWORDS.test(l.title));

        let features = reLeads.map((lead) => {
            const zone = _geocodeLeadTitle(lead.title || '', SIBIU_ZONES);
            const lat = zone.lat + (Math.random() - 0.5) * 0.006;
            const lng = zone.lng + (Math.random() - 0.5) * 0.006;
            const priceEur = _parsePriceEur(lead.price || '');
            const status = lead.status || 'new';
            const verdict = status === 'won' ? 'hot' : status === 'negotiating' ? 'warm' : 'cold';
            const dealScore = status === 'won' ? 92 : status === 'negotiating' ? 74 : 58;
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lng, lat] },
                properties: {
                    id: lead.id || `nego-${lead._id}`,
                    lat, lng,
                    zone_id: zone.id,
                    title: lead.title,
                    price: priceEur,
                    price_m2: 0,
                    rooms: 0,
                    area_sqm: 0,
                    deal_score: dealScore,
                    negotiation_score: status === 'negotiating' ? 0.75 : 0.5,
                    verdict,
                    is_new: status === 'new',
                    price_drop: false,
                    url: lead.url || '#',
                    published_ago: _fmtAgo(lead.createdAt),
                    source: 'nego',
                    nego_status: status,
                },
            };
        });

        const { zone_id, verdict, min_score } = req.query;
        if (zone_id) features = features.filter(f => f.properties.zone_id === zone_id);
        if (verdict) features = features.filter(f => f.properties.verdict === verdict);
        if (min_score) features = features.filter(f => f.properties.deal_score >= parseInt(min_score));

        res.json({ type: 'FeatureCollection', features });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/insights/:zoneId', async (req, res) => {
    try {
        const { zoneId } = req.params;
        const cacheKey = zoneId;
        if (insightsCache.has(cacheKey)) return res.json(insightsCache.get(cacheKey));

        const market = MARKET_DATA[zoneId];
        const zone = SIBIU_ZONES.find(z => z.id === zoneId);
        if (!market || !zone) return res.status(404).json({ error: 'Zone not found' });

        const staticInsights = {
            zone_id: zoneId,
            zone_name: zone.name,
            avg_price_m2: market.avg_price_m2,
            med_price_m2: market.med_price_m2,
            market_score: market.market_score,
            trend: market.trend,
            deal_count: market.deal_count,
            avg_days: market.avg_days,
            liquidity: market.liquidity,
            scores: {
                investment: market.investment_score,
                family: market.family_score,
                student: market.student_score,
            },
            noise: market.noise,
            green_space: Math.round(market.green_space * 100),
            tags: zone.tags,
            pois: zone.poi,
            ai_summary: null,
        };

        try {
            const model = getGeminiModel();
            if (model) {
                const prompt = `Ești un expert imobiliar în Sibiu. Analizează zona "${zone.name}" și oferă un rezumat concis de 2-3 propoziții despre: caracterul zonei, avantajele principale și pentru cine este potrivită. Date: preț mediu ${market.avg_price_m2}€/mp, trend ${market.trend}, lichiditate ${market.liquidity}, scor investiție ${market.investment_score}/100, scor familie ${market.family_score}/100, zgomot ${market.noise}, spații verzi ${Math.round(market.green_space * 100)}%. Răspunde în română, concis.`;
                const result = await model.generateContent(prompt);
                staticInsights.ai_summary = result.response.text().trim();
            }
        } catch (_) { /* Gemini optional */ }

        insightsCache.set(cacheKey, staticInsights);
        setTimeout(() => insightsCache.delete(cacheKey), 30 * 60 * 1000); // 30 min TTL
        res.json(staticInsights);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/compare', async (req, res) => {
    try {
        const { zone_ids } = req.body;
        if (!Array.isArray(zone_ids) || zone_ids.length < 2) {
            return res.status(400).json({ error: 'Provide 2-3 zone_ids' });
        }

        const zones = zone_ids.map(id => {
            const zone = SIBIU_ZONES.find(z => z.id === id);
            const market = MARKET_DATA[id];
            return zone && market ? { id, name: zone.name, market, tags: zone.tags } : null;
        }).filter(Boolean);

        if (zones.length < 2) return res.status(400).json({ error: 'Not enough valid zones' });

        const comparison = zones.map(z => ({
            id: z.id,
            name: z.name,
            avg_price_m2: z.market.avg_price_m2,
            trend: z.market.trend,
            liquidity: z.market.liquidity,
            investment_score: z.market.investment_score,
            family_score: z.market.family_score,
            student_score: z.market.student_score,
            noise: z.market.noise,
            green_space: Math.round(z.market.green_space * 100),
            tags: z.tags,
        }));

        let ai_verdict = null;
        try {
            const model = getGeminiModel();
            if (model) {
                const zoneDesc = zones.map(z => `${z.name}: ${z.market.avg_price_m2}€/mp, scor inv ${z.market.investment_score}, familie ${z.market.family_score}`).join(' | ');
                const prompt = `Compară aceste zone din Sibiu și oferă un verdict clar în 3-4 propoziții: ${zoneDesc}. Spune care e mai bună pentru investiție și care pentru locuit cu familia. Răspunde în română.`;
                const result = await model.generateContent(prompt);
                ai_verdict = result.response.text().trim();
            }
        } catch (_) { /* Gemini optional */ }

        res.json({ zones: comparison, ai_verdict });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NegoApp real leads on map ─────────────────────────────────────────────

function _geocodeLeadTitle(title, zones) {
    const lower = title.toLowerCase();
    for (const zone of zones) {
        if (zone.id === 'sibiu_general') continue;
        for (const alias of (zone.aliases || [])) {
            if (alias.length > 3 && lower.includes(alias.toLowerCase())) return zone;
        }
        if (lower.includes(zone.name.toLowerCase())) return zone;
    }
    return zones.find(z => z.id === 'hipodrom') || zones[0];
}

function _parsePriceEur(str) {
    if (!str) return 0;
    const n = str.replace(/\s|\./g, '').replace(',', '.');
    const m = n.match(/(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    const v = parseFloat(m[1]);
    return /€|eur/i.test(str) ? Math.round(v) : Math.round(v / 5);
}

function _fmtAgo(dateStr) {
    if (!dateStr) return '';
    const ms = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)} zile`;
}

const RE_KEYWORDS = /apartament|garsonier[aă]|cas[aă]|teren|imobil|bloc|vil[aă]|duplex|studio|proprietar|vanzare|inchiriere/i;


router.post('/polygon/save', async (req, res) => {
    try {
        const GeoPreference = mongoose.model('GeoPreference');
        const { coordinates, label, userId } = req.body;
        if (!coordinates || !Array.isArray(coordinates)) {
            return res.status(400).json({ error: 'coordinates required' });
        }
        const pref = await GeoPreference.create({
            userId: userId || 'default',
            type: 'preferred_area',
            city: 'Sibiu',
            resolved_area: label || 'Polygon area',
            raw_input: JSON.stringify({ type: 'polygon', coordinates }),
            updatedAt: new Date(),
        });
        res.status(201).json(pref);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
