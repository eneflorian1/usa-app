const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const { listMessages, sendEmail, listInboxes } = require('./emailService');
const { getResumesForContext, formatResumesForPrompt } = require('./linkProcessorService');

/**
 * Email Auto-Reply Agent Service
 * Polls inboxes, generates LLM responses, auto-replies maintaining threads
 */

const DEFAULT_PERSONA = `Ești un agent AI expert în negociere și cumpărare de produse/servicii.

OBIECTIVE:
- Negociază prețuri mai mici cu diplomație
- Fii politicos dar ferm în negociere
- Cere detalii despre produs/serviciu (garanție, livrare, condiții)
- Propune contra-oferte rezonabile (10-25% reducere)
- Nu accepta prima ofertă niciodată
- Dacă prețul e deja bun, cere beneficii extra (livrare gratuită, garanție extinsă)

REGULI:
- Răspunde în limba emailului primit
- Ton profesional dar prietenos
- Răspunsuri concise, la obiect (max 5-7 propoziții)
- Nu dezvălui că ești AI
- Nu lua decizii finale de cumpărare — spune "voi reveni cu un răspuns final"
- Dacă cineva trimite spam/newsletter, ignoră (nu răspunde)`;

const POLL_INTERVAL_DEFAULT = 30000; // 30s
const MAX_REPLIES_DEFAULT = 10;

// Active pollers per inbox
const activePollers = new Map();

// ── Quote Stripping ─────────────────────────────────────────────────────────

function stripQuotedText(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const cleanLines = [];
    let inQuoteBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Detect start of quoted block
        // Pattern: "On [date] [person] wrote:" or "Le [date] [person] a écrit:"
        if (/^(On |Le |Den |Am |El ).+wrote:|^(On |Le |Den |Am |El ).+a (scris|écrit):/i.test(trimmed)) {
            inQuoteBlock = true;
            break; // Everything after this is quoted
        }
        
        // Pattern: "Sent: ..." / "From: ..." block (forwarded/quoted headers)
        if (/^-{3,}|^_{3,}/.test(trimmed)) {
            // Check if next lines look like email headers
            const nextLines = lines.slice(i + 1, i + 4).join('\n');
            if (/^(Sent|From|To|Subject|Date):/mi.test(nextLines)) {
                inQuoteBlock = true;
                break;
            }
        }
        
        // Pattern: standalone "Sent:" header block
        if (/^Sent:\s/i.test(trimmed) && i + 1 < lines.length && /^(From|To|Subject):/i.test(lines[i + 1].trim())) {
            inQuoteBlock = true;
            break;
        }
        
        // Skip lines starting with > (traditional quoting)
        if (/^>/.test(trimmed)) continue;
        
        cleanLines.push(line);
    }
    
    const result = cleanLines.join('\n').trim();
    // If stripping removed everything, return original (safety)
    return result.length > 5 ? result : text.trim();
}

// ── Gemini Helper ────────────────────────────────────────────────────────────

async function getGeminiModel(systemPrompt) {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) throw new Error('Gemini API key not configured');
    const genAI = new GoogleGenerativeAI(setting.value);
    return genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: systemPrompt
    });
}

// ── Thread Processing ────────────────────────────────────────────────────────

async function processNewMessages(inboxId, config) {
    const EmailThread = mongoose.model('EmailThread');

    let msgs;
    try {
        const result = await listMessages(inboxId, { limit: 20 });
        msgs = result.messages || [];
    } catch (err) {
        console.error(`[EmailAgent] Failed to fetch messages for ${inboxId}:`, err.message);
        return;
    }

    if (msgs.length === 0) return;

    // Get inbox email to detect self-messages
    let inboxEmail = '';
    try {
        const inboxes = await listInboxes();
        const inbox = inboxes.find(i => i.inboxId === inboxId);
        if (inbox) inboxEmail = inbox.email;
    } catch { /* ignore */ }

    for (const msg of msgs) {
        // Skip if already processed
        const existing = await EmailThread.findOne({ 
            inboxId, 
            'messages.messageId': msg.messageId 
        });
        if (existing) continue;

        // Loop protection: skip self-sent emails
        if (msg.from && inboxEmail && msg.from.includes(inboxEmail)) continue;

        // Skip likely spam/newsletters (no reply-to context, generic subjects)
        const spamPatterns = /unsubscribe|newsletter|no-?reply|noreply|marketing|promo/i;
        if (spamPatterns.test(msg.from) || spamPatterns.test(msg.text || '')) continue;

        console.log(`[EmailAgent] New message in ${inboxId}: "${msg.subject}" from ${msg.from}`);

        // Find or create thread by subject + sender
        const threadKey = normalizeThreadKey(msg.subject, msg.from);
        let thread = await EmailThread.findOne({ inboxId, threadKey });

        if (!thread) {
            thread = new EmailThread({
                inboxId,
                threadKey,
                senderEmail: msg.from,
                subject: msg.subject,
                messages: [],
                replyCount: 0,
                status: 'active',
                persona: config.persona || DEFAULT_PERSONA
            });
        }

        // Check max replies
        if (thread.replyCount >= (config.maxRepliesPerThread || MAX_REPLIES_DEFAULT)) {
            console.log(`[EmailAgent] Max replies (${thread.replyCount}) reached for thread: ${msg.subject}`);
            thread.status = 'max-replies';
            await thread.save();
            continue;
        }

        // Add incoming message to thread (strip quoted text from replies)
        const rawText = msg.text || msg.subject || '';
        const cleanText = stripQuotedText(rawText);
        console.log(`[EmailAgent] Raw: ${rawText.length} chars → Clean: ${cleanText.length} chars`);
        
        thread.messages.push({
            role: 'user',
            content: cleanText,
            messageId: msg.messageId,
            timestamp: msg.date ? new Date(msg.date) : new Date()
        });

        // Generate LLM response
        try {
            const response = await generateReply(thread, config);
            
            // Send reply
            const replyResult = await sendEmail(inboxId, {
                to: msg.from,
                subject: msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
                text: response,
                inReplyTo: msg.messageId
            });

            // Save assistant response
            thread.messages.push({
                role: 'assistant',
                content: response,
                messageId: replyResult.messageId || 'sent',
                timestamp: new Date()
            });
            thread.replyCount += 1;
            thread.lastReplyAt = new Date();
            await thread.save();

            console.log(`[EmailAgent] Auto-replied to "${msg.subject}" → ${msg.from} (reply #${thread.replyCount})`);
        } catch (err) {
            console.error(`[EmailAgent] Failed to reply to "${msg.subject}":`, err.message);
            // Still save the incoming message even if reply fails
            await thread.save();
        }
    }
}

async function generateReply(thread, config) {
    const persona = config.persona || thread.persona || DEFAULT_PERSONA;
    const model = await getGeminiModel(persona);

    // Build conversation context
    const contextParts = [];
    contextParts.push(`Subiect email: ${thread.subject}`);
    contextParts.push(`Persoana de contact: ${thread.senderEmail}`);
    contextParts.push(`Număr răspunsuri anterioare: ${thread.replyCount}`);
    contextParts.push('');

    // Add product resumes context for negotiation
    try {
        const resumes = await getResumesForContext(thread.inboxId);
        const resumeContext = formatResumesForPrompt(resumes);
        if (resumeContext) contextParts.push(resumeContext);
    } catch { /* ignore — products context is optional */ }

    // Include conversation history (last 10 messages for context window)
    const recentMessages = thread.messages.slice(-10);
    for (const m of recentMessages) {
        const label = m.role === 'user' ? 'EMAIL PRIMIT' : 'RĂSPUNSUL MEU';
        contextParts.push(`[${label}]:\n${m.content}\n`);
    }

    contextParts.push('Generează răspunsul la ultimul email primit. Răspunde direct, fără salut excesiv dacă conversația e deja în curs. Dacă ai informații despre produs/serviciu din rezumatele de mai sus, folosește-le în negociere.');

    const result = await model.generateContent(contextParts.join('\n'));
    return result.response.text().trim();
}

function normalizeThreadKey(subject, from) {
    // Remove Re:/Fwd: prefixes and normalize
    const cleanSubject = (subject || 'no-subject')
        .replace(/^(Re|Fwd|FW|RE|Fw):\s*/gi, '')
        .trim()
        .toLowerCase()
        .substring(0, 100);
    const cleanFrom = (from || 'unknown').toLowerCase().trim();
    return `${cleanFrom}::${cleanSubject}`;
}

// ── Polling Control ──────────────────────────────────────────────────────────

function startPolling(inboxId, config) {
    if (activePollers.has(inboxId)) {
        console.log(`[EmailAgent] Already polling ${inboxId}`);
        return;
    }

    const interval = config.pollingInterval || POLL_INTERVAL_DEFAULT;
    console.log(`[EmailAgent] Starting polling for ${inboxId} every ${interval / 1000}s`);

    // Run immediately, then on interval
    processNewMessages(inboxId, config).catch(err => {
        console.error(`[EmailAgent] Initial poll error for ${inboxId}:`, err.message);
    });

    const timer = setInterval(() => {
        processNewMessages(inboxId, config).catch(err => {
            console.error(`[EmailAgent] Poll error for ${inboxId}:`, err.message);
        });
    }, interval);

    activePollers.set(inboxId, timer);
}

function stopPolling(inboxId) {
    const timer = activePollers.get(inboxId);
    if (timer) {
        clearInterval(timer);
        activePollers.delete(inboxId);
        console.log(`[EmailAgent] Stopped polling for ${inboxId}`);
    }
}

function isPolling(inboxId) {
    return activePollers.has(inboxId);
}

// ── Restore on server start ──────────────────────────────────────────────────

async function restoreActiveAgents() {
    try {
        const EmailAgentConfig = mongoose.model('EmailAgentConfig');
        const activeConfigs = await EmailAgentConfig.find({ enabled: true });
        console.log(`[EmailAgent] Restoring ${activeConfigs.length} active email agents...`);
        for (const config of activeConfigs) {
            startPolling(config.inboxId, config);
        }
    } catch (err) {
        console.error('[EmailAgent] Failed to restore agents:', err.message);
    }
}

module.exports = {
    startPolling,
    stopPolling,
    isPolling,
    restoreActiveAgents,
    DEFAULT_PERSONA
};
