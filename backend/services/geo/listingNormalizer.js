/**
 * Listing Normalizer — normalizează câmpuri haotice din OLX/imobiliare.ro
 * Input: { title: "ap 2 cam, zona centru, 85mp, et 3" }
 * Output: { rooms: 2, area_sqm: 85, floor: 3, zone_hint: "centru", ... }
 */

const { findZoneByAlias, findPOI } = require('./geoResolver');

// ── Camere ─────────────────────────────────────────────────────────────────

const ROOM_PATTERNS = [
    // Explicit cu cifre
    [/\b(\d)\s*cam(?:ere|era|)?\b/i, m => parseInt(m[1])],
    [/\b(\d)\s*room/i, m => parseInt(m[1])],
    [/apartament\s+(?:cu\s+)?(\d)\s*cam/i, m => parseInt(m[1])],
    [/ap\.?\s+(\d)\s*cam/i, m => parseInt(m[1])],
    // Litere
    [/\bdouă\s*cam/i, () => 2], [/\bdoua\s*cam/i, () => 2],
    [/\btrei\s*cam/i, () => 3], [/\bpatru\s*cam/i, () => 4],
    [/\buna?\s*cam/i, () => 1], [/\bunu?\s*cam/i, () => 1],
    // Garsonieră
    [/garsonier[aă]/i, () => 1],
    // Studio
    [/\bstudio\b/i, () => 1],
    // Decomandat — extrage din context
    [/\b(\d)[+\s]*[/]?\s*(?:dec|decomandat)/i, m => parseInt(m[1])],
    // 2+1, 3+1
    [/\b(\d)\s*\+\s*1\b/, m => parseInt(m[1]) + 1],
];

function extractRooms(text) {
    if (!text) return null;
    for (const [pattern, extractor] of ROOM_PATTERNS) {
        const m = text.match(pattern);
        if (m) {
            const rooms = extractor(m);
            if (rooms >= 1 && rooms <= 10) return rooms;
        }
    }
    return null;
}

// ── Suprafață ──────────────────────────────────────────────────────────────

function extractArea(text) {
    if (!text) return null;
    const patterns = [
        /(\d{2,3})\s*m[²2p]?(?:\s|,|\.)/i,
        /suprafata[:\s]+(\d{2,3})/i,
        /(\d{2,3})\s*mp\b/i,
        /(\d{2,3})\s*metri\s*patrati/i,
        /(\d{2,3})\s*sqm/i,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) {
            const area = parseInt(m[1]);
            if (area >= 15 && area <= 500) return area;
        }
    }
    return null;
}

// ── Etaj ──────────────────────────────────────────────────────────────────

function extractFloor(text) {
    if (!text) return null;
    const patterns = [
        [/etaj\s*(\d{1,2})/i, m => parseInt(m[1])],
        [/et\.?\s*(\d{1,2})/i, m => parseInt(m[1])],
        [/parter/i, () => 0],
        [/\bsutero?n/i, () => -1],
    ];
    for (const [p, ex] of patterns) {
        const m = text.match(p);
        if (m) return ex(m);
    }
    return null;
}

// ── Preț ──────────────────────────────────────────────────────────────────

function extractPrice(text) {
    if (!text) return { price: null, currency: null };
    // EUR
    let m = text.match(/(\d[\d.,\s]{1,10})\s*(?:eur|€)/i);
    if (m) return { price: parseFloat(m[1].replace(/[.,\s]/g, '').replace(',', '.')), currency: 'EUR' };
    // RON
    m = text.match(/(\d[\d.,\s]{1,10})\s*(?:ron|lei|mdl)/i);
    if (m) return { price: parseFloat(m[1].replace(/[.,\s]/g, '').replace(',', '.')), currency: 'RON' };
    // Număr simplu mare (probabil EUR sau RON)
    m = text.match(/^(\d[\d.,]{3,})\s*$/);
    if (m) {
        const val = parseFloat(m[1].replace(/[.,]/g, ''));
        if (val > 10000) return { price: val, currency: 'unknown' };
    }
    return { price: null, currency: null };
}

// ── Zonă din descriere (NLP light) ─────────────────────────────────────────

function extractZoneFromDescription(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    // Caută menționarea unui POI
    const poi = findPOI(lower);
    if (poi) return { zone: poi.name, zone_id: poi.area_id, confidence: 0.85, method: 'poi_description' };

    // Caută alias zonă
    const zone = findZoneByAlias(lower);
    if (zone && zone.id !== 'sibiu_general') {
        return { zone: zone.name, zone_id: zone.id, confidence: 0.75, method: 'alias_description' };
    }

    // Patterns de proximitate
    const proximityPatterns = [
        /la\s+(\d+)\s+minute\s+de\s+(.{3,30})/i,
        /la\s+(\d+)\s+min\s+de\s+(.{3,20})/i,
        /la\s+\d+\s+m\s+de\s+(.{3,20})/i,
        /vis-a-vis\s+de\s+(.{3,20})/i,
        /în\s+spatele\s+(.{3,20})/i,
        /lângă\s+(.{3,20})/i,
        /langa\s+(.{3,20})/i,
    ];

    for (const p of proximityPatterns) {
        const m = lower.match(p);
        if (m) {
            const landmark = m[m.length - 1].trim();
            const poi2 = findPOI(landmark);
            if (poi2) return { zone: poi2.name, zone_id: poi2.area_id, confidence: 0.7, method: 'proximity_poi' };
            const z2 = findZoneByAlias(landmark);
            if (z2 && z2.id !== 'sibiu_general') return { zone: z2.name, zone_id: z2.id, confidence: 0.65, method: 'proximity_zone' };
        }
    }

    return null;
}

// ── Tip proprietate ──────────────────────────────────────────────────────

function extractPropertyType(text) {
    if (!text) return 'unknown';
    const lower = text.toLowerCase();
    if (/garsonier/i.test(lower)) return 'studio';
    if (/cas[aă]|vil[aă]|duplex/i.test(lower)) return 'house';
    if (/teren|lot/i.test(lower)) return 'land';
    if (/comercial|birou|spatiu/i.test(lower)) return 'commercial';
    if (/apartament|ap\b|cam(?:ere)?/i.test(lower)) return 'apartment';
    return 'apartment'; // default imobiliar
}

// ── Master normalizer ─────────────────────────────────────────────────────

/**
 * Normalizează un listing raw din OLX/imobiliare
 * @param {object} raw - { title, description, price, location, ... }
 * @returns {object} normalized listing
 */
function normalize(raw) {
    const combinedText = [raw.title, raw.description, raw.location].filter(Boolean).join(' ');

    const rooms = raw.rooms != null ? parseInt(raw.rooms) : extractRooms(combinedText);
    const area_sqm = raw.area != null ? parseFloat(raw.area) : extractArea(combinedText);
    const floor = raw.floor != null ? parseInt(raw.floor) : extractFloor(combinedText);
    const { price, currency } = raw.price
        ? { price: parseFloat(String(raw.price).replace(/[^0-9.]/g, '')), currency: raw.currency || 'EUR' }
        : extractPrice(combinedText);

    const zone_hint = raw.location
        ? (findZoneByAlias(raw.location.toLowerCase()) || null)
        : null;

    const zone_from_desc = extractZoneFromDescription(combinedText);

    const property_type = extractPropertyType(combinedText);

    return {
        title: raw.title || '',
        price: isNaN(price) ? null : price,
        currency: currency || 'EUR',
        rooms,
        area_sqm,
        floor,
        property_type,
        location_raw: raw.location || null,
        location_zone: zone_hint ? { id: zone_hint.id, name: zone_hint.name } : null,
        location_from_desc: zone_from_desc,
        url: raw.url || null,
        seller_name: raw.sellerName || raw.seller_name || null,
        phone: raw.phone || null,
        description_snippet: raw.description ? raw.description.substring(0, 300) : null,
        source: raw.source || 'unknown',
        normalized_at: new Date().toISOString(),
    };
}

module.exports = { normalize, extractRooms, extractArea, extractFloor, extractPrice, extractZoneFromDescription, extractPropertyType };
