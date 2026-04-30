/**
 * Terminal Task — ReAct loop for autonomous multi-step terminal commands
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const { getApiKey } = require('../configService');
const { TERMINAL_REACT_PROMPT } = require('./prompts');

async function executeTerminalTask(taskDescription, cwd) {
    const LocalExecCommand = mongoose.model('LocalExecCommand');
    const MAX_ITERATIONS = 10;
    const COMMAND_TIMEOUT = 5 * 60 * 1000;
    const POLL_INTERVAL = 3000;
    const history = [];

    console.log(`[Orchestrator] TerminalTask starting: "${taskDescription}"`);

    const apiKey = await getApiKey('gemini_api_key');
    const genAI = new GoogleGenerativeAI(apiKey);
    const reactModel = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: TERMINAL_REACT_PROMPT
    });

    for (let i = 0; i < MAX_ITERATIONS; i++) {
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

        // Check if done
        const doneMatch = thinkText.match(/<DONE>([\s\S]*?)<\/DONE>/);
        if (doneMatch) {
            try {
                const doneData = JSON.parse(doneMatch[1].trim());
                console.log(`[Orchestrator] TerminalTask DONE (success=${doneData.success}):`, doneData.summary?.substring(0, 200));
                return { success: doneData.success !== false, summary: doneData.summary || 'Task completed', steps: history, iterations: i + 1 };
            } catch {
                return { success: true, summary: doneMatch[1].trim(), steps: history, iterations: i + 1 };
            }
        }

        // Extract command
        const cmdMatch = thinkText.match(/<CMD>([\s\S]*?)<\/CMD>/);
        if (!cmdMatch) {
            console.log('[Orchestrator] TerminalTask: No CMD or DONE found, ending loop');
            return {
                success: false,
                summary: `Agentul nu a putut determina următoarea acțiune. Ultimul răspuns: ${thinkText.substring(0, 500)}`,
                steps: history, iterations: i + 1
            };
        }

        let cmdData;
        try { cmdData = JSON.parse(cmdMatch[1].trim()); }
        catch { cmdData = { command: cmdMatch[1].trim(), cwd: cwd || '' }; }

        console.log(`[Orchestrator] TerminalTask executing: ${cmdData.command}`);

        const doc = await LocalExecCommand.create({
            command: cmdData.command,
            label: `TerminalTask step ${i + 1}`,
            cwd: cmdData.cwd || cwd || '',
            execType: 'shell'
        });

        // Poll for result
        const deadline = Date.now() + COMMAND_TIMEOUT;
        let cmdResult = null;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL));
            const updated = await LocalExecCommand.findById(doc._id);
            if (updated && (updated.status === 'done' || updated.status === 'error')) {
                cmdResult = { output: updated.output || '(no output)', exitCode: updated.exitCode || 0 };
                break;
            }
        }

        if (!cmdResult) {
            cmdResult = { output: 'Timeout: comanda nu a fost executată în 5 minute. Verifică dacă local-exec-agent rulează.', exitCode: 1 };
        }

        history.push({
            command: cmdData.command,
            reason: cmdData.reason || '',
            output: cmdResult.output,
            exitCode: cmdResult.exitCode
        });

        console.log(`[Orchestrator] TerminalTask step ${i + 1} result (exit ${cmdResult.exitCode}):`, cmdResult.output.substring(0, 200));
    }

    return {
        success: false,
        summary: `Am atins limita de ${MAX_ITERATIONS} iterații. Iată ce am realizat: ${history.map(h => `${h.command} → exit ${h.exitCode}`).join('; ')}`,
        steps: history, iterations: MAX_ITERATIONS
    };
}

module.exports = { executeTerminalTask };
