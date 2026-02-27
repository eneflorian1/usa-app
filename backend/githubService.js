const mongoose = require('mongoose');

/**
 * GitHub Service
 * Interacts with GitHub REST API for issues, PRs, CI status, and repo info.
 * Uses native fetch() — no `gh` CLI dependency.
 */

const GITHUB_API = 'https://api.github.com';

// ===================== TOKEN =====================

async function getToken() {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'github_token' });
    if (!setting || !setting.value) {
        throw new Error('GitHub token not configured. Please set it in Settings.');
    }
    return setting.value;
}

function headers(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
}

async function githubFetch(path, token, options = {}) {
    const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: { ...headers(token), ...options.headers }
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json();
}

// ===================== ISSUES =====================

async function listIssues(owner, repo, options = {}) {
    const token = await getToken();
    const params = new URLSearchParams({
        state: options.state || 'open',
        per_page: String(options.limit || 10),
        sort: options.sort || 'created',
        direction: options.direction || 'desc'
    });
    if (options.label) params.set('labels', options.label);

    const data = await githubFetch(`/repos/${owner}/${repo}/issues?${params}`, token);

    // Filter out pull requests (GitHub API returns PRs mixed with issues)
    const issues = data.filter(item => !item.pull_request);

    return issues.map(i => ({
        number: i.number,
        title: i.title,
        state: i.state,
        labels: i.labels.map(l => l.name),
        author: i.user.login,
        created: i.created_at,
        url: i.html_url,
        comments: i.comments
    }));
}

async function createIssue(owner, repo, title, body = '', labels = []) {
    const token = await getToken();
    const data = await githubFetch(`/repos/${owner}/${repo}/issues`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, labels })
    });
    return {
        number: data.number,
        title: data.title,
        url: data.html_url,
        state: data.state
    };
}

async function closeIssue(owner, repo, issueNumber) {
    const token = await getToken();
    const data = await githubFetch(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'closed' })
    });
    return {
        number: data.number,
        title: data.title,
        state: data.state,
        url: data.html_url
    };
}

async function commentOnIssue(owner, repo, issueNumber, body) {
    const token = await getToken();
    const data = await githubFetch(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body })
    });
    return {
        id: data.id,
        url: data.html_url
    };
}

// ===================== PULL REQUESTS =====================

async function listPRs(owner, repo, options = {}) {
    const token = await getToken();
    const params = new URLSearchParams({
        state: options.state || 'open',
        per_page: String(options.limit || 10),
        sort: options.sort || 'created',
        direction: options.direction || 'desc'
    });

    const data = await githubFetch(`/repos/${owner}/${repo}/pulls?${params}`, token);

    return data.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user.login,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        mergeable: pr.mergeable,
        created: pr.created_at,
        updated: pr.updated_at,
        url: pr.html_url,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files
    }));
}

async function getPRStatus(owner, repo, prNumber) {
    const token = await getToken();

    // Get PR details
    const pr = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`, token);

    // Get CI check runs for the PR's head commit
    let checks = [];
    try {
        const checkData = await githubFetch(
            `/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs`, token
        );
        checks = checkData.check_runs.map(c => ({
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
            url: c.html_url
        }));
    } catch (e) {
        // No checks configured — not an error
    }

    return {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        mergeable: pr.mergeable,
        mergeableState: pr.mergeable_state,
        author: pr.user.login,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        url: pr.html_url,
        checks
    };
}

// ===================== CI / WORKFLOW RUNS =====================

async function listCIRuns(owner, repo, options = {}) {
    const token = await getToken();
    const params = new URLSearchParams({
        per_page: String(options.limit || 5)
    });
    if (options.branch) params.set('branch', options.branch);
    if (options.status) params.set('status', options.status);

    const data = await githubFetch(`/repos/${owner}/${repo}/actions/runs?${params}`, token);

    return data.workflow_runs.map(run => ({
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        branch: run.head_branch,
        event: run.event,
        created: run.created_at,
        updated: run.updated_at,
        url: run.html_url
    }));
}

// ===================== REPO INFO =====================

async function getRepoInfo(owner, repo) {
    const token = await getToken();
    const data = await githubFetch(`/repos/${owner}/${repo}`, token);

    return {
        name: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        openIssues: data.open_issues_count,
        language: data.language,
        defaultBranch: data.default_branch,
        private: data.private,
        url: data.html_url,
        updatedAt: data.updated_at
    };
}

// ===================== ACTION DISPATCHER =====================

/**
 * Executes a GitHub action from an orchestrator/glasses GITHUB_JSON tag.
 * @param {Object} actionData - Parsed JSON from <GITHUB_JSON> tag
 * @returns {Object} Result of the action
 */
async function executeGitHubAction(actionData) {
    const { action, owner, repo } = actionData;

    if (!owner || !repo) {
        throw new Error('GitHub action requires owner and repo fields');
    }

    switch (action) {
        case 'list_issues':
            return {
                action: 'list_issues',
                result: await listIssues(owner, repo, {
                    state: actionData.state,
                    label: actionData.label,
                    limit: actionData.limit
                })
            };

        case 'create_issue':
            if (!actionData.title) throw new Error('create_issue requires a title');
            return {
                action: 'create_issue',
                result: await createIssue(owner, repo, actionData.title, actionData.body, actionData.labels)
            };

        case 'close_issue':
            if (!actionData.issue) throw new Error('close_issue requires an issue number');
            return {
                action: 'close_issue',
                result: await closeIssue(owner, repo, actionData.issue)
            };

        case 'comment_issue':
            if (!actionData.issue || !actionData.body) throw new Error('comment_issue requires issue number and body');
            return {
                action: 'comment_issue',
                result: await commentOnIssue(owner, repo, actionData.issue, actionData.body)
            };

        case 'list_prs':
            return {
                action: 'list_prs',
                result: await listPRs(owner, repo, {
                    state: actionData.state,
                    limit: actionData.limit
                })
            };

        case 'pr_status':
            if (!actionData.pr) throw new Error('pr_status requires a PR number');
            return {
                action: 'pr_status',
                result: await getPRStatus(owner, repo, actionData.pr)
            };

        case 'ci_status':
            return {
                action: 'ci_status',
                result: await listCIRuns(owner, repo, {
                    limit: actionData.limit,
                    branch: actionData.branch
                })
            };

        case 'repo_info':
            return {
                action: 'repo_info',
                result: await getRepoInfo(owner, repo)
            };

        default:
            throw new Error(`Unknown GitHub action: ${action}`);
    }
}

module.exports = {
    getToken,
    listIssues,
    createIssue,
    closeIssue,
    commentOnIssue,
    listPRs,
    getPRStatus,
    listCIRuns,
    getRepoInfo,
    executeGitHubAction
};
