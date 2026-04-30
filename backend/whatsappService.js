const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { generateReply } = require('./geminiService');

let client;
let qrCodeDataUrl = null;
let status = 'disconnected'; // 'disconnected', 'qr', 'connected', 'initializing', 'error'
let connectedPhoneNumber = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const DESTROY_TIMEOUT = 15000; // 15s max for destroy

// Safe destroy with timeout — prevents hanging on broken sessions
async function safeDestroy(c) {
    if (!c) return;
    try {
        await Promise.race([
            c.destroy(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timeout')), DESTROY_TIMEOUT))
        ]);
    } catch (e) {
        console.error('[WhatsApp] safeDestroy error:', e.message);
    }
}

// Reconnect with exponential backoff
function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(`[WhatsApp] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
        status = 'error';
        return;
    }
    const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 120000); // 5s, 10s, 20s, 40s, 80s
    reconnectAttempts++;
    console.log(`[WhatsApp] Scheduling reconnect #${reconnectAttempts} in ${delay / 1000}s...`);
    setTimeout(() => {
        if (status !== 'connected' && status !== 'initializing') {
            initializeWhatsApp();
        }
    }, delay);
}

function initializeWhatsApp() {
    if (client) {
        if (status === 'error' || status === 'disconnected') {
            safeDestroy(client);
            client = null;
        } else {
            return; // Already initializing or connected
        }
    }

    status = 'initializing';
    qrCodeDataUrl = null;

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            dumpio: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-features=site-per-process',
                '--disable-dbus',
                '--disable-notifications',
                '--disable-component-update',
                '--disable-background-networking'
            ]
        }
    });

    client.on('qr', async (qr) => {
        try {
            status = 'qr';
            qrCodeDataUrl = await qrcode.toDataURL(qr);
            console.log('[WhatsApp] QR Code generated');
        } catch (e) {
            console.error('[WhatsApp] QR generation error:', e.message);
        }
    });

    client.on('ready', () => {
        try {
            status = 'connected';
            qrCodeDataUrl = null;
            reconnectAttempts = 0; // Reset on successful connection

            let phoneStr = '';
            try {
                if (client.info && client.info.wid) {
                    phoneStr = client.info.wid.user || '';
                    if (!phoneStr || phoneStr.includes('@lid') || phoneStr.length > 15) {
                        phoneStr = client.info?.me?.user || client.info?.pushname || '';
                    }
                    if (!phoneStr && client.info.wid._serialized) {
                        phoneStr = client.info.wid._serialized.split('@')[0];
                    }
                }
            } catch (e) {
                console.error('[WhatsApp] Error reading phone number:', e.message);
            }

            connectedPhoneNumber = phoneStr || 'Connected User';
            console.log(`[WhatsApp] Client ready! Connected as: ${connectedPhoneNumber}`);
        } catch (e) {
            console.error('[WhatsApp] Ready handler error:', e.message);
        }
    });

    client.on('authenticated', () => {
        console.log('[WhatsApp] Authenticated');
    });

    client.on('auth_failure', async (msg) => {
        console.error('[WhatsApp] Auth failure:', msg);
        status = 'error';
        const c = client;
        client = null;
        await safeDestroy(c);
        scheduleReconnect();
    });

    client.on('disconnected', async (reason) => {
        console.log('[WhatsApp] Disconnected:', reason);
        status = 'disconnected';
        qrCodeDataUrl = null;
        connectedPhoneNumber = null;
        const c = client;
        client = null;
        await safeDestroy(c);
        scheduleReconnect();
    });

    client.on('message', async (msg) => {
        if (msg.fromMe || msg.isGroupMsg) return;

        try {
            console.log(`[WhatsApp] Message from ${msg.from}: ${msg.body}`);
            const reply = await generateReply(msg.body, msg.from);
            if (reply) {
                await msg.reply(reply).catch(e => console.error('[WhatsApp] Reply send error:', e.message));
                console.log(`[WhatsApp] Replied to ${msg.from}`);
            }
        } catch (error) {
            console.error('[WhatsApp] Message handler error:', error.message);
        }
    });

    client.initialize().catch(err => {
        console.error('[WhatsApp] Initialize failed:', err.message);
        status = 'error';
        const c = client;
        client = null;
        safeDestroy(c);
        scheduleReconnect();
    });
}

function getStatus() { return status; }
function getQR() { return qrCodeDataUrl; }
function getPhoneNumber() { return connectedPhoneNumber; }

async function logout() {
    if (client) {
        try { await client.logout(); } catch (e) { console.error('[WhatsApp] Logout error:', e.message); }
        status = 'disconnected';
        qrCodeDataUrl = null;
        connectedPhoneNumber = null;
        const c = client;
        client = null;
        await safeDestroy(c);
    }
}

async function destroyClient() {
    const c = client;
    client = null;
    status = 'disconnected';
    await safeDestroy(c);
}

// ===================== SEND & CONTACT LOOKUP =====================

async function getActiveChats() {
    if (!client || status !== 'connected') throw new Error('WhatsApp client is not connected');
    const chats = await client.getChats();
    return chats
        .filter(c => !c.isGroup)
        .map(c => ({
            id: c.id._serialized,
            name: c.name || c.id.user,
            lastMessage: c.lastMessage ? c.lastMessage.body : '',
            timestamp: c.timestamp,
            unreadCount: c.unreadCount
        }));
}

async function findChatByName(name) {
    if (!client || status !== 'connected') throw new Error('WhatsApp client is not connected');
    const chats = await client.getChats();
    const needle = name.toLowerCase().trim();

    return chats.find(c => (c.name || '').toLowerCase() === needle)
        || chats.find(c => (c.name || '').toLowerCase().startsWith(needle))
        || chats.find(c => (c.name || '').toLowerCase().includes(needle))
        || chats.find(c => c.name && needle.includes(c.name.toLowerCase()))
        || null;
}

async function sendMessageToChat(chat, message) {
    if (!client || status !== 'connected') throw new Error('WhatsApp client is not connected');
    const result = await chat.sendMessage(message);
    console.log(`[WhatsApp] Sent to ${chat.name} (${chat.id._serialized}): "${message.substring(0, 50)}"`);
    return result;
}

async function sendWhatsAppByName(contactName, message) {
    const chat = await findChatByName(contactName);
    if (!chat) throw new Error(`Contact "${contactName}" not found in active WhatsApp chats`);
    await sendMessageToChat(chat, message);
    return { success: true, sentTo: chat.name, chatId: chat.id._serialized };
}

function getClient() { return client; }

module.exports = {
    initializeWhatsApp, getStatus, getQR, getPhoneNumber, logout, destroyClient,
    getActiveChats, findChatByName, sendMessageToChat, sendWhatsAppByName, getClient
};
