const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

/**
 * ReAct Orchestrator Service
 * Single Gemini call with full context — same pattern as working agentChatService
 */

const SYSTEM_PROMPT = `Ești un asistent AI inteligent care funcționează ca un Orchestrator. Vorbești în limba în care ești abordat.

ROLUL TĂU:
- Clasifici automat intențiile utilizatorului (rezervare, task, informații, general)
- Execut acțiuni folosind TOOLS
- Răspunzi prietenos și profesional

REGULI BOOKING:
- Check-in: între 12:00 și 23:59
- Check-out: între 08:00 și 11:00
- Trebuie: nume oaspete, data check-in, data check-out
- Dacă lipsesc date, cere-le politicos
- Dacă nu se specifică ora: check-in = 14:00, check-out = 10:00

TOOLS DISPONIBILE:
Când vrei să execuți o acțiune, include EXACT acest format:

Pentru REZERVARE (când ai TOATE datele):
<BOOKING_JSON>{"guestName":"Nume","checkIn":"2026-03-05T14:00:00","checkOut":"2026-03-06T10:00:00"}</BOOKING_JSON>

Pentru TASK:
<TASK_JSON>{"title":"Titlu task","description":"Descriere","dueDate":"2026-03-05T09:00:00","priority":"medium"}</TASK_JSON>

Pentru ESCALARE (când detectezi frustrare sau situație complexă):
<ESCALATE_JSON>{"reason":"Motivul escaladării","priority":"high"}</ESCALATE_JSON>

COMPORTAMENT:
- Dacă utilizatorul salută → răspunde prietenos, fără TOOL
- Dacă vrea rezervare dar lipsesc date → întreabă ce lipsește
- Dacă este frustrat (!!!, caps, "nu funcționează") → escaladează
- Include TOOL JSON doar când ai TOATE datele necesare
- NU inventa informații

Dacă detectezi numele utilizatorului sau preferințe, menționează-le natural în conversație (nu folosi tag-uri speciale).`;

async function getGeminiModel() {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) {
        throw new Error('Gemini API key not configured. Please set it in Settings.');
    }
    const genAI = new GoogleGenerativeAI(setting.value);
    return genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: SYSTEM_PROMPT
    });
}

// ===================== JSON EXTRACTORS =====================

function extractJSON(text, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = text.match(regex);
    if (!match) return null;
    try { return JSON.parse(match[1].trim()); } catch { return null; }
}

function cleanAllTags(text) {
    return text
        .replace(/<BOOKING_JSON>[\s\S]*?<\/BOOKING_JSON>/g, '')
        .replace(/<TASK_JSON>[\s\S]*?<\/TASK_JSON>/g, '')
        .replace(/<ESCALATE_JSON>[\s\S]*?<\/ESCALATE_JSON>/g, '')
        .trim();
}

function detectIntent(text, bookingData, taskData, escalateData) {
    if (escalateData) return 'escalate';
    if (bookingData) return 'booking';
    if (taskData) return 'planner';
    // Simple keyword detection as fallback
    const lower = text.toLowerCase();
    if (/rezerv|book|camer|cazare|check.?in|programare/.test(lower)) return 'booking';
    if (/task|sarcin|plan|todo|treab/.test(lower)) return 'planner';
    return 'general';
}

// ===================== MAIN FUNCTION =====================

async function processOrchestratorMessage(userMessage, sessionId = 'orchestrator-default') {
    const AgentChat = mongoose.model('AgentChat');
    const Booking = mongoose.model('Booking');
    const PlannerTask = mongoose.model('PlannerTask');

    // 1. Get or create chat session
    let chat = await AgentChat.findOne({ sessionId });
    if (!chat) {
        chat = await AgentChat.create({ sessionId, agentType: 'orchestrator', messages: [] });
    }

    // 2. Build history for Gemini (same as agentChatService)
    const recentMessages = chat.messages.slice(-20);
    const history = recentMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));

    // 3. Single Gemini call (same pattern as working agentChatService)
    const model = await getGeminiModel();
    const geminiChat = model.startChat({ history });
    const result = await geminiChat.sendMessage(userMessage);
    let responseText = result.response.text();
    console.log('[Orchestrator] Response:', responseText.substring(0, 300));

    // 4. Extract tool commands
    const bookingData = extractJSON(responseText, 'BOOKING_JSON');
    const taskData = extractJSON(responseText, 'TASK_JSON');
    const escalateData = extractJSON(responseText, 'ESCALATE_JSON');
    const intent = detectIntent(userMessage, bookingData, taskData, escalateData);

    // Clean response
    responseText = cleanAllTags(responseText);

    // 5. Execute actions
    let bookingResult = null;
    let taskResult = null;
    let escalationResult = null;

    // Process booking
    if (bookingData && bookingData.guestName && bookingData.checkIn && bookingData.checkOut) {
        try {
            const checkIn = new Date(bookingData.checkIn);
            const checkOut = new Date(bookingData.checkOut);

            // Validate hours
            if (checkIn.getHours() < 12) {
                bookingResult = { success: false, error: 'Check-in trebuie să fie între 12:00 și 23:59' };
            } else if (checkOut.getHours() < 8 || checkOut.getHours() > 11) {
                bookingResult = { success: false, error: 'Check-out trebuie să fie între 08:00 și 11:00' };
            } else {
                // Check overlap
                const overlap = await Booking.findOne({
                    checkIn: { $lt: checkOut },
                    checkOut: { $gt: checkIn }
                });
                if (overlap) {
                    bookingResult = { success: false, error: `Interval ocupat (${overlap.guestName})` };
                } else {
                    const booking = await Booking.create({
                        guestName: bookingData.guestName,
                        checkIn,
                        checkOut
                    });
                    bookingResult = { success: true, booking };
                    console.log('[Orchestrator] Booking created:', booking._id);
                }
            }
        } catch (err) {
            console.error('[Orchestrator] Booking error:', err.message);
            bookingResult = { success: false, error: err.message };
        }
    }

    // Process task
    if (taskData && taskData.title) {
        try {
            const task = await PlannerTask.create({
                title: taskData.title,
                description: taskData.description || '',
                dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
                priority: taskData.priority || 'medium'
            });
            taskResult = [task];
            console.log('[Orchestrator] Task created:', task._id);
        } catch (err) {
            console.error('[Orchestrator] Task error:', err.message);
        }
    }

    // Process escalation
    if (escalateData) {
        try {
            const Escalation = mongoose.model('Escalation');
            const esc = await Escalation.create({
                reason: escalateData.reason || 'Escaladare automată',
                context: recentMessages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n'),
                sessionId,
                agentType: 'orchestrator',
                priority: escalateData.priority || 'high'
            });
            escalationResult = esc;
            console.log('[Orchestrator] Escalation created:', esc._id);
        } catch (err) {
            console.error('[Orchestrator] Escalation error:', err.message);
        }
    }

    // 6. Save to history
    chat.messages.push({ role: 'user', content: userMessage });
    chat.messages.push({ role: 'model', content: responseText });
    chat.updatedAt = Date.now();
    await chat.save();

    // 7. Return response
    return {
        agent: intent,
        reasoning: '',
        confidence: 1,
        reply: responseText,
        booking: bookingResult,
        tasks: taskResult,
        escalation: escalationResult
    };
}

module.exports = { processOrchestratorMessage };
