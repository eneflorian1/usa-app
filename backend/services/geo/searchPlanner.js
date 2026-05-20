/**
 * Search Planner — construiește o strategie de căutare structurată
 * Input: intent natural + geo context + preferințe utilizator
 * Output: plan executabil cu surse, filtre, deduplicare, scoring
 */

const locationExpander = require('./locationExpander');
const { infer: geoInfer } = require('./geoInferenceEngine');
const { extractRooms, extractPrice } = require('./listingNormalizer');

/**
 * Construiește planul de search
 * @param {object} intent - { text, city, zone_text, rooms, price_max, price_min, type }
 * @param {object} memory - { preferred_areas, budget, rooms, lifestyle } din GeoPreference
 * @returns {SearchPlan}
 */
async function buildSearchPlan(intent, memory = {}) {
    const city = intent.city || memory.city || 'Sibiu';
    const locationText = intent.zone_text || intent.text || '';

    // ── 1. Extrage parametrii din text ─────────────────────────────────────
    const rooms_from_text = intent.rooms || extractRooms(intent.text) || memory.rooms || null;
    const { price: price_max_text } = extractPrice(intent.text);
    const price_max = intent.price_max || price_max_text || memory.price_max || null;
    const price_min = intent.price_min || memory.price_min || null;
    const property_type = intent.type || memory.property_type || 'apartment';

    // ── 2. Inferență semantică din text ────────────────────────────────────
    const inferred = await geoInfer(locationText || intent.text, {
        useGemini: false,
        context: { budget: price_max, rooms: rooms_from_text },
    });

    // ── 3. Rezolvă zonele ──────────────────────────────────────────────────
    let expanded;
    if (locationText) {
        expanded = await locationExpander.expand(locationText, { city, maxAreas: 6, includeNearby: true });
    } else if (inferred.zones.length > 0) {
        // Folosim zonele din inferență ca fallback
        expanded = {
            areas: inferred.zones.map(z => ({ id: z.id, name: z.name, lat: z.lat, lng: z.lng, radius_km: z.radius_km, tags: z.tags, price_index: z.price_index, source: 'inferred' })),
            olxQueries: [],
            imobiliareQueries: [],
            resolved: { text: 'lifestyle inference', method: 'inference' },
            meta: { city },
        };
    } else if (memory.preferred_areas && memory.preferred_areas.length > 0) {
        // Fallback: zona memorată
        expanded = await locationExpander.expand(memory.preferred_areas.join(' '), { city });
    } else {
        // Fallback total: tot Sibiu
        expanded = await locationExpander.expand(city, { city });
    }

    // ── 4. Merge zone cu inferență dacă complementare ──────────────────────
    const zoneIds = new Set(expanded.areas.map(a => a.id));
    for (const z of inferred.zones) {
        if (!zoneIds.has(z.id)) {
            expanded.areas.push({ id: z.id, name: z.name, lat: z.lat, lng: z.lng, radius_km: z.radius_km, tags: z.tags, price_index: z.price_index, source: 'inferred' });
            zoneIds.add(z.id);
        }
    }

    // ── 5. Construiește sursele de search ──────────────────────────────────
    const sources = buildSources(expanded, { city, property_type, price_min, price_max, rooms: rooms_from_text });

    // ── 6. Criterii de filtrare ────────────────────────────────────────────
    const filters = {
        price_min: price_min || null,
        price_max: price_max || null,
        rooms: rooms_from_text ? (Array.isArray(rooms_from_text) ? rooms_from_text : [rooms_from_text]) : null,
        area_min: intent.area_min || memory.area_min || null,
        area_max: intent.area_max || memory.area_max || null,
        property_type,
        zone_ids: expanded.areas.map(a => a.id),
        avoid_zones: inferred.avoid_zones || [],
    };

    // ── 7. Scoring weights ─────────────────────────────────────────────────
    const scoring = {
        price_weight: 0.3,
        zone_match_weight: 0.25,
        area_weight: 0.2,
        negotiation_potential_weight: 0.15,
        freshness_weight: 0.1,
    };

    // ── 8. Planul final ────────────────────────────────────────────────────
    return {
        city,
        zones: expanded.areas,
        sources,
        filters,
        scoring,
        strategy: [
            'expand_zones',
            'search_multiple_sources',
            'normalize_listings',
            'extract_zone_from_description',
            'deduplicate',
            'filter',
            'score',
            'lead_intel_top_k',
        ],
        meta: {
            location_resolved: expanded.resolved,
            inferred_tags: inferred.tags,
            lifestyle: inferred.lifestyles,
            rooms: rooms_from_text,
            price_max,
            city,
            planned_at: new Date().toISOString(),
        },
    };
}

function buildSources(expanded, params) {
    const { city, property_type, price_min, price_max, rooms } = params;
    const citySlug = city.toLowerCase().replace(/[^a-z]/g, '');
    const sources = [];

    // OLX — căutare per zonă
    for (const area of expanded.areas.slice(0, 4)) {
        const nameSlug = area.name.toLowerCase()
            .replace(/ș/g, 's').replace(/ț/g, 't').replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
            .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

        let olxUrl = `https://www.olx.ro/imobiliare/apartamente-garsoniere-de-vanzare/${citySlug}/`;
        const params_arr = [];
        if (price_max) params_arr.push(`search%5Bfilter_float_price%3Ato%5D=${price_max}`);
        if (price_min) params_arr.push(`search%5Bfilter_float_price%3Afrom%5D=${price_min}`);
        if (rooms) params_arr.push(`search%5Bfilter_enum_rooms%5D%5B0%5D=${rooms}`);
        if (params_arr.length) olxUrl += '?' + params_arr.join('&');

        sources.push({
            source: 'olx',
            area_id: area.id,
            area_name: area.name,
            url: olxUrl,
            search_query: `apartament ${area.name} sibiu`,
            priority: area.source === 'primary' ? 1 : 2,
        });
    }

    // Imobiliare.ro — per zonă
    for (const area of expanded.areas.slice(0, 3)) {
        const nameSlug = area.name.toLowerCase()
            .replace(/ș/g, 's').replace(/ț/g, 't').replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
            .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

        let imobUrl = `https://www.imobiliare.ro/vanzare-apartamente/${citySlug}/${nameSlug}/`;
        const params_arr = [];
        if (price_max) params_arr.push(`pret-max=${price_max}`);
        if (rooms) params_arr.push(`numar-camere=${rooms}`);
        if (params_arr.length) imobUrl += '?' + params_arr.join('&');

        sources.push({
            source: 'imobiliare',
            area_id: area.id,
            area_name: area.name,
            url: imobUrl,
            search_query: `${area.name} ${city}`,
            priority: area.source === 'primary' ? 1 : 2,
        });
    }

    return sources.sort((a, b) => a.priority - b.priority);
}

module.exports = { buildSearchPlan };
