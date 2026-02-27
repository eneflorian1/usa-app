const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const { executeGitHubAction } = require('./githubService');
const { executeCronAction } = require('./cronService');
const { executeCodingAction } = require('./codingAgentService');
const { executeGhIssuesAction } = require('./ghIssuesService');
const { executeProcessAction } = require('./processManagerService');
const { executeWebAgentAction } = require('./webAgentService');

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

Pentru GITHUB (operații GitHub — issues, PRs, CI status):
<GITHUB_JSON>{"action":"list_issues","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"create_issue","owner":"eneflorian1","repo":"usa-app","title":"Bug: descriere","body":"Detalii"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"list_prs","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"pr_status","owner":"eneflorian1","repo":"usa-app","pr":1}</GITHUB_JSON>
<GITHUB_JSON>{"action":"ci_status","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"close_issue","owner":"eneflorian1","repo":"usa-app","issue":1}</GITHUB_JSON>
<GITHUB_JSON>{"action":"repo_info","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>

Pentru ESCALARE (când detectezi frustrare sau situație complexă):
<ESCALATE_JSON>{"reason":"Motivul escaladării","priority":"high"}</ESCALATE_JSON>

Pentru CODING (task-uri de cod — analiză, fix, review PR):
<CODING_JSON>{"action":"analyze","files":["backend/server.js"],"question":"Ce face acest fișier?"}</CODING_JSON>
<CODING_JSON>{"action":"execute","task":"Adaugă error handling","targetFiles":["backend/server.js"]}</CODING_JSON>
<CODING_JSON>{"action":"review_pr","owner":"eneflorian1","repo":"usa-app","pr":1}</CODING_JSON>

Pentru GH-ISSUES (auto-fix issues de pe GitHub):
<GH_ISSUES_JSON>{"action":"analyze","owner":"eneflorian1","repo":"usa-app","issue":1}</GH_ISSUES_JSON>
<GH_ISSUES_JSON>{"action":"auto_fix","owner":"eneflorian1","repo":"usa-app","issue":1}</GH_ISSUES_JSON>
<GH_ISSUES_JSON>{"action":"batch_fix","owner":"eneflorian1","repo":"usa-app","label":"bug"}</GH_ISSUES_JSON>

Pentru PROCESE (management procese background):
<PROCESS_JSON>{"action":"spawn","command":"npm test","label":"Run tests"}</PROCESS_JSON>
<PROCESS_JSON>{"action":"list"}</PROCESS_JSON>
<PROCESS_JSON>{"action":"log","sessionId":"abc","tail":20}</PROCESS_JSON>
<PROCESS_JSON>{"action":"kill","sessionId":"abc"}</PROCESS_JSON>

Pentru WEB AGENT (automatizare browser — poate face ORICE pe web: comenzi, rezervări, contactare persoane, completare formulare, extragere date):
<WEB_AGENT_JSON>{"task":"Mergi pe wolt.com și comandă salată de la Restaurant X","startUrl":"https://wolt.com"}</WEB_AGENT_JSON>
<WEB_AGENT_JSON>{"task":"Caută pe Google cele mai bune restaurante din Cluj","startUrl":"https://google.com"}</WEB_AGENT_JSON>
<WEB_AGENT_JSON>{"task":"Completează formularul de contact pe site-ul X cu mesajul Y"}</WEB_AGENT_JSON>

Pentru CRON JOBS (programare acțiuni recurente):
<CRON_JSON>{"action":"create","name":"Morning reminder","cron":"0 8 * * *","type":"notification","payload":{"message":"Time to start the day!"}}</CRON_JSON>
<CRON_JSON>{"action":"create","name":"Daily task","cron":"0 9 * * 1-5","type":"task","payload":{"title":"Check emails","priority":"medium"}}</CRON_JSON>
<CRON_JSON>{"action":"list"}</CRON_JSON>
<CRON_JSON>{"action":"pause","id":"..."}</CRON_JSON>
<CRON_JSON>{"action":"resume","id":"..."}</CRON_JSON>
<CRON_JSON>{"action":"delete","id":"..."}</CRON_JSON>

EXPRESII CRON COMUNE:
- "în fiecare minut" → * * * * *
- "la fiecare oră" → 0 * * * *
- "în fiecare zi la ora 8" → 0 8 * * *
- "în fiecare zi la ora 9 dimineața" → 0 9 * * *
- "luni-vineri la 8" → 0 8 * * 1-5
- "în fiecare luni" → 0 0 * * 1
- "prima zi din lună" → 0 0 1 * *
- "la fiecare 5 minute" → */5 * * * *
- "la fiecare 30 minute" → */30 * * * *

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
        .replace(/<GITHUB_JSON>[\s\S]*?<\/GITHUB_JSON>/g, '')
        .replace(/<CODING_JSON>[\s\S]*?<\/CODING_JSON>/g, '')
        .replace(/<GH_ISSUES_JSON>[\s\S]*?<\/GH_ISSUES_JSON>/g, '')
        .replace(/<PROCESS_JSON>[\s\S]*?<\/PROCESS_JSON>/g, '')
        .replace(/<CRON_JSON>[\s\S]*?<\/CRON_JSON>/g, '')
        .replace(/<WEB_AGENT_JSON>[\s\S]*?<\/WEB_AGENT_JSON>/g, '')
        .trim();
}

function detectIntent(text, bookingData, taskData, escalateData, githubData, cronData, codingData, ghIssuesData, processData, webAgentData) {
    if (webAgentData) return 'web-agent';
    if (escalateData) return 'escalate';
    if (codingData) return 'coding';
    if (ghIssuesData) return 'gh-issues';
    if (processData) return 'process';
    if (cronData) return 'cron';
    if (githubData) return 'github';
    if (bookingData) return 'booking';
    if (taskData) return 'planner';
    const lower = text.toLowerCase();
    if (/mergi pe|deschide site|navigheaz|comand[aă].*pe|caut[aă].*pe.*web|completea.*formular|browser|web.*agent|automat.*web|wolt|uber.*eats|booking\.com|ryanair|emag|amazon/.test(lower)) return 'web-agent';
    if (/cod|code|fix|bug|refactor|review.*pr|analize.*cod|implementea|debug/.test(lower)) return 'coding';
    if (/auto.?fix|repar.*issue|fixeaz.*issue|batch.*fix/.test(lower)) return 'gh-issues';
    if (/proces|session|spawn|background|kill.*proc|oprește.*proc/.test(lower)) return 'process';
    if (/cron|schedul|recurent|programea|repeat|remind.*every|amintește.*fiecare|în fiecare|la fiecare/.test(lower)) return 'cron';
    if (/github|issue|pull.?request|\bPR\b|commit|CI|workflow|repo/.test(lower)) return 'github';
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
    const githubData = extractJSON(responseText, 'GITHUB_JSON');
    const cronData = extractJSON(responseText, 'CRON_JSON');
    const codingData = extractJSON(responseText, 'CODING_JSON');
    const ghIssuesData = extractJSON(responseText, 'GH_ISSUES_JSON');
    const processData = extractJSON(responseText, 'PROCESS_JSON');
    const webAgentData = extractJSON(responseText, 'WEB_AGENT_JSON');
    const intent = detectIntent(userMessage, bookingData, taskData, escalateData, githubData, cronData, codingData, ghIssuesData, processData, webAgentData);

    // Clean response
    responseText = cleanAllTags(responseText);

    // 5. Execute actions
    let bookingResult = null;
    let taskResult = null;
    let escalationResult = null;
    let githubResult = null;
    let cronResult = null;
    let codingResult = null;
    let ghIssuesResult = null;
    let processResult = null;
    let webAgentResult = null;

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

    // Process GitHub action
    if (githubData) {
        try {
            githubResult = await executeGitHubAction(githubData);
            console.log('[Orchestrator] GitHub action:', githubData.action, '→', JSON.stringify(githubResult).substring(0, 200));
        } catch (err) {
            console.error('[Orchestrator] GitHub error:', err.message);
            githubResult = { error: err.message };
        }
    }

    // Process Cron action
    if (cronData) {
        try {
            cronResult = await executeCronAction(cronData);
            console.log('[Orchestrator] Cron action:', cronData.action, '→', cronResult.message);
        } catch (err) {
            console.error('[Orchestrator] Cron error:', err.message);
            cronResult = { success: false, message: err.message };
        }
    }

    // Process Coding action
    if (codingData) {
        try {
            codingResult = await executeCodingAction(codingData);
            console.log('[Orchestrator] Coding action:', codingData.action, '→', JSON.stringify(codingResult).substring(0, 200));
        } catch (err) {
            console.error('[Orchestrator] Coding error:', err.message);
            codingResult = { error: err.message };
        }
    }

    // Process GH-Issues action
    if (ghIssuesData) {
        try {
            ghIssuesResult = await executeGhIssuesAction(ghIssuesData);
            console.log('[Orchestrator] GH-Issues action:', ghIssuesData.action, '→', JSON.stringify(ghIssuesResult).substring(0, 200));
        } catch (err) {
            console.error('[Orchestrator] GH-Issues error:', err.message);
            ghIssuesResult = { error: err.message };
        }
    }

    // Process background process action
    if (processData) {
        try {
            processResult = executeProcessAction(processData);
            console.log('[Orchestrator] Process action:', processData.action);
        } catch (err) {
            console.error('[Orchestrator] Process error:', err.message);
            processResult = { error: err.message };
        }
    }

    // Process Web Agent action
    if (webAgentData) {
        try {
            webAgentResult = await executeWebAgentAction(webAgentData);
            console.log('[Orchestrator] WebAgent action:', webAgentData.task, '→', JSON.stringify(webAgentResult).substring(0, 200));
        } catch (err) {
            console.error('[Orchestrator] WebAgent error:', err.message);
            webAgentResult = { error: err.message };
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
        escalation: escalationResult,
        github: githubResult,
        cron: cronResult,
        coding: codingResult,
        ghIssues: ghIssuesResult,
        process: processResult,
        webAgent: webAgentResult
    };
}

module.exports = { processOrchestratorMessage };
