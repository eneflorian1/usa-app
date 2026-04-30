const mongoose = require('mongoose');
const { getGeminiModel: getConfigGeminiModel } = require('./configService');
const fs = require('fs').promises;
const path = require('path');
const { spawnProcess, getProcess, getProcessLog } = require('./processManagerService');

/**
 * Coding Agent Service
 * AI-powered code analysis, fix generation, and PR review.
 * Uses Gemini API as the sub-agent (no external CLI needed).
 */

// In-memory task tracking
const tasks = new Map();

// ===================== GEMINI HELPER =====================

async function getCodingModel() {
    return getConfigGeminiModel(CODING_SYSTEM_PROMPT);
}

const CODING_SYSTEM_PROMPT = `You are a senior software engineer AI agent. You analyze code, find bugs, suggest improvements, and generate precise fixes.

RULES:
- Be precise and minimal — change only what's necessary
- Follow the existing code style (indentation, naming, patterns)
- Always explain WHY you're making a change
- When generating code changes, use this exact format:

<FILE_CHANGE path="relative/path/to/file">
<<<ORIGINAL>>>
exact lines to replace
<<<MODIFIED>>>
replacement lines
</FILE_CHANGE>

- You can include multiple FILE_CHANGE blocks for multiple files
- The ORIGINAL section must match the existing code EXACTLY
- If you need to add a new file, use ORIGINAL as empty:

<FILE_CHANGE path="new/file.js" action="create">
<<<CONTENT>>>
full file content here
</FILE_CHANGE>

- If you need to run a command (like tests), output:
<RUN_COMMAND>npm test</RUN_COMMAND>

IMPORTANT:
- Do NOT invent file contents you haven't seen
- If you're unsure about the codebase structure, say so
- Always consider edge cases and error handling`;

// ===================== CORE FUNCTIONS =====================

/**
 * Read files from disk for context.
 */
async function readFiles(filePaths, workDir) {
    const contents = {};
    for (const fp of filePaths) {
        const fullPath = path.resolve(workDir, fp);
        try {
            const content = await fs.readFile(fullPath, 'utf-8');
            contents[fp] = content;
        } catch (err) {
            contents[fp] = `[ERROR: Cannot read file: ${err.message}]`;
        }
    }
    return contents;
}

/**
 * Parse FILE_CHANGE blocks from Gemini response.
 */
function parseFileChanges(response) {
    const changes = [];
    const regex = /<FILE_CHANGE\s+path="([^"]+)"(?:\s+action="([^"]+)")?>\s*(?:<<<ORIGINAL>>>\s*([\s\S]*?)<<<MODIFIED>>>\s*([\s\S]*?)|<<<CONTENT>>>\s*([\s\S]*?))\s*<\/FILE_CHANGE>/g;
    let match;
    while ((match = regex.exec(response)) !== null) {
        if (match[5]) {
            // New file creation
            changes.push({
                path: match[1],
                action: 'create',
                content: match[5].trim()
            });
        } else {
            // Modification
            changes.push({
                path: match[1],
                action: match[2] || 'modify',
                original: match[3].trim(),
                modified: match[4].trim()
            });
        }
    }
    return changes;
}

/**
 * Parse RUN_COMMAND blocks from Gemini response.
 */
function parseCommands(response) {
    const commands = [];
    const regex = /<RUN_COMMAND>([\s\S]*?)<\/RUN_COMMAND>/g;
    let match;
    while ((match = regex.exec(response)) !== null) {
        commands.push(match[1].trim());
    }
    return commands;
}

/**
 * Apply file changes to disk.
 */
async function applyChanges(changes, workDir) {
    const results = [];
    for (const change of changes) {
        const fullPath = path.resolve(workDir, change.path);
        try {
            if (change.action === 'create') {
                // Create new file
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, change.content, 'utf-8');
                results.push({ path: change.path, action: 'created', success: true });
            } else {
                // Modify existing file
                let content = await fs.readFile(fullPath, 'utf-8');
                if (content.includes(change.original)) {
                    content = content.replace(change.original, change.modified);
                    await fs.writeFile(fullPath, content, 'utf-8');
                    results.push({ path: change.path, action: 'modified', success: true });
                } else {
                    results.push({ path: change.path, action: 'modify_failed', success: false, error: 'Original content not found in file' });
                }
            }
        } catch (err) {
            results.push({ path: change.path, action: 'error', success: false, error: err.message });
        }
    }
    return results;
}

// ===================== PUBLIC API =====================

/**
 * Analyze code files — read and explain what they do, find issues.
 */
async function analyzeCode(filePaths, workDir, question = '') {
    const fileContents = await readFiles(filePaths, workDir);

    let prompt = 'Analyze the following code files:\n\n';
    for (const [fp, content] of Object.entries(fileContents)) {
        prompt += `--- ${fp} ---\n${content}\n\n`;
    }
    if (question) {
        prompt += `\nSpecific question: ${question}`;
    } else {
        prompt += '\nProvide a brief analysis: what does this code do, any bugs or improvements?';
    }

    const model = await getCodingModel();
    const result = await model.generateContent(prompt);
    return {
        analysis: result.response.text(),
        filesRead: Object.keys(fileContents)
    };
}

/**
 * Execute a coding task — describe what to fix, get changes, optionally apply.
 */
async function executeTask(taskDescription, options = {}) {
    const taskId = require('crypto').randomBytes(6).toString('hex');
    const workDir = options.workDir || path.resolve(__dirname, '..');
    const targetFiles = options.targetFiles || [];
    const autoApply = options.autoApply !== false; // default: apply changes

    const task = {
        taskId,
        description: taskDescription,
        workDir,
        targetFiles,
        status: 'running', // running | completed | failed
        startedAt: Date.now(),
        endedAt: null,
        analysis: null,
        changes: [],
        applied: [],
        commands: [],
        commandResults: [],
        error: null
    };
    tasks.set(taskId, task);

    try {
        // 1. Read target files
        let fileContents = {};
        if (targetFiles.length > 0) {
            fileContents = await readFiles(targetFiles, workDir);
        }

        // 2. Build prompt
        let prompt = `TASK: ${taskDescription}\n\n`;
        prompt += `Working directory: ${workDir}\n\n`;
        if (Object.keys(fileContents).length > 0) {
            prompt += 'CURRENT CODE:\n\n';
            for (const [fp, content] of Object.entries(fileContents)) {
                prompt += `--- ${fp} ---\n${content}\n\n`;
            }
        }
        prompt += '\nGenerate the exact code changes needed to complete this task. Use FILE_CHANGE blocks.';

        // 3. Call Gemini
        const model = await getCodingModel();
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        task.analysis = response;

        // 4. Parse changes
        task.changes = parseFileChanges(response);
        task.commands = parseCommands(response);

        // 5. Apply changes (if auto)
        if (autoApply && task.changes.length > 0) {
            task.applied = await applyChanges(task.changes, workDir);
            console.log(`[CodingAgent] Applied ${task.applied.filter(a => a.success).length}/${task.changes.length} changes`);
        }

        // 6. Run commands (if any)
        for (const cmd of task.commands) {
            try {
                const proc = spawnProcess(cmd, { cwd: workDir, timeout: 120, label: `coding-task-${taskId}` });
                task.commandResults.push({ command: cmd, sessionId: proc.sessionId, status: 'spawned' });
                console.log(`[CodingAgent] Running: ${cmd} (session: ${proc.sessionId})`);
            } catch (err) {
                task.commandResults.push({ command: cmd, error: err.message });
            }
        }

        task.status = 'completed';
        task.endedAt = Date.now();
        console.log(`[CodingAgent] Task ${taskId} completed — ${task.changes.length} changes, ${task.commands.length} commands`);

    } catch (err) {
        task.status = 'failed';
        task.error = err.message;
        task.endedAt = Date.now();
        console.error(`[CodingAgent] Task ${taskId} failed:`, err.message);
    }

    return {
        taskId: task.taskId,
        status: task.status,
        description: task.description,
        changesCount: task.changes.length,
        appliedCount: task.applied.filter(a => a.success).length,
        commandsCount: task.commands.length,
        analysis: task.analysis,
        applied: task.applied,
        error: task.error,
        durationMs: (task.endedAt || Date.now()) - task.startedAt
    };
}

/**
 * Review a GitHub PR — fetch diff, analyze with Gemini.
 */
async function reviewPR(owner, repo, prNumber) {
    const githubService = require('./githubService');

    // Get PR details
    const prStatus = await githubService.getPRStatus(owner, repo, prNumber);

    // Get PR diff via GitHub API
    const token = await githubService.getToken();
    const diffRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3.diff'
        }
    });
    const diff = await diffRes.text();

    // Build review prompt
    const prompt = `Review this Pull Request:

PR #${prNumber}: ${prStatus.title}
Author: ${prStatus.author}
Branch: ${prStatus.branch} → ${prStatus.baseBranch}
Changed files: ${prStatus.changedFiles}
Additions: +${prStatus.additions}, Deletions: -${prStatus.deletions}

DIFF:
${diff.substring(0, 15000)}

Provide a code review with:
1. Summary of changes
2. Potential issues or bugs
3. Suggestions for improvement
4. Overall assessment (approve / request changes / needs discussion)`;

    const model = await getCodingModel();
    const result = await model.generateContent(prompt);

    return {
        pr: prStatus,
        review: result.response.text()
    };
}

/**
 * Get status of a coding task.
 */
function getTaskStatus(taskId) {
    const task = tasks.get(taskId);
    if (!task) return null;
    return {
        taskId: task.taskId,
        status: task.status,
        description: task.description,
        changesCount: task.changes.length,
        appliedCount: task.applied.filter(a => a.success).length,
        commandsCount: task.commands.length,
        commandResults: task.commandResults,
        error: task.error,
        durationMs: (task.endedAt || Date.now()) - task.startedAt
    };
}

// ===================== ACTION DISPATCHER =====================

/**
 * Execute a coding action from orchestrator CODING_JSON tag.
 */
async function executeCodingAction(actionData) {
    switch (actionData.action || 'execute') {
        case 'analyze':
            if (!actionData.files || !Array.isArray(actionData.files)) {
                throw new Error('analyze requires files array');
            }
            return {
                action: 'analyze',
                result: await analyzeCode(
                    actionData.files,
                    actionData.workDir || path.resolve(__dirname, '..'),
                    actionData.question
                )
            };

        case 'execute':
            if (!actionData.task) throw new Error('execute requires a task description');
            return {
                action: 'execute',
                result: await executeTask(actionData.task, {
                    workDir: actionData.workDir || path.resolve(__dirname, '..'),
                    targetFiles: actionData.targetFiles || actionData.files || [],
                    autoApply: actionData.autoApply
                })
            };

        case 'review_pr':
            if (!actionData.owner || !actionData.repo || !actionData.pr) {
                throw new Error('review_pr requires owner, repo, and pr number');
            }
            return {
                action: 'review_pr',
                result: await reviewPR(actionData.owner, actionData.repo, actionData.pr)
            };

        case 'task_status':
            if (!actionData.taskId) throw new Error('task_status requires taskId');
            const status = getTaskStatus(actionData.taskId);
            if (!status) throw new Error(`Task ${actionData.taskId} not found`);
            return { action: 'task_status', result: status };

        default:
            throw new Error(`Unknown coding action: ${actionData.action}`);
    }
}

module.exports = {
    analyzeCode,
    executeTask,
    reviewPR,
    getTaskStatus,
    executeCodingAction
};
