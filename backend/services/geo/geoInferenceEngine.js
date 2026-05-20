/**
 * Geo Inference Engine — inferențe semantice din text natural
 * "bun pentru studenți" → { student_friendly: true, near_university: true }
 * "liniștit, pentru familie" → { family: true, quiet: true, zones: [hipodrom, ...] }
 */

const { SIBIU_ZONES, LIFESTYLE_MAP } = require('./sibiu/zones');
const { getGeminiModel } = require('../../configService');

// ── Inferențe rule-based (fără LLM) ──────────────────────────────────────

const INFERENCE_RULES = [
    // Student
    { patterns: [/studen[tț]/i, /campus/i, /c[aă]min/i, /ulbs/i, /facultate/i, /universitate/i],
      tags: ['student_friendly', 'near_university', 'affordable'],
      lifestyle: 'student' },

    // Familie
    { patterns: [/famil/i, /copii/i, /copil/i, /gr[aă]dini[tț][aă]/i, /s[cš]oal[aă]/i, /parc/i],
      tags: ['family_friendly', 'schools', 'park'],
      lifestyle: 'familie' },

    // Pensionar / senior
    { patterns: [/pensionar/i, /senior/i, /v[aâ]rsta a treia/i, /linistit/i, /liniștit/i],
      tags: ['quiet', 'accessible'],
      lifestyle: 'pensionar' },

    // Investiție
    { patterns: [/investi[tț]i[eie]/i, /inchiriere/i, /închiriere/i, /randament/i, /profit/i],
      tags: ['investment', 'rental_yield'],
      lifestyle: 'investitie' },

    // Liniștit
    { patterns: [/linistit/i, /liniștit/i, /quiet/i, /pace/i, /ver[dz]e/i, /natur[aă]/i],
      tags: ['quiet', 'nature'],
      lifestyle: 'linistit' },

    // Transport
    { patterns: [/transport/i, /autobuz/i, /troleibuz/i, /statie/i, /stație/i, /acces/i],
      tags: ['good_transport'],
      lifestyle: 'transport' },

    // Buget
    { patterns: [/ieftin/i, /accesibil/i, /buget/i, /economic/i],
      tags: ['affordable'],
      lifestyle: 'ieftin' },
    { patterns: [/premium/i, /lux/i, /exclusiv/i, /scump/i],
      tags: ['premium', 'luxury'],
      lifestyle: 'premium' },

    // Aproape de centru
    { patterns: [/central/i, /centru/i, /aproape de tot/i, /la îndemân[aă]/i],
      tags: ['central'],
      lifestyle: 'central' },
];

/**
 * Inferență rule-based rapidă
 * @param {string} text
 * @returns {{ tags: string[], lifestyles: string[], zones: Zone[], confidence: number }}
 */
function inferRuleBased(text) {
    const lower = text.toLowerCase();
    const detectedTags = new Set();
    const detectedLifestyles = new Set();

    for (const rule of INFERENCE_RULES) {
        if (rule.patterns.some(p => p.test(lower))) {
            rule.tags.forEach(t => detectedTags.add(t));
            if (rule.lifestyle) detectedLifestyles.add(rule.lifestyle);
        }
    }

    // Colectează zonele compatibile
    const zoneScores = new Map();
    for (const lifestyle of detectedLifestyles) {
        const zoneIds = LIFESTYLE_MAP[lifestyle] || [];
        zoneIds.forEach((id, idx) => {
            const score = zoneIds.length - idx; // mai puțin = prioritate mai mare
            zoneScores.set(id, (zoneScores.get(id) || 0) + score);
        });
    }

    // Filtrează zone prin tags dacă există tag-uri detectate
    if (detectedTags.size > 0) {
        for (const zone of SIBIU_ZONES.filter(z => z.id !== 'sibiu_general')) {
            const matchingTags = zone.tags.filter(t => detectedTags.has(t));
            if (matchingTags.length > 0) {
                zoneScores.set(zone.id, (zoneScores.get(zone.id) || 0) + matchingTags.length * 2);
            }
        }
    }

    const sortedZoneIds = Array.from(zoneScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);

    const zones = sortedZoneIds
        .map(id => SIBIU_ZONES.find(z => z.id === id))
        .filter(Boolean);

    return {
        tags: Array.from(detectedTags),
        lifestyles: Array.from(detectedLifestyles),
        zones,
        confidence: detectedTags.size > 0 || detectedLifestyles.size > 0 ? 0.75 : 0,
        method: 'rule_based',
    };
}

/**
 * Inferență cu Gemini — pentru cazuri complexe
 * @param {string} text
 * @param {object} context - { existingZones, budget, rooms }
 */
async function inferWithGemini(text, context = {}) {
    const model = await getGeminiModel(`Ești un expert imobiliar în Sibiu, România.
Cunoști toate cartierele și caracteristicile lor.
Răspunzi DOAR cu JSON valid, fără markdown sau explicații.`);

    const zonesContext = SIBIU_ZONES
        .filter(z => z.id !== 'sibiu_general')
        .map(z => `${z.id}: ${z.name} (tags: ${z.tags.join(', ')}, pret_index: ${z.price_index})`)
        .join('\n');

    const prompt = `Analizează cererea imobiliară și returnează inferențe pentru Sibiu.

CERERE: "${text}"
${context.budget ? `BUGET: ${context.budget} EUR` : ''}
${context.rooms ? `CAMERE: ${context.rooms}` : ''}

CARTIERE DISPONIBILE:
${zonesContext}

Returnează JSON:
{
  "inferred_tags": ["student_friendly", "quiet", etc.],
  "recommended_zone_ids": ["hipodrom", "centru", etc.],
  "price_range": { "min": null, "max": null, "currency": "EUR" },
  "rooms_inferred": null,
  "reasoning": "1 propoziție explicație",
  "lifestyle": "student/familie/investitor/pensionar/general",
  "avoid_zones": ["zone de evitat dacă e cazul"]
}`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
        const parsed = JSON.parse(text);

        const zones = (parsed.recommended_zone_ids || [])
            .map(id => SIBIU_ZONES.find(z => z.id === id))
            .filter(Boolean);

        return {
            tags: parsed.inferred_tags || [],
            lifestyles: [parsed.lifestyle].filter(Boolean),
            zones,
            price_range: parsed.price_range || null,
            rooms_inferred: parsed.rooms_inferred || null,
            avoid_zones: parsed.avoid_zones || [],
            reasoning: parsed.reasoning || '',
            confidence: 0.85,
            method: 'gemini',
        };
    } catch (err) {
        console.warn('[GeoInference] Gemini failed, falling back to rules:', err.message);
        return null;
    }
}

/**
 * Main inference — combină rule-based + Gemini
 */
async function infer(text, opts = {}) {
    const { useGemini = false, context = {} } = opts;

    const ruleBased = inferRuleBased(text);

    if (ruleBased.confidence > 0.7 && !useGemini) {
        return ruleBased;
    }

    if (useGemini) {
        const geminiResult = await inferWithGemini(text, context);
        if (geminiResult) {
            // Merge: tags din ambele, zone din Gemini (mai precis)
            return {
                ...geminiResult,
                tags: [...new Set([...ruleBased.tags, ...geminiResult.tags])],
                zones: geminiResult.zones.length > 0 ? geminiResult.zones : ruleBased.zones,
            };
        }
    }

    return ruleBased;
}

// Filtrare listing după criterii geo
function filterListingByGeo(listing, criteria) {
    const { min_price, max_price, rooms, area_min, area_max, zone_ids } = criteria;

    if (min_price && listing.price < min_price) return false;
    if (max_price && listing.price > max_price) return false;
    if (rooms && listing.rooms && !rooms.includes(listing.rooms)) return false;
    if (area_min && listing.area_sqm && listing.area_sqm < area_min) return false;
    if (area_max && listing.area_sqm && listing.area_sqm > area_max) return false;

    if (zone_ids && zone_ids.length > 0 && listing.location_zone) {
        if (!zone_ids.includes(listing.location_zone.id)) return false;
    }

    return true;
}

module.exports = { infer, inferRuleBased, inferWithGemini, filterListingByGeo };
