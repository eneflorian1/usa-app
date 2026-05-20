/**
 * Location Expander — extinde o zonă la toate ariile relevante pentru search
 * Input: "apartament aproape de centru"
 * Output: { areas: ["Centru", "Piata Mare", "Orasul de Jos", ...], radius_km: 2, queries: [...] }
 */

const geoResolver = require('./geoResolver');
const { SIBIU_ZONES } = require('./sibiu/zones');

// Regex patterns care implică "aproape de" — radius mai mare
const PROXIMITY_PHRASES = [
    /aproape de/i, /lângă/i, /langa/i, /la \d+ minute/i,
    /în zonă/i, /in zona/i, /nu departe/i, /acces rapid/i
];

// Detectează dacă input implică proximitate (nu exact)
function isProximityQuery(text) {
    return PROXIMITY_PHRASES.some(p => p.test(text));
}

/**
 * Expandează locație la set de zone pentru search
 * @param {string} locationText - text liber
 * @param {object} opts - { city, maxAreas, includeNearby, radiusBoost }
 * @returns {{ areas: {id,name,lat,lng,radius}[], olxQueries: string[], imobiliareQueries: string[], meta: object }}
 */
async function expand(locationText, opts = {}) {
    const {
        city = 'Sibiu',
        maxAreas = 6,
        includeNearby = true,
        radiusBoost = isProximityQuery(locationText) ? 1.5 : 1.0,
    } = opts;

    const resolved = await geoResolver.resolve(locationText, { city, radiusOverride: null });

    // Colectează toate zonele unice
    const seen = new Set();
    const allZones = [];

    for (const zone of resolved.zones) {
        if (!seen.has(zone.id)) {
            seen.add(zone.id);
            allZones.push({ ...zone, source: 'primary' });
        }

        // Adaugă vecini dacă includeNearby
        if (includeNearby && resolved.method !== 'city_fallback') {
            for (const nearbyId of zone.nearby_areas || []) {
                if (!seen.has(nearbyId)) {
                    const nb = SIBIU_ZONES.find(z => z.id === nearbyId);
                    if (nb) {
                        seen.add(nb.id);
                        allZones.push({ ...nb, source: 'nearby' });
                    }
                }
            }
        }
    }

    // Limitează la maxAreas, prioritizând primary
    const primary = allZones.filter(z => z.source === 'primary');
    const nearby = allZones.filter(z => z.source === 'nearby');
    const finalZones = [...primary, ...nearby].slice(0, maxAreas);

    // Generează query strings pentru OLX
    const olxQueries = generateOlxQueries(finalZones, city);
    // Generează query strings pentru imobiliare.ro
    const imobiliareQueries = generateImobiliareQueries(finalZones, city);

    return {
        areas: finalZones.map(z => ({
            id: z.id,
            name: z.name,
            lat: z.lat,
            lng: z.lng,
            radius_km: z.radius_km * radiusBoost,
            tags: z.tags,
            price_index: z.price_index,
            source: z.source,
        })),
        olxQueries,
        imobiliareQueries,
        resolved: {
            text: resolved.resolved_text,
            method: resolved.method,
            center: resolved.center,
            lifestyle_tag: resolved.lifestyle_tag || null,
        },
        meta: { city, totalAreas: finalZones.length, radiusBoost },
    };
}

function generateOlxQueries(zones, city) {
    const queries = [];
    const citySlug = city.toLowerCase().replace(/[^a-z]/g, '');

    for (const zone of zones) {
        // OLX search cu nume zonă
        const nameSlug = zone.name.toLowerCase()
            .replace(/ș/g, 's').replace(/ț/g, 't').replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
            .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

        queries.push({
            area_id: zone.id,
            area_name: zone.name,
            url: `https://www.olx.ro/imobiliare/apartamente-garsoniere-de-vanzare/${citySlug}/?search%5Bfilter_float_price%3Afrom%5D=&search%5Bfilter_float_price%3Ato%5D=`,
            search_term: zone.name,
            type: 'olx_city_filter',
        });

        // OLX căutare directă
        queries.push({
            area_id: zone.id,
            area_name: zone.name,
            url: `https://www.olx.ro/oferte/q-apartament-${nameSlug}/`,
            search_term: `apartament ${zone.name}`,
            type: 'olx_search',
        });
    }

    return queries;
}

function generateImobiliareQueries(zones, city) {
    const queries = [];
    const citySlug = city.toLowerCase().replace(/[^a-z]/g, '');

    for (const zone of zones) {
        const nameSlug = zone.name.toLowerCase()
            .replace(/ș/g, 's').replace(/ț/g, 't').replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
            .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

        queries.push({
            area_id: zone.id,
            area_name: zone.name,
            url: `https://www.imobiliare.ro/vanzare-apartamente/${citySlug}/${nameSlug}/?id=&pagina=1`,
            search_term: zone.name,
            type: 'imobiliare_area',
        });
    }

    return queries;
}

module.exports = { expand, isProximityQuery };
