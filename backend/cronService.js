const { Cron } = require('croner');
const mongoose = require('mongoose');

/**
 * Cron Job Service — Inspired by OpenClaw src/cron/
 * Uses `croner` for scheduling, MongoDB for persistence.
 */

// In-memory map of active cron instances: { jobId: Cron instance }
const activeJobs = new Map();

// ===================== HELPERS =====================

function getModels() {
    const CronJob = mongoose.model('CronJob');
    const CronJobLog = mongoose.model('CronJobLog');
    return { CronJob, CronJobLog };
}

/**
 * Human-readable description of a cron expression
 */
function describeCron(expr) {
    const presets = {
        '* * * * *': 'Every minute',
        '*/5 * * * *': 'Every 5 minutes',
        '*/15 * * * *': 'Every 15 minutes',
        '*/30 * * * *': 'Every 30 minutes',
        '0 * * * *': 'Every hour',
        '0 */2 * * *': 'Every 2 hours',
        '0 */6 * * *': 'Every 6 hours',
        '0 */12 * * *': 'Every 12 hours',
        '0 0 * * *': 'Every day at midnight',
        '0 8 * * *': 'Every day at 8:00',
        '0 9 * * *': 'Every day at 9:00',
        '0 12 * * *': 'Every day at noon',
        '0 20 * * *': 'Every day at 20:00',
        '0 8 * * 1-5': 'Weekdays at 8:00',
        '0 0 * * 0': 'Every Sunday at midnight',
        '0 0 * * 1': 'Every Monday at midnight',
        '0 0 1 * *': 'First day of each month',
    };
    return presets[expr] || expr;
}

// ===================== ACTION EXECUTORS =====================

async function executeAction(job) {
    const { CronJobLog } = getModels();
    let output = '';
    let result = 'success';

    try {
        switch (job.actionType) {
            case 'notification': {
                const msg = job.actionPayload?.message || job.name;
                console.log(`[Cron] 🔔 NOTIFICATION: ${msg}`);
                output = `Notification: ${msg}`;
                break;
            }

            case 'task': {
                const PlannerTask = mongoose.model('PlannerTask');
                const task = await PlannerTask.create({
                    title: job.actionPayload?.title || `[Cron] ${job.name}`,
                    description: job.actionPayload?.description || `Auto-created by cron job: ${job.name}`,
                    dueDate: job.actionPayload?.dueDate ? new Date(job.actionPayload.dueDate) : null,
                    priority: job.actionPayload?.priority || 'medium',
                });
                console.log(`[Cron] ✅ Task created: ${task.title} (${task._id})`);
                output = `Task created: ${task.title}`;
                break;
            }

            case 'whatsapp': {
                try {
                    const whatsappService = require('./whatsappService');
                    const to = job.actionPayload?.to;
                    const message = job.actionPayload?.message;
                    if (to && message) {
                        const res = await whatsappService.sendWhatsAppByName(to, message);
                        output = `WhatsApp sent to ${to}: ${res.status || 'ok'}`;
                        console.log(`[Cron] 📱 WhatsApp sent to ${to}`);
                    } else {
                        throw new Error('Missing "to" or "message" in payload');
                    }
                } catch (err) {
                    result = 'error';
                    output = `WhatsApp error: ${err.message}`;
                    console.error(`[Cron] ❌ WhatsApp error:`, err.message);
                }
                break;
            }

            case 'http': {
                try {
                    const url = job.actionPayload?.url;
                    const method = (job.actionPayload?.method || 'GET').toUpperCase();
                    const headers = job.actionPayload?.headers || {};
                    const body = job.actionPayload?.body;

                    const fetchOpts = { method, headers };
                    if (body && method !== 'GET') {
                        fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
                        if (!headers['Content-Type']) {
                            fetchOpts.headers['Content-Type'] = 'application/json';
                        }
                    }

                    const res = await fetch(url, fetchOpts);
                    const text = await res.text();
                    output = `HTTP ${method} ${url} → ${res.status} (${text.substring(0, 200)})`;
                    if (!res.ok) result = 'error';
                    console.log(`[Cron] 🌐 HTTP ${method} ${url} → ${res.status}`);
                } catch (err) {
                    result = 'error';
                    output = `HTTP error: ${err.message}`;
                    console.error(`[Cron] ❌ HTTP error:`, err.message);
                }
                break;
            }

            default:
                output = `Unknown action type: ${job.actionType}`;
                result = 'error';
        }
    } catch (err) {
        result = 'error';
        output = `Execution error: ${err.message}`;
        console.error(`[Cron] ❌ Error executing job ${job.name}:`, err.message);
    }

    // Log execution
    try {
        await CronJobLog.create({
            cronJobId: job._id,
            jobName: job.name,
            actionType: job.actionType,
            result,
            output,
        });
    } catch (logErr) {
        console.error('[Cron] Failed to save log:', logErr.message);
    }

    // Update job stats
    try {
        const { CronJob } = getModels();
        const cronInstance = activeJobs.get(job._id.toString());
        const nextRun = cronInstance ? cronInstance.nextRun() : null;
        await CronJob.findByIdAndUpdate(job._id, {
            lastRun: new Date(),
            nextRun: nextRun,
            $inc: { runCount: 1 },
        });
    } catch (updateErr) {
        console.error('[Cron] Failed to update job stats:', updateErr.message);
    }

    return { result, output };
}

// ===================== CORE FUNCTIONS =====================

/**
 * Schedule a cron instance in memory for a given job document
 */
function scheduleJob(jobDoc) {
    const id = jobDoc._id.toString();

    // Stop existing instance if any
    if (activeJobs.has(id)) {
        activeJobs.get(id).stop();
        activeJobs.delete(id);
    }

    if (jobDoc.status !== 'active') return;

    try {
        const job = new Cron(jobDoc.cronExpression, { name: jobDoc.name }, async () => {
            await executeAction(jobDoc);
        });

        activeJobs.set(id, job);
        console.log(`[Cron] ⏰ Scheduled: "${jobDoc.name}" (${describeCron(jobDoc.cronExpression)}) → next: ${job.nextRun()}`);
        return job;
    } catch (err) {
        console.error(`[Cron] ❌ Failed to schedule "${jobDoc.name}":`, err.message);
        return null;
    }
}

/**
 * Create a new cron job
 */
async function createCronJob(name, cronExpression, actionType, actionPayload = {}) {
    const { CronJob } = getModels();

    // Validate cron expression by trying to create a temporary instance
    try {
        const test = new Cron(cronExpression);
        test.stop();
    } catch (err) {
        throw new Error(`Invalid cron expression "${cronExpression}": ${err.message}`);
    }

    const jobDoc = await CronJob.create({
        name,
        cronExpression,
        actionType,
        actionPayload,
        status: 'active',
        nextRun: new Cron(cronExpression).nextRun(),
    });

    scheduleJob(jobDoc);
    console.log(`[Cron] ✅ Created job: "${name}" (${cronExpression})`);
    return jobDoc;
}

/**
 * Pause a cron job
 */
async function pauseCronJob(id) {
    const { CronJob } = getModels();
    const jobDoc = await CronJob.findByIdAndUpdate(id, { status: 'paused', nextRun: null }, { new: true });
    if (!jobDoc) throw new Error('Cron job not found');

    if (activeJobs.has(id)) {
        activeJobs.get(id).stop();
        activeJobs.delete(id);
    }

    console.log(`[Cron] ⏸️ Paused: "${jobDoc.name}"`);
    return jobDoc;
}

/**
 * Resume a paused cron job
 */
async function resumeCronJob(id) {
    const { CronJob } = getModels();
    const jobDoc = await CronJob.findById(id);
    if (!jobDoc) throw new Error('Cron job not found');

    jobDoc.status = 'active';
    const tempCron = new Cron(jobDoc.cronExpression);
    jobDoc.nextRun = tempCron.nextRun();
    tempCron.stop();
    await jobDoc.save();

    scheduleJob(jobDoc);
    console.log(`[Cron] ▶️ Resumed: "${jobDoc.name}"`);
    return jobDoc;
}

/**
 * Delete a cron job
 */
async function deleteCronJob(id) {
    const { CronJob, CronJobLog } = getModels();

    if (activeJobs.has(id)) {
        activeJobs.get(id).stop();
        activeJobs.delete(id);
    }

    const jobDoc = await CronJob.findByIdAndDelete(id);
    if (!jobDoc) throw new Error('Cron job not found');

    // Cleanup logs
    await CronJobLog.deleteMany({ cronJobId: id });
    console.log(`[Cron] 🗑️ Deleted: "${jobDoc.name}"`);
    return jobDoc;
}

/**
 * List all cron jobs with status info
 */
async function listCronJobs() {
    const { CronJob } = getModels();
    const jobs = await CronJob.find().sort({ createdAt: -1 });

    return jobs.map(job => {
        const id = job._id.toString();
        const cronInstance = activeJobs.get(id);
        return {
            ...job.toObject(),
            isRunning: activeJobs.has(id),
            nextRunLive: cronInstance ? cronInstance.nextRun() : null,
            humanSchedule: describeCron(job.cronExpression),
        };
    });
}

/**
 * Get logs for a specific job
 */
async function getJobLogs(jobId, limit = 20) {
    const { CronJobLog } = getModels();
    return CronJobLog.find({ cronJobId: jobId }).sort({ executedAt: -1 }).limit(limit);
}

/**
 * Get recent logs across all jobs
 */
async function getRecentLogs(limit = 30) {
    const { CronJobLog } = getModels();
    return CronJobLog.find().sort({ executedAt: -1 }).limit(limit);
}

/**
 * Restore all active jobs from DB (called on server startup)
 */
async function restoreJobs() {
    const { CronJob } = getModels();
    const jobs = await CronJob.find({ status: 'active' });

    console.log(`[Cron] 🔄 Restoring ${jobs.length} active cron jobs...`);
    let restored = 0;

    for (const job of jobs) {
        const instance = scheduleJob(job);
        if (instance) {
            // Update nextRun
            await CronJob.findByIdAndUpdate(job._id, { nextRun: instance.nextRun() });
            restored++;
        }
    }

    console.log(`[Cron] ✅ Restored ${restored}/${jobs.length} jobs`);
    return { restored, total: jobs.length };
}

/**
 * Execute a cron action from the orchestrator (voice/chat)
 */
async function executeCronAction(data) {
    const action = data.action;

    switch (action) {
        case 'create': {
            const job = await createCronJob(
                data.name || 'Unnamed Job',
                data.cron || '0 * * * *',
                data.type || 'notification',
                data.payload || { message: data.name || 'Cron notification' }
            );
            return { success: true, message: `Cron job "${job.name}" created (${describeCron(job.cronExpression)})`, job };
        }

        case 'list': {
            const jobs = await listCronJobs();
            if (jobs.length === 0) return { success: true, message: 'No cron jobs configured.', jobs: [] };
            const summary = jobs.map(j =>
                `• "${j.name}" — ${j.humanSchedule} — ${j.status} — runs: ${j.runCount}`
            ).join('\n');
            return { success: true, message: `${jobs.length} cron jobs:\n${summary}`, jobs };
        }

        case 'pause': {
            if (!data.id) return { success: false, message: 'Job ID required to pause' };
            const job = await pauseCronJob(data.id);
            return { success: true, message: `Cron job "${job.name}" paused`, job };
        }

        case 'resume': {
            if (!data.id) return { success: false, message: 'Job ID required to resume' };
            const job = await resumeCronJob(data.id);
            return { success: true, message: `Cron job "${job.name}" resumed`, job };
        }

        case 'delete': {
            if (!data.id) return { success: false, message: 'Job ID required to delete' };
            const job = await deleteCronJob(data.id);
            return { success: true, message: `Cron job "${job.name}" deleted`, job };
        }

        default:
            return { success: false, message: `Unknown cron action: ${action}` };
    }
}

module.exports = {
    createCronJob,
    pauseCronJob,
    resumeCronJob,
    deleteCronJob,
    listCronJobs,
    getJobLogs,
    getRecentLogs,
    restoreJobs,
    executeCronAction,
    describeCron,
};
