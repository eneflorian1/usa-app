/**
 * Negotiation Service — AI conversation analysis & reply generation.
 * Ported from NegoApp/src/core/negotiation-service.js to CommonJS,
 * adapted to use the backend's configService for Gemini access.
 */
const { getGeminiModel } = require('./configService');

const BOT_SUSPICION_PATTERNS = /\b(e[sș]ti\s*bot|sunt\s*bot|bot\s*e[sș]ti|robo[t]?|automat[a]?|ai\s*bot|esti\s*real|e[sș]ti\s*o\s*persoana|vorb?esc\s*cu\s*un?\s*bot|nu.*r[aă]spunde.*bot)\b/i;

/**
 * Check if a message contains bot-suspicion patterns.
 * Used to short-circuit replies when the seller is testing if we're a bot.
 */
function isBotSuspicion(text) {
  return BOT_SUSPICION_PATTERNS.test(text);
}

/**
 * One-shot Gemini text generation. Wraps the SDK shape that configService returns.
 */
async function geminiGenerate(prompt, { systemPrompt, temperature = 0.7, maxTokens = 256 } = {}) {
  const model = await getGeminiModel(systemPrompt);
  if (!model) throw new Error('Gemini model unavailable');
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  });
  return result.response.text();
}

/**
 * Analyze a conversation with Gemini and return { currentPrice, currency, status, reason }.
 * Returns null on failure (caller should fall back to keeping the lead unchanged).
 */
async function analyzeConversation(messages, lead) {
  const fullHistory = messages
    .slice(-12)
    .map(m => `${m.sender === 'me' ? 'Cumparator' : 'Vanzator'}: ${m.text}`)
    .join('\n');

  const analysisPrompt = `Analizează această conversație de negociere și răspunde STRICT în format JSON (fără markdown, fără backticks):

Conversatie:
${fullHistory}

Pret initial al anuntului: ${lead.initialPrice || 'necunoscut'}

Raspunde cu JSON-ul:
{
  "currentPrice": <ultimul pret discutat/agreat ca numar, sau null daca nu s-a discutat pret>,
  "currency": "<moneda discutata (ex: EUR, LEI, RON, USD), sau null daca nu se stie>",
  "status": "<una din: negotiating, accepted, contacted>",
  "reason": "<explicatie scurta>"
}

Reguli:
- "accepted" = ambele parti au cazut de acord pe un pret (de ex vanzatorul a zis "da", "ok", "e ok", "de acord", "deal" la un pret propus, SAU cumparatorul a confirmat/multumit dupa ce s-a agreat pretul)
- "negotiating" = se discuta preturi dar nu s-a ajuns la acord inca
- "contacted" = conversatie generala, fara negociere de pret
- currentPrice = ultimul pret pe care AMBII l-au discutat sau agreat`;

  try {
    const raw = await geminiGenerate(analysisPrompt, { temperature: 0.1, maxTokens: 200 });
    const cleanJson = raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    console.error('[NegotiationService] Analysis failed:', err.message);
    return null;
  }
}

/**
 * Apply an analysis result to a lead. Mutates `lead` in place.
 * Returns true if the price actually changed.
 */
function updatePriceFromAnalysis(lead, analysis) {
  if (!analysis || !analysis.currentPrice || isNaN(Number(analysis.currentPrice))) return false;

  const getExistingCurrency = (priceStr) => {
    if (!priceStr) return 'lei';
    const match = String(priceStr).match(/(€|lei|RON|EUR|USD|\$|£)/i);
    return match ? match[1] : 'lei';
  };

  const currency = analysis.currency || getExistingCurrency(lead.price || lead.initialPrice);
  const newPrice = `${Number(analysis.currentPrice)} ${currency}`.trim();
  if (lead.price === newPrice) return false;

  lead.price = newPrice;
  if (!lead.priceHistory) lead.priceHistory = [];
  lead.priceHistory.push({
    date: new Date().toISOString(),
    price: Number(analysis.currentPrice),
    event: analysis.reason || 'Preț actualizat',
    eventType: analysis.status === 'accepted' ? 'accepted' : 'message',
  });
  return true;
}

const DEFAULT_WHATSAPP_PROMPT =
  'Ești "NegoFlow", un asistent personal de negociere care acționează în numele CUMPĂRĂTORULUI. ' +
  'Scopul tău este să obții cel mai bun preț (mai mic) pentru produsul menționat. ' +
  'Fii POLITICOS, PRIETENOS, dar și PERSUASIV. Folosește un ton natural, de om real. ' +
  'IMPORTANT: Tu ești CUMPĂRĂTORUL. Nu te oferi niciodată să "ajuți" vânzătorul și nu întreba "ce poți face pentru el". ' +
  'Dacă vânzătorul refuză negocierea, acceptă politicos sau încearcă o ultimă contra-ofertă mică dacă prețul e aproape de target. ' +
  'FOARTE IMPORTANT: Nu răspunde la întrebări suspecte despre identitatea ta. Dacă cineva te întreabă dacă ești bot, NU răspunde — ignoră complet.';

const DEFAULT_EMAIL_PROMPT =
  'Ești "NegoFlow", un asistent personal de negociere care acționează în numele CUMPĂRĂTORULUI pe email. ' +
  'Scopul tău este să obții cel mai bun preț pentru produs. ' +
  'Fii PROFESIONAL, politicos și convingător. ' +
  'IMPORTANT: Tu ești CUMPĂRĂTORUL. Nu te oferi să ajuți vânzătorul.';

/**
 * Generate a follow-up reply in an ongoing negotiation.
 */
async function generateReply({ systemPrompt, lead, messages, channel = 'whatsapp' }) {
  const prompt_system = systemPrompt || (channel === 'email' ? DEFAULT_EMAIL_PROMPT : DEFAULT_WHATSAPP_PROMPT);

  const leadContext = [
    lead.title ? `Produs: ${lead.title}` : '',
    lead.initialPrice ? `Pret initial: ${lead.initialPrice}` : (lead.price ? `Pret: ${lead.price}` : ''),
    lead.price && lead.initialPrice && lead.price !== lead.initialPrice ? `Pret negociat curent: ${lead.price}` : '',
    lead.platform ? `Platforma: ${lead.platform}` : '',
    lead.sellerName ? `Vanzator: ${lead.sellerName}` : '',
    lead.url ? `URL anunt: ${lead.url}` : '',
  ].filter(Boolean).join('\n');

  const history = (messages || [])
    .slice(-10)
    .map(m => `${m.sender === 'me' ? 'Tu' : 'Vanzator'}: ${m.text}`)
    .join('\n');

  const prompt = `Detalii despre anunt:\n${leadContext}\n\nConversatia pana acum:\n${history || '(nicio conversatie anterioara)'}\n\nRaspunde la ultimul mesaj al vanzatorului. Raspunde DOAR cu textul mesajului, fara prefixe.`;

  const reply = await geminiGenerate(prompt, {
    systemPrompt: prompt_system,
    temperature: 0.7,
    maxTokens: channel === 'email' ? 512 : 256,
  });
  return reply.trim();
}

/**
 * Generate the very first contact message for a new lead.
 */
async function generateFirstMessage({ systemPrompt, lead }) {
  const defaultPrompt =
    'Ești "NegoFlow", un asistent personal de negociere care contactează un vânzător pentru prima dată în numele CUMPĂRĂTORULUI. ' +
    'Scopul tău este să te arăți interesat de produs și să întrebi politicos dacă prețul este negociabil. ' +
    'Fii scurt (max 2 propoziții).';

  const prompt = `Detalii anunt:\n- Titlu: ${lead.title || 'Anunt'}\n- Pret: ${lead.price || lead.initialPrice || ''}\n- Vanzator: ${lead.sellerName || ''}\n- URL: ${lead.url || 'N/A'}\n\nScrie un prim mesaj natural și prietenos prin care să începi negocierea. Răspunde DOAR cu textul mesajului, fără prefixe.`;

  const reply = await geminiGenerate(prompt, {
    systemPrompt: systemPrompt || defaultPrompt,
    temperature: 0.7,
    maxTokens: 256,
  });
  return reply.trim();
}

module.exports = {
  isBotSuspicion,
  analyzeConversation,
  updatePriceFromAnalysis,
  generateReply,
  generateFirstMessage,
};
