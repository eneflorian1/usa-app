const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const { processAgentMessage } = require('./agentChatService');
const { processPlannerMessage } = require('./plannerAgentService');

const ORCHESTRATOR_SYSTEM_PROMPT = `Ești un orchestrator AI inteligent. Analizezi mesajul utilizatorului și decizi ce agent trebuie apelat.

AGENȚI DISPONIBILI:
1. "booking" — Agent de Rezervări. Folosește-l când utilizatorul vrea să facă o rezervare, să verifice disponibilitatea, sau discută despre cazare/check-in/check-out.
2. "planner" — Agent Planificator. Folosește-l când utilizatorul vrea să creeze task-uri, to-do-uri, să-și organizeze ziua, să planifice ceva.
3. "general" — Conversație generală. Folosește-l pentru orice altceva: salutări, întrebări generale, informații.

INSTRUCȚIUNI:
- Analizează INTENT-ul mesajului utilizatorului
- Răspunde DOAR cu un bloc JSON valid între tagurile <ROUTE_JSON> și </ROUTE_JSON>
- Câmpul "agent" trebuie să fie unul din: "booking", "planner", "general"
- Câmpul "message" trebuie să conțină mesajul original al utilizatorului (nemodificat)
- Câmpul "reasoning" conține o explicație scurtă de ce ai ales acel agent

FORMAT:
<ROUTE_JSON>{"agent":"booking","message":"mesajul original","reasoning":"Utilizatorul vrea o rezervare"}</ROUTE_JSON>

IMPORTANT:
- NU adăuga text suplimentar în afara block-ului ROUTE_JSON
- Dacă nu ești sigur, alege "general"
- Vorbește în limba în care este mesajul`;

async function getGeminiModel(systemInstruction) {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) {
        throw new Error('Gemini API key not configured.');
    }
    const genAI = new GoogleGenerativeAI(setting.value);
    return genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: systemInstruction
    });
}

function extractRouteJSON(text) {
    const match = text.match(/<ROUTE_JSON>([\s\S]*?)<\/ROUTE_JSON>/);
    if (!match) return null;
    try {
        return JSON.parse(match[1].trim());
    } catch (e) {
        console.error('Failed to parse route JSON:', e);
        return null;
    }
}

async function handleGeneralChat(userMessage, sessionId) {
    const AgentChat = mongoose.model('AgentChat');
    let chat = await AgentChat.findOne({ sessionId });
    if (!chat) {
        chat = await AgentChat.create({ sessionId, messages: [] });
    }

    const recentMessages = chat.messages.slice(-20);
    const history = recentMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));

    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) throw new Error('Gemini API key not configured.');

    const genAI = new GoogleGenerativeAI(setting.value);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: 'Ești un asistent virtual prietenos. Răspunzi scurt și la obiect. Vorbești în limba în care ești abordat.'
    });

    const geminiChat = model.startChat({ history });
    const result = await geminiChat.sendMessage(userMessage);
    const responseText = result.response.text();

    chat.messages.push({ role: 'user', content: userMessage });
    chat.messages.push({ role: 'model', content: responseText });
    chat.updatedAt = Date.now();
    await chat.save();

    return { reply: responseText };
}

async function processOrchestratorMessage(userMessage, sessionId = 'orchestrator-default') {
    // Step 1: Route the message
    const model = await getGeminiModel(ORCHESTRATOR_SYSTEM_PROMPT);
    const routeResult = await model.generateContent(userMessage);
    const routeText = routeResult.response.text();
    const routeData = extractRouteJSON(routeText);

    const agent = routeData?.agent || 'general';
    const reasoning = routeData?.reasoning || '';

    let result;

    // Step 2: Call the appropriate agent
    switch (agent) {
        case 'booking':
            result = await processAgentMessage(userMessage, `orch-booking-${sessionId}`);
            return {
                agent: 'booking',
                reasoning,
                reply: result.reply,
                booking: result.booking || null,
                tasks: null
            };

        case 'planner':
            result = await processPlannerMessage(userMessage, `orch-planner-${sessionId}`);
            return {
                agent: 'planner',
                reasoning,
                reply: result.reply,
                booking: null,
                tasks: result.tasks || null
            };

        case 'general':
        default:
            result = await handleGeneralChat(userMessage, `orch-general-${sessionId}`);
            return {
                agent: 'general',
                reasoning,
                reply: result.reply,
                booking: null,
                tasks: null
            };
    }
}

module.exports = { processOrchestratorMessage };
