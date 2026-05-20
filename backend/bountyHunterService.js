/**
 * Bounty Hunter Service
 * Automatically finds open-source bounties, implements fixes, and submits PRs.
 * Supports Algora and Opire platforms.
 */

const mongoose = require('mongoose');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const WORK_DIR = '/tmp/bounty-hunter';


// ─── In-memory state ─────────────────────────────────────────────────────────
let isRunning = false;
let stopRequested = false;
let currentSessionId = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSession(id) {
  return mongoose.model('BountySession').findById(id);
}

async function log(sessionId, msg, level = 'info') {
  console.log(`[BountyHunter][${level.toUpperCase()}] ${msg}`);
  await mongoose.model('BountySession').updateOne(
    { _id: sessionId },
    { $push: { logs: { ts: new Date(), level, msg } } }
  );
}

async function setCurrentIssue(sessionId, issue) {
  await mongoose.model('BountySession').updateOne(
    { _id: sessionId },
    { $set: { currentIssue: issue } }
  );
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

async function ghApi(apiPath, token, method = 'GET', body = null) {
  const url = `https://api.github.com${apiPath}`;
  const headers = {
    'User-Agent': 'BountyHunter/1.0',
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `token ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Detect bounty amount from issue body/comments/labels ────────────────────

function detectBountyAmount(text, labels = []) {
  // Check labels first: Algora adds a "$75" label
  for (const label of labels) {
    const m = label.match(/^\$(\d+)$/);
    if (m) return parseInt(m[1]);
  }
  // Then check body text
  const patterns = [
    /\/bounty\s+\$(\d+)/i,
    /bounty[:\s]+\$(\d+)/i,
    /\$(\d+)\s+bounty/i,
    /reward[:\s]+\$(\d+)/i,
    /\$(\d+)\s+reward/i,
  ];
  for (const p of patterns) {
    const m = (text || '').match(p);
    if (m) return parseInt(m[1]);
  }
  return 0;
}

function detectPlatform(body, comments) {
  const allText = (body || '') + ' ' + (comments || '');
  if (allText.includes('algora')) return 'algora';
  if (allText.includes('opire')) return 'opire';
  if (allText.includes('issuehunt')) return 'issuehunt';
  return 'other';
}

// ─── Find bounty candidates ───────────────────────────────────────────────────

async function findBountyCandidates(token, sessionId) {
  const candidates = [];

  // Search queries for different platforms
  const searches = [
    { q: 'org:tscircuit label:"💎 Bounty" state:open -label:"💰 Rewarded"', minAmount: 1 },
    { q: '/bounty state:open is:issue language:TypeScript -label:"💰 Rewarded"', minAmount: 5 },
    { q: '/bounty state:open is:issue language:JavaScript -label:"💰 Rewarded"', minAmount: 5 },
  ];

  for (const search of searches) {
    if (stopRequested) break;
    try {
      const enc = encodeURIComponent(search.q);
      const res = await ghApi(`/search/issues?q=${enc}&sort=created&order=desc&per_page=50`, token);
      if (!res.data.items) {
        await log(sessionId, `  ⚠️ Search API error (${res.status}): ${JSON.stringify(res.data).substring(0, 120)}`, 'warn');
        continue;
      }

      await log(sessionId, `Found ${res.data.items.length} issues for: ${search.q.substring(0, 60)}...`);

      for (const issue of res.data.items) {
        if (stopRequested) break;
        const repoName = issue.repository_url.split('/').slice(-2).join('/');
        const labels = (issue.labels || []).map(l => l.name);

        // Skip rewarded
        if (labels.some(l => l.includes('Rewarded') || l.includes('rewarded'))) continue;

        // Detect bounty amount (body + labels)
        const amount = detectBountyAmount(issue.body, labels);
        if (amount < search.minAmount) {
          await log(sessionId, `  ⏭️ ${repoName}#${issue.number} — no amount or too low (detected: $${amount})`);
          continue;
        }

        // Check repo not archived
        const repoRes = await ghApi(`/repos/${repoName}`, token);
        if (repoRes.data.archived) {
          await log(sessionId, `⚠️ Skipping archived repo: ${repoName}`);
          continue;
        }

        // Count competing PRs
        const prRes = await ghApi(`/repos/${repoName}/pulls?state=open&per_page=100`, token);
        const openPRs = Array.isArray(prRes.data) ? prRes.data.length : 0;

        // Filter high competition (>8 related PRs total)
        if (openPRs > 8) {
          await log(sessionId, `⚠️ High competition (${openPRs} PRs) on ${repoName}#${issue.number} - skipping`);
          continue;
        }

        const platform = detectPlatform(issue.body, '');

        candidates.push({
          repo: repoName,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueBody: issue.body || '',
          bountyAmount: amount,
          platform,
          openPRs,
          issueUrl: issue.html_url,
        });

        await log(sessionId, `✅ Candidate: ${repoName}#${issue.number} ($${amount}) - ${openPRs} competing PRs`);
        await sleep(500); // rate limit
      }
    } catch (err) {
      await log(sessionId, `Search error: ${err.message}`, 'warn');
    }
    await sleep(1000);
  }

  // Sort by: lowest competition first, then highest amount
  return candidates.sort((a, b) => {
    if (a.openPRs !== b.openPRs) return a.openPRs - b.openPRs;
    return b.bountyAmount - a.bountyAmount;
  });
}

// ─── Check if we already have a PR for this issue ────────────────────────────

async function alreadySubmitted(sessionId, repo, issueNumber) {
  const session = await getSession(sessionId);
  return (session?.prs || []).some(pr => pr.repo === repo && pr.issueNumber === issueNumber);
}

// ─── Fork repo ────────────────────────────────────────────────────────────────

async function forkRepo(repo, token) {
  const res = await ghApi(`/repos/${repo}/forks`, token, 'POST', { default_branch_only: true });
  if (res.status === 202 || res.status === 200) {
    await sleep(4000); // wait for fork to be ready
    return true;
  }
  return false;
}

// ─── Clone fork ───────────────────────────────────────────────────────────────

function cloneOrUpdateFork(repoName, token, githubUser, workDir) {
  const repoShort = repoName.split('/')[1];
  const localPath = path.join(workDir, repoShort);
  if (!token) throw new Error('GitHub token required for fork/clone/push');
  const forkUrl = `https://${token}@github.com/${githubUser}/${repoShort}.git`;

  if (fs.existsSync(localPath)) {
    execSync(`git -C "${localPath}" fetch origin && git -C "${localPath}" checkout main && git -C "${localPath}" pull origin main`, { stdio: 'pipe' });
  } else {
    execSync(`git clone --filter=blob:none "${forkUrl}" "${localPath}"`, { stdio: 'pipe' });
  }
  return localPath;
}

// ─── Use Claude Code to implement the fix (via Redis/BullMQ queue) ───────────

async function implementWithClaude(issue, localPath, skipDangerously, sessionId) {
  const { mainQueue } = require('./services/queue');

  const prompt = `You are solving a GitHub bounty issue. Implement the fix and commit it.

REPO: ${issue.repo}
ISSUE #${issue.issueNumber}: ${issue.issueTitle}

ISSUE BODY:
${issue.issueBody.substring(0, 3000)}

INSTRUCTIONS:
1. Understand exactly what needs to be changed
2. Find the relevant files using search/read tools
3. Make the minimal necessary code changes
4. DO NOT add unnecessary comments, docs, or refactoring
5. Run tests if they exist and are simple
6. Stage and commit the changes with message: "fix: <short description> (closes #${issue.issueNumber})"
7. Use git user: name=eneflorian1, email=eneflorian@mail.com

Working directory: ${localPath}

When done, output exactly: DONE: <branch-name>
If you cannot solve it, output: SKIP: <reason>`;

  const branchName = `fix/${issue.issueNumber}-${issue.issueTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40)}`;

  // Create branch and set git user
  try {
    execSync(`git -C "${localPath}" checkout -b "${branchName}"`, { stdio: 'pipe' });
  } catch {
    execSync(`git -C "${localPath}" checkout "${branchName}"`, { stdio: 'pipe' });
  }
  execSync(`git -C "${localPath}" config user.name "eneflorian1"`, { stdio: 'pipe' });
  execSync(`git -C "${localPath}" config user.email "eneflorian@mail.com"`, { stdio: 'pipe' });

  await log(sessionId, `🤖 Queuing Claude Code job for ${issue.repo}#${issue.issueNumber}...`);

  // Add job to Redis queue (persisted — survives PM2 restarts)
  const job = await mainQueue.add('bounty-claude', {
    prompt,
    localPath,
    skipDangerously,
    repo: issue.repo,
    issueNumber: issue.issueNumber,
  }, {
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 3600 },
  });

  await log(sessionId, `⏳ Job ${job.id} queued, waiting for worker...`);

  // Poll for completion (max 18 min, job timeout is 15 min)
  const deadline = Date.now() + 18 * 60 * 1000;
  let lastProgress = '';

  while (Date.now() < deadline) {
    await sleep(8000);
    if (stopRequested) {
      await job.remove().catch(() => {});
      return null;
    }

    const j = await mainQueue.getJob(job.id);
    if (!j) {
      await log(sessionId, `⚠️ Job disappeared from queue`, 'warn');
      return null;
    }

    // Forward progress lines to logs
    const prog = j.progress;
    if (prog && prog.line && prog.line !== lastProgress) {
      await log(sessionId, `   ↳ ${prog.line}`);
      lastProgress = prog.line;
    }

    const state = await j.getState();

    if (state === 'completed') {
      const result = j.returnvalue;
      if (result?.skip) {
        await log(sessionId, `⏭️ Skipped: ${result.reason}`, 'warn');
        return null;
      }
      if (result?.done) {
        await log(sessionId, `✅ Claude completed fix for #${issue.issueNumber}`);
        return branchName;
      }
      // Check for actual commits even if DONE not in output
      try {
        const commits = execSync(`git -C "${localPath}" log origin/main..HEAD --oneline`, { stdio: 'pipe' }).toString().trim();
        if (commits.length > 0) {
          await log(sessionId, `✅ Commits found: ${commits.split('\n')[0]}`);
          return branchName;
        }
      } catch { }
      await log(sessionId, `⚠️ Claude finished but no commits found`, 'warn');
      return null;
    }

    if (state === 'failed') {
      const failReason = j.failedReason || 'unknown';
      if (failReason.includes('Timeout')) {
        await log(sessionId, `⏰ Timeout — Claude took >15 min`, 'warn');
      } else {
        await log(sessionId, `⚠️ Job failed: ${failReason.substring(0, 120)}`, 'warn');
      }
      return null;
    }
  }

  await log(sessionId, `⏰ Polling timeout (18 min) for #${issue.issueNumber}`, 'warn');
  return null;
}

// ─── Push branch and create PR ────────────────────────────────────────────────

async function pushAndCreatePR(issue, localPath, branchName, token, githubUser, sessionId) {
  const repoShort = issue.repo.split('/')[1];

  // Push branch
  try {
    execSync(`git -C "${localPath}" push origin "${branchName}"`, { stdio: 'pipe' });
  } catch (err) {
    await log(sessionId, `Push failed: ${err.message}`, 'error');
    return null;
  }

  // Comment /attempt on the issue
  try {
    await ghApi(
      `/repos/${issue.repo}/issues/${issue.issueNumber}/comments`,
      token, 'POST',
      { body: `/attempt #${issue.issueNumber}\n\nImplementing the fix — PR incoming.` }
    );
  } catch { }

  // Build PR body based on platform
  let claimCmd = '';
  if (issue.platform === 'algora') claimCmd = `/claim #${issue.issueNumber}`;
  else if (issue.platform === 'opire') claimCmd = `/try`;

  const prBody = `## Summary

Fix for issue #${issue.issueNumber}: ${issue.issueTitle}

${claimCmd}

---
*Submitted via BountyHunter automation*`;

  // Create PR
  const prRes = await ghApi(
    `/repos/${issue.repo}/pulls`,
    token, 'POST',
    {
      title: `fix: ${issue.issueTitle.substring(0, 70)}`,
      head: `${githubUser}:${branchName}`,
      base: 'main',
      body: prBody,
    }
  );

  if (!prRes.data.number) {
    // Try 'master' base
    const prRes2 = await ghApi(
      `/repos/${issue.repo}/pulls`,
      token, 'POST',
      {
        title: `fix: ${issue.issueTitle.substring(0, 70)}`,
        head: `${githubUser}:${branchName}`,
        base: 'master',
        body: prBody,
      }
    );
    if (!prRes2.data.number) {
      await log(sessionId, `PR creation failed: ${JSON.stringify(prRes2.data).substring(0, 200)}`, 'error');
      return null;
    }
    return prRes2.data;
  }
  return prRes.data;
}

// ─── Update PR statuses ───────────────────────────────────────────────────────

async function refreshPRStatuses(sessionId, token) {
  const session = await getSession(sessionId);
  if (!session) return;

  let totalEarned = 0;
  let totalPending = 0;

  for (const pr of session.prs) {
    if (pr.status === 'paid') {
      totalEarned += pr.bountyAmount || 0;
      continue;
    }
    try {
      const res = await ghApi(`/repos/${pr.repo}/pulls/${pr.prNumber}`, token);
      const prData = res.data;

      if (prData.merged) {
        pr.status = 'merged';
        totalPending += pr.bountyAmount || 0;
      } else if (prData.state === 'closed') {
        pr.status = 'closed';
      } else {
        pr.status = 'submitted';
        totalPending += pr.bountyAmount || 0;
      }
      pr.updatedAt = new Date();
    } catch { }
    await sleep(300);
  }

  await mongoose.model('BountySession').updateOne(
    { _id: sessionId },
    { $set: { prs: session.prs, totalEarned, totalPending } }
  );
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function runBountyHunter(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return;

  const token = session.githubToken;
  const githubUser = session.githubUser || 'eneflorian1';
  const skipDangerously = session.skipDangerously;

  isRunning = true;
  stopRequested = false;
  currentSessionId = sessionId;

  // Ensure work dir
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  await log(sessionId, `🚀 BountyHunter started (user: ${githubUser}, skipDangerously: ${skipDangerously}, token: ${token ? '✅ present' : '❌ MISSING'})`);
  if (!token) {
    await log(sessionId, `❌ Token GitHub lipsă! Mergi la ⚙️ Config, adaugă un token ghp_... și apasă Save Config, apoi repornește hunt-ul.`, 'error');
    await mongoose.model('BountySession').updateOne(
      { _id: sessionId },
      { $set: { status: 'idle', stoppedAt: new Date() } }
    );
    isRunning = false;
    currentSessionId = null;
    return;
  }
  await mongoose.model('BountySession').updateOne(
    { _id: sessionId },
    { $set: { status: 'running', startedAt: new Date() } }
  );

  try {
    // Refresh existing PRs first
    await refreshPRStatuses(sessionId, token);

    // Find candidates
    await log(sessionId, '🔍 Searching for bounty candidates...');
    const candidates = await findBountyCandidates(token, sessionId);
    await log(sessionId, `📋 Found ${candidates.length} viable candidates`);

    if (candidates.length === 0) {
      await log(sessionId, '😔 No suitable bounties found this run', 'warn');
    }

    for (const issue of candidates) {
      if (stopRequested) break;

      await setCurrentIssue(sessionId, `${issue.repo}#${issue.issueNumber}: ${issue.issueTitle}`);

      // Skip if already submitted
      if (await alreadySubmitted(sessionId, issue.repo, issue.issueNumber)) {
        await log(sessionId, `⏭️ Already have PR for ${issue.repo}#${issue.issueNumber}`);
        continue;
      }

      await log(sessionId, `\n🎯 Working on: ${issue.repo}#${issue.issueNumber} ($${issue.bountyAmount}) [${issue.platform}]`);
      await log(sessionId, `   "${issue.issueTitle}"`);

      // Fork repo
      await log(sessionId, `🍴 Forking ${issue.repo}...`);
      const forked = await forkRepo(issue.repo, token);
      if (!forked) {
        await log(sessionId, `Fork might already exist, continuing...`, 'warn');
      }

      // Clone/update fork
      let localPath;
      try {
        localPath = cloneOrUpdateFork(issue.repo, token, githubUser, WORK_DIR);
        await log(sessionId, `📁 Local: ${localPath}`);
      } catch (err) {
        await log(sessionId, `Clone failed: ${err.message}`, 'error');
        continue;
      }

      if (stopRequested) break;

      // Implement with Claude
      const branchName = await implementWithClaude(issue, localPath, skipDangerously, sessionId, token, githubUser);
      if (!branchName) {
        // Reset branch
        try { execSync(`git -C "${localPath}" checkout main`, { stdio: 'pipe' }); } catch { }
        continue;
      }

      if (stopRequested) break;

      // Push and create PR
      await log(sessionId, `📤 Pushing ${branchName} and creating PR...`);
      const pr = await pushAndCreatePR(issue, localPath, branchName, token, githubUser, sessionId);

      if (pr) {
        await log(sessionId, `🎉 PR submitted: ${pr.html_url}`);
        await mongoose.model('BountySession').updateOne(
          { _id: sessionId },
          {
            $push: {
              prs: {
                repo: issue.repo,
                issueNumber: issue.issueNumber,
                issueTitle: issue.issueTitle,
                prNumber: pr.number,
                prUrl: pr.html_url,
                platform: issue.platform,
                bountyAmount: issue.bountyAmount,
                status: 'submitted',
                competitorPRs: issue.openPRs,
                notes: `$${issue.bountyAmount} bounty, ${issue.openPRs} competing PRs`,
              }
            }
          }
        );
      }

      // Small delay between issues
      await sleep(3000);
    }

  } catch (err) {
    await log(sessionId, `Fatal error: ${err.message}`, 'error');
    await mongoose.model('BountySession').updateOne(
      { _id: sessionId },
      { $set: { status: 'error' } }
    );
  } finally {
    isRunning = false;
    currentSessionId = null;
    await mongoose.model('BountySession').updateOne(
      { _id: sessionId },
      { $set: { status: 'idle', currentIssue: null, stoppedAt: new Date() } }
    );
    await log(sessionId, '🏁 BountyHunter stopped');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function start(config = {}) {
  if (isRunning) throw new Error('Already running');

  const BountySession = mongoose.model('BountySession');

  // Resolve token: request > existing session > env var
  const resolvedToken = config.githubToken || process.env.GITHUB_TOKEN || null;

  // Get or create the single persistent session
  let session = await BountySession.findOne().sort({ createdAt: -1 });
  if (!session) {
    session = await BountySession.create({
      githubToken: resolvedToken,
      githubUser: config.githubUser || 'eneflorian1',
      skipDangerously: config.skipDangerously || false,
    });
  } else {
    await BountySession.updateOne({ _id: session._id }, {
      $set: {
        githubToken: resolvedToken || session.githubToken,
        githubUser: config.githubUser || session.githubUser || 'eneflorian1',
        skipDangerously: config.skipDangerously !== undefined ? config.skipDangerously : session.skipDangerously,
      }
    });
    session = await BountySession.findById(session._id);
  }

  runBountyHunter(session._id.toString()).catch(err => {
    console.error('[BountyHunter] Fatal:', err.message);
  });

  return session;
}

async function stop() {
  stopRequested = true;
  if (currentSessionId) {
    await mongoose.model('BountySession').updateOne(
      { _id: currentSessionId },
      { $set: { status: 'stopped', stoppedAt: new Date() } }
    );
    await log(currentSessionId, '⛔ Stop requested by user');
  }
  return { stopped: true };
}

async function getState() {
  const session = await mongoose.model('BountySession').findOne().sort({ createdAt: -1 });
  return { isRunning, session };
}

async function refreshStatuses() {
  const session = await mongoose.model('BountySession').findOne().sort({ createdAt: -1 });
  if (!session || !session.githubToken) throw new Error('No session or token');
  await refreshPRStatuses(session._id.toString(), session.githubToken);
  return getState();
}

module.exports = { start, stop, getState, refreshStatuses, runBountyHunter };
