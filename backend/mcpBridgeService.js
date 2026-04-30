/**
 * MCP Bridge WebSocket Handler — Multi-Bridge Architecture
 * 
 * Supports multiple named bridges simultaneously (e.g. book2, negoapp).
 * Each bridge registers with an agent name and declares its available tools.
 * Tool calls can target a specific agent or auto-route by tool name.
 * 
 * Usage in server.js:
 *   const { setupMcpBridge } = require('./mcpBridgeService');
 *   // After server.listen():
 *   setupMcpBridge(server);
 */

const { WebSocketServer } = require('ws');
const crypto = require('crypto');

// Active bridges: Map<agentName, { ws, tools }>
const activeBridges = new Map();
// Pending tool call responses: Map<callId, { resolve, reject, agent }>
const pendingCalls = new Map();

function setupMcpBridge(httpServer) {
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/ws/mcp-bridge'
  });

  console.log('[MCP Bridge] WebSocket endpoint ready at /ws/mcp-bridge');

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[MCP Bridge] 🔌 New connection from ${ip}`);

    ws.bridgeAgent = null;
    ws.bridgeTools = [];

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        console.error('[MCP Bridge] Invalid JSON from bridge');
        return;
      }

      // Registration message
      if (msg.type === 'register') {
        const agentName = msg.agent || 'unnamed';
        
        // If an old bridge with same name exists, clean it up
        const existing = activeBridges.get(agentName);
        if (existing && existing.ws !== ws) {
          console.log(`[MCP Bridge] Replacing old bridge for agent: ${agentName}`);
          try { existing.ws.close(); } catch {}
        }

        ws.bridgeAgent = agentName;
        ws.bridgeTools = msg.tools || [];
        activeBridges.set(agentName, { ws, tools: ws.bridgeTools });

        console.log(`[MCP Bridge] ✅ Bridge registered: "${agentName}" with ${ws.bridgeTools.length} tools`);
        console.log(`[MCP Bridge] Tools: ${ws.bridgeTools.map(t => t.name).join(', ')}`);
        console.log(`[MCP Bridge] Active bridges: ${[...activeBridges.keys()].join(', ')}`);
        return;
      }

      // Heartbeat
      if (msg.type === 'heartbeat' || msg.type === 'pong') {
        return;
      }

      // Tool call response (has id + result/error)
      if (msg.id) {
        const pending = pendingCalls.get(msg.id);
        if (pending) {
          pendingCalls.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }
    });

    ws.on('close', () => {
      const agentName = ws.bridgeAgent || 'unknown';
      console.log(`[MCP Bridge] 🔌 Bridge disconnected: "${agentName}"`);
      
      // Only remove if this ws is still the active one for this agent
      const current = activeBridges.get(agentName);
      if (current && current.ws === ws) {
        activeBridges.delete(agentName);
      }

      // Reject pending calls from this bridge
      for (const [id, pending] of pendingCalls) {
        if (pending.agent === agentName) {
          pending.reject(new Error(`Bridge "${agentName}" disconnected`));
          pendingCalls.delete(id);
        }
      }
    });

    ws.on('error', (err) => {
      console.error(`[MCP Bridge] WebSocket error (${ws.bridgeAgent || 'unknown'}):`, err.message);
    });

    // Keep-alive pings
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      } else {
        clearInterval(pingInterval);
      }
    }, 20000);

    ws.on('close', () => clearInterval(pingInterval));
  });
}

/**
 * Call a tool on a connected MCP bridge.
 * 
 * @param {string} toolName - Name of the tool to call
 * @param {object} params - Parameters for the tool
 * @param {object} options - { agent?: string, timeoutMs?: number }
 *   - agent: Target a specific bridge by name. If omitted, auto-finds by tool name.
 *   - timeoutMs: Timeout in ms (default 30000)
 */
async function callMcpTool(toolName, params = {}, options = {}) {
  const { agent, timeoutMs = 30000 } = options;

  let targetBridge = null;
  let targetAgent = null;

  if (agent) {
    // Targeted dispatch
    const bridge = activeBridges.get(agent);
    if (!bridge || bridge.ws.readyState !== 1) {
      throw new Error(`Bridge "${agent}" not connected.`);
    }
    targetBridge = bridge;
    targetAgent = agent;
  } else {
    // Auto-find: scan all bridges for this tool
    for (const [name, bridge] of activeBridges) {
      if (bridge.ws.readyState !== 1) continue;
      const hasTool = bridge.tools.some(t => t.name === toolName);
      if (hasTool) {
        targetBridge = bridge;
        targetAgent = name;
        break;
      }
    }
    if (!targetBridge) {
      const connected = [...activeBridges.keys()].join(', ') || 'none';
      throw new Error(`No bridge has tool "${toolName}". Connected bridges: ${connected}`);
    }
  }

  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error(`Tool "${toolName}" on bridge "${targetAgent}" timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    pendingCalls.set(id, {
      agent: targetAgent,
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      }
    });

    targetBridge.ws.send(JSON.stringify({ id, tool: toolName, params }));
    console.log(`[MCP Bridge] 📤 ${targetAgent}::${toolName} (id: ${id})`);
  });
}

/**
 * Check if any bridge is connected
 */
function isBridgeConnected(agent) {
  if (agent) {
    const bridge = activeBridges.get(agent);
    return bridge !== null && bridge !== undefined && bridge.ws.readyState === 1;
  }
  return activeBridges.size > 0;
}

/**
 * Get list of available tools from a specific bridge or all bridges
 */
function getBridgeTools(agent) {
  if (agent) {
    const bridge = activeBridges.get(agent);
    return bridge ? bridge.tools : [];
  }
  // All tools from all bridges
  const allTools = [];
  for (const [name, bridge] of activeBridges) {
    for (const tool of bridge.tools) {
      allTools.push({ ...tool, agent: name });
    }
  }
  return allTools;
}

/**
 * Get status of all connected bridges
 */
function getBridgeStatus() {
  const bridges = {};
  for (const [name, bridge] of activeBridges) {
    bridges[name] = {
      connected: bridge.ws.readyState === 1,
      toolCount: bridge.tools.length,
      tools: bridge.tools.map(t => t.name),
    };
  }
  return bridges;
}

module.exports = { setupMcpBridge, callMcpTool, isBridgeConnected, getBridgeTools, getBridgeStatus };
