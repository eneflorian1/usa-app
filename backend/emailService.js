const { AgentMail } = require('agentmail');
const mongoose = require('mongoose');

/**
 * AgentMail Email Service
 * Provides inbox management, send/receive emails for AI agents
 */

let client = null;

async function getClient() {
    if (client) return client;
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'agentmail_api_key' });
    if (!setting || !setting.value) {
        throw new Error('AgentMail API key not configured. Get one at https://console.agentmail.to/ and set it in Settings.');
    }
    client = new AgentMail({ apiKey: setting.value });
    return client;
}

// Reset client when API key changes
function resetClient() {
    client = null;
}

// ── Inbox Management ─────────────────────────────────────────────────────────

async function createInbox(options = {}) {
    const am = await getClient();
    const inbox = await am.inboxes.create({
        displayName: options.displayName || undefined,
        username: options.username || undefined,
        domain: options.domain || undefined,
    });
    console.log('[Email] Inbox created:', inbox.inboxId, inbox.email);
    return {
        inboxId: inbox.inboxId,
        email: inbox.email,
        displayName: inbox.displayName || '',
        createdAt: inbox.createdAt
    };
}

async function listInboxes() {
    const am = await getClient();
    const result = await am.inboxes.list();
    return (result.inboxes || []).map(i => ({
        inboxId: i.inboxId,
        email: i.email,
        displayName: i.displayName || '',
        createdAt: i.createdAt
    }));
}

async function getInbox(inboxId) {
    const am = await getClient();
    const inbox = await am.inboxes.get(inboxId);
    return {
        inboxId: inbox.inboxId,
        email: inbox.email,
        displayName: inbox.displayName || '',
        createdAt: inbox.createdAt
    };
}

async function deleteInbox(inboxId) {
    const am = await getClient();
    await am.inboxes.delete(inboxId);
    console.log('[Email] Inbox deleted:', inboxId);
    return { success: true };
}

// ── Message Operations ───────────────────────────────────────────────────────

async function sendEmail(inboxId, { to, subject, text, html, cc, bcc, replyTo }) {
    const am = await getClient();
    const msg = await am.inboxes.messages.send(inboxId, {
        to,
        subject: subject || '(no subject)',
        text: text || '',
        html: html || undefined,
        cc: cc || undefined,
        bcc: bcc || undefined,
        replyTo: replyTo || undefined,
    });
    console.log('[Email] Sent:', subject, '→', to);
    return {
        messageId: msg.messageId || msg.id,
        to,
        subject,
        status: 'sent'
    };
}

async function listMessages(inboxId, options = {}) {
    const am = await getClient();
    const result = await am.inboxes.messages.list(inboxId, {
        limit: options.limit || 20,
        pageToken: options.pageToken || undefined,
    });
    return {
        messages: (result.messages || []).map(m => ({
            messageId: m.messageId || m.id,
            from: m.from,
            to: m.to,
            subject: m.subject || '(no subject)',
            text: m.extractedText || m.text || '',
            html: m.extractedHtml || m.html || '',
            date: m.date || m.createdAt,
            labels: m.labels || [],
        })),
        nextPageToken: result.nextPageToken || null
    };
}

async function getMessage(inboxId, messageId) {
    const am = await getClient();
    const m = await am.inboxes.messages.get(inboxId, messageId);
    return {
        messageId: m.messageId || m.id,
        from: m.from,
        to: m.to,
        cc: m.cc,
        bcc: m.bcc,
        subject: m.subject || '(no subject)',
        text: m.extractedText || m.text || '',
        html: m.extractedHtml || m.html || '',
        date: m.date || m.createdAt,
        labels: m.labels || [],
        attachments: m.attachments || [],
    };
}

// ── Orchestrator Integration ─────────────────────────────────────────────────

async function executeEmailAction(data) {
    const action = data.action;
    try {
        switch (action) {
            case 'create_inbox':
                return await createInbox(data);
            case 'list_inboxes':
                return await listInboxes();
            case 'send':
                if (!data.inboxId || !data.to) throw new Error('inboxId and to are required');
                return await sendEmail(data.inboxId, data);
            case 'list_messages':
                if (!data.inboxId) throw new Error('inboxId is required');
                return await listMessages(data.inboxId, data);
            case 'read_message':
                if (!data.inboxId || !data.messageId) throw new Error('inboxId and messageId are required');
                return await getMessage(data.inboxId, data.messageId);
            case 'delete_inbox':
                if (!data.inboxId) throw new Error('inboxId is required');
                return await deleteInbox(data.inboxId);
            default:
                return { error: `Unknown email action: ${action}` };
        }
    } catch (err) {
        console.error(`[Email] Action '${action}' error:`, err.message);
        return { error: err.message };
    }
}

module.exports = {
    createInbox,
    listInboxes,
    getInbox,
    deleteInbox,
    sendEmail,
    listMessages,
    getMessage,
    executeEmailAction,
    resetClient
};
