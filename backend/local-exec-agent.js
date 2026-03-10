#!/usr/bin/env node
/**
 * Local Exec Agent
 * Rulează pe PC-ul local și execută comenzile trimise din chat-ul de pe VPS.
 *
 * Pornire:
 *   node local-exec-agent.js
 *
 * Variabile de mediu (sau editează direct mai jos):
 *   VPS_URL   - URL-ul VPS-ului (ex: http://155.117.45.192:5000)
 *   POLL_MS   - interval polling în ms (default: 3000)
 *   EXEC_CWD  - director de lucru default pentru comenzi (default: $HOME)
 */

const { execFile } = require('child_process');
const https = require('https');
const http = require('http');
const os = require('os');

const VPS_URL = process.env.VPS_URL || 'http://155.117.45.192:5000';
const POLL_MS = parseInt(process.env.POLL_MS || '3000', 10);
const DEFAULT_CWD = process.env.EXEC_CWD || os.homedir();

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function request(method, url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const data = body ? JSON.stringify(body) : null;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            },
            timeout: 10000
        };
        const req = lib.request(options, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch { resolve(raw); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (data) req.write(data);
        req.end();
    });
}

// ─── Command execution ────────────────────────────────────────────────────────

function runCommand(command, cwd) {
    return new Promise((resolve) => {
        const shell = process.platform === 'win32' ? 'cmd' : 'bash';
        const shellFlag = process.platform === 'win32' ? '/c' : '-c';
        const workDir = cwd && cwd.trim() ? cwd.trim() : DEFAULT_CWD;

        const child = execFile(shell, [shellFlag, command], {
            cwd: workDir,
            timeout: 5 * 60 * 1000, // 5 minute timeout
            maxBuffer: 1024 * 1024 * 5 // 5MB output
        }, (error, stdout, stderr) => {
            const output = [stdout, stderr].filter(Boolean).join('\n').trim();
            resolve({
                output: output || (error ? error.message : '(no output)'),
                exitCode: error ? (error.code ?? 1) : 0
            });
        });

        child.on('error', (err) => {
            resolve({ output: err.message, exitCode: 1 });
        });
    });
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function poll() {
    try {
        const cmd = await request('GET', `${VPS_URL}/api/local-exec/pending`);
        if (!cmd || !cmd._id) return; // nothing pending

        console.log(`[LocalExecAgent] Running: ${cmd.command}`);

        const { output, exitCode } = await runCommand(cmd.command, cmd.cwd);

        console.log(`[LocalExecAgent] Done (exit ${exitCode}):`, output.substring(0, 200));

        await request('POST', `${VPS_URL}/api/local-exec/result/${cmd._id}`, {
            output,
            exitCode,
            status: exitCode === 0 ? 'done' : 'error'
        });
    } catch (err) {
        // Silently ignore connection errors — VPS might be temporarily unreachable
        if (!err.message.includes('ECONNREFUSED') && !err.message.includes('timeout')) {
            console.error('[LocalExecAgent] Error:', err.message);
        }
    }
}

// ─── Start ────────────────────────────────────────────────────────────────────

console.log(`[LocalExecAgent] Started. Polling ${VPS_URL} every ${POLL_MS}ms`);
console.log(`[LocalExecAgent] Default CWD: ${DEFAULT_CWD}`);

setInterval(poll, POLL_MS);
poll(); // first poll immediately
