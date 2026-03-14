const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
// NOTE: emailService and emailAgentService are lazy-loaded in startNegotiation()
// to avoid circular dependency (emailAgentService → linkProcessorService → emailAgentService)

/**
 * Link Processor Service
 * Scrapes URLs, generates product/service resumes via Gemini, saves to MongoDB
 * Provides context to the email auto-reply agent for negotiations
 */

const RESUME_PROMPT = `Ești un analist expert. Ti s-a dat conținutul unei pagini web.

TASK: Creează un rezumat structurat al produsului/serviciului descris pe pagină.

FORMAT OBLIGATORIU (JSON):
{
  "title": "Numele produsului/serviciului",
  "type": "product | service | rental | listing | other",
  "price": "Prețul afișat sau null",
  "currency": "RON | EUR | USD | etc.",
  "seller": "Numele vânzătorului/companiei",
  "description": "Descriere scurtă (2-3 propoziții)",
  "keyFeatures": ["feature1", "feature2", ...],
  "negotiationNotes": "Observații utile pentru negociere (ex: produs la reducere, stoc limitat, preț negociabil menționat, alternative mai ieftine posibile)",
  "category": "electronics | auto | real-estate | clothing | services | food | other",
  "location": "Locația dacă e menționată sau null",
  "condition": "new | used | refurbished | null",
  "url": "URL-ul original"
}

REGULI:
- Extrage TOATE informațiile relevante pentru o negociere
- Dacă prețul nu apare, pune null
- negotiationNotes trebuie să conțină sfaturi concrete de negociere
- Răspunde DOAR cu JSON valid, fără altceva`;

// ── Scrape URL Content ──────────────────────────────────────────────────────

async function scrapeUrl(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            signal: AbortSignal.timeout(15000)
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        
        // Extract text content from HTML (strip tags, scripts, styles)
        const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 8000); // Limit for LLM context
        
        return text;
    } catch (err) {
        throw new Error(`Failed to scrape ${url}: ${err.message}`);
    }
}

// ── Generate Resume via LLM ─────────────────────────────────────────────────

async function generateResume(url, pageContent) {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) throw new Error('Gemini API key not configured');
    
    const genAI = new GoogleGenerativeAI(setting.value);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: RESUME_PROMPT
    });

    const prompt = `URL: ${url}\n\nCONȚINUT PAGINĂ:\n${pageContent}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    
    try {
        const data = JSON.parse(jsonStr);
        data.url = url;
        return data;
    } catch {
        // If JSON parse fails, create a basic resume
        return {
            title: 'Unknown Product',
            type: 'other',
            price: null,
            currency: null,
            seller: null,
            description: text.substring(0, 300),
            keyFeatures: [],
            negotiationNotes: '',
            category: 'other',
            location: null,
            condition: null,
            url
        };
    }
}

// ── Process Link (main entry point) ─────────────────────────────────────────

async function processLink(url, options = {}) {
    const ProductResume = mongoose.model('ProductResume');
    
    console.log(`[LinkProcessor] Processing: ${url}`);
    
    // Check if already processed
    const existing = await ProductResume.findOne({ url });
    if (existing && !options.force) {
        console.log(`[LinkProcessor] Already processed: ${url}`);
        return { resume: existing, isNew: false };
    }
    
    // 1. Scrape
    const pageContent = await scrapeUrl(url);
    if (!pageContent || pageContent.length < 50) {
        throw new Error('Page content too short or empty — may be blocked by anti-bot');
    }
    
    // 2. Generate resume via LLM
    const resumeData = await generateResume(url, pageContent);
    
    // 3. Save to DB
    const resume = existing 
        ? await ProductResume.findOneAndUpdate(
            { url },
            { ...resumeData, rawContent: pageContent.substring(0, 3000), updatedAt: Date.now() },
            { new: true }
          )
        : await ProductResume.create({
            ...resumeData,
            rawContent: pageContent.substring(0, 3000),
            inboxId: options.inboxId || null
          });
    
    console.log(`[LinkProcessor] Saved resume: "${resume.title}" (${resume.type}) — ${resume.price || 'no price'}`);
    
    return { resume, isNew: !existing };
}

// ── Get resumes for email agent context ─────────────────────────────────────

async function getResumesForContext(inboxId) {
    const ProductResume = mongoose.model('ProductResume');
    // Get all resumes, prioritize ones linked to this inbox
    const resumes = await ProductResume.find({
        $or: [{ inboxId }, { inboxId: null }]
    }).sort({ updatedAt: -1 }).limit(10);
    
    return resumes.map(r => ({
        title: r.title,
        type: r.type,
        price: r.price,
        currency: r.currency,
        seller: r.seller,
        description: r.description,
        keyFeatures: r.keyFeatures,
        negotiationNotes: r.negotiationNotes,
        url: r.url
    }));
}

function formatResumesForPrompt(resumes) {
    if (!resumes || resumes.length === 0) return '';
    
    let context = '\n\n=== PRODUSE/SERVICII CUNOSCUTE (pentru negociere) ===\n';
    for (const r of resumes) {
        context += `\n📦 ${r.title} (${r.type})`;
        if (r.price) context += ` — ${r.price} ${r.currency || ''}`;
        if (r.seller) context += ` | Vânzător: ${r.seller}`;
        if (r.description) context += `\n   ${r.description}`;
        if (r.negotiationNotes) context += `\n   💡 Negociere: ${r.negotiationNotes}`;
        if (r.url) context += `\n   🔗 ${r.url}`;
        context += '\n';
    }
    return context;
}

// ── Autonomous Negotiation Starter ─────────────────────────────────────────────

const NEGOTIATION_EMAIL_PROMPT = `Ești un negociator expert. Trebuie să compui PRIMUL email către vânzător pentru un produs/serviciu.

REGULI:
- Ton politicos, profesional dar prietenos
- Exprimă interes real pentru produs
- Pune 2-3 întrebări inteligente (stare, disponibilitate, împachetare)
- Sugerează subtil că ai văzut alternative mai ieftine (fără să fii agresiv)
- Cere dacă prețul este negociabil
- NU oferi un preț concret în primul mesaj — întreabă doar
- Max 6-8 propoziții
- Răspunde în ROMÂNĂ
- NU te prezenta ca AI
- Semnează cu "Cu stimă" (fără nume real)`;

async function startNegotiation(url, recipientEmail, options = {}) {
    // Lazy-load to avoid circular dependency
    const { sendEmail, listInboxes } = require('./emailService');
    const emailAgent = require('./emailAgentService');
    
    console.log(`[LinkProcessor] Starting negotiation for ${url} → ${recipientEmail}`);
    
    // 1. Process the link (get/save resume)
    const { resume } = await processLink(url, options);
    
    // 2. Find an inbox to send from
    let inboxId = options.inboxId;
    if (!inboxId) {
        const inboxes = await listInboxes();
        if (!inboxes || inboxes.length === 0) {
            throw new Error('No email inbox available. Create one first on the Email page.');
        }
        inboxId = inboxes[0].inboxId;
    }
    
    // 3. Generate first negotiation email via LLM
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) throw new Error('Gemini API key not configured');
    
    const genAI = new GoogleGenerativeAI(setting.value);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: NEGOTIATION_EMAIL_PROMPT
    });
    
    const productContext = [
        `PRODUS: ${resume.title}`,
        resume.price ? `PREȚ: ${resume.price} ${resume.currency || ''}` : 'PREȚ: nespecificat',
        resume.seller ? `VÂNZĂTOR: ${resume.seller}` : '',
        resume.description ? `DESCRIERE: ${resume.description}` : '',
        resume.keyFeatures?.length ? `CARACTERISTICI: ${resume.keyFeatures.join(', ')}` : '',
        resume.negotiationNotes ? `NOTE NEGOCIERE: ${resume.negotiationNotes}` : '',
        resume.location ? `LOCAȚIE: ${resume.location}` : '',
        resume.condition ? `STARE: ${resume.condition}` : '',
        `URL: ${resume.url}`
    ].filter(Boolean).join('\n');
    
    const result = await model.generateContent(
        `Compune primul email de negociere pentru acest produs:\n\n${productContext}`
    );
    const emailBody = result.response.text().trim();
    
    // 4. Send the email
    const subject = `Întrebare despre ${resume.title}`;
    
    const sendResult = await sendEmail(inboxId, {
        to: recipientEmail,
        subject,
        text: emailBody
    });
    
    console.log(`[LinkProcessor] First negotiation email sent to ${recipientEmail} for "${resume.title}"`);
    
    // 5. Save thread in DB for email agent to track
    const EmailThread = mongoose.model('EmailThread');
    const threadKey = `${recipientEmail.toLowerCase()}::${subject.toLowerCase().substring(0, 100)}`;
    await EmailThread.create({
        inboxId,
        threadKey,
        senderEmail: recipientEmail,
        subject,
        messages: [{
            role: 'assistant',
            content: emailBody,
            messageId: sendResult.messageId || 'sent',
            timestamp: new Date()
        }],
        replyCount: 1,
        status: 'active',
        lastReplyAt: new Date()
    });
    
    // 6. Start email agent polling if not already active
    const EmailAgentConfig = mongoose.model('EmailAgentConfig');
    let config = await EmailAgentConfig.findOne({ inboxId });
    if (!config || !config.enabled) {
        config = await EmailAgentConfig.findOneAndUpdate(
            { inboxId },
            { enabled: true, updatedAt: Date.now() },
            { upsert: true, new: true }
        );
        emailAgent.startPolling(inboxId, config);
        console.log(`[LinkProcessor] Email agent auto-started for ${inboxId}`);
    }
    
    return {
        resume,
        emailSent: true,
        to: recipientEmail,
        subject,
        body: emailBody,
        inboxId,
        agentStarted: true
    };
}

module.exports = {
    processLink,
    startNegotiation,
    getResumesForContext,
    formatResumesForPrompt,
    scrapeUrl,
    generateResume
};
