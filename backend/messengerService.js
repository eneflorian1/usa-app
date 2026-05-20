/**
 * Messenger Agent Service
 * Unified send: email (with attachments) + WhatsApp via MCP bridge
 * Automatically resolves destination from Profile when not specified.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const mongoose = require('mongoose');
const { sendEmail, listInboxes } = require('./emailService');
const { callMcpTool } = require('./mcpBridgeService');
const { getLastCreatedFilePath } = require('./fileAgentService');

// ── Profile resolver ──────────────────────────────────────────────────────────

async function getProfile() {
    const Profile = mongoose.model('Profile');
    return Profile.findOne().lean();
}

function phoneToWaChatId(phone) {
    if (!phone) return null;
    let p = phone.replace(/[\s\-().+]/g, '');
    if (p.startsWith('00')) p = p.slice(2);
    if (p.startsWith('0')) p = '40' + p.slice(1);
    if (!p.includes('@')) p = p + '@c.us';
    return p;
}

// ── Transcript builder ────────────────────────────────────────────────────────

async function buildTranscript(sessionId) {
    const AgentChat = mongoose.model('AgentChat');
    const sid = sessionId || 'orchestrator-default';
    const chat = await AgentChat.findOne({ sessionId: sid }).lean();
    console.log(`[Messenger] buildTranscript(${sid}): ${chat?.messages?.length ?? 'no chat'} messages`);
    if (!chat || !chat.messages?.length) return null;

    const lines = chat.messages
        .filter(m => m.content)
        .map(m => {
            const role = m.role === 'user' ? 'Tu' : 'Ilie (AI)';
            const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) : '';
            return `[${ts}] ${role}: ${m.content}`;
        });
    return lines.length > 0 ? lines.join('\n') : null;
}

// ── MIME type detection ───────────────────────────────────────────────────────

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.html': 'application/octet-stream', // WhatsApp doesn't support HTML; force download. Use PDF instead.
        '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
        '.json': 'application/json', '.xml': 'application/xml',
        '.zip': 'application/zip', '.gz': 'application/gzip',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
    };
    return map[ext] || 'application/octet-stream';
}

// ── Screenshot capture ────────────────────────────────────────────────────────

async function captureScreenshot() {
    const tmpFile = path.join(os.tmpdir(), `messenger_screenshot_${Date.now()}.png`);
    try {
        const { execSync } = require('child_process');
        try {
            execSync(`screencapture -x "${tmpFile}" 2>/dev/null`, { timeout: 5000 });
        } catch {
            try { execSync(`import -window root "${tmpFile}" 2>/dev/null`, { timeout: 5000 }); } catch { /* no display */ }
        }
        if (fs.existsSync(tmpFile)) {
            const data = fs.readFileSync(tmpFile).toString('base64');
            fs.unlinkSync(tmpFile);
            return { content: data, contentType: 'image/png', filename: `screenshot_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png` };
        }
    } catch (err) {
        console.error('[Messenger] Screenshot error:', err.message);
    }
    return null;
}

// ── Attachment builder ────────────────────────────────────────────────────────
// Each item in `attachments` array can be:
//   { type: "transcript" }                         → conversation as .txt
//   { type: "screenshot" }                         → take screenshot now
//   { type: "file", path: "/abs/path/to/file" }   → read file from disk
//   { type: "text", filename: "doc.txt", content: "..." } → inline text

async function buildAttachments(attachments = [], sessionId) {
    const result = [];

    for (const att of attachments) {
        try {
            if (att.type === 'transcript') {
                const transcript = await buildTranscript(sessionId);
                if (transcript) {
                    result.push({
                        filename: `conversatie_${new Date().toISOString().slice(0,10)}.txt`,
                        contentType: 'text/plain',
                        content: Buffer.from(transcript).toString('base64'),
                    });
                    console.log('[Messenger] Attachment: transcript added');
                }

            } else if (att.type === 'screenshot') {
                const shot = await captureScreenshot();
                if (shot) {
                    result.push({ filename: shot.filename, contentType: shot.contentType, content: shot.content });
                    console.log('[Messenger] Attachment: screenshot added');
                }

            } else if (att.type === 'last_created') {
                const lastPath = getLastCreatedFilePath();
                if (lastPath && fs.existsSync(lastPath)) {
                    const content = fs.readFileSync(lastPath).toString('base64');
                    result.push({
                        filename: path.basename(lastPath),
                        contentType: getMimeType(lastPath),
                        content,
                    });
                    console.log('[Messenger] Attachment: last_created file added', lastPath);
                } else {
                    console.warn('[Messenger] Attachment: last_created — no file found');
                }

            } else if (att.type === 'file' && att.path) {
                const absPath = path.resolve(att.path);
                if (!fs.existsSync(absPath)) {
                    console.warn('[Messenger] Attachment file not found:', absPath);
                    continue;
                }
                const content = fs.readFileSync(absPath).toString('base64');
                result.push({
                    filename: att.filename || path.basename(absPath),
                    contentType: att.contentType || getMimeType(absPath),
                    content,
                });
                console.log('[Messenger] Attachment: file added', absPath);

            } else if (att.type === 'text' && att.content) {
                result.push({
                    filename: att.filename || 'document.txt',
                    contentType: att.contentType || 'text/plain',
                    content: Buffer.from(att.content).toString('base64'),
                });
                console.log('[Messenger] Attachment: text document added', att.filename);
            }
        } catch (err) {
            console.error('[Messenger] Attachment build error:', err.message);
        }
    }

    return result;
}

// ── Send Email ────────────────────────────────────────────────────────────────

async function sendMessengerEmail({ inboxId, to, subject, body, attachTranscript, attachments, sessionId, additionalText }) {
    let resolvedTo = to;
    if (!resolvedTo) {
        const profile = await getProfile();
        resolvedTo = profile?.email;
        if (!resolvedTo) throw new Error('Niciun email destinatar specificat și niciun email în Profil (Settings → Profil).');
        console.log('[Messenger] Email destination resolved from Profile:', resolvedTo);
    }

    let resolvedInboxId = inboxId;
    if (!resolvedInboxId) {
        const inboxes = await listInboxes();
        if (!inboxes.length) throw new Error('No email inboxes configured. Create one first.');
        resolvedInboxId = inboxes[0].inboxId;
    }

    let emailBody = body || '';
    if (additionalText) emailBody = additionalText + (emailBody ? '\n\n' + emailBody : '');

    // Build attachment list
    const attList = Array.isArray(attachments) ? [...attachments] : [];

    // attachTranscript: true → add transcript as .txt file attachment
    if (attachTranscript) {
        attList.unshift({ type: 'transcript' });
    }

    const builtAttachments = await buildAttachments(attList, sessionId);

    const resolvedSubject = subject || 'Mesaj de la Ilie AI';
    const result = await sendEmail(resolvedInboxId, {
        to: resolvedTo,
        subject: resolvedSubject,
        text: emailBody || '(mesaj gol)',
        attachments: builtAttachments.length > 0 ? builtAttachments : undefined,
    });

    const attNote = builtAttachments.length > 0 ? ` (${builtAttachments.length} atașament${builtAttachments.length > 1 ? 'e' : ''}: ${builtAttachments.map(a => a.filename).join(', ')})` : '';
    console.log(`[Messenger] Email sent to ${resolvedTo} → subject: ${resolvedSubject}${attNote}`);
    return { ...result, channel: 'email', to: resolvedTo, subject: resolvedSubject, attachmentCount: builtAttachments.length, attachmentNames: builtAttachments.map(a => a.filename) };
}

// ── Send WhatsApp ─────────────────────────────────────────────────────────────

async function sendMessengerWhatsApp({ chatId, userId, message, attachTranscript, attachments, sessionId, additionalText }) {
    let resolvedChatId = chatId;
    if (!resolvedChatId) {
        const profile = await getProfile();
        resolvedChatId = phoneToWaChatId(profile?.phone);
        if (!resolvedChatId) throw new Error('Niciun chatId specificat și niciun telefon în Profil (Settings → Profil).');
        console.log('[Messenger] WhatsApp destination resolved from Profile:', resolvedChatId);
    }

    let text = message || '';
    if (additionalText) text = additionalText + (text ? '\n\n' + text : '');

    // Build full attachment list (transcript + extras)
    const attList = [];
    if (attachTranscript) attList.push({ type: 'transcript' });
    if (Array.isArray(attachments)) attList.push(...attachments);

    const builtAttachments = await buildAttachments(attList, sessionId);

    // Convert to the format negoapp/whatsapp-web.js expects
    const waAttachments = builtAttachments.map(a => ({
        filename: a.filename,
        mimetype: a.contentType,
        data: a.content, // base64
    }));

    if (!text && waAttachments.length === 0) throw new Error('No message content to send');

    const result = await callMcpTool('nego_send_whatsapp', {
        userId: userId || 'default',
        chatId: resolvedChatId,
        message: text || '',
        attachments: waAttachments.length > 0 ? waAttachments : undefined,
    });

    const attNote = waAttachments.length > 0 ? ` (${waAttachments.length} atașament${waAttachments.length > 1 ? 'e' : ''}: ${builtAttachments.map(a => a.filename).join(', ')})` : '';
    console.log('[Messenger] WhatsApp sent to', resolvedChatId + attNote);
    return { success: true, channel: 'whatsapp', chatId: resolvedChatId, attachmentCount: waAttachments.length, attachmentNames: builtAttachments.map(a => a.filename), result };
}

// ── Unified dispatcher ────────────────────────────────────────────────────────

async function executeMessengerAction(data, sessionId) {
    if (!data) return null;
    const { channel } = data;

    if (channel === 'email') return sendMessengerEmail({ ...data, sessionId });
    if (channel === 'whatsapp') return sendMessengerWhatsApp({ ...data, sessionId });

    throw new Error(`Unknown messenger channel: ${channel}. Use "email" or "whatsapp".`);
}

module.exports = { executeMessengerAction, buildTranscript, sendMessengerEmail, sendMessengerWhatsApp };
