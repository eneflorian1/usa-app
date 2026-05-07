const router = require('express').Router();
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// List all PM2 processes
router.get('/', async (req, res) => {
    try {
        const { stdout } = await execAsync('pm2 jlist');
        const processes = JSON.parse(stdout);
        res.json(processes.map(p => ({
            id: p.pm_id,
            name: p.name,
            status: p.pm2_env.status,
            pid: p.pid,
            uptime: p.pm2_env.pm_uptime,
            restarts: p.pm2_env.restart_time,
            memory: p.monit?.memory || 0,
            cpu: p.monit?.cpu || 0,
            cwd: p.pm2_env.cwd,
            script: p.pm2_env.pm_exec_path,
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start a stopped process
router.post('/:name/start', async (req, res) => {
    try {
        await execAsync(`pm2 start ${req.params.name}`);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stop a process
router.post('/:name/stop', async (req, res) => {
    try {
        await execAsync(`pm2 stop ${req.params.name}`);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restart a process
router.post('/:name/restart', async (req, res) => {
    try {
        await execAsync(`pm2 restart ${req.params.name}`);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get logs for a process (last N lines)
router.get('/:name/logs', async (req, res) => {
    const lines = parseInt(req.query.lines) || 30;
    try {
        const { stdout } = await execAsync(`pm2 logs ${req.params.name} --lines ${lines} --nostream 2>&1 || true`);
        res.json({ logs: stdout });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
