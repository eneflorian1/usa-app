/**
 * Orchestrator Utilities — JSON extraction, tag cleaning, intent detection
 */

// All tool tags used by the orchestrator
const TOOL_TAGS = [
    'BOOKING_JSON', 'TASK_JSON', 'ESCALATE_JSON', 'GITHUB_JSON',
    'CODING_JSON', 'GH_ISSUES_JSON', 'PROCESS_JSON', 'CRON_JSON',
    'WEB_AGENT_JSON', 'LOCAL_EXEC_JSON', 'SCREENSHOT_JSON', 'CLIPBOARD_JSON',
    'CODING_LOOP_JSON', 'FILESYSTEM_JSON', 'SYSINFO_JSON', 'LAUNCHER_JSON',
    'TERMINAL_TASK_JSON', 'EMAIL_JSON', 'LINK_PROCESSOR_JSON', 'GIT_APP_JSON',
    'MEMORY_JSON', 'TASKS_QUERY_JSON', 'PAYMENT_JSON', 'SEARCH_JSON', 'NEGO_JSON',
    'BOOK_APP_JSON'
];

function extractJSON(text, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = text.match(regex);
    if (!match) return null;
    try { return JSON.parse(match[1].trim()); } catch { return null; }
}

function extractAllJSON(text, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
    const results = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
        try { results.push(JSON.parse(m[1].trim())); } catch { /* skip malformed */ }
    }
    return results;
}

// Tags that may appear multiple times per turn and must be aggregated
const MULTI_TAGS = new Set(['MEMORY_JSON']);

function extractAllTools(text) {
    const tools = {};
    for (const tag of TOOL_TAGS) {
        if (MULTI_TAGS.has(tag)) {
            const all = extractAllJSON(text, tag);
            if (all.length > 0) tools[tag] = all;
        } else {
            const data = extractJSON(text, tag);
            if (data) tools[tag] = data;
        }
    }
    return tools;
}

function cleanAllTags(text) {
    let cleaned = text;
    for (const tag of TOOL_TAGS) {
        cleaned = cleaned.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g'), '');
    }
    return cleaned.trim();
}

// Intent detection from extracted tool data + text fallback
const INTENT_REGEX_MAP = [
    ['book-app', /cart[eié]|c[aă]r[tț]i|carti|\bbook\b|books?.*app|bibliotec|generare.*cart|listea.*c[aă]r|ni[sș]e|book.*generat|start.*generat/i],
    ['nego', /negoci[ea]z[aă]|scanea.*olx|scanea.*marketplace|extrage.*telefon|reveal.*phone|lead-uri|leads|misiuni.*nego|nego.*scan|olx.*scan|negoapp|nego.*app|nego|contact.*nego|persoan[aă].*nego|vânz[aă]tor|ultimul.*contact|telefoane.*extrase|whatsapp.*nego|conversați.*nego|nego.*lead|nego.*config|nego.*stat|contact.*din|lead.*din|persoan.*din/i],
    ['search', /caut[ăa].*pe.*internet|search.*online|caută|caut[ăa].*despre|găsește.*informații|știri.*despre|ce.*știri|news.*despre|informații.*despre|ce presupune|ce este|ce înseamnă|prețul.*azi|cum funcționează|definiția|wikipedia|google.*despre|caută.*web/i],
    ['memory', /ce.*(?:știi|ții.*minte|amintești|reții).*despre.*mine|ce.*am.*zis|ce.*informații.*ai|amintește-ți|remember|ce.*(?:preferințe|date).*ai/i],
    ['tasks-query', /ce.*task.*am|task-uri.*active|task-uri.*completate|ce.*am.*de.*făcut|arată.*task|list.*task|overdue|restante/i],
    ['screenshot', /screenshot|captură.*ecran|captur.*ecran|print.*screen|ce am pe ecran|arată.*ecranul/],
    ['clipboard', /clipboard|copiat|ce am copiat|paste|lipit/],
    ['filesystem', /fișier|folder|director|listea.*fișier|caut[aă].*fișier|citește.*fișier|scrie.*fișier|conținut.*fișier|ce fișiere/],
    ['sysinfo', /sistem|cpu|ram|memorie|disk|spațiu|procese.*rulează|ip.*meu|uptime|network/],
    ['launcher', /deschide.*folder|deschide.*notepad|deschide.*chrome|deschide.*url|deschide.*aplicați|open.*folder/],
    ['web-agent', /mergi pe|deschide site|navigheaz|comand[aă].*pe|caut[aă].*pe.*web|completea.*formular|browser|web.*agent|automat.*web|wolt|uber.*eats|booking\.com|ryanair|emag|amazon/],
    ['email', /\bemail\b|\bmail\b|trimite.*email|citește.*email|inbox|mesaj.*email|send.*email|compose.*email|check.*mail/i],
    ['link-processor', /https?:\/\/[^\s]+.*(?:produs|product|anunț|olx|emag|amazon|ebay|negoci|preț|ofert|link|url)|analizea.*link|procesea.*link|uită-te.*la.*link|verifică.*link|ce.*(?:e|este|găsesc).*la.*link/i],
    ['terminal-task', /instale[aă]z[aă]|configurea|setup.*environment|verifică.*și.*repar|install.*pachet|npm.*install.*-g|verific[aă].*versiune|ce versiune|versiunea de|node.*version|npm.*version|python.*version|update[aă]z[aă].*pachet|dezinstale[aă]z[aă]|uninstall/i],
    ['local-exec', /execut[aă].*local|rulea.*pe pc|comand[aă].*local|local.*exec|pe pc|pe local|pe computer|deschide.*pe.*pc|rulează.*local/],
    ['coding', /(?<!\bvs\s)\bcod(?!e[\s.])|fix\b|bug|refactor|review.*pr|analize.*cod|implementea|debug/],
    ['gh-issues', /auto.?fix|repar.*issue|fixeaz.*issue|batch.*fix/],
    ['process', /proces|session|spawn|background|kill.*proc|oprește.*proc/],
    ['cron', /cron|schedul|recurent|programea|repeat|remind.*every|amintește.*fiecare|în fiecare|la fiecare/],
    ['github', /github|issue|pull.?request|\bPR\b|commit|CI|workflow|repo/],
    ['booking', /rezerv|booking|camer|cazare|check.?in|programare/],
    ['planner', /task|sarcin|plan|todo|treab|marchează|completează|steargă|șterge/i],
];

// Map tool tag names to intent strings
const TAG_TO_INTENT = {
    NEGO_JSON: 'nego',
    SEARCH_JSON: 'search',
    PAYMENT_JSON: 'payment',
    MEMORY_JSON: 'memory',
    TASKS_QUERY_JSON: 'tasks-query',
    LINK_PROCESSOR_JSON: 'link-processor',
    EMAIL_JSON: 'email',
    TERMINAL_TASK_JSON: 'terminal-task',
    CODING_LOOP_JSON: 'coding-loop',
    SCREENSHOT_JSON: 'screenshot',
    CLIPBOARD_JSON: 'clipboard',
    FILESYSTEM_JSON: 'filesystem',
    SYSINFO_JSON: 'sysinfo',
    LAUNCHER_JSON: 'launcher',
    LOCAL_EXEC_JSON: 'local-exec',
    WEB_AGENT_JSON: 'web-agent',
    ESCALATE_JSON: 'escalate',
    CODING_JSON: 'coding',
    GH_ISSUES_JSON: 'gh-issues',
    PROCESS_JSON: 'process',
    CRON_JSON: 'cron',
    GITHUB_JSON: 'github',
    BOOKING_JSON: 'booking',
    TASK_JSON: 'planner',
    GIT_APP_JSON: 'git-app',
    BOOK_APP_JSON: 'book-app',
};

function detectIntent(text, tools) {
    // First check extracted tool data (priority order matches TAG_TO_INTENT key order)
    for (const [tag, intent] of Object.entries(TAG_TO_INTENT)) {
        if (tools[tag]) return intent;
    }
    // Fallback: regex on user message text
    const lower = text.toLowerCase();
    for (const [intent, regex] of INTENT_REGEX_MAP) {
        if (regex.test(lower)) return intent;
    }
    return 'general';
}

module.exports = { extractJSON, extractAllJSON, extractAllTools, cleanAllTags, detectIntent, TOOL_TAGS };
