const mongoose = require('mongoose');
const { getGeminiModel: getConfigGeminiModel } = require('./configService');
const { getContextForAgent } = require('./knowledgeService');
const whatsappService = require('./whatsappService');
const { processObjectScan, learnObject, getObjectTrackingContext } = require('./objectTrackingService');
const { executeGitHubAction } = require('./githubService');
const { executeCodingAction } = require('./codingAgentService');
const { executeGhIssuesAction } = require('./ghIssuesService');
const { executeProcessAction } = require('./processManagerService');

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
- "trimite-i lui X" → WHATSAPP_JSON
- "dă-i mesaj lui X" → WHATSAPP_JSON

ATENȚIE — NU CONFUNDA:
- "trimite mesaj" / "scrie-i lui" / "spune-i lui" / "dă-i mesaj" = WHATSAPP_JSON (trimite mesaj pe WhatsApp)
- "pune pe calendar" / "adaugă task" / "remind me" = TASK_JSON (adaugă în calendar)
Dacă utilizatorul menționează un NUME DE PERSOANĂ și vrea să-i transmită ceva, este ÎNTOTDEAUNA WHATSAPP_JSON, nu TASK_JSON.

IMPORTANT: Când utilizatorul cere să pui ceva pe calendar după o discuție, extrage esența sfatului/ideii și creează un task cu titlu clar și descriere utilă. NU cere confirmare — execută direct.
IMPORTANT: Când trimiți mesaj WhatsApp, folosește exact numele contactului cum îl spune utilizatorul. NU cere confirmare — trimite direct.

ÎNVĂȚARE OBIECTE (când utilizatorul spune "ține minte că X stă pe Y", "telecomanda e pe masă", "locul cheilor e pe cuier"):
<OBJECT_LEARN_JSON>{"name":"telecomandă","description":"telecomandă neagră Samsung","expectedLocation":"pe masă lângă TV"}</OBJECT_LEARN_JSON>

BACKGROUND SCAN (SILENT — rulează automat, NU menționa în răspunsul vocal):
Când vezi prin cameră obiecte de uz casnic (telecomandă, chei, telefon, cărți, haine, jucării etc.), raportează-le SILENT fără a le menționa vocii:
<OBJECT_SCAN_JSON>{"objects":[{"name":"telecomandă","location":"pe canapea","description":"telecomandă neagră"}]}</OBJECT_SCAN_JSON>
- Fă asta DOAR în interiorul casei când observi obiecte prin cameră
- NU menționa scanarea în răspunsul vocal
- Raportează maxim 3-5 obiecte observabile per scanare
- Include locația cât mai specifică ("pe canapea din living", "pe podea lângă ușă")

GITHUB (operații pe repository — issues, PRs, CI status):
<GITHUB_JSON>{"action":"list_issues","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"create_issue","owner":"eneflorian1","repo":"usa-app","title":"Bug: descriere","body":"Detalii"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"list_prs","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"pr_status","owner":"eneflorian1","repo":"usa-app","pr":1}</GITHUB_JSON>
<GITHUB_JSON>{"action":"ci_status","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"repo_info","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>

EXEMPLE GITHUB:
- "ce issues am pe GitHub?" → GITHUB_JSON cu list_issues
- "arată-mi PRs" → GITHUB_JSON cu list_prs
- "creează un issue" → GITHUB_JSON cu create_issue
- "cum stă CI-ul?" → GITHUB_JSON cu ci_status
- Când răspunzi cu rezultate GitHub, fii CONCIS — numără și rezumă, nu citi tot JSON-ul

CODING (task-uri de cod):
<CODING_JSON>{"action":"analyze","files":["backend/server.js"],"question":"Ce face?"}</CODING_JSON>
<CODING_JSON>{"action":"execute","task":"Fix bug","targetFiles":["backend/server.js"]}</CODING_JSON>

GH-ISSUES (auto-fix issues):
<GH_ISSUES_JSON>{"action":"analyze","owner":"eneflorian1","repo":"usa-app","issue":1}</GH_ISSUES_JSON>
<GH_ISSUES_JSON>{"action":"auto_fix","owner":"eneflorian1","repo":"usa-app","issue":1}</GH_ISSUES_JSON>

PROCESE (management procese background):
<PROCESS_JSON>{"action":"list"}</PROCESS_JSON>
<PROCESS_JSON>{"action":"spawn","command":"npm test"}</PROCESS_JSON>`;
}

// ===================== HELPERS =====================

async function getGeminiModel(systemPrompt) {
    return getConfigGeminiModel(systemPrompt);
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
        .replace(/<OBJECT_SCAN_JSON>[\s\S]*?<\/OBJECT_SCAN_JSON>/g, '')
        .replace(/<OBJECT_LEARN_JSON>[\s\S]*?<\/OBJECT_LEARN_JSON>/g, '')
        .replace(/<GITHUB_JSON>[\s\S]*?<\/GITHUB_JSON>/g, '')
        .replace(/<CODING_JSON>[\s\S]*?<\/CODING_JSON>/g, '')
        .replace(/<GH_ISSUES_JSON>[\s\S]*?<\/GH_ISSUES_JSON>/g, '')
        .replace(/<PROCESS_JSON>[\s\S]*?<\/PROCESS_JSON>/g, '')
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
    const [memoryContext, knowledgeContext, objectContext] = await Promise.all([
        formatMemoryContext(),
        getContextForAgent('glasses'),
        getObjectTrackingContext()
    ]);

    const fullSystemPrompt = getGlassesSystemPrompt() + knowledgeContext + memoryContext + objectContext;

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
    const objectScanActions = extractJSON(responseText, 'OBJECT_SCAN_JSON');
    const objectLearnActions = extractJSON(responseText, 'OBJECT_LEARN_JSON');
    const githubActions = extractJSON(responseText, 'GITHUB_JSON');
    const codingActions = extractJSON(responseText, 'CODING_JSON');
    const ghIssuesActions = extractJSON(responseText, 'GH_ISSUES_JSON');
    const processActions = extractJSON(responseText, 'PROCESS_JSON');

    // Clean response
    const cleanResponse = cleanAllTags(responseText);

    // Execute actions
    const results = { bookings: [], tasks: [], memories: [], whatsapp: [], objectScans: [], objectLearned: [], github: [], coding: [], ghIssues: [], process: [] };

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
                const result = await whatsappService.sendWhatsAppByName(waMsg.to, waMsg.message);
                results.whatsapp.push({ success: true, to: result.sentTo, message: waMsg.message });
                console.log(`[Glasses] WhatsApp sent to ${result.sentTo}: "${waMsg.message.substring(0, 50)}"`);
            } catch (err) {
                results.whatsapp.push({ success: false, error: err.message });
                console.error('[Glasses] WhatsApp send error:', err.message);
            }
        }
    }

    // Process object scans (silent — background processing)
    for (const scan of objectScanActions) {
        if (scan.objects && Array.isArray(scan.objects)) {
            try {
                const scanResult = await processObjectScan(scan.objects);
                results.objectScans.push({ success: true, ...scanResult });
            } catch (err) {
                console.error('[Glasses] Object scan error:', err.message);
            }
        }
    }

    // Process object learning
    for (const obj of objectLearnActions) {
        if (obj.name && obj.expectedLocation) {
            try {
                const result = await learnObject(obj.name, obj.description || '', obj.expectedLocation, obj.imageDescription || '');
                results.objectLearned.push({ success: true, ...result });
                console.log(`[Glasses] Object learned: "${obj.name}" at "${obj.expectedLocation}"`);
            } catch (err) {
                results.objectLearned.push({ success: false, error: err.message });
                console.error('[Glasses] Object learn error:', err.message);
            }
        }
    }

    // Process GitHub actions
    for (const ghAction of githubActions) {
        try {
            const result = await executeGitHubAction(ghAction);
            results.github.push({ success: true, ...result });
            console.log(`[Glasses] GitHub ${ghAction.action}:`, JSON.stringify(result).substring(0, 150));
        } catch (err) {
            results.github.push({ success: false, error: err.message });
            console.error('[Glasses] GitHub error:', err.message);
        }
    }

    // Process coding actions
    for (const codingAction of codingActions) {
        try {
            const result = await executeCodingAction(codingAction);
            results.coding.push({ success: true, ...result });
            console.log(`[Glasses] Coding ${codingAction.action}:`, JSON.stringify(result).substring(0, 150));
        } catch (err) {
            results.coding.push({ success: false, error: err.message });
            console.error('[Glasses] Coding error:', err.message);
        }
    }

    // Process gh-issues actions
    for (const ghIssueAction of ghIssuesActions) {
        try {
            const result = await executeGhIssuesAction(ghIssueAction);
            results.ghIssues.push({ success: true, ...result });
            console.log(`[Glasses] GH-Issues ${ghIssueAction.action}:`, JSON.stringify(result).substring(0, 150));
        } catch (err) {
            results.ghIssues.push({ success: false, error: err.message });
            console.error('[Glasses] GH-Issues error:', err.message);
        }
    }

    // Process background process actions
    for (const procAction of processActions) {
        try {
            const result = executeProcessAction(procAction);
            results.process.push({ success: true, ...result });
            console.log(`[Glasses] Process ${procAction.action}`);
        } catch (err) {
            results.process.push({ success: false, error: err.message });
            console.error('[Glasses] Process error:', err.message);
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
    try {
        const { getApiKey } = require('./configService');
        const storedToken = await getApiKey('glasses_gateway_token');
        return storedToken === token;
    } catch { return false; }
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
