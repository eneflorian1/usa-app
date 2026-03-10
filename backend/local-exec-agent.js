#!/usr/bin/env node
/**
 * Local Exec Agent + MCP Client
 * Rulează pe PC-ul local și execută comenzile trimise din chat-ul de pe VPS.
 * Suportă atât comenzi shell cât și MCP tools (screenshot, clipboard).
 *
 * Pornire:
 *   node local-exec-agent.js
 *
 * Variabile de mediu (sau editează direct mai jos):
 *   VPS_URL   - URL-ul VPS-ului (ex: http://155.117.45.192:5000)
 *   POLL_MS   - interval polling în ms (default: 3000)
 *   EXEC_CWD  - director de lucru default pentru comenzi (default: $HOME)
 */

const { execFile, spawn } = require('child_process');
const https = require('https');
const http = require('http');
const os = require('os');
const path = require('path');

const VPS_URL = process.env.VPS_URL || 'http://155.117.45.192:5000';
const POLL_MS = parseInt(process.env.POLL_MS || '3000', 10);
const DEFAULT_CWD = process.env.EXEC_CWD || os.homedir();

// ─── MCP Server Registry ────────────────────────────────────────────────────

const MCP_SERVERS = {
    screenshot: {
        command: 'npx',
        args: ['-y', 'screen-capture-mcp'],
        client: null,
        transport: null,
        ready: false
    },
    clipboard: {
        command: 'npx',
        args: ['-y', '@nicholasoxford/clipboard-mcp-server'],
        client: null,
        transport: null,
        ready: false
    }
};

let mcpSdkAvailable = false;
let Client, StdioClientTransport;

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

// ─── Shell Command execution ─────────────────────────────────────────────────

function runCommand(command, cwd) {
    return new Promise((resolve) => {
        const shell = process.platform === 'win32' ? 'cmd' : 'bash';
        const shellFlag = process.platform === 'win32' ? '/c' : '-c';
        const workDir = cwd && cwd.trim() ? cwd.trim() : DEFAULT_CWD;

        const child = execFile(shell, [shellFlag, command], {
            cwd: workDir,
            timeout: 5 * 60 * 1000,
            maxBuffer: 1024 * 1024 * 5
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

// ─── MCP Client ──────────────────────────────────────────────────────────────

async function initMcpSdk() {
    try {
        const clientMod = await import('@modelcontextprotocol/sdk/client/index.js');
        const transportMod = await import('@modelcontextprotocol/sdk/client/stdio.js');
        Client = clientMod.Client;
        StdioClientTransport = transportMod.StdioClientTransport;
        mcpSdkAvailable = true;
        console.log('[MCP] SDK loaded successfully');
    } catch (err) {
        console.warn('[MCP] SDK not installed. MCP tools will be unavailable.');
        console.warn('[MCP] Install with: npm install @modelcontextprotocol/sdk');
        mcpSdkAvailable = false;
    }
}

async function connectMcpServer(name) {
    if (!mcpSdkAvailable) return false;
    const server = MCP_SERVERS[name];
    if (!server || server.ready) return server?.ready || false;

    try {
        console.log(`[MCP] Connecting to ${name} server...`);
        const transport = new StdioClientTransport({
            command: server.command,
            args: server.args
        });

        const client = new Client({ name: `local-agent-${name}`, version: '1.0.0' });
        await client.connect(transport);

        // List available tools
        const { tools } = await client.listTools();
        console.log(`[MCP] ${name} server connected. Tools:`, tools.map(t => t.name).join(', '));

        server.client = client;
        server.transport = transport;
        server.ready = true;
        return true;
    } catch (err) {
        console.error(`[MCP] Failed to connect ${name}:`, err.message);
        server.ready = false;
        return false;
    }
}

async function runMcpTool(serverName, toolName, args) {
    const server = MCP_SERVERS[serverName];

    // Lazy connect on first use
    if (!server?.ready) {
        const connected = await connectMcpServer(serverName);
        if (!connected) {
            return { output: `MCP server "${serverName}" is not available. Install it first.`, exitCode: 1 };
        }
    }

    try {
        console.log(`[MCP] Calling ${serverName}.${toolName}(${JSON.stringify(args)})`);
        const result = await server.client.callTool({ name: toolName, arguments: args || {} });

        // Extract text content from MCP response
        let output = '';
        if (result.content && Array.isArray(result.content)) {
            for (const item of result.content) {
                if (item.type === 'text') {
                    output += item.text + '\n';
                } else if (item.type === 'image') {
                    // Return base64 image data with prefix for frontend display
                    output += `[IMAGE:${item.mimeType}]${item.data}\n`;
                } else if (item.type === 'resource') {
                    output += JSON.stringify(item.resource) + '\n';
                }
            }
        } else {
            output = JSON.stringify(result);
        }

        return { output: output.trim() || '(no output)', exitCode: result.isError ? 1 : 0 };
    } catch (err) {
        console.error(`[MCP] Tool error ${serverName}.${toolName}:`, err.message);
        // Try to reconnect once
        server.ready = false;
        return { output: `MCP error: ${err.message}`, exitCode: 1 };
    }
}

// ─── MCP tool name mapping ───────────────────────────────────────────────────

function resolveMcpToolName(serverName, command, args) {
    // Map our internal command names to actual MCP tool names
    // These will be discovered dynamically, but we provide sensible defaults
    if (serverName === 'screenshot') {
        return { toolName: command || 'capture_screenshot', toolArgs: args || {} };
    }
    if (serverName === 'clipboard') {
        if (command === 'write_clipboard') {
            return { toolName: 'write_clipboard', toolArgs: { text: args?.text || '' } };
        }
        return { toolName: 'read_clipboard', toolArgs: {} };
    }
    return { toolName: command, toolArgs: args || {} };
}

// ─── Main poll loop ──────────────────────────────────────────────────────────

async function poll() {
    try {
        const cmd = await request('GET', `${VPS_URL}/api/local-exec/pending`);
        if (!cmd || !cmd._id) return; // nothing pending

        let output, exitCode;

        if (cmd.execType === 'mcp' && cmd.mcpServer) {
            // MCP tool execution
            console.log(`[LocalExecAgent] MCP: ${cmd.mcpServer}.${cmd.command}`);
            const { toolName, toolArgs } = resolveMcpToolName(cmd.mcpServer, cmd.command, cmd.mcpArgs);
            ({ output, exitCode } = await runMcpTool(cmd.mcpServer, toolName, toolArgs));
        } else {
            // Shell command execution (legacy)
            console.log(`[LocalExecAgent] Shell: ${cmd.command}`);
            ({ output, exitCode } = await runCommand(cmd.command, cmd.cwd));
        }

        console.log(`[LocalExecAgent] Done (exit ${exitCode}):`, output.substring(0, 200));

        await request('POST', `${VPS_URL}/api/local-exec/result/${cmd._id}`, {
            output,
            exitCode,
            status: exitCode === 0 ? 'done' : 'error'
        });
    } catch (err) {
        if (!err.message.includes('ECONNREFUSED') && !err.message.includes('timeout')) {
            console.error('[LocalExecAgent] Error:', err.message);
        }
    }
}

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
    console.log(`[LocalExecAgent] Started. Polling ${VPS_URL} every ${POLL_MS}ms`);
    console.log(`[LocalExecAgent] Default CWD: ${DEFAULT_CWD}`);

    // Try to load MCP SDK
    await initMcpSdk();

    if (mcpSdkAvailable) {
        console.log('[LocalExecAgent] MCP servers will connect on first use (lazy loading)');
    }

    setInterval(poll, POLL_MS);
    poll(); // first poll immediately
}

main();
