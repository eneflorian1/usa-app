module.exports = {
  apps: [
    {
      name: 'usaapp',
      cwd: '/root/usa-app/backend',
      script: 'server.js',
      env: { NODE_ENV: 'production', PORT: 5000 },
      max_memory_restart: '300M',
    },
    {
      name: 'usaapp-frontend',
      cwd: '/root/usa-app/frontend',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000 -H 0.0.0.0',
      env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '500M',
    },
    {
      name: 'nego-backend',
      cwd: '/root/NegoApp',
      script: 'server.js',
      env: { NODE_ENV: 'production', PORT: 3001 },
      max_memory_restart: '200M',
    },
    {
      name: 'nego-bridge',
      cwd: '/root/NegoApp',
      script: 'mcp-bridge-client.js',
      env: { BRIDGE_URL: 'ws://localhost:5000/ws/mcp-bridge' },
      max_memory_restart: '100M',
      restart_delay: 5000,
    },
    {
      name: 'book2',
      cwd: '/home/administrator/book2',
      script: 'node_modules/.bin/next',
      args: 'start -p 3002',
      env: { 
        NODE_ENV: 'production', 
        PORT: 3002,
        REDIS_URL: 'redis://localhost:6379',
        WEBSITE_URL: 'http://localhost:3004'
      },
      max_memory_restart: '300M',
    },
    {
      name: 'book-bridge',
      cwd: '/home/administrator/book2',
      script: 'node_modules/.bin/tsx',
      args: 'mcp-bridge/src/index.ts',
      env: { 
        MCP_WS_URL: 'ws://localhost:5000/ws/mcp-bridge',
        BOOK2_BASE_URL: 'http://localhost:3002',
      },
      max_memory_restart: '100M',
      restart_delay: 5000,
    },
    {
      name: 'eneflorin.com',
      cwd: '/root/eneflorin.com',
      script: 'node_modules/.bin/next',
      args: 'start -p 3004',
      env: { 
        NODE_ENV: 'production', 
        PORT: 3004
      },
      max_memory_restart: '400M',
    },
  ],
};
