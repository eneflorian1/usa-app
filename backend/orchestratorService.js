const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const { executeGitHubAction } = require('./githubService');
const { executeCronAction } = require('./cronService');
const { executeCodingAction } = require('./codingAgentService');
const { executeGhIssuesAction } = require('./ghIssuesService');
const { executeProcessAction } = require('./processManagerService');
const { executeWebAgentAction } = require('./webAgentService');
const os = require('os');

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

Pentru CODING simplu (analiză rapidă, review PR — 1 pas):
<CODING_JSON>{"action":"analyze","files":["backend/server.js"],"question":"Ce face acest fișier?"}</CODING_JSON>
<CODING_JSON>{"action":"review_pr","owner":"eneflorian1","repo":"usa-app","pr":1}</CODING_JSON>

Pentru CODING COMPLEX (implementare feature, fix bug, refactor — multi-pas autonom pe PC-ul local):
<CODING_LOOP_JSON>{"task":"Adaugă dark mode toggle în Navigation","project":"usa-app"}</CODING_LOOP_JSON>
<CODING_LOOP_JSON>{"task":"Fix bug-ul de login","project":"de-vanzare.ro"}</CODING_LOOP_JSON>
<CODING_LOOP_JSON>{"task":"Refactorizează API routes","project":"casa"}</CODING_LOOP_JSON>
- Folosește CODING_LOOP_JSON când: implementare feature, fix bug complex, refactor, orice necesită citire+scriere cod
- project = numele folderului din C:\\Users\\Admin\\Documents\\GitHub\\
- Agentul va citi codul, va face modificări, va testa, va commit și push AUTOMAT

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

Pentru LOCAL EXEC (execuție comandă SIMPLĂ pe PC-ul local — o singură comandă rapidă):
<LOCAL_EXEC_JSON>{"command":"npm run dev","label":"Start dev server","cwd":"/home/user/project"}</LOCAL_EXEC_JSON>
<LOCAL_EXEC_JSON>{"command":"git pull && npm install","label":"Update repo"}</LOCAL_EXEC_JSON>
<LOCAL_EXEC_JSON>{"command":"code /path/to/file.js","label":"Open file in VS Code"}</LOCAL_EXEC_JSON>

Pentru TERMINAL TASK (task-uri COMPLEXE pe terminal — instalări, configurări, diagnosticări care necesită mai mulți pași autonomi):
<TERMINAL_TASK_JSON>{"task":"Instalează Node.js pe PC","cwd":"C:\\Users\\Admin"}</TERMINAL_TASK_JSON>
<TERMINAL_TASK_JSON>{"task":"Instalează pachetul npm cowsay global","cwd":"C:\\Users\\Admin"}</TERMINAL_TASK_JSON>
<TERMINAL_TASK_JSON>{"task":"Verifică și repară instalarea Python","cwd":"C:\\Users\\Admin"}</TERMINAL_TASK_JSON>
- Folosește TERMINAL_TASK_JSON când: instalare pachete/software, configurare environment, diagnosticare probleme, orice necesită mai mulți pași și verificări
- Agentul va executa comenzi pas cu pas, va analiza output-ul, va rezolva erori autonom, și va raporta rezultatul final
- DIFERIT de LOCAL_EXEC: TERMINAL_TASK este autonom multi-step, LOCAL_EXEC este o singură comandă fire-and-forget

Pentru SCREENSHOT (captură ecran de pe PC-ul local):
<SCREENSHOT_JSON>{"area":"full"}</SCREENSHOT_JSON>
- Folosește pentru: screenshot, captură ecran, "ce am pe ecran", "arată-mi ecranul", print screen

Pentru CLIPBOARD (citire/scriere clipboard de pe PC-ul local):
<CLIPBOARD_JSON>{"action":"read"}</CLIPBOARD_JSON>
<CLIPBOARD_JSON>{"action":"write","text":"text de copiat"}</CLIPBOARD_JSON>
- Folosește pentru: "ce am copiat", "ce e în clipboard", "copiază textul X", paste

Pentru FILESYSTEM (operații fișiere pe PC-ul local):
<FILESYSTEM_JSON>{"action":"list_directory","path":"C:\\Users\\Admin\\Desktop"}</FILESYSTEM_JSON>
<FILESYSTEM_JSON>{"action":"read_file","path":"C:\\Users\\Admin\\Documents\\note.txt"}</FILESYSTEM_JSON>
<FILESYSTEM_JSON>{"action":"write_file","path":"C:\\Users\\Admin\\Desktop\\test.txt","content":"Hello!"}</FILESYSTEM_JSON>
<FILESYSTEM_JSON>{"action":"move_file","source":"C:\\old.txt","destination":"C:\\new.txt"}</FILESYSTEM_JSON>
<FILESYSTEM_JSON>{"action":"copy_file","source":"C:\\file.txt","destination":"C:\\backup.txt"}</FILESYSTEM_JSON>
<FILESYSTEM_JSON>{"action":"delete_file","path":"C:\\Users\\Admin\\Desktop\\trash.txt"}</FILESYSTEM_JSON>
<FILESYSTEM_JSON>{"action":"search_files","path":"C:\\Users\\Admin","pattern":"*.pdf","maxDepth":3}</FILESYSTEM_JSON>
<FILESYSTEM_JSON>{"action":"file_info","path":"C:\\Users\\Admin\\Documents"}</FILESYSTEM_JSON>
- Folosește pentru: listare foldere, citire fișiere, creare fișiere, mutare, copiere, ștergere, căutare fișiere
- "deschide folderul Documents" → LAUNCHER_JSON, NU filesystem
- "ce fișiere am pe Desktop" → FILESYSTEM_JSON list_directory

Pentru SYSINFO (informații sistem PC local):
<SYSINFO_JSON>{"action":"system_info"}</SYSINFO_JSON>
<SYSINFO_JSON>{"action":"disk_usage"}</SYSINFO_JSON>
<SYSINFO_JSON>{"action":"running_processes"}</SYSINFO_JSON>
<SYSINFO_JSON>{"action":"network_info"}</SYSINFO_JSON>
- Folosește pentru: "cât RAM am", "ce procese rulează", "spațiu pe disk", "IP-ul meu"

Pentru LAUNCHER (deschide aplicații/foldere/URL-uri pe PC-ul local):
<LAUNCHER_JSON>{"action":"open_folder","path":"C:\\Users\\Admin\\Documents"}</LAUNCHER_JSON>
<LAUNCHER_JSON>{"action":"open_app","app":"notepad"}</LAUNCHER_JSON>
<LAUNCHER_JSON>{"action":"open_url","url":"https://google.com"}</LAUNCHER_JSON>
- Folosește pentru: "deschide folderul X", "deschide Notepad", "deschide Chrome pe site-ul Y"
- DIFERIT de LOCAL_EXEC: launcher deschide vizual, LOCAL_EXEC rulează în terminal

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
- Dacă utilizatorul vrea să ruleze o comandă SIMPLĂ pe PC-ul local → LOCAL_EXEC_JSON
- Dacă utilizatorul vrea o INSTALARE, CONFIGURARE, sau DIAGNOSTICARE complexă (mai mulți pași) → OBLIGATORIU TERMINAL_TASK_JSON
- Exemple instalare: "instalează nodejs", "instalează pachetul X" → TERMINAL_TASK_JSON
- Exemple configurare: "configurează Python", "setează environment" → TERMINAL_TASK_JSON  
- Exemple comandă simplă: "dir Desktop", "deschide VS Code" → LOCAL_EXEC_JSON
- Orice referire la "pe PC", "pe local", "pe computer" cu task simplu → LOCAL_EXEC_JSON
- Orice referire la "instalează", "configurează", "verifică și repară" → TERMINAL_TASK_JSON
- NU răspunde doar cu text despre intenție — TREBUIE să incluzi tag-ul corespunzător
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

// ===================== TERMINAL TASK ReAct LOOP =====================

const TERMINAL_REACT_PROMPT = `Ești un agent terminal autonom pe un PC Windows. Execuți un task pas cu pas.
Sistem: Windows 10/11, PowerShell și CMD disponibile.
Default CWD: C:\\Users\\Admin

INSTRUCȚIUNI:
1. Analizează istoricul comenzilor de mai jos
2. Dacă taskul e COMPLET cu succes, răspunde EXACT cu:
   <DONE>{"summary":"Raport final detaliat cu ce s-a făcut, ce probleme au apărut și cum s-au rezolvat","success":true}</DONE>
3. Dacă taskul a eșuat definitiv și nu mai poți face nimic, răspunde cu:
   <DONE>{"summary":"Explicație ce nu a mers și de ce","success":false}</DONE>
4. Dacă mai e ceva de făcut, generează EXACT O SINGURĂ comandă:
   <CMD>{"command":"comanda de executat","cwd":"C:\\\\Users\\\\Admin","reason":"De ce rulez asta"}</CMD>
5. Dacă apar erori, încearcă să le rezolvi autonom (instalează dependențe, retry cu alt approach, etc.)
6. NU rula comenzi interactive care necesită input de la user
7. Preferă winget sau choco pentru instalări pe Windows
8. Verifică ÎNTOTDEAUNA rezultatul instalării cu o comandă de verificare (ex: node --version)

Răspunde DOAR cu <CMD>...</CMD> sau <DONE>...</DONE>, nimic altceva.`;

async function executeTerminalTask(taskDescription, cwd) {
    const LocalExecCommand = mongoose.model('LocalExecCommand');
    const MAX_ITERATIONS = 10;
    const COMMAND_TIMEOUT = 5 * 60 * 1000; // 5 min per command
    const POLL_INTERVAL = 3000; // 3s polling
    const history = [];

    console.log(`[Orchestrator] TerminalTask starting: "${taskDescription}"`);

    // Get a fresh Gemini model with the ReAct prompt
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) throw new Error('Gemini API key not configured');
    const genAI = new GoogleGenerativeAI(setting.value);
    const reactModel = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: TERMINAL_REACT_PROMPT
    });

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        // 1. THINK — Build context and ask Gemini what to do
        let contextParts = [`TASK: ${taskDescription}\n`];
        if (history.length === 0) {
            contextParts.push('Nu s-a executat nicio comandă încă. Ce comandă ar trebui rulată prima?');
        } else {
            contextParts.push('ISTORIC COMENZI:');
            for (const h of history) {
                contextParts.push(`\n$ ${h.command}`);
                contextParts.push(`Exit code: ${h.exitCode}`);
                contextParts.push(`Output:\n${h.output.substring(0, 3000)}`);
                contextParts.push('---');
            }
            contextParts.push(`\nIterația ${i + 1}/${MAX_ITERATIONS}. Ce faci mai departe?`);
        }

        const thinkResult = await reactModel.generateContent(contextParts.join('\n'));
        const thinkText = thinkResult.response.text();
        console.log(`[Orchestrator] TerminalTask iteration ${i + 1}:`, thinkText.substring(0, 200));

        // 2. Check if Gemini says DONE
        const doneMatch = thinkText.match(/<DONE>([\s\S]*?)<\/DONE>/);
        if (doneMatch) {
            try {
                const doneData = JSON.parse(doneMatch[1].trim());
                console.log(`[Orchestrator] TerminalTask DONE (success=${doneData.success}):`, doneData.summary?.substring(0, 200));
                return {
                    success: doneData.success !== false,
                    summary: doneData.summary || 'Task completed',
                    steps: history,
                    iterations: i + 1
                };
            } catch {
                return { success: true, summary: doneMatch[1].trim(), steps: history, iterations: i + 1 };
            }
        }

        // 3. ACT — Extract command and execute
        const cmdMatch = thinkText.match(/<CMD>([\s\S]*?)<\/CMD>/);
        if (!cmdMatch) {
            console.log('[Orchestrator] TerminalTask: No CMD or DONE found, ending loop');
            return {
                success: false,
                summary: `Agentul nu a putut determina următoarea acțiune. Ultimul răspuns: ${thinkText.substring(0, 500)}`,
                steps: history,
                iterations: i + 1
            };
        }

        let cmdData;
        try {
            cmdData = JSON.parse(cmdMatch[1].trim());
        } catch {
            cmdData = { command: cmdMatch[1].trim(), cwd: cwd || '' };
        }

        console.log(`[Orchestrator] TerminalTask executing: ${cmdData.command}`);

        // Queue command for local-exec-agent
        const doc = await LocalExecCommand.create({
            command: cmdData.command,
            label: `TerminalTask step ${i + 1}`,
            cwd: cmdData.cwd || cwd || '',
            execType: 'shell'
        });

        // 4. OBSERVE — Poll for result
        const deadline = Date.now() + COMMAND_TIMEOUT;
        let cmdResult = null;
        console.log(`[Orchestrator] TerminalTask waiting for result of: ${cmdData.command} (timeout ${COMMAND_TIMEOUT / 1000}s)...`);
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL));
            const updated = await LocalExecCommand.findById(doc._id);
            if (updated && (updated.status === 'done' || updated.status === 'error')) {
                cmdResult = { output: updated.output || '(no output)', exitCode: updated.exitCode || 0 };
                console.log(`[Orchestrator] TerminalTask got result for: ${cmdData.command}`);
                break;
            }
        }

        if (!cmdResult) {
            console.log(`[Orchestrator] TerminalTask TIMEOUT for: ${cmdData.command} — local-exec-agent may not be running`);
            cmdResult = { output: 'Timeout: comanda nu a fost executată în 5 minute. Verifică dacă local-exec-agent rulează.', exitCode: 1 };
        }

        // Record step
        history.push({
            command: cmdData.command,
            reason: cmdData.reason || '',
            output: cmdResult.output,
            exitCode: cmdResult.exitCode
        });

        console.log(`[Orchestrator] TerminalTask step ${i + 1} result (exit ${cmdResult.exitCode}):`, cmdResult.output.substring(0, 200));
    }

    // Max iterations reached
    return {
        success: false,
        summary: `Am atins limita de ${MAX_ITERATIONS} iterații. Iată ce am realizat: ${history.map(h => `${h.command} → exit ${h.exitCode}`).join('; ')}`,
        steps: history,
        iterations: MAX_ITERATIONS
    };
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
        .replace(/<LOCAL_EXEC_JSON>[\s\S]*?<\/LOCAL_EXEC_JSON>/g, '')
        .replace(/<SCREENSHOT_JSON>[\s\S]*?<\/SCREENSHOT_JSON>/g, '')
        .replace(/<CLIPBOARD_JSON>[\s\S]*?<\/CLIPBOARD_JSON>/g, '')
        .replace(/<CODING_LOOP_JSON>[\s\S]*?<\/CODING_LOOP_JSON>/g, '')
        .replace(/<FILESYSTEM_JSON>[\s\S]*?<\/FILESYSTEM_JSON>/g, '')
        .replace(/<SYSINFO_JSON>[\s\S]*?<\/SYSINFO_JSON>/g, '')
        .replace(/<LAUNCHER_JSON>[\s\S]*?<\/LAUNCHER_JSON>/g, '')
        .replace(/<TERMINAL_TASK_JSON>[\s\S]*?<\/TERMINAL_TASK_JSON>/g, '')
        .trim();
}

function detectIntent(text, bookingData, taskData, escalateData, githubData, cronData, codingData, ghIssuesData, processData, webAgentData, localExecData, screenshotData, clipboardData, filesystemData, sysinfoData, launcherData, codingLoopData, terminalTaskData) {
    if (terminalTaskData) return 'terminal-task';
    if (codingLoopData) return 'coding-loop';
    if (screenshotData) return 'screenshot';
    if (clipboardData) return 'clipboard';
    if (filesystemData) return 'filesystem';
    if (sysinfoData) return 'sysinfo';
    if (launcherData) return 'launcher';
    if (localExecData) return 'local-exec';
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
    if (/screenshot|captură.*ecran|captur.*ecran|print.*screen|ce am pe ecran|arată.*ecranul/.test(lower)) return 'screenshot';
    if (/clipboard|copiat|ce am copiat|paste|lipit/.test(lower)) return 'clipboard';
    if (/fișier|folder|director|listea.*fișier|caut[aă].*fișier|citește.*fișier|scrie.*fișier|conținut.*fișier|ce fișiere/.test(lower)) return 'filesystem';
    if (/sistem|cpu|ram|memorie|disk|spațiu|procese.*rulează|ip.*meu|uptime|network/.test(lower)) return 'sysinfo';
    if (/deschide.*folder|deschide.*notepad|deschide.*chrome|deschide.*url|deschide.*aplicați|open.*folder/.test(lower)) return 'launcher';
    if (/mergi pe|deschide site|navigheaz|comand[aă].*pe|caut[aă].*pe.*web|completea.*formular|browser|web.*agent|automat.*web|wolt|uber.*eats|booking\.com|ryanair|emag|amazon/.test(lower)) return 'web-agent';
    if (/instale[aă]z[aă]|configurea|setup.*environment|verifică.*și.*repar|install.*pachet|npm.*install.*-g|verific[aă].*versiune|ce versiune|versiunea de|node.*version|npm.*version|python.*version|update[aă]z[aă].*pachet|dezinstale[aă]z[aă]|uninstall/i.test(lower)) return 'terminal-task';
    if (/execut[aă].*local|rulea.*pe pc|comand[aă].*local|local.*exec|pe pc|pe local|pe computer|deschide.*pe.*pc|rulează.*local/.test(lower)) return 'local-exec';
    if (/(?<!\bvs\s)\bcod(?!e[\s.])|fix\b|bug|refactor|review.*pr|analize.*cod|implementea|debug/.test(lower)) return 'coding';
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
    const codingLoopData = extractJSON(responseText, 'CODING_LOOP_JSON');
    const ghIssuesData = extractJSON(responseText, 'GH_ISSUES_JSON');
    const processData = extractJSON(responseText, 'PROCESS_JSON');
    const webAgentData = extractJSON(responseText, 'WEB_AGENT_JSON');
    const localExecData = extractJSON(responseText, 'LOCAL_EXEC_JSON');
    const screenshotData = extractJSON(responseText, 'SCREENSHOT_JSON');
    const clipboardData = extractJSON(responseText, 'CLIPBOARD_JSON');
    const filesystemData = extractJSON(responseText, 'FILESYSTEM_JSON');
    const sysinfoData = extractJSON(responseText, 'SYSINFO_JSON');
    const launcherData = extractJSON(responseText, 'LAUNCHER_JSON');
    const terminalTaskData = extractJSON(responseText, 'TERMINAL_TASK_JSON');
    const intent = detectIntent(userMessage, bookingData, taskData, escalateData, githubData, cronData, codingData, ghIssuesData, processData, webAgentData, localExecData, screenshotData, clipboardData, filesystemData, sysinfoData, launcherData, codingLoopData, terminalTaskData);

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
    let localExecResult = null;
    let terminalTaskResult = null;

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

    // Process Coding Loop — autonomous multi-step coding agent
    if (codingLoopData && codingLoopData.task) {
        try {
            const { runCodingLoop } = require('./codingLoopService');
            const CodingSession = mongoose.model('CodingSession');
            const projectPath = `C:\\Users\\Admin\\Documents\\GitHub\\${codingLoopData.project || 'usa-app'}`;
            const session = await CodingSession.create({
                task: codingLoopData.task,
                projectPath,
                projectName: codingLoopData.project || 'usa-app'
            });
            // Run loop in background (don't await)
            runCodingLoop(codingLoopData.task, projectPath, session._id.toString()).catch(err => {
                console.error('[CodingLoop] Fatal:', err.message);
            });
            codingResult = {
                success: true,
                sessionId: session._id,
                task: codingLoopData.task,
                project: codingLoopData.project,
                status: 'running',
                message: `Coding session started. Track progress at /coding or /api/coding/sessions/${session._id}`
            };
            console.log('[Orchestrator] CodingLoop started:', codingLoopData.task, '→ session', session._id);
        } catch (err) {
            console.error('[Orchestrator] CodingLoop error:', err.message);
            codingResult = { success: false, error: err.message };
        }
    }

    // Process Local Exec action — queues command for local PC agent
    if (localExecData && localExecData.command) {
        try {
            const LocalExecCommand = mongoose.model('LocalExecCommand');
            const doc = await LocalExecCommand.create({
                command: localExecData.command,
                label: localExecData.label || '',
                cwd: localExecData.cwd || ''
            });
            localExecResult = { success: true, id: doc._id, command: doc.command, label: doc.label, status: 'pending' };
            console.log('[Orchestrator] LocalExec queued:', doc.command, '→ id', doc._id);
        } catch (err) {
            console.error('[Orchestrator] LocalExec error:', err.message);
            localExecResult = { success: false, error: err.message };
        }
    }

    // Fallback: intent is local-exec but Gemini didn't generate the tag — extract command from message
    if (intent === 'local-exec' && !localExecResult) {
        try {
            const cmdMatch = userMessage.match(/:\s*(.+)$/) || userMessage.match(/comanda?\s+["""]?(.+?)["""]?\s*$/i);
            if (cmdMatch) {
                const LocalExecCommand = mongoose.model('LocalExecCommand');
                const doc = await LocalExecCommand.create({
                    command: cmdMatch[1].trim(),
                    label: 'Auto-extracted from chat',
                    cwd: ''
                });
                localExecResult = { success: true, id: doc._id, command: doc.command, label: doc.label, status: 'pending' };
                console.log('[Orchestrator] LocalExec fallback queued:', doc.command, '→ id', doc._id);
            }
        } catch (err) {
            console.error('[Orchestrator] LocalExec fallback error:', err.message);
        }
    }

    // Process Screenshot MCP action — queues MCP command for local PC agent
    if (screenshotData || (intent === 'screenshot' && !localExecResult)) {
        try {
            const LocalExecCommand = mongoose.model('LocalExecCommand');
            const doc = await LocalExecCommand.create({
                command: 'take_screenshot',
                label: 'Screenshot',
                execType: 'mcp',
                mcpServer: 'screenshot',
                mcpArgs: screenshotData || { area: 'full' }
            });
            localExecResult = { success: true, id: doc._id, command: 'take_screenshot', label: 'Screenshot', status: 'pending', type: 'mcp' };
            console.log('[Orchestrator] MCP Screenshot queued → id', doc._id);
        } catch (err) {
            console.error('[Orchestrator] Screenshot error:', err.message);
            localExecResult = { success: false, error: err.message };
        }
    }

    // Process Clipboard MCP action — queues MCP command for local PC agent
    if (clipboardData || (intent === 'clipboard' && !localExecResult)) {
        try {
            const LocalExecCommand = mongoose.model('LocalExecCommand');
            const args = clipboardData || { action: 'read' };
            const doc = await LocalExecCommand.create({
                command: args.action === 'write' ? 'write_clipboard' : 'read_clipboard',
                label: args.action === 'write' ? 'Write Clipboard' : 'Read Clipboard',
                execType: 'mcp',
                mcpServer: 'clipboard',
                mcpArgs: args
            });
            localExecResult = { success: true, id: doc._id, command: doc.command, label: doc.label, status: 'pending', type: 'mcp' };
            console.log('[Orchestrator] MCP Clipboard queued → id', doc._id);
        } catch (err) {
            console.error('[Orchestrator] Clipboard error:', err.message);
            localExecResult = { success: false, error: err.message };
        }
    }

    // Process Filesystem MCP action
    if (filesystemData || (intent === 'filesystem' && !localExecResult)) {
        try {
            const LocalExecCommand = mongoose.model('LocalExecCommand');
            const args = filesystemData || { action: 'list_directory', path: DEFAULT_CWD };
            const doc = await LocalExecCommand.create({
                command: args.action || 'list_directory',
                label: `Filesystem: ${args.action || 'list'}`,
                execType: 'mcp',
                mcpServer: 'filesystem',
                mcpArgs: args
            });
            localExecResult = { success: true, id: doc._id, command: doc.command, label: doc.label, status: 'pending', type: 'mcp' };
            console.log('[Orchestrator] MCP Filesystem queued → id', doc._id);
        } catch (err) {
            console.error('[Orchestrator] Filesystem error:', err.message);
            localExecResult = { success: false, error: err.message };
        }
    }

    // Process SysInfo MCP action
    if (sysinfoData || (intent === 'sysinfo' && !localExecResult)) {
        try {
            const LocalExecCommand = mongoose.model('LocalExecCommand');
            const args = sysinfoData || { action: 'system_info' };
            const doc = await LocalExecCommand.create({
                command: args.action || 'system_info',
                label: `SysInfo: ${args.action || 'info'}`,
                execType: 'mcp',
                mcpServer: 'sysinfo',
                mcpArgs: args
            });
            localExecResult = { success: true, id: doc._id, command: doc.command, label: doc.label, status: 'pending', type: 'mcp' };
            console.log('[Orchestrator] MCP SysInfo queued → id', doc._id);
        } catch (err) {
            console.error('[Orchestrator] SysInfo error:', err.message);
            localExecResult = { success: false, error: err.message };
        }
    }

    // Process Launcher MCP action
    if (launcherData || (intent === 'launcher' && !localExecResult)) {
        try {
            const LocalExecCommand = mongoose.model('LocalExecCommand');
            const args = launcherData || { action: 'open_folder', path: os.homedir() };
            const doc = await LocalExecCommand.create({
                command: args.action || 'open_folder',
                label: `Launcher: ${args.action || 'open'}`,
                execType: 'mcp',
                mcpServer: 'launcher',
                mcpArgs: args
            });
            localExecResult = { success: true, id: doc._id, command: doc.command, label: doc.label, status: 'pending', type: 'mcp' };
            console.log('[Orchestrator] MCP Launcher queued → id', doc._id);
        } catch (err) {
            console.error('[Orchestrator] Launcher error:', err.message);
            localExecResult = { success: false, error: err.message };
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

    // Process Terminal Task — autonomous multi-step ReAct loop
    if (terminalTaskData && terminalTaskData.task) {
        try {
            console.log('[Orchestrator] TerminalTask starting (background):', terminalTaskData.task);
            terminalTaskResult = await executeTerminalTask(
                terminalTaskData.task,
                terminalTaskData.cwd || 'C:\\Users\\Admin'
            );
            console.log('[Orchestrator] TerminalTask completed:', terminalTaskResult.success, terminalTaskResult.summary?.substring(0, 200));
            
            // Override the response with the terminal task result
            const stepsReport = terminalTaskResult.steps?.map((s, i) => 
                `  ${i + 1}. \`${s.command}\` → exit ${s.exitCode}${s.reason ? ` (${s.reason})` : ''}`
            ).join('\n') || '';
            
            responseText = `${terminalTaskResult.success ? '✅' : '❌'} **Terminal Task ${terminalTaskResult.success ? 'Completat' : 'Eșuat'}**\n\n` +
                `${terminalTaskResult.summary}\n\n` +
                (stepsReport ? `📋 **Pași executați** (${terminalTaskResult.iterations} iterații):\n${stepsReport}` : '');
        } catch (err) {
            console.error('[Orchestrator] TerminalTask error:', err.message);
            terminalTaskResult = { success: false, summary: err.message };
            responseText = `❌ Terminal Task Error: ${err.message}`;
        }
    }

    // Fallback: intent is terminal-task but Gemini didn't generate the tag
    if (intent === 'terminal-task' && !terminalTaskResult) {
        try {
            console.log('[Orchestrator] TerminalTask fallback for:', userMessage);
            terminalTaskResult = await executeTerminalTask(userMessage, 'C:\\Users\\Admin');
            const stepsReport = terminalTaskResult.steps?.map((s, i) => 
                `  ${i + 1}. \`${s.command}\` → exit ${s.exitCode}`
            ).join('\n') || '';
            responseText = `${terminalTaskResult.success ? '✅' : '❌'} **Terminal Task ${terminalTaskResult.success ? 'Completat' : 'Eșuat'}**\n\n` +
                `${terminalTaskResult.summary}\n\n` +
                (stepsReport ? `📋 **Pași executați** (${terminalTaskResult.iterations} iterații):\n${stepsReport}` : '');
        } catch (err) {
            console.error('[Orchestrator] TerminalTask fallback error:', err.message);
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
        webAgent: webAgentResult,
        localExec: localExecResult,
        terminalTask: terminalTaskResult
    };
}

module.exports = { processOrchestratorMessage };
