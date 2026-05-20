/**
 * Orchestrator Service — Main entry point
 * Slim dispatcher: Gemini call → extract tools → route to handlers
 */
const mongoose = require('mongoose');
const { getGeminiModel } = require('../configService');
const { SYSTEM_PROMPT } = require('./prompts');
const { extractAllTools, cleanAllTags, detectIntent } = require('./utils');
const h = require('./handlers');

// Categories used for the "about the user" and "about the assistant" profile slots
const PERSONA_CATEGORIES = new Set(['persona', 'assistant_persona']);

async function processOrchestratorMessage(userMessage, sessionId = 'orchestrator-default', opts = {}) {
    const AgentChat = mongoose.model('AgentChat');
    const PlannerTask = mongoose.model('PlannerTask');
    const OrchestratorMemory = mongoose.model('OrchestratorMemory');
    const ProjectMemory = mongoose.model('ProjectMemory');
    const projectPath = opts.projectPath || null;

    // 1. Get or create chat session
    let chat = await AgentChat.findOne({ sessionId });
    if (!chat) {
        chat = await AgentChat.create({ sessionId, agentType: 'orchestrator', messages: [] });
    }

    // 2. Build history for Gemini (alternating user/model)
    const recentMessages = chat.messages.slice(-20);
    let history = recentMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content || ' ' }]
    }));
    while (history.length > 0 && history[0].role !== 'user') history.shift();
    history = history.reduce((acc, curr) => {
        if (acc.length > 0 && acc[acc.length - 1].role === curr.role) {
            acc[acc.length - 1].parts[0].text += '\n' + curr.parts[0].text;
        } else {
            acc.push(curr);
        }
        return acc;
    }, []);

    // 3. Inject memory + task context
    let contextBlock = '';
    try {
        // Inject user Profile (email, phone, name) so Gemini never asks for them
        try {
            const Profile = mongoose.model('Profile');
            const profile = await Profile.findOne().lean();
            if (profile) {
                const parts = [];
                if (profile.firstName || profile.lastName) parts.push(`Nume: ${[profile.firstName, profile.lastName].filter(Boolean).join(' ')}`);
                if (profile.email) parts.push(`Email: ${profile.email}`);
                if (profile.phone) parts.push(`Telefon/WhatsApp: ${profile.phone}`);
                if (profile.address) parts.push(`Adresă: ${profile.address}`);
                if (parts.length > 0) {
                    contextBlock += `\n[USER_CONTACT_PROFILE]\n${parts.join('\n')}\nFolosește aceste date direct — NU cere email sau telefon utilizatorului.\n[/USER_CONTACT_PROFILE]\n`;
                }
            }
        } catch (profileErr) {
            console.error('[Orchestrator] Profile inject error:', profileErr.message);
        }
        const activeTasks = await PlannerTask.find({ completed: false }).sort({ dueDate: 1 }).limit(20).lean();
        if (activeTasks.length > 0) {
            const taskLines = activeTasks.map(t => {
                const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString('ro-RO') : 'fără termen';
                return `  - [${t.priority}] ${t.title} (termen: ${due})`;
            }).join('\n');
            contextBlock += `\n[ACTIVE_TASKS_CONTEXT]\nAi ${activeTasks.length} task-uri active:\n${taskLines}\n[/ACTIVE_TASKS_CONTEXT]\n`;
        }
        const memories = await OrchestratorMemory.find().sort({ updatedAt: -1 }).limit(50).lean();

        // Split out persona / assistant_persona entries — injected as dedicated
        // profile slots so the model treats them as durable identity, not just facts.
        const userPersona = memories.filter(m => m.category === 'persona');
        const assistantPersona = memories.filter(m => m.category === 'assistant_persona');
        const generalMemories = memories.filter(m => !PERSONA_CATEGORIES.has(m.category));

        if (userPersona.length > 0) {
            contextBlock += `\n[USER_PROFILE]\nDespre utilizator (folosește natural, fără a cita blocul):\n` +
                userPersona.map(m => `  - ${m.content}`).join('\n') + `\n[/USER_PROFILE]\n`;
        }
        if (assistantPersona.length > 0) {
            contextBlock += `\n[ASSISTANT_PROFILE]\nCum să vorbești / stilul tău (păstrează consecvent):\n` +
                assistantPersona.map(m => `  - ${m.content}`).join('\n') + `\n[/ASSISTANT_PROFILE]\n`;
        }
        if (generalMemories.length > 0) {
            const memLines = generalMemories.map(m => `  - [${m.category}] ${m.content}`).join('\n');
            contextBlock += `\n[MEMORY_CONTEXT]\nMemoriile tale salvate:\n${memLines}\n[/MEMORY_CONTEXT]\n`;
        }

        // Project memory — full entry when a projectPath is supplied, else compact index of all known projects
        if (projectPath) {
            const pm = await ProjectMemory.findOne({ projectPath }).lean();
            if (pm) {
                const parts = [`Proiect activ: ${pm.projectName || projectPath}`, `Path: ${pm.projectPath}`];
                if (pm.techStack) parts.push(`Tech stack: ${pm.techStack}`);
                if (pm.conventions) parts.push(`Convenții: ${pm.conventions}`);
                if (pm.structure) parts.push(`Structură:\n${pm.structure}`);
                if (pm.deployNotes) parts.push(`Deploy: ${pm.deployNotes}`);
                if (pm.knownIssues?.length) parts.push(`Known issues: ${pm.knownIssues.join('; ')}`);
                if (pm.recentChanges?.length) {
                    const rc = pm.recentChanges.slice(-5).map(c => `  - ${c.summary}`).join('\n');
                    parts.push(`Schimbări recente:\n${rc}`);
                }
                contextBlock += `\n[PROJECT_MEMORY]\n${parts.join('\n')}\n[/PROJECT_MEMORY]\n`;
            }
        } else {
            const allProjects = await ProjectMemory.find()
                .select('projectName projectPath techStack conventions updatedAt')
                .sort({ updatedAt: -1 }).limit(10).lean();
            if (allProjects.length > 0) {
                const lines = allProjects.map(p => {
                    const bits = [p.projectName || p.projectPath];
                    if (p.techStack) bits.push(p.techStack);
                    if (p.conventions) bits.push(`conv: ${p.conventions.substring(0, 120)}`);
                    return `  - ${bits.join(' | ')}`;
                }).join('\n');
                contextBlock += `\n[PROJECTS_INDEX]\nProiecte cunoscute (convenții + tech stack):\n${lines}\n[/PROJECTS_INDEX]\n`;
            }
        }

        // Active document draft context
        try {
            const { getLatestDraft } = require('../documentService');
            const activeDraft = await getLatestDraft(sessionId);
            if (activeDraft && activeDraft.status !== 'published') {
                const sCount = activeDraft.sections?.length || 0;
                const nCount = activeDraft.notes?.length || 0;
                const sPreview = activeDraft.sections?.slice(-3).map(s =>
                    `  • [${s.type}] ${s.text?.substring(0, 60) || s.code?.substring(0, 40) || ''}`
                ).join('\n') || '  (nicio secțiune încă)';
                const nPreview = nCount > 0
                    ? `\n  Note în buffer (${nCount}):\n${activeDraft.notes.slice(-3).map(n => `  📌 "${n.substring(0, 80)}"`).join('\n')}`
                    : '';
                contextBlock += `\n[ACTIVE_DOCUMENT]\nDocument activ: "${activeDraft.title}" (docId: ${activeDraft.docId})\n  Status: ${activeDraft.status} | ${sCount} secțiuni | ${nCount} note în buffer | categorie: ${activeDraft.categoryId}\n  Ultimele secțiuni:\n${sPreview}${nPreview}\n[/ACTIVE_DOCUMENT]\n`;
            }
        } catch (draftErr) {
            // Non-critical
        }

        // Cassandra semantic recall (vector memory + recent + prior relevant turns)
        try {
            const cassandraMem = require('../services/cassandra');
            if (cassandraMem.isReady()) {
                const semanticBlock = await cassandraMem.buildContextBlock(sessionId, userMessage, {
                    memoryK: 6,
                    turnK: 3,
                    recentTurns: 0,
                });
                if (semanticBlock) contextBlock += semanticBlock;
            }
        } catch (cmErr) {
            console.error('[Orchestrator] Cassandra recall error:', cmErr.message);
        }
    } catch (err) {
        console.error('[Orchestrator] Context injection error:', err.message);
    }

    const enrichedMessage = contextBlock ? `${contextBlock}\nMesajul utilizatorului: ${userMessage}` : userMessage;

    // 4. Single Gemini call — fallback chain on 429/404
    const MODEL_CHAIN = [
        'gemini-2.5-flash', 'gemini-2.0-flash',
        'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite',
        'gemini-flash-latest', 'gemini-flash-lite-latest',
        'gemini-3.1-flash-lite', 'gemini-3-flash-preview'
    ];
    let responseText = '';
    let lastErr = null;
    for (const modelName of MODEL_CHAIN) {
        try {
            const model = await getGeminiModel(SYSTEM_PROMPT, modelName);
            const geminiChat = model.startChat({ history });
            const result = await geminiChat.sendMessage(enrichedMessage);
            responseText = result.response.text();
            if (modelName !== MODEL_CHAIN[0]) console.log(`[Orchestrator] Used fallback model: ${modelName}`);
            lastErr = null;
            break;
        } catch (err) {
            lastErr = err;
            const retryable = err.message?.includes('429') || err.message?.includes('404') || err.message?.includes('not found');
            if (retryable) {
                console.warn(`[Orchestrator] ${modelName} unavailable (${err.message?.includes('429') ? 'quota' : 'not found'}), trying next...`);
                continue;
            }
            throw err;
        }
    }
    if (!responseText && lastErr) throw lastErr;
    console.log('[Orchestrator] Response:', responseText.substring(0, 300));

    // 5. Extract all tool commands and detect intent
    const tools = extractAllTools(responseText);
    const intent = detectIntent(userMessage, tools);
    const extractedTags = Object.keys(tools);
    if (extractedTags.length > 0) {
        console.log(`[Orchestrator] Tags extracted: ${extractedTags.join(', ')}`);
    } else {
        console.log(`[Orchestrator] No tags extracted — text-only response`);
    }
    responseText = cleanAllTags(responseText);

    // 6. Execute actions via handlers
    const results = {};
    const safeExec = async (name, fn) => {
        try { results[name] = await fn(); }
        catch (err) {
            console.error(`[Orchestrator] ${name} error:`, err.message);
            results[name] = { error: err.message };
        }
    };

    const applyResult = (handlerResult) => {
        if (!handlerResult) return;
        if (handlerResult.responseOverride) responseText = handlerResult.responseOverride;
        if (handlerResult.responseAppend) responseText += handlerResult.responseAppend;
        return handlerResult.result || handlerResult;
    };

    // Booking
    await safeExec('booking', async () => applyResult({ result: await h.handleBooking(tools.BOOKING_JSON) }));

    // Task
    await safeExec('tasks', async () => {
        const r = await h.handleTask(tools.TASK_JSON);
        if (r && r.responseAppend) responseText += r.responseAppend;
        return r?.result;
    });

    // Escalation
    await safeExec('escalation', () => h.handleEscalation(tools.ESCALATE_JSON, recentMessages, sessionId));

    // Simple delegated services
    await safeExec('github', () => h.handleGithub(tools.GITHUB_JSON));
    await safeExec('cron', () => h.handleCron(tools.CRON_JSON));
    await safeExec('coding', () => h.handleCoding(tools.CODING_JSON));
    await safeExec('ghIssues', () => h.handleGhIssues(tools.GH_ISSUES_JSON));
    await safeExec('process', () => h.handleProcess(tools.PROCESS_JSON));
    await safeExec('webAgent', () => h.handleWebAgent(tools.WEB_AGENT_JSON));
    await safeExec('email', () => h.handleEmail(tools.EMAIL_JSON));
    await safeExec('gitApp', () => h.handleGitApp(tools.GIT_APP_JSON));

    // Coding Loop (override coding result if present)
    if (tools.CODING_LOOP_JSON) {
        await safeExec('coding', () => h.handleCodingLoop(tools.CODING_LOOP_JSON));
    }

    // Local Exec (with intent fallback)
    await safeExec('localExec', async () =>
        h.handleLocalExec(tools.LOCAL_EXEC_JSON, userMessage, intent)
    );

    // MCP handlers — only if no localExec result yet
    const mcpTypes = ['screenshot', 'clipboard', 'filesystem', 'sysinfo', 'launcher'];
    const mcpTagMap = {
        screenshot: 'SCREENSHOT_JSON', clipboard: 'CLIPBOARD_JSON',
        filesystem: 'FILESYSTEM_JSON', sysinfo: 'SYSINFO_JSON', launcher: 'LAUNCHER_JSON'
    };
    for (const type of mcpTypes) {
        const tagData = tools[mcpTagMap[type]];
        if (tagData || intent === type) {
            await safeExec('localExec', () => h.handleMcp(type, tagData, intent, results.localExec));
        }
    }

    // Link Processor
    await safeExec('linkProcessor', async () => {
        const r = await h.handleLinkProcessor(tools.LINK_PROCESSOR_JSON, userMessage, intent);
        return applyResult(r);
    });

    // Terminal Task
    await safeExec('terminalTask', async () => {
        const r = await h.handleTerminalTask(tools.TERMINAL_TASK_JSON, userMessage, intent);
        return applyResult(r);
    });

    // Memory
    await safeExec('memory', async () => {
        const r = await h.handleMemory(tools.MEMORY_JSON, intent);
        if (r && r.responseAppend) responseText += r.responseAppend;
        return r?.result;
    });

    // Search
    await safeExec('search', async () => {
        const r = await h.handleSearch(tools.SEARCH_JSON, userMessage, intent);
        return applyResult(r);
    });

    // Payment
    await safeExec('payment', async () => {
        const r = await h.handlePayment(tools.PAYMENT_JSON);
        if (r && r.responseAppend) responseText += r.responseAppend;
        return r?.result;
    });

    // Nego
    await safeExec('nego', async () => {
        const r = await h.handleNego(tools.NEGO_JSON);
        if (r && r.responseOverride) responseText = r.responseOverride;
        else if (r && r.responseAppend) responseText += r.responseAppend;
        return r?.result;
    });

    // Tasks Query
    await safeExec('tasksQuery', async () => {
        const r = await h.handleTasksQuery(tools.TASKS_QUERY_JSON, intent);
        if (r && r.responseAppend) responseText += r.responseAppend;
        return r?.result;
    });

    // Book App (MCP Bridge to local book2)
    await safeExec('bookApp', async () => {
        const r = await h.handleBookApp(tools.BOOK_APP_JSON, intent);
        if (r && r.responseAppend) responseText += r.responseAppend;
        return r?.result;
    });

    // Lead Intelligence — scrape → analyze → score → draft
    if (tools.LEAD_INTEL_JSON) {
        await safeExec('leadIntel', async () => {
            const r = await h.handleLeadIntel(tools.LEAD_INTEL_JSON);
            if (r && r.responseOverride) responseText = r.responseOverride;
            return r?.result;
        });
    }

    // Geo Search — Geo Brain: search planner + OLX agent + lead intel + monitor
    if (tools.GEO_SEARCH_JSON) {
        await safeExec('geoSearch', async () => {
            const r = await h.handleGeoSearch(tools.GEO_SEARCH_JSON, userMessage, null);
            if (r && r.responseOverride) responseText = r.responseOverride;
            return r?.result;
        });
    }

    // File Agent — creează/listează/citește fișiere (rulează ÎNAINTE de Messenger pentru same-turn attach)
    if (tools.FILE_AGENT_JSON) {
        await safeExec('fileAgent', async () => {
            const r = await h.handleFileAgent(tools.FILE_AGENT_JSON);
            if (r?.responseAppend) responseText += r.responseAppend;
            return r?.result;
        });
    }

    // Doc Agent — creare/editare documente multi-turn + PDF + publish eneflorian.com
    // DOC_AGENT_JSON is a MULTI_TAG — process all actions sequentially in order
    if (tools.DOC_AGENT_JSON) {
        const docActions = Array.isArray(tools.DOC_AGENT_JSON) ? tools.DOC_AGENT_JSON : [tools.DOC_AGENT_JSON];
        let lastDocResult = null;
        for (const action of docActions) {
            await safeExec('docAgent', async () => {
                const r = await h.handleDocAgent(action, sessionId);
                if (r?.responseAppend) responseText += r.responseAppend;
                lastDocResult = r?.result;
                return lastDocResult;
            });
        }
        results.docAgent = lastDocResult;
    }

    // Messenger — trimite email/WhatsApp cu transcript de conversație
    if (tools.MESSENGER_JSON) {
        await safeExec('messenger', async () => {
            const r = await h.handleMessenger(tools.MESSENGER_JSON, sessionId);
            if (r?.responseOverride) responseText = r.responseOverride;
            if (r?.responseAppend) responseText += '\n' + r.responseAppend;
            return r?.result;
        });
    }

    // 7. Save to history
    chat.messages.push({ role: 'user', content: userMessage });
    chat.messages.push({ role: 'model', content: responseText });
    chat.updatedAt = Date.now();
    await chat.save();

    // 9. Save to Cassandra for Long-Term Memory processing
    try {
        const { saveConversation } = require('../services/cassandra');
        // Save both sides of the turn
        await saveConversation(sessionId, 'user', userMessage, intent, Object.keys(tools).filter(k => tools[k]));
        await saveConversation(sessionId, 'assistant', responseText, intent, []);
    } catch (err) {
      console.error('[Cassandra] Failed to save conversation turn:', err.message);
    }

    // 8. Return response
    return {
        agent: intent, reasoning: '', confidence: 1, reply: responseText,
        booking: results.booking, tasks: results.tasks,
        escalation: results.escalation, github: results.github,
        cron: results.cron, coding: results.coding,
        ghIssues: results.ghIssues, process: results.process,
        webAgent: results.webAgent, localExec: results.localExec,
        terminalTask: results.terminalTask, email: results.email,
        linkProcessor: results.linkProcessor, gitApp: results.gitApp,
        memory: results.memory, tasksQuery: results.tasksQuery,
        search: results.search, nego: results.nego,
        bookApp: results.bookApp, fileAgent: results.fileAgent, docAgent: results.docAgent
    };
}

module.exports = { processOrchestratorMessage };
