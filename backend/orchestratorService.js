const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const { getContextForAgent, searchKnowledge, getUserProfile, updateUserProfile, summarizeConversationIfNeeded, extractUserProfile, cleanProfileTags } = require('./knowledgeService');

/**
 * ReAct Orchestrator Service
 * Uses Reason + Act pattern with intent detection, slot filling, and tool execution
 */

// ===================== INTENT CLASSIFICATION =====================

const INTENT_PROMPT = `Ești un clasificator de intenții. Analizează mesajul utilizatorului și clasifică-l strict în una din categoriile:

BOOKING - vrea să facă, modifice, anuleze sau verifice o rezervare/programare
PLANNER - vrea să creeze, gestioneze task-uri/to-do-uri, să planifice
INFO - întreabă despre prețuri, servicii, program, stocuri, informații business
ESCALATE - este frustrat, supărat, cere un operator uman, sau problemă complexă
GENERAL - salutări, conversație generală, alte întrebări

Răspunde DOAR cu JSON:
{"intent":"BOOKING|PLANNER|INFO|ESCALATE|GENERAL","confidence":0.0-1.0,"reasoning":"explicație scurtă"}`;

// ===================== SLOT FILLING =====================

const BOOKING_SLOTS_PROMPT = `Analizează mesajul utilizatorului și extrage informațiile pentru o rezervare.
Extragi: guestName, checkInDate (format YYYY-MM-DD), checkInTime (HH:mm, default 14:00), checkOutDate, checkOutTime (HH:mm, default 10:00).

Data de azi este: {TODAY}

Răspunde DOAR cu JSON:
{"guestName":null|"nume","checkInDate":null|"YYYY-MM-DD","checkInTime":"HH:mm","checkOutDate":null|"YYYY-MM-DD","checkOutTime":"HH:mm","missingSlots":["guestName","checkInDate",...]}`;

const PLANNER_SLOTS_PROMPT = `Analizează mesajul utilizatorului și extrage informațiile pentru un task.
Extragi: title, description, dueDate (format YYYY-MM-DDTHH:mm:ss), priority (low/medium/high).

Data de azi este: {TODAY}

Răspunde DOAR cu JSON:
{"title":null|"titlu","description":"","dueDate":null|"YYYY-MM-DDTHH:mm:ss","priority":"medium","missingSlots":["title",...]}`;

// ===================== REACT AGENT =====================

const REACT_PROMPT = `Ești un asistent AI inteligent care răspunde prietenos și profesional. Vorbești în limba în care ești abordat.

{KNOWLEDGE_CONTEXT}

{USER_PROFILE}

{CONVERSATION_SUMMARY}

Ai acces la următoarele TOOLS (instrumente):
1. search_knowledge(query) - Caută informații în baza de date (prețuri, servicii, stocuri)
2. create_booking(guestName, checkIn, checkOut) - Creează o rezervare
3. check_availability(checkIn, checkOut) - Verifică disponibilitatea
4. create_task(title, description, dueDate, priority) - Creează un task
5. get_user_bookings(guestName) - Listează rezervările unui client
6. escalate_to_human(reason) - Escaladează la un operator uman

REGULI BOOKING:
- Check-in: 12:00 - 23:59
- Check-out: 08:00 - 11:00
- Trebuie: nume, data check-in, data check-out
- Dacă lipsesc date, cere-le politicos

Când vrei să folosești un tool, răspunde cu:
<TOOL_CALL>{"tool":"tool_name","params":{"param1":"value1"}}</TOOL_CALL>

Poți folosi un singur tool per răspuns. Dacă rezultatul tool-ului e reușit, formulează un răspuns prietenos.
Dacă nu ai nevoie de tool, răspunde direct.

Dacă detectezi semne de frustrare (!!!, caps lock, "nu funcționează", "ce servicii proaste"), semnalează escaladarea.

Dacă afli informații despre utilizator (nume, preferințe), salvează-le:
<USER_PROFILE>{"name":"Nume","preferences":["preferință"]}</USER_PROFILE>`;

async function getGeminiModel(systemInstruction) {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) throw new Error('Gemini API key not configured.');
    const genAI = new GoogleGenerativeAI(setting.value);
    return genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite', systemInstruction });
}

async function getGeminiModelBasic() {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) throw new Error('Gemini API key not configured.');
    const genAI = new GoogleGenerativeAI(setting.value);
    return genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
}

// ===================== TOOL EXECUTION =====================

function extractToolCall(text) {
    const match = text.match(/<TOOL_CALL>([\s\S]*?)<\/TOOL_CALL>/);
    if (!match) return null;
    try { return JSON.parse(match[1].trim()); } catch { return null; }
}

function cleanToolTags(text) {
    return text.replace(/<TOOL_CALL>[\s\S]*?<\/TOOL_CALL>/g, '').trim();
}

async function executeTool(toolCall) {
    const Booking = mongoose.model('Booking');
    const PlannerTask = mongoose.model('PlannerTask');
    const Escalation = mongoose.model('Escalation');
    const { tool, params } = toolCall;

    switch (tool) {
        case 'search_knowledge': {
            const results = await searchKnowledge(params.query);
            if (results.length === 0) return { success: true, data: 'No results found.' };
            return { success: true, data: results.map(r => `${r.key}: ${r.value}`).join('\n') };
        }

        case 'check_availability': {
            const ci = new Date(params.checkIn);
            const co = new Date(params.checkOut);
            const overlap = await Booking.findOne({ checkIn: { $lt: co }, checkOut: { $gt: ci } });
            if (overlap) return { success: true, data: `Ocupat. Rezervare existentă: ${overlap.guestName} (${overlap.checkIn.toISOString().slice(0, 10)} - ${overlap.checkOut.toISOString().slice(0, 10)})` };
            return { success: true, data: 'Disponibil!' };
        }

        case 'create_booking': {
            const ciDate = new Date(params.checkIn);
            const coDate = new Date(params.checkOut);
            // Validate hours
            if (ciDate.getHours() < 12) return { success: false, error: 'Check-in trebuie să fie între 12:00 și 23:59' };
            if (coDate.getHours() < 8 || coDate.getHours() > 11) return { success: false, error: 'Check-out trebuie să fie între 08:00 și 11:00' };
            // Check overlap
            const overlap = await Booking.findOne({ checkIn: { $lt: coDate }, checkOut: { $gt: ciDate } });
            if (overlap) return { success: false, error: `Interval ocupat (${overlap.guestName})` };
            const booking = await Booking.create({ guestName: params.guestName, checkIn: ciDate, checkOut: coDate });
            return { success: true, data: booking, type: 'booking' };
        }

        case 'get_user_bookings': {
            const bookings = await Booking.find({ guestName: { $regex: params.guestName, $options: 'i' } }).sort({ checkIn: -1 }).limit(5);
            if (bookings.length === 0) return { success: true, data: 'Nu am găsit rezervări.' };
            return { success: true, data: bookings.map(b => `${b.guestName}: ${b.checkIn.toISOString().slice(0, 10)} → ${b.checkOut.toISOString().slice(0, 10)}`).join('\n') };
        }

        case 'create_task': {
            const task = await PlannerTask.create({
                title: params.title,
                description: params.description || '',
                dueDate: params.dueDate ? new Date(params.dueDate) : null,
                priority: params.priority || 'medium'
            });
            return { success: true, data: task, type: 'task' };
        }

        case 'escalate_to_human': {
            const escalation = await Escalation.create({
                reason: params.reason,
                context: params.context || '',
                sessionId: params.sessionId || '',
                agentType: 'orchestrator',
                priority: params.priority || 'high'
            });
            return { success: true, data: escalation, type: 'escalation' };
        }

        default:
            return { success: false, error: `Unknown tool: ${tool}` };
    }
}

// ===================== MAIN ORCHESTRATOR =====================

async function processOrchestratorMessage(userMessage, sessionId = 'orchestrator-default') {
    const AgentChat = mongoose.model('AgentChat');

    // 1. Get/create chat session
    let chat;
    try {
        chat = await AgentChat.findOne({ sessionId });
        if (!chat) {
            chat = await AgentChat.create({ sessionId, agentType: 'orchestrator', messages: [] });
        }
    } catch (err) {
        console.error('[Orchestrator] DB error getting chat:', err.message);
        chat = { messages: [], summary: '', save: async () => { } };
    }

    // 2. Summarize if conversation is too long (safe)
    try {
        const modelBasic = await getGeminiModelBasic();
        await summarizeConversationIfNeeded(sessionId, modelBasic);
    } catch (err) {
        console.error('[Orchestrator] Summarize error (non-fatal):', err.message);
    }

    // 3. Intent Classification
    let intent = 'GENERAL';
    let confidence = 0.5;
    let reasoning = '';
    try {
        const intentModel = await getGeminiModel(INTENT_PROMPT);
        const intentResult = await intentModel.generateContent(userMessage);
        const intentText = intentResult.response.text();
        console.log('[Orchestrator] Intent raw:', intentText);
        const cleaned = intentText.replace(/```json\n?/g, '').replace(/\n?```/g, '').trim();
        const intentJson = JSON.parse(cleaned);
        intent = intentJson.intent || 'GENERAL';
        confidence = intentJson.confidence || 0.5;
        reasoning = intentJson.reasoning || '';
    } catch (err) {
        console.error('[Orchestrator] Intent classification error:', err.message);
        // Continue with GENERAL intent
    }

    // 4. Build ReAct prompt with context
    let knowledgeContext = '';
    try {
        knowledgeContext = await getContextForAgent('orchestrator') || '';
    } catch (err) {
        console.error('[Orchestrator] Knowledge context error (non-fatal):', err.message);
    }

    let userProfile = {};
    try {
        userProfile = await getUserProfile(sessionId) || {};
    } catch (err) {
        console.error('[Orchestrator] User profile error (non-fatal):', err.message);
    }

    const profileStr = userProfile?.name
        ? `\nPROFIL UTILIZATOR: Nume: ${userProfile.name}, Preferințe: ${(userProfile.preferences || []).join(', ')}`
        : '';
    const summaryStr = chat.summary ? `\nREZUMAT CONVERSAȚIE ANTERIOARĂ: ${chat.summary}` : '';

    const reactPrompt = REACT_PROMPT
        .replace('{KNOWLEDGE_CONTEXT}', knowledgeContext)
        .replace('{USER_PROFILE}', profileStr)
        .replace('{CONVERSATION_SUMMARY}', summaryStr);

    // 5. Build history and send to ReAct agent
    const recentMessages = (chat.messages || []).slice(-20);
    const history = recentMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));

    const reactModel = await getGeminiModel(reactPrompt);
    const reactChat = reactModel.startChat({ history });
    const reactResult = await reactChat.sendMessage(userMessage);
    let responseText = reactResult.response.text();
    console.log('[Orchestrator] ReAct response:', responseText.substring(0, 200));

    // 6. Check for tool calls
    let toolResult = null;
    let toolCall = null;
    try {
        toolCall = extractToolCall(responseText);
        if (toolCall) {
            console.log('[Orchestrator] Tool call:', JSON.stringify(toolCall));
            // Add session info for escalation
            if (toolCall.tool === 'escalate_to_human') {
                toolCall.params = toolCall.params || {};
                toolCall.params.sessionId = sessionId;
                toolCall.params.context = recentMessages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
            }
            toolResult = await executeTool(toolCall);
            responseText = cleanToolTags(responseText);

            // If tool was executed, get a final response incorporating the result
            if (toolResult.success) {
                if (toolResult.type === 'escalation') {
                    responseText = responseText || 'Vă fac imediat legătura cu un coleg. Un moment, vă rog.';
                } else if (!responseText && toolResult.data) {
                    const followUp = await reactChat.sendMessage(
                        `[TOOL RESULT for ${toolCall.tool}]: ${typeof toolResult.data === 'string' ? toolResult.data : JSON.stringify(toolResult.data)}\n\nFormulează un răspuns prietenos bazat pe acest rezultat.`
                    );
                    responseText = followUp.response.text();
                    responseText = cleanToolTags(responseText);
                }
            } else {
                responseText = responseText || `Eroare: ${toolResult.error}`;
            }
        }
    } catch (err) {
        console.error('[Orchestrator] Tool execution error:', err.message);
        responseText = responseText || 'Am întâmpinat o eroare la procesarea cererii. Încearcă din nou.';
    }

    // 7. Extract user profile if present (safe)
    try {
        const profileData = extractUserProfile(responseText);
        if (profileData) {
            await updateUserProfile(sessionId, { ...userProfile, ...profileData });
            responseText = cleanProfileTags(responseText);
        }
    } catch (err) {
        console.error('[Orchestrator] Profile extraction error (non-fatal):', err.message);
        responseText = cleanProfileTags(responseText);
    }

    // 8. Save to history (safe)
    try {
        chat.messages.push({ role: 'user', content: userMessage });
        chat.messages.push({ role: 'model', content: responseText });
        chat.updatedAt = Date.now();
        await chat.save();
    } catch (err) {
        console.error('[Orchestrator] Save history error (non-fatal):', err.message);
    }

    // 9. Build response
    return {
        agent: intent.toLowerCase(),
        reasoning,
        confidence,
        reply: responseText,
        booking: toolResult?.type === 'booking' ? { success: true, booking: toolResult.data } :
            (toolResult && !toolResult.success && toolCall?.tool === 'create_booking') ? { success: false, error: toolResult.error } : null,
        tasks: toolResult?.type === 'task' ? [toolResult.data] : null,
        escalation: toolResult?.type === 'escalation' ? toolResult.data : null
    };
}

module.exports = { processOrchestratorMessage };
