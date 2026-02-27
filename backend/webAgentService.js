const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

/**
 * Web Action Agent (LAM) Service
 * Uses Playwright for browser automation + Gemini Vision for screenshot-based decision making.
 * General-purpose: can handle ANY web task (ordering, booking, contacting, form filling, data extraction).
 */

// ===================== CONFIG =====================

const MAX_STEPS = 25;
const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 800;
const STEP_TIMEOUT_MS = 15000;
const THUMBNAIL_WIDTH = 640;

// Active browser sessions (in-memory)
const activeSessions = new Map();

// ===================== GEMINI VISION =====================

async function getGeminiVisionModel() {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) {
        throw new Error('Gemini API key not configured.');
    }
    const genAI = new GoogleGenerativeAI(setting.value);
    return genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
}

const VISION_SYSTEM_PROMPT = `You are a Web Action Agent (LAM). You control a web browser to complete tasks for the user.

You receive a screenshot of the current browser page and must decide the NEXT ACTION to take.

AVAILABLE ACTIONS (respond with EXACTLY ONE JSON object):

1. {"action":"navigate","url":"https://..."}
   - Go to a URL

2. {"action":"click","x":500,"y":300}
   - Click at specific coordinates on the page
   - Use coordinates from the screenshot (1280x800 viewport)

3. {"action":"type","text":"hello world"}
   - Type text into the currently focused element
   - First click on the input field, then type

4. {"action":"press","key":"Enter"}
   - Press a keyboard key (Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp)

5. {"action":"scroll","direction":"down","amount":300}
   - Scroll the page (direction: "up" or "down", amount in pixels)

6. {"action":"wait","seconds":2}
   - Wait for page to load or content to appear

7. {"action":"done","result":"Task completed successfully. [describe what was accomplished]"}
   - Task is COMPLETE — describe what you achieved

8. {"action":"fail","reason":"Cannot proceed because..."}
   - Task CANNOT be completed — explain why

RULES:
- Respond with ONLY a JSON object, no other text
- Include a "reasoning" field explaining your thought process
- Be precise with click coordinates — click on the CENTER of buttons/links
- If you see a cookie banner or popup, dismiss it first
- If you need to log in and don't have credentials, report "fail"
- If a page is loading, use "wait"
- If you're stuck or going in circles, report "fail"
- Always work towards completing the task efficiently
- You can handle ANY website and ANY task: ordering, booking, searching, contacting, filling forms, extracting data, etc.
- Adapt to whatever UI you see — you are a general-purpose web agent`;

async function analyzeScreenshot(base64Screenshot, task, stepHistory, currentUrl) {
    const model = await getGeminiVisionModel();

    const historyText = stepHistory.length > 0
        ? `\n\nSTEPS SO FAR:\n${stepHistory.map((s, i) => `${i + 1}. ${s.action}${s.details ? ': ' + s.details : ''} — ${s.reasoning || ''}`).join('\n')}`
        : '';

    const prompt = `TASK: ${task}
CURRENT URL: ${currentUrl}
STEP ${stepHistory.length + 1} of max ${MAX_STEPS}${historyText}

Look at the screenshot and decide the NEXT ACTION to take to complete the task.
Respond with a single JSON object.`;

    const result = await model.generateContent([
        { text: VISION_SYSTEM_PROMPT + '\n\n' + prompt },
        {
            inlineData: {
                mimeType: 'image/png',
                data: base64Screenshot
            }
        }
    ]);

    const responseText = result.response.text().trim();
    console.log(`[WebAgent] Vision response:`, responseText.substring(0, 200));

    // Extract JSON from response (may be wrapped in markdown code block)
    let jsonStr = responseText;
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
    }

    try {
        return JSON.parse(jsonStr);
    } catch (err) {
        console.error('[WebAgent] Failed to parse vision response:', responseText);
        return { action: 'fail', reason: 'Failed to parse AI vision response' };
    }
}

// ===================== BROWSER ACTIONS =====================

async function executeAction(page, action) {
    const type = action.action;

    switch (type) {
        case 'navigate':
            await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });
            return `Navigated to ${action.url}`;

        case 'click':
            await page.mouse.click(action.x, action.y);
            await page.waitForTimeout(1000); // small wait for UI reaction
            return `Clicked at (${action.x}, ${action.y})`;

        case 'type':
            await page.keyboard.type(action.text, { delay: 50 });
            return `Typed "${action.text}"`;

        case 'press':
            await page.keyboard.press(action.key);
            await page.waitForTimeout(500);
            return `Pressed ${action.key}`;

        case 'scroll':
            const delta = action.direction === 'up' ? -(action.amount || 300) : (action.amount || 300);
            await page.mouse.wheel(0, delta);
            await page.waitForTimeout(800);
            return `Scrolled ${action.direction} by ${Math.abs(delta)}px`;

        case 'wait':
            const seconds = Math.min(action.seconds || 2, 10);
            await page.waitForTimeout(seconds * 1000);
            return `Waited ${seconds}s`;

        case 'done':
            return action.result || 'Task completed';

        case 'fail':
            return action.reason || 'Task failed';

        default:
            return `Unknown action: ${type}`;
    }
}

// ===================== MAIN TASK RUNNER =====================

async function runTask(task, options = {}) {
    const WebAgentSession = mongoose.model('WebAgentSession');
    const startUrl = options.startUrl || '';

    // Reuse existing session if provided (from API route), or create new one
    let session;
    if (options.existingSessionId) {
        session = await WebAgentSession.findById(options.existingSessionId);
        if (!session) {
            throw new Error('Session not found: ' + options.existingSessionId);
        }
    } else {
        session = await WebAgentSession.create({
            task,
            status: 'running',
            startUrl,
            steps: []
        });
    }

    console.log(`[WebAgent] Starting task: "${task}" (session: ${session._id})`);

    let browser = null;
    let page = null;

    try {
        // Launch browser
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const context = await browser.newContext({
            viewport: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        page = await context.newPage();

        // Store active session
        activeSessions.set(session._id.toString(), { browser, page, session });

        // Navigate to start URL if provided
        if (startUrl) {
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });
            console.log(`[WebAgent] Navigated to: ${startUrl}`);
        } else {
            // If no start URL, navigate to Google as default
            await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });
        }

        // Action loop
        const stepHistory = [];

        for (let step = 0; step < MAX_STEPS; step++) {
            // Take screenshot
            const screenshotBuffer = await page.screenshot({ type: 'png' });
            const base64Screenshot = screenshotBuffer.toString('base64');

            // Compress for storage (just store a smaller version reference)
            const thumbnailBase64 = base64Screenshot; // In production, resize to save space

            // Get current URL
            const currentUrl = page.url();

            // Ask Gemini what to do next
            const decision = await analyzeScreenshot(base64Screenshot, task, stepHistory, currentUrl);
            console.log(`[WebAgent] Step ${step + 1}: ${decision.action} — ${decision.reasoning || ''}`);

            // Build step record
            const stepRecord = {
                stepNumber: step + 1,
                action: decision.action,
                details: '',
                reasoning: decision.reasoning || '',
                screenshot: thumbnailBase64.substring(0, 500) + '...', // store just a preview hash
                timestamp: new Date()
            };

            // Execute the action
            if (decision.action === 'done') {
                stepRecord.details = decision.result || 'Task completed';
                session.steps.push(stepRecord);
                session.status = 'completed';
                session.finalResult = decision.result || 'Task completed successfully';
                session.completedAt = new Date();
                await session.save();

                console.log(`[WebAgent] ✅ Task completed: ${decision.result}`);
                break;
            }

            if (decision.action === 'fail') {
                stepRecord.details = decision.reason || 'Task failed';
                session.steps.push(stepRecord);
                session.status = 'failed';
                session.error = decision.reason || 'Task could not be completed';
                session.completedAt = new Date();
                await session.save();

                console.log(`[WebAgent] ❌ Task failed: ${decision.reason}`);
                break;
            }

            // Execute browser action
            try {
                const result = await executeAction(page, decision);
                stepRecord.details = result;
            } catch (err) {
                stepRecord.details = `Error: ${err.message}`;
                console.error(`[WebAgent] Action error:`, err.message);
            }

            stepHistory.push(stepRecord);
            session.steps.push(stepRecord);

            // Save progress periodically (every 3 steps)
            if (step % 3 === 0) {
                await session.save();
            }
        }

        // If we hit max steps without completing
        if (session.status === 'running') {
            session.status = 'failed';
            session.error = `Reached maximum steps (${MAX_STEPS}) without completing the task`;
            session.completedAt = new Date();
            await session.save();
            console.log(`[WebAgent] ⚠️ Max steps reached`);
        }

        // Take final screenshot
        if (page && !page.isClosed()) {
            const finalScreenshot = await page.screenshot({ type: 'png' });
            session.finalScreenshot = finalScreenshot.toString('base64');
            await session.save();
        }

    } catch (err) {
        console.error(`[WebAgent] Fatal error:`, err.message);
        session.status = 'failed';
        session.error = err.message;
        session.completedAt = new Date();
        await session.save();
    } finally {
        // Cleanup
        if (browser) {
            try { await browser.close(); } catch (e) { /* ignore */ }
        }
        activeSessions.delete(session._id.toString());
    }

    return {
        sessionId: session._id,
        status: session.status,
        steps: session.steps.length,
        result: session.finalResult || session.error || '',
    };
}

// ===================== SESSION MANAGEMENT =====================

async function listSessions(limit = 20) {
    const WebAgentSession = mongoose.model('WebAgentSession');
    return WebAgentSession.find()
        .select('-steps.screenshot -finalScreenshot')
        .sort({ createdAt: -1 })
        .limit(limit);
}

async function getSession(sessionId) {
    const WebAgentSession = mongoose.model('WebAgentSession');
    return WebAgentSession.findById(sessionId);
}

async function stopSession(sessionId) {
    const active = activeSessions.get(sessionId);
    if (active) {
        try {
            await active.browser.close();
        } catch (e) { /* ignore */ }
        activeSessions.delete(sessionId);

        active.session.status = 'failed';
        active.session.error = 'Stopped by user';
        active.session.completedAt = new Date();
        await active.session.save();
        return { success: true, message: 'Session stopped' };
    }
    return { success: false, message: 'Session not found or already completed' };
}

// ===================== ORCHESTRATOR INTEGRATION =====================

async function executeWebAgentAction(data) {
    if (!data || !data.task) {
        return { error: 'Task description is required' };
    }

    // Run the task (this is async and may take a while)
    const result = await runTask(data.task, {
        startUrl: data.startUrl || data.url || ''
    });

    return {
        success: result.status === 'completed',
        sessionId: result.sessionId,
        status: result.status,
        steps: result.steps,
        result: result.result,
        message: result.status === 'completed'
            ? `✅ Task completed in ${result.steps} steps: ${result.result}`
            : `❌ Task failed after ${result.steps} steps: ${result.result}`
    };
}

module.exports = {
    runTask,
    listSessions,
    getSession,
    stopSession,
    executeWebAgentAction
};
