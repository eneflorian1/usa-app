#!/usr/bin/env node
/**
 * Local Exec Agent — runs on user's PC
 * Executes shell commands + native MCP tools (screenshot, clipboard, filesystem, sysinfo)
 *
 * Usage:  node local-exec-agent.js
 *
 * Env vars:
 *   VPS_URL   - VPS URL (default: http://155.117.45.192:5000)
 *   POLL_MS   - polling interval ms (default: 3000)
 *   EXEC_CWD  - default working directory (default: $HOME)
 */

const { execFile } = require('child_process');
const https = require('https');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

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
            timeout: 15000
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

function runShellCommand(command, cwd) {
    return new Promise((resolve) => {
        const shell = process.platform === 'win32' ? 'cmd' : 'bash';
        const shellFlag = process.platform === 'win32' ? '/c' : '-c';
        const workDir = cwd && cwd.trim() ? cwd.trim() : DEFAULT_CWD;

        execFile(shell, [shellFlag, command], {
            cwd: workDir,
            timeout: 20 * 60 * 1000, // 20 min for long claude CLI sessions
            maxBuffer: 1024 * 1024 * 5
        }, (error, stdout, stderr) => {
            const output = [stdout, stderr].filter(Boolean).join('\n').trim();
            resolve({
                output: output || (error ? error.message : '(no output)'),
                exitCode: error ? (error.code ?? 1) : 0
            });
        });
    });
}

// ─── Native MCP Tools ────────────────────────────────────────────────────────
// Built-in tools that don't need external MCP servers

const mcpTools = {

    // ── Screenshot ──────────────────────────────────────────────────────────
    screenshot: {
        async take_screenshot(args) {
            const tmpFile = path.join(os.tmpdir(), `screenshot_${Date.now()}.png`);
            try {
                if (process.platform === 'win32') {
                    // PowerShell screenshot on Windows
                    const ps = `
                        Add-Type -AssemblyName System.Windows.Forms
                        Add-Type -AssemblyName System.Drawing
                        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                        $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
                        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
                        $bitmap.Save('${tmpFile.replace(/\\/g, '\\\\')}')
                        $graphics.Dispose()
                        $bitmap.Dispose()
                    `.trim();
                    await runPowerShell(ps);
                } else {
                    // Linux/Mac
                    await runShellCommand(`screencapture -x "${tmpFile}" 2>/dev/null || import -window root "${tmpFile}"`, '');
                }

                if (fs.existsSync(tmpFile)) {
                    const data = fs.readFileSync(tmpFile).toString('base64');
                    fs.unlinkSync(tmpFile);
                    return { output: `[IMAGE:image/png]${data}`, exitCode: 0 };
                }
                return { output: 'Screenshot failed: file not created', exitCode: 1 };
            } catch (err) {
                if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
                return { output: `Screenshot error: ${err.message}`, exitCode: 1 };
            }
        }
    },

    // ── Clipboard ───────────────────────────────────────────────────────────
    clipboard: {
        async read_clipboard() {
            try {
                if (process.platform === 'win32') {
                    const result = await runPowerShell('Get-Clipboard');
                    return { output: result || '(clipboard empty)', exitCode: 0 };
                } else {
                    const { output } = await runShellCommand('pbpaste 2>/dev/null || xclip -selection clipboard -o 2>/dev/null', '');
                    return { output: output || '(clipboard empty)', exitCode: 0 };
                }
            } catch (err) {
                return { output: `Clipboard read error: ${err.message}`, exitCode: 1 };
            }
        },
        async write_clipboard(args) {
            try {
                const text = args?.text || '';
                if (process.platform === 'win32') {
                    await runPowerShell(`Set-Clipboard -Value '${text.replace(/'/g, "''")}'`);
                } else {
                    await runShellCommand(`echo "${text}" | pbcopy 2>/dev/null || echo "${text}" | xclip -selection clipboard`, '');
                }
                return { output: `Copied to clipboard: "${text.substring(0, 100)}"`, exitCode: 0 };
            } catch (err) {
                return { output: `Clipboard write error: ${err.message}`, exitCode: 1 };
            }
        }
    },

    // ── Filesystem ──────────────────────────────────────────────────────────
    filesystem: {
        async list_directory(args) {
            try {
                const dirPath = args?.path || DEFAULT_CWD;
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const result = entries.map(e => {
                    const stat = fs.statSync(path.join(dirPath, e.name));
                    return `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}${e.isFile() ? ` (${formatSize(stat.size)})` : ''}`;
                }).join('\n');
                return { output: result || '(empty directory)', exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        },
        async read_file(args) {
            try {
                const filePath = args?.path;
                if (!filePath) return { output: 'Error: path is required', exitCode: 1 };
                const stat = fs.statSync(filePath);
                if (stat.size > 1024 * 1024) return { output: `File too large (${formatSize(stat.size)}). Max 1MB.`, exitCode: 1 };
                const content = fs.readFileSync(filePath, 'utf8');
                return { output: content, exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        },
        async write_file(args) {
            try {
                const filePath = args?.path;
                const content = args?.content;
                if (!filePath || content === undefined) return { output: 'Error: path and content are required', exitCode: 1 };
                fs.writeFileSync(filePath, content, 'utf8');
                return { output: `Written ${content.length} chars to ${filePath}`, exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        },
        async move_file(args) {
            try {
                if (!args?.source || !args?.destination) return { output: 'Error: source and destination required', exitCode: 1 };
                fs.renameSync(args.source, args.destination);
                return { output: `Moved: ${args.source} → ${args.destination}`, exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        },
        async copy_file(args) {
            try {
                if (!args?.source || !args?.destination) return { output: 'Error: source and destination required', exitCode: 1 };
                fs.copyFileSync(args.source, args.destination);
                return { output: `Copied: ${args.source} → ${args.destination}`, exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        },
        async delete_file(args) {
            try {
                if (!args?.path) return { output: 'Error: path is required', exitCode: 1 };
                const stat = fs.statSync(args.path);
                if (stat.isDirectory()) {
                    fs.rmSync(args.path, { recursive: true });
                } else {
                    fs.unlinkSync(args.path);
                }
                return { output: `Deleted: ${args.path}`, exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        },
        async search_files(args) {
            try {
                const dir = args?.path || DEFAULT_CWD;
                const pattern = args?.pattern || '*';
                const maxDepth = args?.maxDepth || 3;
                const results = [];
                searchRecursive(dir, new RegExp(pattern.replace(/\*/g, '.*'), 'i'), 0, maxDepth, results);
                return { output: results.length ? results.join('\n') : 'No files found', exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        },
        async file_info(args) {
            try {
                if (!args?.path) return { output: 'Error: path is required', exitCode: 1 };
                const stat = fs.statSync(args.path);
                const info = [
                    `Path: ${args.path}`,
                    `Type: ${stat.isDirectory() ? 'Directory' : 'File'}`,
                    `Size: ${formatSize(stat.size)}`,
                    `Created: ${stat.birthtime.toISOString()}`,
                    `Modified: ${stat.mtime.toISOString()}`,
                    `Permissions: ${stat.mode.toString(8)}`
                ].join('\n');
                return { output: info, exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        }
    },

    // ── System Info ─────────────────────────────────────────────────────────
    sysinfo: {
        async system_info() {
            const cpus = os.cpus();
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const info = [
                `Hostname: ${os.hostname()}`,
                `Platform: ${os.platform()} ${os.arch()}`,
                `OS: ${os.type()} ${os.release()}`,
                `CPU: ${cpus[0]?.model || 'Unknown'} (${cpus.length} cores)`,
                `RAM: ${formatSize(totalMem - freeMem)} used / ${formatSize(totalMem)} total (${Math.round((1 - freeMem / totalMem) * 100)}%)`,
                `Uptime: ${formatUptime(os.uptime())}`,
                `User: ${os.userInfo().username}`,
                `Home: ${os.homedir()}`
            ].join('\n');
            return { output: info, exitCode: 0 };
        },
        async disk_usage() {
            if (process.platform === 'win32') {
                const { output } = await runShellCommand('wmic logicaldisk get size,freespace,caption /format:list', '');
                return { output, exitCode: 0 };
            }
            const { output } = await runShellCommand('df -h', '');
            return { output, exitCode: 0 };
        },
        async running_processes() {
            if (process.platform === 'win32') {
                const { output } = await runShellCommand('tasklist /FO CSV /NH | sort /R /+2', '');
                const lines = output.split('\n').slice(0, 30);
                return { output: `Top 30 processes:\n${lines.join('\n')}`, exitCode: 0 };
            }
            const { output } = await runShellCommand('ps aux --sort=-%mem | head -30', '');
            return { output, exitCode: 0 };
        },
        async network_info() {
            const interfaces = os.networkInterfaces();
            const lines = [];
            for (const [name, addrs] of Object.entries(interfaces)) {
                for (const addr of addrs) {
                    if (addr.family === 'IPv4') {
                        lines.push(`${name}: ${addr.address}${addr.internal ? ' (internal)' : ''}`);
                    }
                }
            }
            return { output: lines.join('\n') || 'No network interfaces', exitCode: 0 };
        }
    },

    // ── App Launcher ────────────────────────────────────────────────────────
    launcher: {
        async open_app(args) {
            const app = args?.app || args?.path || '';
            if (!app) return { output: 'Error: app name or path is required', exitCode: 1 };
            try {
                if (process.platform === 'win32') {
                    await runShellCommand(`start "" "${app}"`, '');
                } else if (process.platform === 'darwin') {
                    await runShellCommand(`open "${app}"`, '');
                } else {
                    await runShellCommand(`xdg-open "${app}"`, '');
                }
                return { output: `Opened: ${app}`, exitCode: 0 };
            } catch (err) {
                return { output: `Error opening ${app}: ${err.message}`, exitCode: 1 };
            }
        },
        async open_url(args) {
            const url = args?.url || '';
            if (!url) return { output: 'Error: url is required', exitCode: 1 };
            try {
                if (process.platform === 'win32') {
                    await runShellCommand(`start "" "${url}"`, '');
                } else if (process.platform === 'darwin') {
                    await runShellCommand(`open "${url}"`, '');
                } else {
                    await runShellCommand(`xdg-open "${url}"`, '');
                }
                return { output: `Opened URL: ${url}`, exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        },
        async open_folder(args) {
            const folder = args?.path || DEFAULT_CWD;
            try {
                if (process.platform === 'win32') {
                    await runShellCommand(`explorer "${folder}"`, '');
                } else if (process.platform === 'darwin') {
                    await runShellCommand(`open "${folder}"`, '');
                } else {
                    await runShellCommand(`xdg-open "${folder}"`, '');
                }
                return { output: `Opened folder: ${folder}`, exitCode: 0 };
            } catch (err) {
                return { output: `Error: ${err.message}`, exitCode: 1 };
            }
        }
    }
};

// ─── Helper functions ────────────────────────────────────────────────────────

function runPowerShell(script) {
    return new Promise((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
            timeout: 30000,
            maxBuffer: 1024 * 1024 * 5
        }, (error, stdout, stderr) => {
            if (error) reject(new Error(stderr || error.message));
            else resolve(stdout.trim());
        });
    });
}

function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
}

function searchRecursive(dir, regex, depth, maxDepth, results) {
    if (depth > maxDepth || results.length > 100) return;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (regex.test(entry.name)) results.push(fullPath);
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                searchRecursive(fullPath, regex, depth + 1, maxDepth, results);
            }
        }
    } catch { }
}

// ─── MCP Tool dispatcher ────────────────────────────────────────────────────

async function runMcpTool(serverName, toolName, args) {
    const server = mcpTools[serverName];
    if (!server) {
        return { output: `Unknown MCP server: "${serverName}". Available: ${Object.keys(mcpTools).join(', ')}`, exitCode: 1 };
    }

    const tool = server[toolName];
    if (!tool) {
        const available = Object.keys(server).join(', ');
        return { output: `Unknown tool "${toolName}" in ${serverName}. Available: ${available}`, exitCode: 1 };
    }

    try {
        return await tool(args || {});
    } catch (err) {
        return { output: `MCP error (${serverName}.${toolName}): ${err.message}`, exitCode: 1 };
    }
}

// ─── Main poll loop ──────────────────────────────────────────────────────────

async function poll() {
    try {
        const cmd = await request('GET', `${VPS_URL}/api/local-exec/pending`);
        if (!cmd || !cmd._id) return;

        let output, exitCode;

        if (cmd.execType === 'mcp' && cmd.mcpServer) {
            console.log(`[Agent] MCP: ${cmd.mcpServer}.${cmd.command}`);
            ({ output, exitCode } = await runMcpTool(cmd.mcpServer, cmd.command, cmd.mcpArgs));
        } else {
            console.log(`[Agent] Shell: ${cmd.command}`);
            ({ output, exitCode } = await runShellCommand(cmd.command, cmd.cwd));
        }

        console.log(`[Agent] Done (exit ${exitCode}):`, output.substring(0, 200));

        await request('POST', `${VPS_URL}/api/local-exec/result/${cmd._id}`, {
            output,
            exitCode,
            status: exitCode === 0 ? 'done' : 'error'
        });
    } catch (err) {
        if (!err.message.includes('ECONNREFUSED') && !err.message.includes('timeout')) {
            console.error('[Agent] Error:', err.message);
        }
    }
}

// ─── Start ───────────────────────────────────────────────────────────────────

console.log(`[Agent] Started. Polling ${VPS_URL} every ${POLL_MS}ms`);
console.log(`[Agent] Default CWD: ${DEFAULT_CWD}`);
console.log(`[Agent] MCP tools: ${Object.entries(mcpTools).map(([k, v]) => `${k}(${Object.keys(v).join(',')})`).join(' | ')}`);

setInterval(poll, POLL_MS);
poll();
