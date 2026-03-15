const mongoose = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');

const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 15 * 60 * 1000; // 15 min

// ─── Helper: Execute command on local PC via queue ────────────────────────────

async function executeOnLocalPC(command, cwd) {
    const LocalExecCommand = mongoose.model('LocalExecCommand');
    const doc = await LocalExecCommand.create({ command, cwd: cwd || '', execType: 'shell' });

    const deadline = Date.now() + POLL_TIMEOUT;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        const updated = await LocalExecCommand.findById(doc._id);
        if (updated && (updated.status === 'done' || updated.status === 'error')) {
            return { output: updated.output, exitCode: updated.exitCode, status: updated.status };
        }
    }
    return { output: 'Timeout: command did not complete in 15 minutes', exitCode: 1, status: 'error' };
}

// ─── Helper: Get GitHub token ─────────────────────────────────────────────────

async function getGitHubToken() {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'github_token' });
    if (!setting?.value) throw new Error('GitHub token not configured in Settings.');
    return setting.value;
}

// ─── Helper: Get Anthropic client ────────────────────────────────────────────

async function getAnthropicClient() {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'anthropic_api_key' });
    if (!setting?.value) throw new Error('Anthropic API key not configured in Settings.');
    return new Anthropic({ apiKey: setting.value });
}

// ─── Helper: Get repo by ID ───────────────────────────────────────────────────

async function getRepo(repoId) {
    const GitRepo = mongoose.model('GitRepo');
    const repo = await GitRepo.findById(repoId);
    if (!repo) throw new Error(`Repo not found: ${repoId}`);
    return repo;
}

// ─── Helper: Save task log ────────────────────────────────────────────────────

async function createTaskLog(repoId, repoName, taskType, task) {
    const GitRepoTask = mongoose.model('GitRepoTask');
    return GitRepoTask.create({
        repoId,
        repoName,
        taskType,
        task,
        status: 'running',
        steps: [],
        createdAt: new Date()
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * list_repos() — return all registered repos from DB
 */
async function list_repos() {
    const GitRepo = mongoose.model('GitRepo');
    return GitRepo.find().sort({ updatedAt: -1 }).lean();
}

/**
 * create_repo(name, description, isPrivate) — create GitHub repo + save in DB
 */
async function create_repo(name, description = '', isPrivate = false) {
    const token = await getGitHubToken();
    const res = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ name, description, private: isPrivate, auto_init: true })
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API ${res.status}: ${body}`);
    }

    const data = await res.json();
    const GitRepo = mongoose.model('GitRepo');
    const repo = await GitRepo.create({
        name: data.name,
        fullName: data.full_name,
        githubUrl: data.html_url,
        cloneUrl: data.clone_url,
        description: data.description || '',
        isPrivate: data.private,
        language: data.language || '',
        localPath: '',
        status: 'remote_only',
        defaultBranch: data.default_branch || 'main'
    });

    console.log('[GitApps] create_repo:', repo.name, '→', repo.githubUrl);
    return { repo, github: { fullName: data.full_name, url: data.html_url } };
}

/**
 * clone_repo(url, localPath, repoId?) — git clone on local PC + update DB
 */
async function clone_repo(cloneUrl, localPath, repoId = null) {
    const result = await executeOnLocalPC(
        `git clone "${cloneUrl}" "${localPath}"`,
        ''
    );

    if (repoId) {
        const GitRepo = mongoose.model('GitRepo');
        await GitRepo.findByIdAndUpdate(repoId, {
            localPath,
            status: result.exitCode === 0 ? 'cloned' : 'clone_error',
            lastError: result.exitCode !== 0 ? result.output?.substring(0, 500) : '',
            updatedAt: new Date()
        });
    } else if (result.exitCode === 0) {
        // Auto-detect name from url
        const name = cloneUrl.split('/').pop()?.replace('.git', '') || 'repo';
        const GitRepo = mongoose.model('GitRepo');
        const existing = await GitRepo.findOne({ cloneUrl });
        if (!existing) {
            await GitRepo.create({
                name,
                cloneUrl,
                githubUrl: cloneUrl.replace('.git', ''),
                localPath,
                status: 'cloned'
            });
        }
    }

    console.log('[GitApps] clone_repo:', cloneUrl, '→ exit', result.exitCode);
    return result;
}

/**
 * delete_repo(repoId, alsoDeleteRemote?) — remove from DB, optionally delete GitHub repo
 */
async function delete_repo(repoId, alsoDeleteRemote = false) {
    const repo = await getRepo(repoId);

    if (alsoDeleteRemote && repo.fullName) {
        const token = await getGitHubToken();
        const res = await fetch(`https://api.github.com/repos/${repo.fullName}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        if (!res.ok && res.status !== 204) {
            const body = await res.text();
            throw new Error(`GitHub API ${res.status}: ${body}`);
        }
    }

    const GitRepo = mongoose.model('GitRepo');
    await GitRepo.findByIdAndDelete(repoId);
    console.log('[GitApps] delete_repo:', repo.name, alsoDeleteRemote ? '(+ GitHub)' : '(DB only)');
    return { deleted: true, name: repo.name };
}

/**
 * repo_metadata(repoId) — get git status, branch, last commits from local PC
 */
async function repo_metadata(repoId) {
    const repo = await getRepo(repoId);
    const path = repo.localPath;

    if (!path) {
        // Fetch from GitHub API if no local path
        if (repo.fullName) {
            const token = await getGitHubToken();
            const res = await fetch(`https://api.github.com/repos/${repo.fullName}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });
            if (res.ok) {
                const data = await res.json();
                return {
                    source: 'github',
                    name: data.name,
                    fullName: data.full_name,
                    description: data.description,
                    language: data.language,
                    stars: data.stargazers_count,
                    forks: data.forks_count,
                    openIssues: data.open_issues_count,
                    defaultBranch: data.default_branch,
                    updatedAt: data.updated_at,
                    url: data.html_url
                };
            }
        }
        return { source: 'db', name: repo.name, status: 'remote_only', localPath: null };
    }

    // Run git commands on local PC
    const cmd = [
        `git -C "${path}" branch --show-current`,
        `git -C "${path}" log --oneline -10`,
        `git -C "${path}" status --short`,
        `git -C "${path}" remote -v`
    ].join(' && echo "---SEP---" && ');

    const result = await executeOnLocalPC(cmd, path);
    const parts = (result.output || '').split('---SEP---');

    return {
        source: 'local',
        name: repo.name,
        localPath: path,
        currentBranch: parts[0]?.trim() || '',
        recentCommits: parts[1]?.trim().split('\n').filter(Boolean) || [],
        gitStatus: parts[2]?.trim() || '',
        remotes: parts[3]?.trim() || '',
        exitCode: result.exitCode
    };
}

/**
 * update_repo(repoId) — git pull on local PC
 */
async function update_repo(repoId) {
    const repo = await getRepo(repoId);
    if (!repo.localPath) throw new Error('Repo not cloned locally.');

    const result = await executeOnLocalPC(`git -C "${repo.localPath}" pull`, repo.localPath);

    const GitRepo = mongoose.model('GitRepo');
    await GitRepo.findByIdAndUpdate(repoId, { updatedAt: new Date() });

    console.log('[GitApps] update_repo:', repo.name, '→ exit', result.exitCode);
    return result;
}

/**
 * commit_changes(repoId, message) — git add . && git commit -m on local PC
 */
async function commit_changes(repoId, message) {
    const repo = await getRepo(repoId);
    if (!repo.localPath) throw new Error('Repo not cloned locally.');

    const cmd = `git -C "${repo.localPath}" add -A && git -C "${repo.localPath}" commit -m "${message.replace(/"/g, '\\"')}"`;
    const result = await executeOnLocalPC(cmd, repo.localPath);

    console.log('[GitApps] commit_changes:', repo.name, '"' + message + '"', '→ exit', result.exitCode);
    return result;
}

/**
 * run_task(repoId, task) — run a single Claude CLI task on the repo
 */
async function run_task(repoId, task) {
    const repo = await getRepo(repoId);
    const taskDoc = await createTaskLog(repoId, repo.name, 'task', task);

    const projectPath = repo.localPath || `C:\\Users\\Admin\\Documents\\GitHub\\${repo.name}`;
    const prompt = [
        `PROJECT: ${repo.name}`,
        `PATH: ${projectPath}`,
        `\nTASK: ${task}`,
        `\nAfter completing the task, commit changes with git if you made code changes.`
    ].join('\n');

    const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`');
    const claudeCmd = [
        'claude', '-p', `"${escapedPrompt}"`,
        '--output-format', 'json',
        '--model', 'opus',
        '--dangerously-skip-permissions',
        '--no-session-persistence'
    ].join(' ');

    // Fire and forget — update task doc async
    executeOnLocalPC(claudeCmd, projectPath).then(async result => {
        let summary = '';
        if (result.exitCode === 0 && result.output) {
            try {
                const json = JSON.parse(result.output);
                summary = json.result || json.content || result.output.substring(0, 2000);
                if (json.cost_usd) summary += `\n\nCost: $${json.cost_usd.toFixed(4)}`;
            } catch {
                summary = result.output.substring(0, 3000);
            }
        } else {
            summary = `Error (exit ${result.exitCode}): ${result.output?.substring(0, 2000) || 'No output'}`;
        }

        const GitRepoTask = mongoose.model('GitRepoTask');
        await GitRepoTask.findByIdAndUpdate(taskDoc._id, {
            status: result.exitCode === 0 ? 'done' : 'error',
            output: result.output?.substring(0, 50000) || '',
            summary: summary.substring(0, 5000),
            completedAt: new Date()
        });

        const GitRepo = mongoose.model('GitRepo');
        await GitRepo.findByIdAndUpdate(repoId, { updatedAt: new Date(), lastTask: task });
    }).catch(async err => {
        const GitRepoTask = mongoose.model('GitRepoTask');
        await GitRepoTask.findByIdAndUpdate(taskDoc._id, {
            status: 'error',
            summary: `Error: ${err.message}`,
            completedAt: new Date()
        });
    });

    return taskDoc;
}

/**
 * run_repo_agent(repoId, task) — autonomous multi-step agent on the repo
 * Uses Claude CLI with full project context
 */
async function run_repo_agent(repoId, task) {
    const repo = await getRepo(repoId);
    const taskDoc = await createTaskLog(repoId, repo.name, 'agent', task);

    const projectPath = repo.localPath || `C:\\Users\\Admin\\Documents\\GitHub\\${repo.name}`;

    // Build rich prompt with context
    const prompt = [
        `You are an autonomous coding agent working on the "${repo.name}" project.`,
        repo.description ? `Project description: ${repo.description}` : '',
        repo.language ? `Primary language: ${repo.language}` : '',
        `Local path: ${projectPath}`,
        `\n## AGENT TASK\n${task}`,
        `\nBehave as an expert developer:`,
        `1. Explore the project structure`,
        `2. Read relevant files`,
        `3. Make precise changes`,
        `4. Run tests if available`,
        `5. Commit all changes with a descriptive message`,
        `6. Push to remote if possible`,
        `\nReport what you did in a clear summary.`
    ].filter(Boolean).join('\n');

    const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`');
    const claudeCmd = [
        'claude', '-p', `"${escapedPrompt}"`,
        '--output-format', 'json',
        '--model', 'opus',
        '--dangerously-skip-permissions',
        '--no-session-persistence'
    ].join(' ');

    // Fire and forget
    executeOnLocalPC(claudeCmd, projectPath).then(async result => {
        let summary = '';
        if (result.exitCode === 0 && result.output) {
            try {
                const json = JSON.parse(result.output);
                summary = json.result || json.content || result.output.substring(0, 2000);
                if (json.cost_usd) summary += `\n\nCost: $${json.cost_usd.toFixed(4)}`;
            } catch {
                summary = result.output.substring(0, 3000);
            }
        } else {
            summary = `Error (exit ${result.exitCode}): ${result.output?.substring(0, 2000) || 'No output'}`;
        }

        const GitRepoTask = mongoose.model('GitRepoTask');
        await GitRepoTask.findByIdAndUpdate(taskDoc._id, {
            status: result.exitCode === 0 ? 'done' : 'error',
            output: result.output?.substring(0, 50000) || '',
            summary: summary.substring(0, 5000),
            completedAt: new Date()
        });
    }).catch(async err => {
        const GitRepoTask = mongoose.model('GitRepoTask');
        await GitRepoTask.findByIdAndUpdate(taskDoc._id, {
            status: 'error',
            summary: `Error: ${err.message}`,
            completedAt: new Date()
        });
    });

    return taskDoc;
}

/**
 * update_code_from_llm(repoId, task) — use Anthropic API (claude-sonnet-4-6) to plan + apply changes
 * Returns the LLM's analysis and patch suggestions directly (no local exec needed)
 */
async function update_code_from_llm(repoId, task) {
    const repo = await getRepo(repoId);
    const taskDoc = await createTaskLog(repoId, repo.name, 'llm_update', task);
    const client = await getAnthropicClient();

    const systemPrompt = `You are an expert software engineer. The user will describe a change to make in the "${repo.name}" project.
Your job is to:
1. Analyze the request
2. Describe the specific files and changes needed
3. Provide exact code patches/snippets
4. Explain the reasoning

Project: ${repo.name}
${repo.description ? `Description: ${repo.description}` : ''}
${repo.language ? `Language: ${repo.language}` : ''}
${repo.localPath ? `Path: ${repo.localPath}` : ''}

Respond with:
- A brief analysis
- A list of files to change with exact code
- Git commit message suggestion`;

    // Fire async
    (async () => {
        try {
            const message = await client.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 4096,
                system: systemPrompt,
                messages: [{ role: 'user', content: task }]
            });

            const content = message.content[0]?.type === 'text' ? message.content[0].text : '';
            const GitRepoTask = mongoose.model('GitRepoTask');
            await GitRepoTask.findByIdAndUpdate(taskDoc._id, {
                status: 'done',
                output: content,
                summary: content.substring(0, 500),
                completedAt: new Date()
            });
        } catch (err) {
            const GitRepoTask = mongoose.model('GitRepoTask');
            await GitRepoTask.findByIdAndUpdate(taskDoc._id, {
                status: 'error',
                summary: `LLM Error: ${err.message}`,
                completedAt: new Date()
            });
        }
    })();

    return taskDoc;
}

// ─── Execute action from orchestrator ────────────────────────────────────────

async function executeGitAppAction(data) {
    const { action } = data;

    switch (action) {
        case 'list_repos':
            return list_repos();

        case 'create_repo':
            return create_repo(data.name, data.description, data.private || false);

        case 'clone_repo':
            return clone_repo(data.url, data.localPath, data.repoId);

        case 'delete_repo':
            return delete_repo(data.repoId, data.alsoDeleteRemote || false);

        case 'repo_metadata':
            return repo_metadata(data.repoId);

        case 'update_repo':
            return update_repo(data.repoId);

        case 'commit_changes':
            return commit_changes(data.repoId, data.message || 'Auto commit');

        case 'run_task':
            return run_task(data.repoId, data.task);

        case 'run_repo_agent':
            return run_repo_agent(data.repoId, data.task);

        case 'update_code_from_llm':
            return update_code_from_llm(data.repoId, data.task);

        default:
            throw new Error(`Unknown git app action: ${action}`);
    }
}

module.exports = {
    list_repos,
    create_repo,
    clone_repo,
    delete_repo,
    repo_metadata,
    update_repo,
    commit_changes,
    run_task,
    run_repo_agent,
    update_code_from_llm,
    executeGitAppAction
};
