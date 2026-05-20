/**
 * Geo Resolver — transformă text în zone reale cu coordonate
 * Input: "centru", "langa mall", "aproape de ULBS"
 * Output: { city, areas[], coordinates, radius_km }
 */

const { SIBIU_ZONES, SIBIU_POIS, LIFESTYLE_MAP } = require('./sibiu/zones');

// Nominatim geocoding cu rate limit respectat
let lastNominatimCall = 0;
async function nominatimGeocode(query, city = 'Sibiu') {
    const now = Date.now();
    if (now - lastNominatimCall < 1100) await new Promise(r => setTimeout(r, 1100 - (now - lastNominatimCall)));
    lastNominatimCall = Date.now();

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${query}, ${city}, Romania`)}&format=json&limit=1&addressdetails=1`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'USAApp-GeoBrain/1.0 eneflorian@mail.com' }, signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        return data[0] ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name } : null;
    } catch { return null; }
}

// Calculează distanța Haversine în km
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Găsește zona după alias exact sau fuzzy
function findZoneByAlias(text) {
    const lower = text.toLowerCase().trim();
    // Exact match pe alias
    for (const zone of SIBIU_ZONES) {
        if (zone.aliases.some(a => lower === a || lower.includes(a) || a.includes(lower))) {
            return zone;
        }
    }
    // Fuzzy: cel mai bun overlap
    let best = null, bestScore = 0;
    for (const zone of SIBIU_ZONES) {
        for (const alias of zone.aliases) {
            const words = alias.split(' ');
            const matches = words.filter(w => lower.includes(w) && w.length > 3);
            const score = matches.length / words.length;
            if (score > bestScore && score > 0.5) { bestScore = score; best = zone; }
        }
    }
    return best;
}

// Găsește POI după text
function findPOI(text) {
    const lower = text.toLowerCase();
    for (const [key, poi] of Object.entries(SIBIU_POIS)) {
        if (lower.includes(key)) return poi;
    }
    return null;
}

// Extinde zona cu vecinii apropiați dacă radius > zona
function expandWithNeighbors(zone, radiusKm = null) {
    const targetRadius = radiusKm || zone.radius_km;
    const result = [zone];
    if (targetRadius > zone.radius_km * 0.8) {
        for (const nearbyId of zone.nearby_areas) {
            const nearby = SIBIU_ZONES.find(z => z.id === nearbyId);
            if (nearby) {
                const dist = haversineKm(zone.lat, zone.lng, nearby.lat, nearby.lng);
                if (dist <= targetRadius + nearby.radius_km) result.push(nearby);
            }
        }
    }
    return result;
}

/**
 * Core resolver — principala funcție publică
 * @param {string} input - text liber: "aproape de centru", "turnisor", "langa promenada"
 * @param {object} opts - { city: 'Sibiu', radiusOverride: 3 }
 * @returns {{ zones: Zone[], center: {lat,lng}|null, radius_km: number, resolved_text: string, method: string }}
 */
async function resolve(input, opts = {}) {
    const city = opts.city || 'Sibiu';
    const lower = input.toLowerCase().trim();

    // 1. POI match — "langa promenada", "aproape de ulbs"
    const poi = findPOI(lower);
    if (poi) {
        const anchorZone = SIBIU_ZONES.find(z => z.id === poi.area_id) || SIBIU_ZONES.find(z => z.id === 'sibiu_general');
        const radius = opts.radiusOverride || poi.radius_km;
        const zones = expandWithNeighbors(anchorZone, radius);
        return {
            zones, poi,
            center: { lat: poi.lat, lng: poi.lng },
            radius_km: radius,
            resolved_text: poi.name,
            method: 'poi_match',
        };
    }

    // 2. Direct zone alias match
    const zone = findZoneByAlias(lower);
    if (zone && zone.id !== 'sibiu_general') {
        const radius = opts.radiusOverride || zone.radius_km;
        const zones = expandWithNeighbors(zone, radius);
        return {
            zones,
            center: { lat: zone.lat, lng: zone.lng },
            radius_km: radius,
            resolved_text: zone.name,
            method: 'alias_match',
        };
    }

    // 3. Lifestyle inference — "bun pentru studenti", "linistit", "ieftin"
    for (const [tag, zoneIds] of Object.entries(LIFESTYLE_MAP)) {
        if (lower.includes(tag)) {
            const zones = zoneIds.map(id => SIBIU_ZONES.find(z => z.id === id)).filter(Boolean);
            if (zones.length > 0) {
                return {
                    zones,
                    center: null,
                    radius_km: opts.radiusOverride || 2.0,
                    resolved_text: `Zone ${tag}`,
                    method: 'lifestyle_inference',
                    lifestyle_tag: tag,
                };
            }
        }
    }

    // 4. Proximity patterns — "aproape de X", "langa X", "la X minute de Y"
    const proximityPatterns = [
        /aproape de (.+)/i,
        /lângă (.+)/i,
        /langa (.+)/i,
        /la \d+ minute? de (.+)/i,
        /în zona (.+)/i,
        /in zona (.+)/i,
        /zona (.+)/i,
        /cartier (.+)/i,
    ];
    for (const pattern of proximityPatterns) {
        const match = lower.match(pattern);
        if (match) {
            const innerResolved = await resolve(match[1].trim(), { city, radiusOverride: opts.radiusOverride || 2.5 });
            if (innerResolved.method !== 'nominatim_fallback' || innerResolved.zones.length > 0) {
                return { ...innerResolved, method: `proximity_${innerResolved.method}` };
            }
        }
    }

    // 5. Nominatim fallback + match la zona cea mai apropiată
    const geocoded = await nominatimGeocode(input, city);
    if (geocoded) {
        let closestZone = null, closestDist = Infinity;
        for (const z of SIBIU_ZONES.filter(z => z.id !== 'sibiu_general')) {
            const dist = haversineKm(geocoded.lat, geocoded.lng, z.lat, z.lng);
            if (dist < closestDist) { closestDist = dist; closestZone = z; }
        }
        if (closestZone && closestDist < 5) {
            const radius = opts.radiusOverride || Math.max(closestZone.radius_km, closestDist + 0.5);
            return {
                zones: [closestZone],
                center: { lat: geocoded.lat, lng: geocoded.lng },
                radius_km: radius,
                resolved_text: geocoded.display,
                method: 'nominatim_fallback',
            };
        }
    }

    // 6. Fallback: întreg Sibiul
    return {
        zones: [SIBIU_ZONES.find(z => z.id === 'sibiu_general')],
        center: { lat: 45.7973, lng: 24.1519 },
        radius_km: 10,
        resolved_text: 'Sibiu (general)',
        method: 'city_fallback',
    };
}

module.exports = { resolve, findZoneByAlias, findPOI, haversineKm, nominatimGeocode };
