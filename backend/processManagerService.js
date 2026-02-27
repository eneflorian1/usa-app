const { spawn } = require('child_process');
const crypto = require('crypto');

/**
 * Process Manager Service
 * Manages background processes — spawn, monitor, kill, read logs.
 * Replaces tmux for usa-app (runs on Linux VPS).
 */

// In-memory session store
const sessions = new Map();
const MAX_LOG_LINES = 500;
const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours

// ===================== SPAWN =====================

/**
 * Spawn a background process.
 * @param {string} command - Shell command to run
 * @param {Object} options - { cwd, env, timeout, label }
 * @returns {{ sessionId, pid, label }}
 */
function spawnProcess(command, options = {}) {
    const sessionId = crypto.randomBytes(8).toString('hex');
    const cwd = options.cwd || process.cwd();
    const timeout = options.timeout || 3600; // default 1 hour
    const label = options.label || command.substring(0, 60);

    const child = spawn('bash', ['-c', command], {
        cwd,
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
    });

    const session = {
        sessionId,
        pid: child.pid,
        label,
        command,
        cwd,
        status: 'running', // running | done | error | killed | timeout
        exitCode: null,
        startedAt: Date.now(),
        endedAt: null,
        log: [],        // circular buffer of output lines
        child
    };

    // Capture stdout
    child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.length > 0);
        for (const line of lines) {
            session.log.push({ ts: Date.now(), stream: 'stdout', text: line });
            if (session.log.length > MAX_LOG_LINES) {
                session.log.shift();
            }
        }
    });

    // Capture stderr
    child.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.length > 0);
        for (const line of lines) {
            session.log.push({ ts: Date.now(), stream: 'stderr', text: line });
            if (session.log.length > MAX_LOG_LINES) {
                session.log.shift();
            }
        }
    });

    // Handle exit
    child.on('close', (code) => {
        session.status = code === 0 ? 'done' : 'error';
        session.exitCode = code;
        session.endedAt = Date.now();
        session.child = null; // Release reference
        console.log(`[ProcessMgr] Session ${sessionId} exited with code ${code}`);
    });

    child.on('error', (err) => {
        session.status = 'error';
        session.endedAt = Date.now();
        session.log.push({ ts: Date.now(), stream: 'stderr', text: `Process error: ${err.message}` });
        session.child = null;
        console.error(`[ProcessMgr] Session ${sessionId} error:`, err.message);
    });

    // Timeout
    if (timeout > 0) {
        setTimeout(() => {
            if (session.status === 'running') {
                killProcess(sessionId);
                session.status = 'timeout';
                console.log(`[ProcessMgr] Session ${sessionId} timed out after ${timeout}s`);
            }
        }, timeout * 1000);
    }

    sessions.set(sessionId, session);
    console.log(`[ProcessMgr] Spawned ${sessionId} (PID ${child.pid}): ${label}`);

    return {
        sessionId,
        pid: child.pid,
        label,
        status: 'running'
    };
}

// ===================== QUERY =====================

function getProcess(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return null;
    return {
        sessionId: s.sessionId,
        pid: s.pid,
        label: s.label,
        command: s.command,
        cwd: s.cwd,
        status: s.status,
        exitCode: s.exitCode,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        logLines: s.log.length,
        durationMs: (s.endedAt || Date.now()) - s.startedAt
    };
}

function getProcessLog(sessionId, tail = 50) {
    const s = sessions.get(sessionId);
    if (!s) return null;
    const lines = s.log.slice(-tail);
    return {
        sessionId: s.sessionId,
        status: s.status,
        total: s.log.length,
        showing: lines.length,
        lines: lines.map(l => ({
            time: new Date(l.ts).toISOString(),
            stream: l.stream,
            text: l.text
        }))
    };
}

function listProcesses() {
    const result = [];
    for (const [id, s] of sessions) {
        result.push({
            sessionId: s.sessionId,
            pid: s.pid,
            label: s.label,
            status: s.status,
            exitCode: s.exitCode,
            startedAt: s.startedAt,
            durationMs: (s.endedAt || Date.now()) - s.startedAt
        });
    }
    return result.sort((a, b) => b.startedAt - a.startedAt);
}

// ===================== CONTROL =====================

function sendInput(sessionId, input) {
    const s = sessions.get(sessionId);
    if (!s || !s.child || s.status !== 'running') {
        throw new Error(`Session ${sessionId} is not running`);
    }
    s.child.stdin.write(input + '\n');
    return { sent: true, sessionId };
}

function killProcess(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    if (s.child && s.status === 'running') {
        s.child.kill('SIGTERM');
        // Force kill after 5 seconds
        setTimeout(() => {
            if (s.child && s.status === 'running') {
                try { s.child.kill('SIGKILL'); } catch { }
            }
        }, 5000);
        s.status = 'killed';
        s.endedAt = Date.now();
        console.log(`[ProcessMgr] Killed session ${sessionId}`);
    }
    return { killed: true, sessionId };
}

// ===================== CLEANUP =====================

function cleanupOldSessions() {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, s] of sessions) {
        if (s.status !== 'running' && (now - s.startedAt) > SESSION_TTL) {
            sessions.delete(id);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`[ProcessMgr] Cleaned up ${cleaned} old sessions`);
    }
}

// Auto-cleanup every 30 minutes
setInterval(cleanupOldSessions, 30 * 60 * 1000);

// ===================== ACTION DISPATCHER =====================

/**
 * Execute a process management action from orchestrator PROCESS_JSON tag.
 */
function executeProcessAction(actionData) {
    switch (actionData.action) {
        case 'spawn':
            if (!actionData.command) throw new Error('spawn requires a command');
            return spawnProcess(actionData.command, {
                cwd: actionData.cwd,
                timeout: actionData.timeout,
                label: actionData.label
            });

        case 'list':
            return { action: 'list', result: listProcesses() };

        case 'status':
            if (!actionData.sessionId) throw new Error('status requires sessionId');
            const proc = getProcess(actionData.sessionId);
            if (!proc) throw new Error(`Session ${actionData.sessionId} not found`);
            return { action: 'status', result: proc };

        case 'log':
            if (!actionData.sessionId) throw new Error('log requires sessionId');
            const log = getProcessLog(actionData.sessionId, actionData.tail || 20);
            if (!log) throw new Error(`Session ${actionData.sessionId} not found`);
            return { action: 'log', result: log };

        case 'input':
            if (!actionData.sessionId || !actionData.text) throw new Error('input requires sessionId and text');
            return { action: 'input', result: sendInput(actionData.sessionId, actionData.text) };

        case 'kill':
            if (!actionData.sessionId) throw new Error('kill requires sessionId');
            return { action: 'kill', result: killProcess(actionData.sessionId) };

        default:
            throw new Error(`Unknown process action: ${actionData.action}`);
    }
}

module.exports = {
    spawnProcess,
    getProcess,
    getProcessLog,
    listProcesses,
    sendInput,
    killProcess,
    cleanupOldSessions,
    executeProcessAction
};
