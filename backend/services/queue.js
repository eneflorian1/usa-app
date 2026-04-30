const { Queue, Worker } = require('bullmq');
const redis = require('./redis');

// Main system queue
const mainQueue = new Queue('usa-main-queue', { connection: redis });

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
        // process general async tasks from orchestrator
        return { success: true };

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
