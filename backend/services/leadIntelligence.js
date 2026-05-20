/**
 * Lead Intelligence Agent
 * Pipeline: Scrape → Analyze → Score → Draft → Create lead + WhatsApp
 */

const { getGeminiModel } = require('../configService');
const { callMcpTool } = require('../mcpBridgeService');

// Wrapper cu timeout pentru orice promise — evită agățarea pe MCP bridge sau Gemini
function withTimeout(promise, ms, label) {
    const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout după ${ms / 1000}s: ${label}`)), ms)
    );
    return Promise.race([promise, timer]);
}

// ── Step 1: Scrape ─────────────────────────────────────────────────────────

async function scrapeListing(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
            'Referer': 'https://www.google.com/',
        },
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`Failed to fetch listing: ${response.status}`);
    const html = await response.text();

    const model = await getGeminiModel(`Ești un agent de extracție date din anunțuri imobiliare/produse.
Extragi informații structurate din HTML-ul unui anunț.
Returnezi DOAR un JSON valid, fără markdown.`);

    const result = await withTimeout(model.generateContent(`Extrage datele din acest anunț și returnează JSON cu exact aceste câmpuri:
{
  "title": "titlul anunțului",
  "price": "prețul ca număr (fără valută)",
  "currency": "RON sau EUR",
  "location": "orașul/zona",
  "area": "suprafața în mp dacă există, altfel null",
  "rooms": "numărul de camere dacă există, altfel null",
  "floor": "etajul dacă există, altfel null",
  "description": "primele 500 caractere din descriere",
  "sellerName": "numele vânzătorului dacă există",
  "phone": "telefonul dacă e vizibil, altfel null",
  "type": "apartment/house/land/commercial/product/other",
  "condition": "new/used/renovated/unknown"
}

HTML (primele 30000 caractere):
${html.substring(0, 30000)}`), 45000, 'scrape Gemini');

    const text = result.response.text().trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(text);
}

// ── Step 2: Analyze ────────────────────────────────────────────────────────

async function analyzeListingContext(listing) {
    let comparables = [];
    try {
        const leads = await withTimeout(callMcpTool('nego_get_leads', { limit: 200 }), 8000, 'nego_get_leads');
        if (Array.isArray(leads)) {
            comparables = leads
                .filter(l => l.price && l.status !== 'rejected')
                .slice(0, 50)
                .map(l => ({ title: l.title, price: l.price, status: l.status }));
        }
    } catch { /* MCP bridge might not be connected */ }

    const model = await getGeminiModel(`Ești un analist imobiliar expert în piața românească.
Analizezi un anunț în context cu alte listinguri similare din baza de date.`);

    const result = await withTimeout(model.generateContent(`Analizează acest listing imobiliar:

ANUNȚ:
${JSON.stringify(listing, null, 2)}

COMPARABILE DIN BD (${comparables.length} leaduri):
${comparables.length > 0 ? JSON.stringify(comparables, null, 2) : 'Nicio dată comparabilă disponibilă.'}

Returnează JSON cu exact aceste câmpuri:
{
  "priceAssessment": "overpriced/fair/underpriced/unknown",
  "estimatedMarketPrice": "estimarea ta în aceeași valută sau null",
  "negotiationRoom": "procent estimat de negociere posibil (ex: 10-15%)",
  "redFlags": ["lista de probleme potențiale"],
  "positives": ["lista de puncte forte"],
  "contextSummary": "2-3 propoziții despre poziționarea anunțului față de piață"
}`), 45000, 'analyze Gemini');

    const text = result.response.text().trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(text);
}

// ── Step 3: Score ──────────────────────────────────────────────────────────

async function scoreLead(listing, analysis) {
    const model = await getGeminiModel(`Ești un evaluator de oportunități imobiliare cu experiență în negociere.
Dai scoruri obiective bazate pe potențialul de negociere și calitatea lead-ului.`);

    const result = await withTimeout(model.generateContent(`Acordă un scor acestui lead de negociere.

LISTING:
${JSON.stringify(listing, null, 2)}

ANALIZĂ:
${JSON.stringify(analysis, null, 2)}

Returnează JSON cu exact aceste câmpuri:
{
  "score": număr între 1 și 10,
  "verdict": "hot/warm/cold",
  "scoreReason": "1-2 propoziții clare de ce ai dat acest scor",
  "recommendedAction": "contact_now/contact_later/skip",
  "suggestedOffer": "oferta inițială recomandată ca număr sau null",
  "suggestedOfferCurrency": "RON sau EUR"
}`), 30000, 'score Gemini');

    const text = result.response.text().trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(text);
}

// ── Step 4: Draft ──────────────────────────────────────────────────────────

async function draftNegotiationMessage(listing, analysis, score) {
    const model = await getGeminiModel(`Ești un negociator expert, politicos și diplomatic.
Scrii mesaje de negociere în română, naturale și convingătoare.
Nu dezvălui că ești AI. Ești direct, la obiect, max 5-6 propoziții.`);

    const result = await withTimeout(model.generateContent(`Scrie un prim mesaj de contact pentru acest anunț.

ANUNȚ: ${listing.title} — ${listing.price} ${listing.currency}
LOCAȚIE: ${listing.location}
EVALUARE: ${analysis.priceAssessment} (spațiu negociere: ${analysis.negotiationRoom})
OFERTĂ RECOMANDATĂ: ${score.suggestedOffer ? `${score.suggestedOffer} ${score.suggestedOfferCurrency}` : 'negociabil'}

Mesajul trebuie să:
1. Exprime interes sincer
2. Ceară detalii suplimentare (disponibilitate vizionare, stare, acte)
3. Lase deschisă negocierea natural, fără a menționa un preț deocamdată
4. Fie în română, ton profesional-prietenos

Returnează DOAR textul mesajului, fără explicații.`), 30000, 'draft Gemini');

    return result.response.text().trim();
}

// ── Pipeline Principal ─────────────────────────────────────────────────────

async function runLeadIntelligencePipeline({ url, chatId, userId = 'default' }) {
    console.log(`[LeadIntelligence] Starting pipeline for: ${url}`);
    const startedAt = Date.now();

    // Step 1: Scrape
    console.log(`[LeadIntelligence] Step 1: Scraping...`);
    const listing = await scrapeListing(url);
    listing.url = url;

    // Step 2: Analyze
    console.log(`[LeadIntelligence] Step 2: Analyzing...`);
    const analysis = await analyzeListingContext(listing);

    // Step 3: Score
    console.log(`[LeadIntelligence] Step 3: Scoring...`);
    const score = await scoreLead(listing, analysis);

    // Step 4: Draft
    console.log(`[LeadIntelligence] Step 4: Drafting message...`);
    const draftMessage = await draftNegotiationMessage(listing, analysis, score);

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    // Step 5: Create lead in negoapp
    let leadCreated = false;
    try {
        await callMcpTool('nego_create_lead', {
            url,
            title: listing.title,
            price: String(listing.price),
            sellerName: listing.sellerName || '',
            phoneNumber: listing.phone || '',
        });
        leadCreated = true;
        console.log(`[LeadIntelligence] Lead created in negoapp`);
    } catch (err) {
        console.warn(`[LeadIntelligence] Could not create lead in negoapp: ${err.message}`);
    }

    // Step 6: Send WhatsApp report
    const verdictEmoji = score.verdict === 'hot' ? '🔥' : score.verdict === 'warm' ? '🟡' : '❄️';
    const actionEmoji = score.recommendedAction === 'contact_now' ? '✅' : score.recommendedAction === 'contact_later' ? '⏳' : '❌';

    const report = [
        `${verdictEmoji} *Lead Intelligence Report*`,
        ``,
        `*${listing.title}*`,
        `💰 ${listing.price} ${listing.currency} — ${listing.location}`,
        `📊 Evaluare: ${analysis.priceAssessment} | Negociere: ${analysis.negotiationRoom}`,
        `⭐ Scor: ${score.score}/10 — ${score.scoreReason}`,
        `${actionEmoji} Acțiune: ${score.recommendedAction}`,
        score.suggestedOffer ? `🎯 Ofertă sugerată: ${score.suggestedOffer} ${score.suggestedOfferCurrency}` : '',
        analysis.redFlags?.length > 0 ? `⚠️ Red flags: ${analysis.redFlags.slice(0, 2).join(', ')}` : '',
        ``,
        `*Mesaj draft:*`,
        draftMessage,
        ``,
        `🔗 ${url}`,
        `_(analizat în ${elapsed}s)_`,
    ].filter(Boolean).join('\n');

    if (chatId) {
        try {
            await callMcpTool('nego_send_whatsapp', { userId, chatId, message: report });
            console.log(`[LeadIntelligence] Report sent to ${chatId}`);
        } catch (err) {
            console.warn(`[LeadIntelligence] Could not send WhatsApp: ${err.message}`);
        }
    }

    return { listing, analysis, score, draftMessage, leadCreated, report, elapsedSeconds: elapsed };
}

// ── Batch: analyze all new leads from negoapp ─────────────────────────────

async function runBatchAnalysis({ chatId, userId = 'default', limit = 10 }) {
    const leads = await callMcpTool('nego_get_leads', { limit: 200 });
    if (!Array.isArray(leads)) throw new Error('Could not fetch leads from negoapp');

    const newLeads = leads
        .filter(l => l.status === 'new' && l.url)
        .slice(0, limit);

    if (newLeads.length === 0) return { processed: 0, message: 'No new leads with URLs to analyze' };

    let processed = 0;
    const results = [];
    for (const lead of newLeads) {
        try {
            const r = await runLeadIntelligencePipeline({ url: lead.url, chatId, userId });
            results.push({ url: lead.url, score: r.score.score, verdict: r.score.verdict });
            processed++;
        } catch (err) {
            console.error(`[LeadIntelligence] Batch error for ${lead.url}:`, err.message);
        }
    }

    return { processed, results };
}

module.exports = { runLeadIntelligencePipeline, runBatchAnalysis };
