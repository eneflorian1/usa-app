/**
 * OLX Agent — scraper structurat pentru OLX imobiliare
 * Primește: { city, areas[], price_max, rooms, property_type }
 * Returnează: Listing[] normalizate + zone inferred
 */

const { normalize, extractZoneFromDescription } = require('./listingNormalizer');
const { getGeminiModel } = require('../../configService');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
    'Referer': 'https://www.google.com/',
};

// Fetch cu timeout
async function fetchHtml(url, timeoutMs = 15000) {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

// Extrage listinguri din HTML OLX via Gemini
async function extractListingsFromOlxHtml(html, area) {
    const model = await getGeminiModel(`Ești un extractor de date din paginile OLX.
Returnezi DOAR JSON valid, un array de obiecte, fără markdown.`);

    const result = await model.generateContent(`Extrage TOATE anunțurile imobiliare vizibile din acest HTML OLX.

Pentru fiecare anunț returnează:
{
  "title": "titlul anunțului",
  "price": număr sau null,
  "currency": "EUR sau RON",
  "location": "zona/cartierul menționat",
  "rooms": număr sau null,
  "area_sqm": suprafata mp sau null,
  "url": "link complet spre anunț",
  "description": "primele 200 caractere descriere dacă există"
}

Returnează array JSON. Dacă nu găsești anunțuri returnează [].

HTML (primele 25000 caractere):
${html.substring(0, 25000)}`);

    const text = result.response.text().trim()
        .replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    try {
        return JSON.parse(text);
    } catch { return []; }
}

/**
 * Caută listinguri pe OLX pentru o zonă
 * @param {object} searchParams - { city, area, price_max, price_min, rooms, property_type }
 * @returns {Listing[]}
 */
async function searchOlxArea({ city = 'Sibiu', area, price_max, price_min, rooms, property_type = 'apartment' }) {
    const citySlug = city.toLowerCase().replace(/[^a-z]/g, '');
    const params = [];
    if (price_max) params.push(`search%5Bfilter_float_price%3Ato%5D=${price_max}`);
    if (price_min) params.push(`search%5Bfilter_float_price%3Afrom%5D=${price_min}`);
    if (rooms) {
        const roomsArr = Array.isArray(rooms) ? rooms : [rooms];
        roomsArr.forEach((r, i) => params.push(`search%5Bfilter_enum_rooms%5D%5B${i}%5D=${r}`));
    }

    const baseUrl = `https://www.olx.ro/imobiliare/apartamente-garsoniere-de-vanzare/${citySlug}/`;
    const url = params.length ? `${baseUrl}?${params.join('&')}` : baseUrl;

    console.log(`[OLX Agent] Fetching: ${url}`);
    const html = await fetchHtml(url);
    const raw = await extractListingsFromOlxHtml(html, area);

    return raw.map(item => ({
        ...normalize({ ...item, source: 'olx' }),
        source_url: url,
        area_search: area ? area.name : null,
    }));
}

/**
 * Caută pe OLX cu text liber (fallback când nu avem zonă)
 */
async function searchOlxQuery(query, city = 'Sibiu') {
    const querySlug = query.toLowerCase()
        .replace(/ș/g, 's').replace(/ț/g, 't').replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
        .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');

    const url = `https://www.olx.ro/oferte/q-${querySlug}/`;
    const html = await fetchHtml(url);
    const raw = await extractListingsFromOlxHtml(html, null);

    return raw.map(item => normalize({ ...item, source: 'olx_search' }));
}

/**
 * Main — execută planul de search pentru mai multe zone
 * @param {SearchPlan} plan - output din searchPlanner
 * @returns {{ listings: Listing[], stats: object }}
 */
async function executeSearchPlan(plan) {
    const allListings = [];
    const urlsSeen = new Set();
    const stats = { sources_tried: 0, raw_count: 0, deduplicated: 0, errors: [] };

    // Execută sursele în paralel (max 3 concurrent)
    const olxSources = plan.sources.filter(s => s.source === 'olx').slice(0, 3);

    const results = await Promise.allSettled(
        olxSources.map(source => searchOlxArea({
            city: plan.city,
            area: plan.zones.find(z => z.id === source.area_id),
            price_max: plan.filters.price_max,
            price_min: plan.filters.price_min,
            rooms: plan.filters.rooms ? plan.filters.rooms[0] : null,
        }))
    );

    for (let i = 0; i < results.length; i++) {
        stats.sources_tried++;
        const r = results[i];
        if (r.status === 'fulfilled') {
            for (const listing of r.value) {
                stats.raw_count++;
                const key = listing.url || listing.title;
                if (key && !urlsSeen.has(key)) {
                    urlsSeen.add(key);
                    allListings.push(listing);
                } else {
                    stats.deduplicated++;
                }
            }
        } else {
            stats.errors.push(r.reason?.message || 'unknown');
        }
    }

    // Aplică filtre
    const filtered = allListings.filter(l => {
        if (plan.filters.price_max && l.price && l.price > plan.filters.price_max) return false;
        if (plan.filters.price_min && l.price && l.price < plan.filters.price_min) return false;
        if (plan.filters.rooms && plan.filters.rooms.length > 0 && l.rooms) {
            if (!plan.filters.rooms.includes(l.rooms)) return false;
        }
        return true;
    });

    // Sortează după preț
    filtered.sort((a, b) => {
        if (!a.price) return 1;
        if (!b.price) return -1;
        return a.price - b.price;
    });

    return { listings: filtered, stats };
}

module.exports = { searchOlxArea, searchOlxQuery, executeSearchPlan };
