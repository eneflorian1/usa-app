const { Queue, Worker } = require('bullmq');
const { execFile } = require('child_process');
const redis = require('./redis');

// Main system queue
const mainQueue = new Queue('usa-main-queue', { connection: redis });

// Resolve claude binary path (NVM not in PM2 PATH)
let CLAUDE_BIN = '/root/.nvm/versions/node/v20.20.0/bin/claude';
try {
  const { execSync } = require('child_process');
  CLAUDE_BIN = execSync('which claude', {
    env: { ...process.env, PATH: '/root/.nvm/versions/node/v20.20.0/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || '') }
  }).toString().trim();
} catch { }

// Initialize repeatable jobs (crons)
async function setupCronJobs() {
  // Example: Memory consolidation every hour
  await mainQueue.add('memory-consolidation', {}, {
    repeat: {
      every: 60 * 60 * 1000, // 1 hour
    },
    jobId: 'memory-consolidation-repeat'
  });
  
  console.log('[Queue] Registered repeatable jobs');
}

const MemoryConsolidator = require('../agents/MemoryConsolidator');

// Worker setup
const worker = new Worker('usa-main-queue', async (job) => {
  console.log(`[Worker] Processing job: ${job.name} (ID: ${job.id})`);
  
  try {
    switch (job.name) {
      case 'memory-consolidation': {
        const agent = new MemoryConsolidator();
        return await agent.execute();
      }
      
      case 'async-task':
        return { success: true };

      case 'bounty-claude': {
        const { prompt, localPath } = job.data;
        // --dangerously-skip-permissions blocked on root
        const isRoot = process.getuid && process.getuid() === 0;
        const args = ['--print', prompt];
        if (job.data.skipDangerously && !isRoot) args.unshift('--dangerously-skip-permissions');

        return new Promise((resolve, reject) => {
          const child = execFile(CLAUDE_BIN, args, {
            cwd: localPath,
            timeout: 15 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, HOME: '/root' },
          }, (err, stdout, stderr) => {
            const output = (stdout || '') + (stderr || '');
            if (output.includes('SKIP:')) {
              const reason = output.split('SKIP:')[1]?.trim().substring(0, 200);
              return resolve({ skip: true, reason });
            }
            if (output.includes('DONE:')) {
              return resolve({ done: true, output });
            }
            if (err && err.killed) {
              return reject(new Error('Timeout: Claude took >15min'));
            }
            // Return output even on non-zero exit — caller checks for commits
            resolve({ done: false, output: output.substring(0, 2000), error: err?.message });
          });

          // Report progress lines via BullMQ job.updateProgress
          let buf = '';
          if (child.stdout) {
            child.stdout.on('data', chunk => {
              buf += chunk;
              const lines = buf.split('\n');
              buf = lines.pop() || '';
              const last = lines[lines.length - 1]?.trim();
              if (last) job.updateProgress({ line: last.substring(0, 120) }).catch(() => {});
            });
          }
        });
      }

      default:
        console.warn(`[Worker] Unknown job name: ${job.name}`);
        return { error: 'Unknown job' };
    }
  } catch (err) {
    console.error(`[Worker] Job ${job.id} failed:`, err.message);
    throw err;
  }
}, { 
  connection: redis,
  concurrency: 5 
});

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} failed:`, err.message);
});

module.exports = {
  mainQueue,
  setupCronJobs
};
