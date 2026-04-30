const mongoose = require('mongoose');
const { getGeminiModel } = require('./configService');
const { spawnProcess, getProcess, getProcessLog } = require('./processManagerService');
const githubService = require('./githubService');
const { executeTask } = require('./codingAgentService');

/**
 * GH-Issues Auto-Fix Service
 * Automated GitHub issue fixing: fetch → analyze → fix → git → PR.
 */

const fixes = new Map();

async function getAnalysisModel() {
    return getGeminiModel(null);
}

// ===================== PHASE 1: ANALYZE ISSUE =====================

/**
 * Analyze a GitHub issue and determine if it's auto-fixable.
 * Returns confidence score (1-10) and analysis.
 */
async function analyzeIssue(owner, repo, issueNumber) {
    // Fetch issue details
    const token = await githubService.getToken();
    const issueRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json'
        }
    });
    if (!issueRes.ok) throw new Error(`GitHub API ${issueRes.status}: Cannot fetch issue #${issueNumber}`);
    const issue = await issueRes.json();

    if (issue.pull_request) {
        throw new Error(`#${issueNumber} is a pull request, not an issue`);
    }

    // Get repo info for context
    const repoInfo = await githubService.getRepoInfo(owner, repo);

    const prompt = `You are analyzing a GitHub issue to determine if it can be automatically fixed by an AI coding agent.

REPOSITORY: ${owner}/${repo}
Language: ${repoInfo.language || 'Unknown'}
Description: ${repoInfo.description || 'N/A'}

ISSUE #${issue.number}: ${issue.title}
Labels: ${issue.labels.map(l => l.name).join(', ') || 'none'}
Author: ${issue.user.login}
Created: ${issue.created_at}

BODY:
${issue.body || '(no description)'}

TASK: Evaluate this issue and provide:
1. CONFIDENCE SCORE (1-10): How confident are you that an AI agent can fix this automatically?
   - 1-3: Too vague, needs human input, or requires architecture changes
   - 4-6: Partially clear, may need guessing, medium scope
   - 7-10: Clear problem, specific code location, focused fix

2. ANALYSIS: What would need to change?

3. ESTIMATED FILES: Which files would likely need modification?

4. RISKS: What could go wrong?

Respond in this exact JSON format:
{"confidence": 8, "analysis": "...", "estimatedFiles": ["file1.js"], "risks": "...", "recommended": true}`;

    const model = await getAnalysisModel();
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON from response
    let analysis;
    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { confidence: 0, analysis: responseText, recommended: false };
    } catch {
        analysis = { confidence: 0, analysis: responseText, recommended: false };
    }

    return {
        issue: {
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            labels: issue.labels.map(l => l.name),
            body: (issue.body || '').substring(0, 500)
        },
        ...analysis
    };
}

// ===================== PHASE 2-4: AUTO-FIX =====================

/**
 * Auto-fix a GitHub issue:
 * 1. Analyze issue (confidence check)
 * 2. Create branch
 * 3. Run coding agent to generate fix
 * 4. Commit, push, create PR
 */
async function autoFixIssue(owner, repo, issueNumber, options = {}) {
    const fixId = require('crypto').randomBytes(6).toString('hex');
    const workDir = options.workDir || require('path').resolve(__dirname, '..');
    const minConfidence = options.minConfidence || 7;

    const fix = {
        fixId,
        owner,
        repo,
        issueNumber,
        status: 'analyzing', // analyzing | fixing | committing | pr_created | failed | skipped
        startedAt: Date.now(),
        endedAt: null,
        analysis: null,
        codingResult: null,
        gitResult: null,
        prUrl: null,
        error: null
    };
    fixes.set(fixId, fix);

    try {
        // Phase 1: Analyze
        console.log(`[GH-Issues] Analyzing issue #${issueNumber}...`);
        fix.analysis = await analyzeIssue(owner, repo, issueNumber);

        if (fix.analysis.confidence < minConfidence) {
            fix.status = 'skipped';
            fix.endedAt = Date.now();
            console.log(`[GH-Issues] Skipped #${issueNumber}: confidence ${fix.analysis.confidence}/10 (min: ${minConfidence})`);
            return formatFixResult(fix);
        }

        // Phase 2: Create branch
        fix.status = 'fixing';
        const branchName = `fix/issue-${issueNumber}`;

        // Git operations via processManager
        console.log(`[GH-Issues] Creating branch ${branchName}...`);
        const gitCheckout = spawnProcess(
            `cd "${workDir}" && git checkout -b ${branchName} 2>&1 || git checkout ${branchName} 2>&1`,
            { cwd: workDir, timeout: 30, label: `git-branch-${issueNumber}` }
        );
        // Wait for git to finish
        await waitForProcess(gitCheckout.sessionId, 15000);

        // Phase 3: Coding agent generates fix
        console.log(`[GH-Issues] Running coding agent for #${issueNumber}...`);
        const taskDescription = `Fix GitHub issue #${issueNumber}: ${fix.analysis.issue.title}

Issue description: ${fix.analysis.issue.body}

Analysis: ${fix.analysis.analysis}

Estimated files to modify: ${(fix.analysis.estimatedFiles || []).join(', ')}

Generate the minimal code changes needed to fix this issue.`;

        fix.codingResult = await executeTask(taskDescription, {
            workDir,
            targetFiles: fix.analysis.estimatedFiles || [],
            autoApply: true
        });

        if (fix.codingResult.status === 'failed') {
            throw new Error(`Coding agent failed: ${fix.codingResult.error}`);
        }

        if (fix.codingResult.changesCount === 0) {
            throw new Error('Coding agent generated no changes');
        }

        // Phase 4: Commit, push, create PR
        fix.status = 'committing';
        console.log(`[GH-Issues] Committing and pushing fix for #${issueNumber}...`);

        // Stage, commit, push
        const token = await githubService.getToken();
        const commitCmd = [
            `cd "${workDir}"`,
            'git add -A',
            `git commit -m "fix: ${fix.analysis.issue.title.replace(/"/g, '\\"')}\n\nFixes ${owner}/${repo}#${issueNumber}"`,
            `git remote set-url origin https://x-access-token:${token}@github.com/${owner}/${repo}.git`,
            `git push -u origin ${branchName}`
        ].join(' && ');

        const gitPush = spawnProcess(commitCmd, {
            cwd: workDir,
            timeout: 60,
            label: `git-push-${issueNumber}`
        });
        await waitForProcess(gitPush.sessionId, 30000);

        // Check if push succeeded
        const pushStatus = getProcess(gitPush.sessionId);
        if (pushStatus.status === 'error') {
            const pushLog = getProcessLog(gitPush.sessionId, 10);
            throw new Error(`Git push failed: ${pushLog.lines.map(l => l.text).join('\n')}`);
        }

        // Create PR via GitHub API
        const prBody = `## Summary

Auto-generated fix for issue #${issueNumber}.

## Changes

${fix.codingResult.applied.filter(a => a.success).map(a => `- ${a.action}: \`${a.path}\``).join('\n')}

## Analysis

${fix.analysis.analysis}

---
*This PR was created automatically by the usa-app coding agent.*

Fixes #${issueNumber}`;

        const pr = await githubService.createIssue(owner, repo,
            `fix: ${fix.analysis.issue.title}`, prBody
        );
        // Actually create PR (not issue)
        const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: `fix: ${fix.analysis.issue.title}`,
                head: branchName,
                base: 'main',
                body: prBody
            })
        });

        if (prRes.ok) {
            const prData = await prRes.json();
            fix.prUrl = prData.html_url;
            fix.status = 'pr_created';
            console.log(`[GH-Issues] PR created for #${issueNumber}: ${fix.prUrl}`);
        } else {
            const errBody = await prRes.text();
            throw new Error(`PR creation failed: ${errBody}`);
        }

        // Return to main branch
        spawnProcess(`cd "${workDir}" && git checkout main 2>&1 || git checkout master 2>&1`, {
            cwd: workDir, timeout: 15, label: 'git-checkout-main'
        });

        fix.endedAt = Date.now();

    } catch (err) {
        fix.status = 'failed';
        fix.error = err.message;
        fix.endedAt = Date.now();
        console.error(`[GH-Issues] Fix #${issueNumber} failed:`, err.message);

        // Try to return to main branch on failure
        try {
            spawnProcess(`cd "${workDir}" && git checkout main 2>&1 || git checkout master 2>&1`, {
                cwd: workDir, timeout: 15, label: 'git-cleanup'
            });
        } catch { }
    }

    return formatFixResult(fix);
}

// ===================== BATCH FIX =====================

/**
 * Batch fix multiple issues sequentially.
 */
async function batchFixIssues(owner, repo, options = {}) {
    const issues = await githubService.listIssues(owner, repo, {
        state: 'open',
        label: options.label,
        limit: options.limit || 5
    });

    if (issues.length === 0) {
        return { message: 'No issues found', results: [] };
    }

    const results = [];
    for (const issue of issues) {
        try {
            const result = await autoFixIssue(owner, repo, issue.number, options);
            results.push(result);
        } catch (err) {
            results.push({
                issueNumber: issue.number,
                status: 'failed',
                error: err.message
            });
        }
    }

    const summary = {
        total: results.length,
        prCreated: results.filter(r => r.status === 'pr_created').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        failed: results.filter(r => r.status === 'failed').length,
        results
    };
    console.log(`[GH-Issues] Batch complete: ${summary.prCreated} PRs, ${summary.skipped} skipped, ${summary.failed} failed`);
    return summary;
}

// ===================== HELPERS =====================

function formatFixResult(fix) {
    return {
        fixId: fix.fixId,
        issueNumber: fix.issueNumber,
        status: fix.status,
        confidence: fix.analysis?.confidence,
        prUrl: fix.prUrl,
        changesApplied: fix.codingResult?.appliedCount || 0,
        analysis: fix.analysis?.analysis,
        error: fix.error,
        durationMs: (fix.endedAt || Date.now()) - fix.startedAt
    };
}

function getFixStatus(fixId) {
    const fix = fixes.get(fixId);
    if (!fix) return null;
    return formatFixResult(fix);
}

/**
 * Wait for a process to finish (with timeout).
 */
function waitForProcess(sessionId, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
            const proc = getProcess(sessionId);
            if (!proc || proc.status !== 'running' || (Date.now() - start) > timeoutMs) {
                resolve(proc);
            } else {
                setTimeout(check, 500);
            }
        };
        check();
    });
}

// ===================== ACTION DISPATCHER =====================

/**
 * Execute a gh-issues action from orchestrator GH_ISSUES_JSON tag.
 */
async function executeGhIssuesAction(actionData) {
    const { owner, repo } = actionData;
    if (!owner || !repo) throw new Error('GH-Issues requires owner and repo');

    switch (actionData.action) {
        case 'analyze':
            if (!actionData.issue) throw new Error('analyze requires issue number');
            return {
                action: 'analyze',
                result: await analyzeIssue(owner, repo, actionData.issue)
            };

        case 'auto_fix':
            if (!actionData.issue) throw new Error('auto_fix requires issue number');
            return {
                action: 'auto_fix',
                result: await autoFixIssue(owner, repo, actionData.issue, {
                    workDir: actionData.workDir,
                    minConfidence: actionData.minConfidence
                })
            };

        case 'batch_fix':
            return {
                action: 'batch_fix',
                result: await batchFixIssues(owner, repo, {
                    label: actionData.label,
                    limit: actionData.limit,
                    workDir: actionData.workDir
                })
            };

        case 'fix_status':
            if (!actionData.fixId) throw new Error('fix_status requires fixId');
            const status = getFixStatus(actionData.fixId);
            if (!status) throw new Error(`Fix ${actionData.fixId} not found`);
            return { action: 'fix_status', result: status };

        default:
            throw new Error(`Unknown gh-issues action: ${actionData.action}`);
    }
}

module.exports = {
    analyzeIssue,
    autoFixIssue,
    batchFixIssues,
    getFixStatus,
    executeGhIssuesAction
};
