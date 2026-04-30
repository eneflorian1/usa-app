/**
 * Orchestrator Action Handlers
 * Each handler receives its data + context, returns { result, responseAppend? }
 */
const mongoose = require('mongoose');
const os = require('os');
const { executeGitHubAction } = require('../githubService');
const { executeCronAction } = require('../cronService');
const { executeCodingAction } = require('../codingAgentService');
const { executeGhIssuesAction } = require('../ghIssuesService');
const { executeProcessAction } = require('../processManagerService');
const { executeWebAgentAction } = require('../webAgentService');
const { executeEmailAction } = require('../emailService');
const linkProcessor = require('../linkProcessorService');
const { executeGitAppAction } = require('../gitAppsService');
const { executePayment } = require('../x402PaymentService');
const { executeSearxngSearch } = require('../searxngService');
const { executeTerminalTask } = require('./terminalTask');
const { callMcpTool, isBridgeConnected } = require('../mcpBridgeService');

// ─── Booking ────────────────────────────────────────────────────────────────

async function handleBooking(data) {
    if (!data || !data.guestName || !data.checkIn || !data.checkOut) return null;
    const Booking = mongoose.model('Booking');
    const checkIn = new Date(data.checkIn);
    const checkOut = new Date(data.checkOut);

    if (checkIn.getHours() < 12) return { success: false, error: 'Check-in trebuie să fie între 12:00 și 23:59' };
    if (checkOut.getHours() < 8 || checkOut.getHours() > 11) return { success: false, error: 'Check-out trebuie să fie între 08:00 și 11:00' };

    const overlap = await Booking.findOne({ checkIn: { $lt: checkOut }, checkOut: { $gt: checkIn } });
    if (overlap) return { success: false, error: `Interval ocupat (${overlap.guestName})` };

    const booking = await Booking.create({ guestName: data.guestName, checkIn, checkOut });
    console.log('[Orchestrator] Booking created:', booking._id);
    return { success: true, booking };
}

// ─── Task (Planner) ────────────────────────────────────────────────────────

async function handleTask(data) {
    if (!data) return { result: null, responseAppend: '' };
    const PlannerTask = mongoose.model('PlannerTask');
    const action = data.action || 'create';
    let responseAppend = '';

    if (action === 'create' && data.title) {
        const task = await PlannerTask.create({
            title: data.title,
            description: data.description || '',
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            priority: data.priority || 'medium'
        });
        console.log('[Orchestrator] Task created:', task._id, task.title, task.dueDate);
        if (task.dueDate) {
            const when = new Date(task.dueDate).toLocaleString('ro-RO', {
                day: '2-digit', month: 'long', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            responseAppend = `\n\n📅 Am salvat "${task.title}" pentru ${when}.`;
        } else {
            responseAppend = `\n\n📝 Am salvat "${task.title}" fără termen.`;
        }
        return { result: [task], responseAppend };
    }
    if (action === 'complete' && data.title) {
        const task = await PlannerTask.findOneAndUpdate(
            { title: { $regex: new RegExp(data.title, 'i') }, completed: false },
            { completed: true, updatedAt: Date.now() },
            { new: true }
        );
        if (task) responseAppend = `\n\n✅ Task-ul "${task.title}" a fost marcat ca finalizat!`;
        else responseAppend = `\n\n⚠️ Nu am găsit niciun task activ cu titlul "${data.title}".`;
        return { result: task ? [task] : null, responseAppend };
    }
    if (action === 'delete' && data.title) {
        const task = await PlannerTask.findOneAndDelete({ title: { $regex: new RegExp(data.title, 'i') } });
        if (task) responseAppend = `\n\n🗑️ Task-ul "${task.title}" a fost șters!`;
        else responseAppend = `\n\n⚠️ Nu am găsit niciun task cu titlul "${data.title}".`;
        return { result: task ? [task] : null, responseAppend };
    }
    return { result: null, responseAppend };
}

// ─── Escalation ─────────────────────────────────────────────────────────────

async function handleEscalation(data, recentMessages, sessionId) {
    if (!data) return null;
    const Escalation = mongoose.model('Escalation');
    const esc = await Escalation.create({
        reason: data.reason || 'Escaladare automată',
        context: recentMessages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n'),
        sessionId, agentType: 'orchestrator',
        priority: data.priority || 'high'
    });
    console.log('[Orchestrator] Escalation created:', esc._id);
    return esc;
}

// ─── Simple delegated handlers ──────────────────────────────────────────────

async function handleGithub(data) {
    if (!data) return null;
    const result = await executeGitHubAction(data);
    console.log('[Orchestrator] GitHub action:', data.action, '→', JSON.stringify(result).substring(0, 200));
    return result;
}

async function handleCron(data) {
    if (!data) return null;
    const result = await executeCronAction(data);
    console.log('[Orchestrator] Cron action:', data.action, '→', result.message);
    return result;
}

async function handleCoding(data) {
    if (!data) return null;
    const result = await executeCodingAction(data);
    console.log('[Orchestrator] Coding action:', data.action, '→', JSON.stringify(result).substring(0, 200));
    return result;
}

async function handleGhIssues(data) {
    if (!data) return null;
    const result = await executeGhIssuesAction(data);
    console.log('[Orchestrator] GH-Issues action:', data.action, '→', JSON.stringify(result).substring(0, 200));
    return result;
}

async function handleProcess(data) {
    if (!data) return null;
    const result = executeProcessAction(data);
    console.log('[Orchestrator] Process action:', data.action);
    return result;
}

async function handleWebAgent(data) {
    if (!data) return null;
    const result = await executeWebAgentAction(data);
    console.log('[Orchestrator] WebAgent action:', data.task, '→', JSON.stringify(result).substring(0, 200));
    return result;
}

async function handleEmail(data) {
    if (!data) return null;
    const result = await executeEmailAction(data);
    console.log('[Orchestrator] Email action:', data.action, '→', JSON.stringify(result).substring(0, 200));
    return result;
}

async function handleGitApp(data) {
    if (!data || !data.action) return null;
    const result = await executeGitAppAction(data);
    console.log('[Orchestrator] GitApp action:', data.action, '→', JSON.stringify(result).substring(0, 200));
    return result;
}

// ─── Coding Loop ────────────────────────────────────────────────────────────

async function handleCodingLoop(data) {
    if (!data || !data.task) return null;
    const { runCodingLoop } = require('../codingLoopService');
    const CodingSession = mongoose.model('CodingSession');
    const projectPath = `C:\\Users\\Admin\\Documents\\GitHub\\${data.project || 'usa-app'}`;
    const session = await CodingSession.create({
        task: data.task, projectPath, projectName: data.project || 'usa-app'
    });
    runCodingLoop(data.task, projectPath, session._id.toString()).catch(err => {
        console.error('[CodingLoop] Fatal:', err.message);
    });
    console.log('[Orchestrator] CodingLoop started:', data.task, '→ session', session._id);
    return {
        success: true, sessionId: session._id, task: data.task,
        project: data.project, status: 'running',
        message: `Coding session started. Track progress at /coding or /api/coding/sessions/${session._id}`
    };
}

// ─── Local Exec ─────────────────────────────────────────────────────────────

async function handleLocalExec(data, userMessage, intent) {
    const LocalExecCommand = mongoose.model('LocalExecCommand');

    if (data && data.command) {
        const doc = await LocalExecCommand.create({
            command: data.command, label: data.label || '', cwd: data.cwd || ''
        });
        console.log('[Orchestrator] LocalExec queued:', doc.command, '→ id', doc._id);
        return { success: true, id: doc._id, command: doc.command, label: doc.label, status: 'pending' };
    }

    // Fallback: extract command from message
    if (intent === 'local-exec') {
        const cmdMatch = userMessage.match(/:\s*(.+)$/) || userMessage.match(/comanda?\s+["""]?(.+?)["""]?\s*$/i);
        if (cmdMatch) {
            const doc = await LocalExecCommand.create({
                command: cmdMatch[1].trim(), label: 'Auto-extracted from chat', cwd: ''
            });
            console.log('[Orchestrator] LocalExec fallback queued:', doc.command, '→ id', doc._id);
            return { success: true, id: doc._id, command: doc.command, label: doc.label, status: 'pending' };
        }
    }
    return null;
}

// ─── MCP Handlers (screenshot, clipboard, filesystem, sysinfo, launcher) ───

async function handleMcp(type, data, intent, existingResult) {
    if (!data && intent !== type && existingResult) return null;
    if (!data && intent !== type) return null;

    const LocalExecCommand = mongoose.model('LocalExecCommand');
    const configs = {
        screenshot: { command: 'take_screenshot', label: 'Screenshot', server: 'screenshot', defaultArgs: { area: 'full' } },
        clipboard: {
            command: (args) => args.action === 'write' ? 'write_clipboard' : 'read_clipboard',
            label: (args) => args.action === 'write' ? 'Write Clipboard' : 'Read Clipboard',
            server: 'clipboard', defaultArgs: { action: 'read' }
        },
        filesystem: { command: (args) => args.action || 'list_directory', label: (args) => `Filesystem: ${args.action || 'list'}`, server: 'filesystem', defaultArgs: { action: 'list_directory', path: 'C:\\Users\\Admin' } },
        sysinfo: { command: (args) => args.action || 'system_info', label: (args) => `SysInfo: ${args.action || 'info'}`, server: 'sysinfo', defaultArgs: { action: 'system_info' } },
        launcher: { command: (args) => args.action || 'open_folder', label: (args) => `Launcher: ${args.action || 'open'}`, server: 'launcher', defaultArgs: { action: 'open_folder', path: os.homedir() } },
    };

    const config = configs[type];
    if (!config) return null;

    const args = data || config.defaultArgs;
    const command = typeof config.command === 'function' ? config.command(args) : config.command;
    const label = typeof config.label === 'function' ? config.label(args) : config.label;

    const doc = await LocalExecCommand.create({
        command, label, execType: 'mcp', mcpServer: config.server, mcpArgs: args
    });
    console.log(`[Orchestrator] MCP ${type} queued → id`, doc._id);
    return { success: true, id: doc._id, command: doc.command, label: doc.label, status: 'pending', type: 'mcp' };
}

// ─── Link Processor ─────────────────────────────────────────────────────────

async function handleLinkProcessor(data, userMessage, intent) {
    if (data && data.url) {
        let negotiateEmail = data.email;
        let shouldNegotiate = data.negotiate;
        if (!negotiateEmail) {
            const emailMatch = userMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch) negotiateEmail = emailMatch[0];
        }
        if (!shouldNegotiate && negotiateEmail) shouldNegotiate = true;

        if (shouldNegotiate && negotiateEmail) {
            const result = await linkProcessor.startNegotiation(data.url, negotiateEmail, { inboxId: data.inboxId || null });
            const r = result.resume;
            const responseText = `🤝 **Negociere Pornită Automat!**\n\n` +
                `📦 **${r.title}** (${r.type})\n` +
                (r.price ? `💰 Preț: ${r.price} ${r.currency || ''}\n` : '') +
                (r.seller ? `🏪 Vânzător: ${r.seller}\n` : '') +
                `\n✉️ **Primul email de negociere trimis la:** ${negotiateEmail}\n` +
                `📧 Subiect: ${result.subject}\n\n` +
                `📝 **Mesajul trimis:**\n> ${result.body.split('\n').join('\n> ')}\n\n` +
                `🤖 **Email agent pornit** — va răspunde automat la replies.\n` +
                `👁️ Urmărește conversația în tab-ul Agent pe pagina Email.`;
            console.log('[Orchestrator] Negotiation started:', r.title, '→', negotiateEmail);
            return { result, responseOverride: responseText };
        }

        const result = await linkProcessor.processLink(data.url, { inboxId: data.inboxId || null, force: data.force || false });
        const r = result.resume;
        const responseText = `📦 **Rezumat Produs/Serviciu Salvat**\n\n` +
            `**${r.title}** (${r.type})\n` +
            (r.price ? `💰 Preț: ${r.price} ${r.currency || ''}\n` : '') +
            (r.seller ? `🏪 Vânzător: ${r.seller}\n` : '') +
            (r.description ? `📝 ${r.description}\n` : '') +
            (r.keyFeatures?.length ? `\n✅ Caracteristici:\n${r.keyFeatures.map(f => `  • ${f}`).join('\n')}\n` : '') +
            (r.negotiationNotes ? `\n💡 **Sfaturi negociere:** ${r.negotiationNotes}\n` : '') +
            (r.location ? `📍 Locație: ${r.location}\n` : '') +
            `\n🔗 ${r.url}` + (result.isNew ? '' : '\n\n_(rezumat actualizat)_');
        console.log('[Orchestrator] LinkProcessor saved:', r.title, '→', r.url);
        return { result, responseOverride: responseText };
    }

    // Fallback
    if (intent === 'link-processor') {
        const urlMatch = userMessage.match(/https?:\/\/[^\s]+/);
        const emailMatch = userMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (urlMatch) {
            if (emailMatch && /negoci|cump[aă]r|ofert|pre[tț]/i.test(userMessage)) {
                const result = await linkProcessor.startNegotiation(urlMatch[0], emailMatch[0]);
                const r = result.resume;
                return {
                    result,
                    responseOverride: `🤝 **Negociere Pornită Automat!**\n\n📦 **${r.title}**\n✉️ Primul email trimis la: ${emailMatch[0]}\n🤖 Agent auto-reply pornit.`
                };
            }
            const result = await linkProcessor.processLink(urlMatch[0]);
            const r = result.resume;
            return {
                result,
                responseOverride: `📦 **Rezumat Produs/Serviciu Salvat**\n\n**${r.title}** (${r.type})\n` +
                    (r.price ? `💰 Preț: ${r.price} ${r.currency || ''}\n` : '') +
                    (r.seller ? `🏪 Vânzător: ${r.seller}\n` : '') +
                    (r.description ? `📝 ${r.description}\n` : '') +
                    (r.negotiationNotes ? `\n💡 **Sfaturi negociere:** ${r.negotiationNotes}` : '') +
                    `\n\n🔗 ${r.url}`
            };
        }
    }
    return null;
}

// ─── Terminal Task ──────────────────────────────────────────────────────────

async function handleTerminalTask(data, userMessage, intent) {
    let result = null;
    if (data && data.task) {
        result = await executeTerminalTask(data.task, data.cwd || 'C:\\Users\\Admin');
    } else if (intent === 'terminal-task') {
        result = await executeTerminalTask(userMessage, 'C:\\Users\\Admin');
    }
    if (!result) return null;

    const stepsReport = result.steps?.map((s, i) =>
        `  ${i + 1}. \`${s.command}\` → exit ${s.exitCode}${s.reason ? ` (${s.reason})` : ''}`
    ).join('\n') || '';
    const responseOverride = `${result.success ? '✅' : '❌'} **Terminal Task ${result.success ? 'Completat' : 'Eșuat'}**\n\n` +
        `${result.summary}\n\n` +
        (stepsReport ? `📋 **Pași executați** (${result.iterations} iterații):\n${stepsReport}` : '');

    return { result, responseOverride };
}

// ─── Memory ─────────────────────────────────────────────────────────────────

async function handleMemory(data, intent) {
    const OrchestratorMemory = mongoose.model('OrchestratorMemory');
    let responseAppend = '';

    const ops = Array.isArray(data) ? data : (data ? [data] : []);
    const saves = ops.filter(o => o && o.action === 'save' && o.content);
    const recalls = ops.filter(o => o && o.action === 'recall' && o.query);

    if (saves.length > 0) {
        const created = [];
        for (const op of saves) {
            const mem = await OrchestratorMemory.create({
                category: op.category || 'general', content: op.content, source: 'orchestrator'
            });
            created.push(mem);
            console.log('[Orchestrator] Memory saved:', op.category, '→', op.content.substring(0, 100));
        }
        responseAppend = `\n\n💾 **Salvat în memorie (${created.length}):**\n` +
            created.map(m => `  🧠 [${m.category}] ${m.content}`).join('\n');
        if (recalls.length === 0) {
            return { result: { success: true, action: 'save', saved: created.length, memories: created }, responseAppend };
        }
    }

    if (recalls.length > 0) {
        const allFound = [];
        for (const op of recalls) {
            let found;
            try {
                found = await OrchestratorMemory.find(
                    { $text: { $search: op.query } },
                    { score: { $meta: 'textScore' } }
                ).sort({ score: { $meta: 'textScore' } }).limit(10).lean();
            } catch {
                found = await OrchestratorMemory.find({
                    content: { $regex: op.query, $options: 'i' }
                }).sort({ updatedAt: -1 }).limit(10).lean();
            }
            console.log('[Orchestrator] Memory recall:', op.query, '→', found.length, 'results');
            allFound.push(...found);
        }
        if (allFound.length > 0) {
            responseAppend += `\n\n📋 **Memorii găsite (${allFound.length}):**\n` +
                allFound.map(m => `  🧠 [${m.category}] ${m.content}`).join('\n');
        } else {
            responseAppend += '\n\n🔍 Nu am găsit memorii relevante pentru această căutare.';
        }
        return { result: { success: true, action: 'recall', results: allFound }, responseAppend };
    }

    // Fallback
    if (intent === 'memory') {
        const allMems = await OrchestratorMemory.find().sort({ updatedAt: -1 }).limit(20).lean();
        if (allMems.length > 0) {
            responseAppend = `\n\n📋 **Memoriile mele (${allMems.length}):**\n` +
                allMems.map(m => `  🧠 [${m.category}] ${m.content}`).join('\n');
        } else {
            responseAppend = '\n\n🔍 Nu am nicio memorie salvată încă.';
        }
        return { result: { success: true, action: 'recall', results: allMems }, responseAppend };
    }
    return null;
}

// ─── Search (SearXNG) ───────────────────────────────────────────────────────

async function handleSearch(data, userMessage, intent) {
    let responseAppend = '';

    if (data && data.query) {
        const result = await executeSearxngSearch({
            query: data.query, categories: data.categories || 'general',
            language: data.language || 'ro-RO', numResults: data.numResults || 5,
            timeRange: data.timeRange || ''
        });
        if (result.success && result.results.length > 0) {
            responseAppend = `\n\n🔍 **Rezultate căutare: "${result.query}"** (${result.totalFound} găsite)\n\n` +
                result.results.map((r, i) => `**${i + 1}. [${r.title}](${r.url})**\n   ${r.snippet}`).join('\n\n');
        } else if (!result.success) {
            responseAppend = `\n\n❌ **Căutare eșuată:** ${result.error}`;
        } else {
            responseAppend = `\n\n🔍 Nu am găsit rezultate pentru "${data.query}".`;
        }
        console.log('[Orchestrator] SearXNG search:', data.query, '→', result.totalFound || 0, 'results');
        return { result, responseAppend };
    }

    // Fallback
    if (intent === 'search') {
        const fillerPattern = /\b(caută|căutare|căutați|cauta|search|găsește|găsiți|pe\s+internet|pe\s+google|online|pe\s+web|prezintă|afișează|arată|listează|extrage|spune-mi|dă-mi|titlurile?(\s+lor)?|rezultatele?|știrile?|news)\b\s*/gi;
        const timePattern = /\b(din\s+)?(ultimele?\s+\d+\s+(zile?|ore?|săptămâni?|luni?)|azi|astăzi|această\s+săptămână|această\s+lună|recent(e)?|ieri|acum|din\s+ultimul?\s+\w+)\b\s*/gi;
        const numberPattern = /\b\d+\s+(știri|titluri|rezultate|articole)\b\s*/gi;

        let cleanQuery = userMessage.replace(fillerPattern, ' ').replace(timePattern, ' ').replace(numberPattern, ' ').replace(/\s{2,}/g, ' ').trim();
        if (cleanQuery.length < 3) cleanQuery = userMessage.substring(0, 80);
        cleanQuery = cleanQuery.substring(0, 80);

        const isNews = /știri|news|actualitate|eveniment|titluri|informații\s+recente/i.test(userMessage);
        const wantsRecent = /azi|astăzi|ultim|recent|this\s+week|această\s+săptămână|această\s+lună|nou/i.test(userMessage);

        console.log(`[Search] Fallback query: "${cleanQuery}" (category: ${isNews ? 'news' : 'general'}, timeRange: ${wantsRecent ? 'month' : 'all'})`);

        const result = await executeSearxngSearch({
            query: cleanQuery, categories: isNews ? 'news' : 'general',
            numResults: 5, timeRange: wantsRecent ? 'month' : ''
        });

        if (result.success && result.results.length > 0) {
            const resultLines = result.results.map((r, i) => `**${i + 1}. [${r.title}](${r.url})**\n   ${r.snippet}`).join('\n\n');
            return { result, responseOverride: `🔍 **Rezultate pentru "${cleanQuery}"** (via ${result.engine || 'DuckDuckGo'}):\n\n${resultLines}` };
        } else if (!result.success) {
            return { result, responseOverride: `❌ **Căutare eșuată:** ${result.error}` };
        }
        return { result, responseOverride: `🔍 Nu am găsit rezultate pentru "${cleanQuery}".` };
    }
    return null;
}

// ─── Payment ────────────────────────────────────────────────────────────────

async function handlePayment(data) {
    if (!data || !data.url) return null;
    console.log('[Orchestrator] x402 Payment requested for:', data.url);
    const result = await executePayment(data.url, data.task || '', data.maxAmount || 0.01);
    let responseAppend = '';
    if (result.success) {
        responseAppend = `\n\n💳 **Plată x402 efectuată cu succes!**\n- URL: ${data.url}\n- Sumă: $${result.amountPaid || '~0.01'} USDC\n` +
            (result.txHash ? `- Tx: \`${result.txHash}\`\n` : '') +
            `- Network: ${result.network}\n` +
            (result.responseData ? `\n📄 **Răspuns:**\n\`\`\`\n${result.responseData.substring(0, 500)}\n\`\`\`` : '');
    } else {
        responseAppend = `\n\n❌ **Plata x402 a eșuat**: ${result.error}\n` +
            (result.error?.includes('not configured') ? '\n💡 Configurează wallet-ul în pagina **/payments** din aplicație.' : '');
    }
    return { result, responseAppend };
}

// ─── Nego (Bridge-first, local fallback) ────────────────────────────────────

async function handleNego(data) {
    if (!data) return null;
    const action = data.action || 'missions';
    let result = null;
    let responseAppend = '';
    let responseOverride = null;

    // Try bridge first (NegoApp running separately with WhatsApp)
    if (isBridgeConnected('negoapp')) {
        const bridgeActionMap = {
            scan: 'nego_start_mission',
            reveal: 'nego_reveal_phone',
            leads: 'nego_get_leads',
            missions: 'nego_get_missions',
            stats: 'nego_get_stats',
            whatsapp_status: 'nego_whatsapp_status',
            send_whatsapp: 'nego_send_whatsapp',
            conversations: 'nego_get_conversations',
            chat_reply: 'nego_chat_reply',
            config: 'nego_get_config',
        };

        const toolName = bridgeActionMap[action];
        if (toolName) {
            try {
                const params = { ...data };
                delete params.action;
                result = await callMcpTool(toolName, params, { agent: 'negoapp' });
                
                // Format responses — use responseOverride to replace Gemini's text entirely
                if (action === 'leads') {
                    const leads = Array.isArray(result) ? result : [];
                    // Sort by lastContacted desc (most recent conversation first)
                    const sorted = [...leads].sort((a, b) => {
                        const ta = a.lastContacted || a.createdAt || '';
                        const tb = b.lastContacted || b.createdAt || '';
                        return tb.localeCompare(ta);
                    });
                    
                    const statusEmoji = { new: '🆕', contacted: '💬', negotiating: '🤝', won: '✅', lost: '❌', saved: '⭐' };
                    const timeAgo = (iso) => {
                        if (!iso) return '';
                        const diff = Date.now() - new Date(iso).getTime();
                        const mins = Math.floor(diff / 60000);
                        if (mins < 60) return `${mins}m`;
                        const hours = Math.floor(mins / 60);
                        if (hours < 24) return `${hours}h`;
                        return `${Math.floor(hours / 24)}d`;
                    };

                    let text = `📋 **NegoApp — ${sorted.length} contacte**\n\n`;
                    sorted.slice(0, 10).forEach((l, i) => {
                        const emoji = statusEmoji[l.status] || '📌';
                        const name = l.sellerName || '(necunoscut)';
                        const title = l.title ? l.title.substring(0, 40) : l.url?.substring(0, 40) || '';
                        const price = l.price || l.initialPrice || '';
                        const phone = l.phoneNumber ? `📞 ${l.phoneNumber}` : '';
                        const lastMsg = l.lastMessage ? `💬 "${l.lastMessage.substring(0, 50)}${l.lastMessage.length > 50 ? '...' : ''}"` : '';
                        const time = timeAgo(l.lastContacted || l.createdAt);
                        
                        text += `${emoji} **${name}** ${time ? `· ${time}` : ''}\n`;
                        text += `   ${title} ${price ? `— ${price}` : ''} ${phone}\n`;
                        if (lastMsg) text += `   ${lastMsg}\n`;
                        text += '\n';
                    });
                    if (sorted.length > 10) text += `... și încă ${sorted.length - 10} contacte\n`;
                    
                    responseOverride = text;
                } else if (action === 'scan') {
                    responseOverride = `🔍 **Misiune lansată pe NegoApp**\nURL: ${data.url}\n${data.query ? `Căutare: ${data.query}\n` : ''}Status: ${JSON.stringify(result).substring(0, 200)}`;
                } else if (action === 'reveal') {
                    responseOverride = result?.success && result?.phone
                        ? `📞 **Telefon extras:** ${result.phone}`
                        : `❌ Nu am putut extrage telefonul: ${result?.error || 'necunoscut'}`;
                } else if (action === 'missions') {
                    const missions = Array.isArray(result) ? result : [];
                    const sorted = [...missions].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
                    let text = `📊 **NegoApp — ${missions.length} misiuni**\n\n`;
                    sorted.slice(0, 5).forEach(m => {
                        const emoji = m.status === 'completed' ? '✅' : m.status === 'failed' ? '❌' : '🔄';
                        text += `${emoji} [${m.status}] ${m.query || m.url || '(fără titlu)'} — ${m.leadsFound || 0} lead-uri, ${m.phonesRevealed || 0} telefoane\n`;
                    });
                    responseOverride = text;
                } else if (action === 'stats') {
                    const s = result || {};
                    responseOverride = `📊 **NegoApp — Statistici**\n\n` +
                        `Lead-uri: **${s.totalLeads || 0}**\n` +
                        `Misiuni: **${s.totalMissions || 0}** (${s.completedMissions || 0} finalizate, ${s.runningMissions || 0} active)\n` +
                        (s.byStatus ? `Status-uri: ${Object.entries(s.byStatus).map(([k,v]) => `${k}: ${v}`).join(', ')}\n` : '');
                } else if (action === 'whatsapp_status') {
                    responseOverride = result?.connected 
                        ? `📱 **WhatsApp:** ✅ Conectat` 
                        : `📱 **WhatsApp:** ❌ Deconectat`;
                } else if (action === 'conversations') {
                    const msgs = Array.isArray(result) ? result : [];
                    let text = `💬 **Conversație** (${msgs.length} mesaje)\n\n`;
                    msgs.slice(-10).forEach(m => {
                        const who = m.sender === 'me' ? '🤖' : '👤';
                        text += `${who} ${m.text?.substring(0, 100) || ''}\n`;
                    });
                    responseOverride = text;
                } else {
                    responseOverride = `🤝 **NegoApp — ${action}**\n\`\`\`json\n${JSON.stringify(result, null, 2).substring(0, 500)}\n\`\`\``;
                }
                
                console.log('[Orchestrator] Negotiator (bridge):', action, '→', JSON.stringify(result).substring(0, 200));
                return { result, responseOverride };
            } catch (err) {
                console.error('[Orchestrator] Nego bridge call failed:', err.message, '— falling back to local');
            }
        }
    }

    // Fallback: local orchestrator (no WhatsApp, but scraping works)
    const { orchestrator } = require('../negoSingleton');
    const PhoneRevealer = require('../scraping/phoneRevealer');

    if (action === 'scan' && data.url) {
        const params = {
            url: data.url, query: data.query || '',
            maxPages: data.maxPages || 2, maxListings: data.maxListings || 50,
            maxReveals: data.maxReveals || 5, useProxy: !!data.useProxy,
        };
        const missionPromise = orchestrator.executeMission(params)
            .catch(err => console.error('[Orchestrator→Nego] executeMission failed:', err.message));
        await new Promise(r => setImmediate(r));
        const allMissions = orchestrator.getAllMissions();
        const mission = allMissions[0];
        result = { missionId: mission?.id, status: mission?.status || 'initializing', url: data.url };
        responseAppend = `\n\n🔍 **Negotiator (local) — Misiune lansată**\n` +
            `URL: ${data.url}\nMission ID: \`${mission?.id || 'pending'}\``;
        void missionPromise;
    } else if (action === 'reveal' && data.url) {
        const revealer = new PhoneRevealer(null);
        result = await revealer.revealPhone(data.url, { debugScreenshot: false });
        responseAppend = `\n\n📞 **Negotiator — Reveal**\n` +
            (result.success && result.phone ? `Telefon: ${result.phone}` : `Eșuat: ${result.error || 'necunoscut'}`);
    } else if (action === 'leads') {
        const NegoLead = mongoose.model('NegoLead');
        const leads = await NegoLead.find({}).sort({ createdAt: -1 }).limit(20).lean();
        result = leads;
        responseAppend = `\n\n📋 **Negotiator — ${leads.length} lead-uri**`;
    } else if (action === 'missions') {
        const NegoMission = mongoose.model('NegoMission');
        const missions = await NegoMission.find({}).sort({ createdAt: -1 }).limit(20).lean();
        result = missions;
        responseAppend = `\n\n📊 **Negotiator — ${missions.length} misiuni**`;
    } else if (action === 'stats') {
        result = orchestrator.getStats();
        responseAppend = `\n\n📊 **Negotiator — Statistici**\n` +
            `  - Total: ${result.total} | Finalizate: ${result.completed} | Running: ${result.running}`;
    }
    console.log('[Orchestrator] Negotiator (local):', action, '→', JSON.stringify(result).substring(0, 200));
    return { result, responseAppend };
}

// ─── Tasks Query ────────────────────────────────────────────────────────────

async function handleTasksQuery(data, intent) {
    const PlannerTask = mongoose.model('PlannerTask');
    let responseAppend = '';

    const filter = data?.filter || 'active';
    let query = {};
    if (filter === 'active') query = { completed: false };
    else if (filter === 'completed') query = { completed: true };
    else if (filter === 'overdue') query = { completed: false, dueDate: { $lt: new Date() } };

    if (!data && intent !== 'tasks-query') return null;

    const tasks = await PlannerTask.find(query).sort({ dueDate: 1 }).lean();
    if (tasks.length > 0) {
        const taskList = tasks.map(t => {
            const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString('ro-RO') : 'fără termen';
            const prio = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
            const status = t.completed ? '✅' : '⬜';
            return `  ${status} ${prio} ${t.title} (termen: ${due})`;
        }).join('\n');
        responseAppend = `\n\n📋 **Task-uri (${filter}) — ${tasks.length}:**\n${taskList}`;
    } else {
        responseAppend = `\n\n📋 Nu ai task-uri ${filter === 'overdue' ? 'restante' : filter === 'completed' ? 'completate' : 'active'}.`;
    }
    console.log('[Orchestrator] TasksQuery:', filter, '→', tasks.length, 'results');
    return { result: { success: true, filter, count: tasks.length, tasks }, responseAppend };
}

// ─── Book App (MCP Bridge to local book2) ──────────────────────────────────

async function handleBookApp(data, intent) {
    if (!data && intent !== 'book-app') return null;

    if (!isBridgeConnected()) {
        return {
            result: { success: false },
            responseAppend: '\n\n⚠️ **MCP Bridge nu este conectat.** Pornește bridge-ul pe PC-ul local: `npm run mcp-bridge`'
        };
    }

    const actionToTool = {
        list_books: 'list_books', get_book: 'get_book',
        create_book: 'create_book', delete_book: 'delete_book',
        start_generation: 'start_generation', list_niches: 'list_niches',
        trigger_niche_research: 'trigger_niche_research',
        get_agent_logs: 'get_agent_logs', get_settings: 'get_settings',
        update_settings: 'update_settings', get_memory: 'get_memory'
    };

    const action = data?.action || 'list_books';
    const toolName = actionToTool[action];
    if (!toolName) {
        return { result: { success: false }, responseAppend: `\n\n❌ Book App: acțiune necunoscută "${action}"` };
    }

    // Remove 'action' key from params
    const params = { ...data };
    delete params.action;

    try {
        const result = await callMcpTool(toolName, params);
        console.log('[Orchestrator] BookApp action:', action, '→', JSON.stringify(result).substring(0, 200));

        let responseAppend = '';

        // Format response based on action type
        if (action === 'list_books' && Array.isArray(result)) {
            const bookList = result.map((b, i) => {
                const status = b.generationStatus === 'COMPLETED' ? '✅' : b.generationStatus === 'DRAFTING' ? '✏️' : b.generationStatus === 'FAILED' ? '❌' : '📄';
                return `  ${i + 1}. ${status} **${b.title}** (${b.chaptersCount || 0} capitole, ${b.type})`;
            }).join('\n');
            responseAppend = `\n\n📚 **Cărțile tale (${result.length}):**\n${bookList}`;
        } else if (action === 'get_book' && result && result.title) {
            responseAppend = `\n\n📖 **${result.title}**\n` +
                `- Autor: ${result.author}\n- Status: ${result.generationStatus}\n- Capitole: ${result.chaptersCount}\n` +
                (result.chapterTitles?.length ? `\n📑 Capitole:\n${result.chapterTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}` : '');
        } else if (action === 'create_book' || action === 'start_generation') {
            responseAppend = `\n\n✅ **${action === 'start_generation' ? 'Generare pornită' : 'Carte creată'}!**\n\`\`\`json\n${JSON.stringify(result, null, 2).substring(0, 500)}\n\`\`\``;
        } else if (action === 'delete_book') {
            responseAppend = `\n\n🗑️ **Carte ștearsă cu succes.**`;
        } else if (action === 'list_niches' && Array.isArray(result)) {
            const nicheList = result.slice(0, 10).map((n, i) => `  ${i + 1}. **${n.topic}** (${n.category})`).join('\n');
            responseAppend = `\n\n🔍 **Nișe descoperite (${result.length}):**\n${nicheList}`;
        } else if (action === 'get_agent_logs' && Array.isArray(result)) {
            const logList = result.slice(0, 10).map(l => `  [${l.status}] ${l.message.substring(0, 100)}`).join('\n');
            responseAppend = `\n\n📋 **Agent Logs (${result.length}):**\n${logList}`;
        } else {
            // Fallback: compact JSON
            responseAppend = `\n\n📚 **Book App — ${action}:**\n\`\`\`json\n${JSON.stringify(result, null, 2).substring(0, 800)}\n\`\`\``;
        }

        return { result: { success: true, action, data: result }, responseAppend };
    } catch (err) {
        console.error('[Orchestrator] BookApp error:', err.message);
        return { result: { success: false, error: err.message }, responseAppend: `\n\n❌ **Book App Error:** ${err.message}` };
    }
}

module.exports = {
    handleBooking, handleTask, handleEscalation, handleGithub, handleCron,
    handleCoding, handleGhIssues, handleProcess, handleWebAgent, handleEmail,
    handleGitApp, handleCodingLoop, handleLocalExec, handleMcp,
    handleLinkProcessor, handleTerminalTask, handleMemory, handleSearch,
    handlePayment, handleNego, handleTasksQuery, handleBookApp
};
