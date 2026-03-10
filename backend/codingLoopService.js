const Anthropic = require('@anthropic-ai/sdk');
const mongoose = require('mongoose');

const MAX_STEPS = 25;
const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 180000; // 3 min max wait per tool

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an autonomous coding agent. You work on the user's local PC by calling tools.
You MUST use tools to accomplish tasks — do NOT just describe what to do.

AVAILABLE TOOLS (respond with exactly ONE JSON block per message):

<TOOL>{"tool":"list_directory","path":"C:\\path\\to\\dir"}</TOOL>
<TOOL>{"tool":"read_file","path":"C:\\path\\to\\file.js"}</TOOL>
<TOOL>{"tool":"write_file","path":"C:\\path\\to\\file.js","content":"full file content here"}</TOOL>
<TOOL>{"tool":"search_files","path":"C:\\project","pattern":"*.tsx","maxDepth":3}</TOOL>
<TOOL>{"tool":"run_command","command":"npm test","cwd":"C:\\path\\to\\project"}</TOOL>
<TOOL>{"tool":"run_command","command":"git add -A && git commit -m \\"feat: description\\"","cwd":"C:\\path"}</TOOL>
<TOOL>{"tool":"run_command","command":"git push origin main","cwd":"C:\\path"}</TOOL>
<TOOL>{"tool":"done","summary":"What was accomplished"}</TOOL>

WORKFLOW:
1. First, explore the project: list_directory → read key files (package.json, README, main files)
2. Understand the codebase before making changes
3. Make focused, minimal changes — one file at a time
4. After making changes, verify with run_command (npm run build, npm test, etc.) if applicable
5. When done, use git to commit and push changes
6. Call "done" tool with a summary

RULES:
- Always read a file BEFORE modifying it — never guess content
- write_file REPLACES the entire file — include ALL content, not just changes
- One tool call per message
- If a command fails, analyze the error and try to fix it
- Do NOT invent file paths — always list_directory first
- Keep changes minimal and focused on the task
- Use the project's existing coding style and conventions`;

// ─── Helper: Get Anthropic Client ───────────────────────────────────────────

async function getClient() {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'anthropic_api_key' });
    if (!setting?.value) throw new Error('Anthropic API key not configured. Set it at /api/settings/anthropic');
    return new Anthropic({ apiKey: setting.value });
}

// ─── Helper: Execute tool on local PC via queue ──────────────────────────────

async function executeOnLocalPC(toolCall) {
    const LocalExecCommand = mongoose.model('LocalExecCommand');

    let doc;
    if (toolCall.tool === 'run_command') {
        doc = await LocalExecCommand.create({
            command: toolCall.command,
            cwd: toolCall.cwd || '',
            execType: 'shell'
        });
    } else {
        // Filesystem MCP tools
        doc = await LocalExecCommand.create({
            command: toolCall.tool,
            execType: 'mcp',
            mcpServer: 'filesystem',
            mcpArgs: toolCall
        });
    }

    // Poll for result
    const deadline = Date.now() + POLL_TIMEOUT;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        const updated = await LocalExecCommand.findById(doc._id);
        if (updated && (updated.status === 'done' || updated.status === 'error')) {
            return { output: updated.output, exitCode: updated.exitCode, status: updated.status };
        }
    }
    return { output: 'Timeout: command did not complete in 3 minutes', exitCode: 1, status: 'error' };
}

// ─── Helper: Extract tool call from response ─────────────────────────────────

function extractToolCall(text) {
    const match = text.match(/<TOOL>([\s\S]*?)<\/TOOL>/);
    if (!match) return null;
    try {
        return JSON.parse(match[1].trim());
    } catch {
        return null;
    }
}

// ─── Helper: Load project memory ─────────────────────────────────────────────

async function loadProjectMemory(projectPath) {
    const ProjectMemory = mongoose.model('ProjectMemory');
    const mem = await ProjectMemory.findOne({ projectPath });
    if (!mem) return '';

    let text = `PROJECT MEMORY for ${mem.projectName}:\n`;
    if (mem.techStack) text += `Tech Stack: ${mem.techStack}\n`;
    if (mem.structure) text += `Structure:\n${mem.structure}\n`;
    if (mem.conventions) text += `Conventions: ${mem.conventions}\n`;
    if (mem.deployNotes) text += `Deploy: ${mem.deployNotes}\n`;
    if (mem.recentChanges?.length) {
        text += `Recent Changes:\n`;
        for (const c of mem.recentChanges.slice(-5)) {
            text += `  - ${c.summary} (${c.files?.join(', ')})\n`;
        }
    }
    if (mem.knownIssues?.length) {
        text += `Known Issues: ${mem.knownIssues.join('; ')}\n`;
    }
    return text;
}

// ─── Helper: Update project memory after session ─────────────────────────────

async function updateProjectMemory(projectPath, session) {
    const ProjectMemory = mongoose.model('ProjectMemory');
    const projectName = projectPath.split(/[/\\]/).pop();

    await ProjectMemory.findOneAndUpdate(
        { projectPath },
        {
            projectPath,
            projectName,
            $push: {
                recentChanges: {
                    $each: [{
                        date: new Date(),
                        summary: session.summary || session.task,
                        files: session.filesChanged || []
                    }],
                    $slice: -10 // keep last 10
                }
            },
            updatedAt: Date.now()
        },
        { upsert: true, new: true }
    );
}

// ─── Main Coding Loop ────────────────────────────────────────────────────────

async function runCodingLoop(task, projectPath, sessionId) {
    const CodingSession = mongoose.model('CodingSession');
    const client = await getClient();

    console.log(`[CodingLoop] Starting session ${sessionId}: "${task}" in ${projectPath}`);

    // Build initial context
    const memoryText = await loadProjectMemory(projectPath);
    const messages = [];

    // Initial user message with task + memory
    const initialMessage = [
        memoryText ? memoryText + '\n---\n' : '',
        `PROJECT PATH: ${projectPath}`,
        `TASK: ${task}`,
        `\nStart by exploring the project structure, then implement the task.`
    ].join('\n');

    messages.push({ role: 'user', content: initialMessage });

    let stepNum = 0;
    const filesChanged = new Set();

    try {
        let response = await client.messages.create({
            model: 'claude-opus-4-6',
            max_tokens: 16000,
            system: SYSTEM_PROMPT,
            messages
        });
        let responseText = response.content[0].text;

        while (stepNum < MAX_STEPS) {
            // Add assistant response to history
            messages.push({ role: 'assistant', content: responseText });

            // Save think step
            const thinkText = responseText.replace(/<TOOL>[\s\S]*?<\/TOOL>/g, '').trim();
            if (thinkText) {
                await CodingSession.findByIdAndUpdate(sessionId, {
                    $push: { steps: { step: stepNum, type: 'think', tool: '', args: {}, result: thinkText, timestamp: new Date() } }
                });
            }

            // Extract tool call
            const toolCall = extractToolCall(responseText);
            if (!toolCall) {
                console.log(`[CodingLoop] No tool call — session complete at step ${stepNum}`);
                break;
            }

            // Check for "done" tool
            if (toolCall.tool === 'done') {
                await CodingSession.findByIdAndUpdate(sessionId, {
                    status: 'done',
                    summary: toolCall.summary || 'Task completed',
                    filesChanged: [...filesChanged],
                    completedAt: new Date(),
                    $push: { steps: { step: stepNum, type: 'act', tool: 'done', args: toolCall, result: toolCall.summary, timestamp: new Date() } }
                });
                console.log(`[CodingLoop] Done: ${toolCall.summary}`);

                // Update project memory
                const session = await CodingSession.findById(sessionId);
                await updateProjectMemory(projectPath, session);
                return;
            }

            // Save act step
            await CodingSession.findByIdAndUpdate(sessionId, {
                $push: { steps: { step: stepNum, type: 'act', tool: toolCall.tool, args: toolCall, result: '', timestamp: new Date() } }
            });
            console.log(`[CodingLoop] Step ${stepNum}: ${toolCall.tool}(${JSON.stringify(toolCall).substring(0, 100)})`);

            // Track changed files
            if (toolCall.tool === 'write_file' && toolCall.path) {
                filesChanged.add(toolCall.path);
            }

            // Execute tool on local PC
            const result = await executeOnLocalPC(toolCall);
            const resultText = result.output?.substring(0, 50000) || '(no output)'; // cap at 50KB

            // Save observe step
            await CodingSession.findByIdAndUpdate(sessionId, {
                $push: { steps: { step: stepNum, type: 'observe', tool: toolCall.tool, args: {}, result: resultText, timestamp: new Date() } }
            });

            stepNum++;

            // Feed result back to Claude
            const observation = `Tool "${toolCall.tool}" result (exit ${result.exitCode}):\n${resultText}`;
            messages.push({ role: 'user', content: observation });

            response = await client.messages.create({
                model: 'claude-opus-4-6',
                max_tokens: 16000,
                system: SYSTEM_PROMPT,
                messages
            });
            responseText = response.content[0].text;
        }

        // Max steps reached
        await CodingSession.findByIdAndUpdate(sessionId, {
            status: 'done',
            summary: `Reached max steps (${MAX_STEPS}). Partial progress made.`,
            filesChanged: [...filesChanged],
            completedAt: new Date()
        });
        const session = await CodingSession.findById(sessionId);
        await updateProjectMemory(projectPath, session);

    } catch (err) {
        console.error(`[CodingLoop] Error at step ${stepNum}:`, err.message);
        await CodingSession.findByIdAndUpdate(sessionId, {
            status: 'error',
            summary: `Error at step ${stepNum}: ${err.message}`,
            completedAt: new Date()
        });
    }
}

module.exports = { runCodingLoop };
