const mongoose = require('mongoose');
const { getGeminiModel } = require('./configService');

const PLANNER_SYSTEM_PROMPT = `Ești un agent de planificare personal. Vorbești în limba în care ești abordat.

CAPABILITĂȚI:
- Creezi task-uri/to-do cu titlu, descriere, deadline și prioritate
- Organizezi planuri zilnice
- Sugerezi priorități
- Poți purta conversații normale

Când utilizatorul vrea să creeze un task, extrage informațiile și adaugă la sfârșitul răspunsului un bloc JSON:

<TASK_JSON>{"title":"Titlu task","description":"Descriere opțională","dueDate":"2026-02-28T18:00:00","priority":"high"}</TASK_JSON>

REGULI:
- priority poate fi: "low", "medium", "high"
- Dacă nu se specifică deadline, pune mâine la 18:00
- Dacă nu se specifică prioritate, pune "medium"
- NU include blocul JSON decât când ești sigur că utilizatorul vrea să creeze un task
- Poți crea multiple task-uri dacă se cer (un bloc TASK_JSON per task)
- Fii prietenos și eficient
- Dacă ți se raportează finalizarea unui task, felicită utilizatorul`;

// getGeminiModel imported from configService

function extractTaskJSONs(text) {
    const regex = /<TASK_JSON>([\s\S]*?)<\/TASK_JSON>/g;
    const tasks = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        try {
            tasks.push(JSON.parse(match[1].trim()));
        } catch (e) {
            console.error('Failed to parse task JSON:', e);
        }
    }
    return tasks;
}

function cleanResponseText(text) {
    return text.replace(/<TASK_JSON>[\s\S]*?<\/TASK_JSON>/g, '').trim();
}

async function processPlannerMessage(userMessage, sessionId = 'planner-default') {
    const AgentChat = mongoose.model('AgentChat');
    const PlannerTask = mongoose.model('PlannerTask');

    let chat = await AgentChat.findOne({ sessionId });
    if (!chat) {
        chat = await AgentChat.create({ sessionId, messages: [] });
    }

    const recentMessages = chat.messages.slice(-30);
    const history = recentMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));

    const model = await getGeminiModel(PLANNER_SYSTEM_PROMPT);
    const geminiChat = model.startChat({ history });

    const result = await geminiChat.sendMessage(userMessage);
    const rawResponse = result.response.text();

    const taskDataList = extractTaskJSONs(rawResponse);
    const responseText = cleanResponseText(rawResponse);
    const createdTasks = [];

    for (const taskData of taskDataList) {
        try {
            const task = await PlannerTask.create({
                title: taskData.title,
                description: taskData.description || '',
                dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
                priority: taskData.priority || 'medium'
            });
            createdTasks.push(task);
        } catch (err) {
            console.error('Failed to create task:', err);
        }
    }

    // Save messages
    chat.messages.push({ role: 'user', content: userMessage });
    let savedContent = responseText;
    if (createdTasks.length > 0) {
        savedContent += `\n[SYSTEM: ${createdTasks.length} task(s) created successfully]`;
    }
    chat.messages.push({ role: 'model', content: savedContent });
    chat.updatedAt = Date.now();
    await chat.save();

    return {
        reply: responseText,
        tasks: createdTasks.length > 0 ? createdTasks : null
    };
}

module.exports = { processPlannerMessage };
