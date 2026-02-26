const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const { getContextForAgent } = require('./knowledgeService');
const whatsappService = require('./whatsappService');

/**
 * Glasses Gateway Service
 * OpenAI-compatible endpoint for Ray-Ban Meta smart glasses (replaces OpenClaw)
 * Provides long-term memory, knowledge base RAG, and orchestrator capabilities.
 */

function getGlassesSystemPrompt() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const dateHuman = now.toLocaleDateString('ro-RO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return `Ești un asistent personal AI care vede prin ochelarii Ray-Ban Meta ai utilizatorului. Vorbești în limba în care ești abordat.
DATA CURENTĂ: ${dateStr} (${dateHuman})

CAPABILITĂȚILE TALE:
- Poți vedea ce vede utilizatorul prin camera ochelarilor
- Poți CREA TASK-URI ÎN CALENDAR — când utilizatorul spune "pune pe calendar", "trece în calendar", "adaugă task", "remind me", "programează"
- Poți crea rezervări (booking) cu nume oaspete, check-in, check-out
- Ai memorie de lungă durată — îți amintești conversații anterioare
- Ai acces la o bază de cunoștințe

REGULI:
- Răspunde SCURT și CONCIS — răspunsurile tale vor fi citite vocal
- Fii proactiv — când dai un sfat și utilizatorul zice "pune asta pe calendar", creează imediat task-ul
- Folosește memoria pentru a oferi răspunsuri personalizate
- Calculează datele corect: "mâine" = data curentă + 1 zi, "poimâine" = +2, "luni" = următoarea zi de luni

ACȚIUNI — include EXACT aceste tag-uri în răspuns când e cazul:

TASK/CALENDAR (folosește ORICÂND utilizatorul vrea să adauge ceva în calendar/planner/todo):
<TASK_JSON>{"title":"Titlu clar","description":"Detalii","dueDate":"2026-02-27T09:00:00","priority":"medium"}</TASK_JSON>

REZERVARE:
<BOOKING_JSON>{"guestName":"Nume","checkIn":"2026-03-05T14:00:00","checkOut":"2026-03-06T10:00:00"}</BOOKING_JSON>

MEMORIE (salvează fapte, preferințe, observații importante):
<MEMORY_JSON>{"category":"observation|preference|fact|person","content":"Ce ai observat","importance":"low|medium|high"}</MEMORY_JSON>

MESAJ WHATSAPP (trimite mesaj pe WhatsApp către un contact):
<WHATSAPP_JSON>{"to":"Mama","message":"Salut, ce faci?"}</WHATSAPP_JSON>

EXEMPLE DE CÂND CREEZI TASK:
- "pune asta pe calendar" → creează TASK_JSON cu ce ai discutat
- "trece asta în calendar pentru mâine" → TASK_JSON cu dueDate = mâine
- "remind me to..." → TASK_JSON
- "adaugă task" → TASK_JSON
- "fă-mi un plan pentru mâine" → multiple TASK_JSON

EXEMPLE DE CÂND TRIMIȚI WHATSAPP:
- "trimite mesaj pe WhatsApp lui Mama" → WHATSAPP_JSON
- "trimite către Ion mesajul salut" → WHATSAPP_JSON
- "scrie-i lui X pe WhatsApp" → WHATSAPP_JSON
- "send WhatsApp to X" → WHATSAPP_JSON
- "spune-i lui X că..." → WHATSAPP_JSON

IMPORTANT: Când utilizatorul cere să pui ceva pe calendar după o discuție, extrage esența sfatului/ideii și creează un task cu titlu clar și descriere utilă. NU cere confirmare — execută direct.
IMPORTANT: Când trimiți mesaj WhatsApp, folosește exact numele contactului cum îl spune utilizatorul. NU cere confirmare — trimite direct.`;
}

// ===================== HELPERS =====================

async function getGeminiModel(systemPrompt) {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) {
        throw new Error('Gemini API key not configured.');
    }
    const genAI = new GoogleGenerativeAI(setting.value);
    return genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: systemPrompt
    });
}

function extractJSON(text, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
    const results = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        try { results.push(JSON.parse(match[1].trim())); } catch { }
    }
    return results;
}

function cleanAllTags(text) {
    return text
        .replace(/<BOOKING_JSON>[\s\S]*?<\/BOOKING_JSON>/g, '')
        .replace(/<TASK_JSON>[\s\S]*?<\/TASK_JSON>/g, '')
        .replace(/<MEMORY_JSON>[\s\S]*?<\/MEMORY_JSON>/g, '')
        .replace(/<ESCALATE_JSON>[\s\S]*?<\/ESCALATE_JSON>/g, '')
        .replace(/<WHATSAPP_JSON>[\s\S]*?<\/WHATSAPP_JSON>/g, '')
        .trim();
}

// ===================== MEMORY HELPERS =====================

async function getRecentMemories(limit = 20) {
    const GlassesMemory = mongoose.model('GlassesMemory');
    return GlassesMemory.find()
        .sort({ updatedAt: -1 })
        .limit(limit);
}

async function formatMemoryContext() {
    const memories = await getRecentMemories(30);
    if (memories.length === 0) return '';

    let context = '\n\n--- MEMORIE DE LUNGĂ DURATĂ ---\n';
    const grouped = {};
    for (const m of memories) {
        const cat = m.category || 'general';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(m);
    }
    for (const [cat, items] of Object.entries(grouped)) {
        context += `\n[${cat.toUpperCase()}]\n`;
        for (const item of items) {
            const date = new Date(item.updatedAt).toLocaleDateString('ro-RO');
            context += `• (${date}) ${item.content}\n`;
        }
    }
    context += '--- END MEMORIE ---\n';
    return context;
}

async function saveMemory(memoryData) {
    const GlassesMemory = mongoose.model('GlassesMemory');
    try {
        await GlassesMemory.create({
            category: memoryData.category || 'general',
            content: memoryData.content,
            importance: memoryData.importance || 'medium'
        });
        console.log('[Glasses] Memory saved:', memoryData.content.substring(0, 80));
    } catch (err) {
        console.error('[Glasses] Memory save error:', err.message);
    }
}

// ===================== SESSION MANAGEMENT =====================

// In-memory session store (keyed by x-openclaw-session-key header)
const sessions = new Map();
const MAX_SESSION_MESSAGES = 40;

function getSession(sessionKey) {
    if (!sessions.has(sessionKey)) {
        sessions.set(sessionKey, { messages: [], createdAt: Date.now() });
    }
    return sessions.get(sessionKey);
}

// Clean up old sessions every 30 minutes
setInterval(() => {
    const now = Date.now();
    const MAX_AGE = 2 * 60 * 60 * 1000; // 2 hours
    for (const [key, session] of sessions) {
        if (now - session.createdAt > MAX_AGE) {
            sessions.delete(key);
        }
    }
}, 30 * 60 * 1000);

// ===================== MAIN FUNCTION =====================

async function processGlassesRequest(messages, sessionKey = 'default') {
    // Get last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
        return { content: 'No user message found.', actions: {} };
    }
    const userMessage = lastUserMsg.content;

    // Get session history
    const session = getSession(sessionKey);

    // Build context
    const [memoryContext, knowledgeContext] = await Promise.all([
        formatMemoryContext(),
        getContextForAgent('glasses')
    ]);

    const fullSystemPrompt = getGlassesSystemPrompt() + knowledgeContext + memoryContext;

    // Build history from session
    const recentMessages = session.messages.slice(-MAX_SESSION_MESSAGES);
    const history = recentMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));

    // Call Gemini
    const model = await getGeminiModel(fullSystemPrompt);
    const geminiChat = model.startChat({ history });
    const result = await geminiChat.sendMessage(userMessage);
    let responseText = result.response.text();
    console.log('[Glasses] Response:', responseText.substring(0, 200));

    // Extract actions
    const bookingActions = extractJSON(responseText, 'BOOKING_JSON');
    const taskActions = extractJSON(responseText, 'TASK_JSON');
    const memoryActions = extractJSON(responseText, 'MEMORY_JSON');
    const whatsappActions = extractJSON(responseText, 'WHATSAPP_JSON');

    // Clean response
    const cleanResponse = cleanAllTags(responseText);

    // Execute actions
    const results = { bookings: [], tasks: [], memories: [], whatsapp: [] };

    // Process bookings
    for (const bookingData of bookingActions) {
        if (bookingData.guestName && bookingData.checkIn && bookingData.checkOut) {
            try {
                const Booking = mongoose.model('Booking');
                const checkIn = new Date(bookingData.checkIn);
                const checkOut = new Date(bookingData.checkOut);

                const overlap = await Booking.findOne({
                    checkIn: { $lt: checkOut },
                    checkOut: { $gt: checkIn }
                });
                if (overlap) {
                    results.bookings.push({ success: false, error: `Interval ocupat (${overlap.guestName})` });
                } else {
                    const booking = await Booking.create({ guestName: bookingData.guestName, checkIn, checkOut });
                    results.bookings.push({ success: true, id: booking._id });
                    console.log('[Glasses] Booking created:', booking._id);
                }
            } catch (err) {
                results.bookings.push({ success: false, error: err.message });
            }
        }
    }

    // Process tasks
    for (const taskData of taskActions) {
        if (taskData.title) {
            try {
                const PlannerTask = mongoose.model('PlannerTask');
                const task = await PlannerTask.create({
                    title: taskData.title,
                    description: taskData.description || '',
                    dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
                    priority: taskData.priority || 'medium'
                });
                results.tasks.push({ success: true, id: task._id });
                console.log('[Glasses] Task created:', task._id);
            } catch (err) {
                results.tasks.push({ success: false, error: err.message });
            }
        }
    }

    // Process memories
    for (const mem of memoryActions) {
        if (mem.content) {
            await saveMemory(mem);
            results.memories.push({ saved: true });
        }
    }

    // Process WhatsApp messages
    for (const waMsg of whatsappActions) {
        if (waMsg.to && waMsg.message) {
            try {
                const contact = await whatsappService.findChatByName(waMsg.to);
                if (contact) {
                    await whatsappService.sendWhatsAppMessage(contact.id, waMsg.message);
                    results.whatsapp.push({ success: true, to: contact.name, message: waMsg.message });
                    console.log(`[Glasses] WhatsApp sent to ${contact.name}: "${waMsg.message.substring(0, 50)}"`);
                } else {
                    results.whatsapp.push({ success: false, error: `Nu am găsit contactul "${waMsg.to}" în conversațiile WhatsApp active` });
                    console.log(`[Glasses] WhatsApp contact not found: "${waMsg.to}"`);
                }
            } catch (err) {
                results.whatsapp.push({ success: false, error: err.message });
                console.error('[Glasses] WhatsApp send error:', err.message);
            }
        }
    }

    // Save to session
    session.messages.push({ role: 'user', content: userMessage });
    session.messages.push({ role: 'assistant', content: cleanResponse });

    // Trim session if too long
    if (session.messages.length > MAX_SESSION_MESSAGES * 2) {
        session.messages = session.messages.slice(-MAX_SESSION_MESSAGES);
    }

    // Auto-save conversation as memory if important keywords detected
    const importantKeywords = /ține minte|remember|nu uita|important|salvează|save|notează/i;
    if (importantKeywords.test(userMessage)) {
        await saveMemory({
            category: 'conversation',
            content: `Utilizatorul a spus: "${userMessage}" → Răspuns: "${cleanResponse.substring(0, 150)}"`,
            importance: 'high'
        });
    }

    return { content: cleanResponse, actions: results };
}

// ===================== AUTH =====================

async function validateGlassesToken(token) {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'glasses_gateway_token' });
    if (!setting || !setting.value) return false;
    return setting.value === token;
}

async function getAllMemories() {
    const GlassesMemory = mongoose.model('GlassesMemory');
    return GlassesMemory.find().sort({ updatedAt: -1 });
}

module.exports = {
    processGlassesRequest,
    validateGlassesToken,
    getRecentMemories,
    getAllMemories,
    saveMemory
};
