const mongoose = require('mongoose');

const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 15 * 60 * 1000; // 15 min max wait for claude CLI

// ─── Helper: Execute command on local PC via queue ───────────────────────────

async function executeOnLocalPC(command, cwd) {
    const LocalExecCommand = mongoose.model('LocalExecCommand');

    const doc = await LocalExecCommand.create({
        command,
        cwd: cwd || '',
        execType: 'shell'
    });

    // Poll for result
    const deadline = Date.now() + POLL_TIMEOUT;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        const updated = await LocalExecCommand.findById(doc._id);
        if (updated && (updated.status === 'done' || updated.status === 'error')) {
            return { output: updated.output, exitCode: updated.exitCode, status: updated.status };
        }
    }
    return { output: 'Timeout: Claude CLI did not complete in 15 minutes', exitCode: 1, status: 'error' };
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
                    $slice: -10
                }
            },
            updatedAt: Date.now()
        },
        { upsert: true, new: true }
    );
}

// ─── Main Coding Loop — runs Claude CLI on local PC ─────────────────────────

async function runCodingLoop(task, projectPath, sessionId) {
    const CodingSession = mongoose.model('CodingSession');
    const projectName = projectPath.split(/[/\\]/).pop();

    console.log(`[CodingLoop] Starting session ${sessionId}: "${task}" in ${projectPath}`);

    // Build prompt with project memory
    const memoryText = await loadProjectMemory(projectPath);
    const promptParts = [];
    if (memoryText) promptParts.push(memoryText, '---');
    promptParts.push(`PROJECT: ${projectName}`);
    promptParts.push(`PATH: ${projectPath}`);
    promptParts.push(`\nTASK: ${task}`);
    promptParts.push(`\nAfter completing the task, commit changes with git if you made code changes.`);

    const fullPrompt = promptParts.join('\n');

    // Save initial "running" step
    await CodingSession.findByIdAndUpdate(sessionId, {
        $push: {
            steps: {
                step: 0,
                type: 'think',
                tool: 'claude-cli',
                args: {},
                result: `Running Claude CLI on local PC...\nTask: ${task}`,
                timestamp: new Date()
            }
        }
    });

    try {
        // Escape the prompt for shell — write to temp file to avoid quoting issues
        const escapedPrompt = fullPrompt.replace(/"/g, '\\"').replace(/`/g, '\\`');

        const claudeCmd = [
            'claude',
            '-p',
            `"${escapedPrompt}"`,
            '--output-format', 'json',
            '--model', 'opus',
            '--dangerously-skip-permissions',
            '--no-session-persistence'
        ].join(' ');

        console.log(`[CodingLoop] Executing Claude CLI in ${projectPath}`);

        const result = await executeOnLocalPC(claudeCmd, projectPath);

        // Parse JSON output from Claude CLI
        let summary = '';
        let filesChanged = [];

        if (result.exitCode === 0 && result.output) {
            try {
                const jsonOutput = JSON.parse(result.output);
                // Claude CLI json output has a "result" field with the final text
                summary = jsonOutput.result || jsonOutput.content || result.output.substring(0, 2000);

                // Try to extract cost info
                if (jsonOutput.cost_usd) {
                    summary += `\n\nCost: $${jsonOutput.cost_usd.toFixed(4)}`;
                }
                if (jsonOutput.stats) {
                    summary += `\nTokens: ${jsonOutput.stats.input_tokens || 0} in / ${jsonOutput.stats.output_tokens || 0} out`;
                }
            } catch {
                // Not valid JSON — use raw output as summary
                summary = result.output.substring(0, 3000);
            }
        } else {
            summary = `Error (exit ${result.exitCode}): ${result.output?.substring(0, 2000) || 'No output'}`;
        }

        // Save result step
        await CodingSession.findByIdAndUpdate(sessionId, {
            status: result.exitCode === 0 ? 'done' : 'error',
            summary: summary.substring(0, 5000),
            filesChanged,
            completedAt: new Date(),
            $push: {
                steps: {
                    step: 1,
                    type: result.exitCode === 0 ? 'observe' : 'act',
                    tool: 'claude-cli',
                    args: {},
                    result: result.output?.substring(0, 50000) || '(no output)',
                    timestamp: new Date()
                }
            }
        });

        console.log(`[CodingLoop] Session ${sessionId} completed (exit ${result.exitCode})`);

        // Update project memory
        const session = await CodingSession.findById(sessionId);
        if (session) await updateProjectMemory(projectPath, session);

    } catch (err) {
        console.error(`[CodingLoop] Error:`, err.message);
        await CodingSession.findByIdAndUpdate(sessionId, {
            status: 'error',
            summary: `Error: ${err.message}`,
            completedAt: new Date()
        });
    }
}

module.exports = { runCodingLoop };
