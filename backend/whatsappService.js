const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { generateReply } = require('./geminiService');

let client;
let qrCodeDataUrl = null;
let status = 'disconnected'; // 'disconnected', 'qr', 'connected', 'error'
let connectedPhoneNumber = null;

function initializeWhatsApp() {
    if (client) {
        if (status === 'error') {
            try { client.destroy(); } catch (e) { }
            client = null;
        } else {
            // Already initialized
            return;
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
        status = 'qr';
        qrCodeDataUrl = await qrcode.toDataURL(qr);
        console.log('WhatsApp QR Code generated');
    });

    client.on('ready', () => {
        status = 'connected';
        qrCodeDataUrl = null;

        let phoneStr = '';
        if (client.info && client.info.wid) {
            phoneStr = client.info.wid.user || '';
            if (!phoneStr || phoneStr.includes('@lid') || phoneStr.length > 15) {
                if (client.info.me && client.info.me.user) {
                    phoneStr = client.info.me.user;
                } else if (client.info.pushname) {
                    phoneStr = client.info.pushname;
                }
            }
            if (client.info.wid._serialized && !phoneStr) {
                phoneStr = client.info.wid._serialized.split('@')[0];
            }
        }

        connectedPhoneNumber = phoneStr || 'Connected User';
        console.log(`WhatsApp Client is ready! Connected as: ${connectedPhoneNumber}`);
    });

    client.on('authenticated', () => {
        console.log('WhatsApp Authenticated');
    });

    client.on('auth_failure', msg => {
        console.error('WhatsApp Auth failure', msg);
        status = 'error';
        if (client) {
            try { client.destroy(); } catch (e) { }
            client = null;
        }
    });

    client.on('disconnected', (reason) => {
        status = 'disconnected';
        qrCodeDataUrl = null;
        connectedPhoneNumber = null;
        console.log('WhatsApp Client was logged out', reason);
        // Clean up client so it can be re-initialized
        client.destroy();
        client = null;
    });

    client.on('message', async msg => {
        // Avoid replying to own messages or group messages (unless specifically requested)
        if (msg.fromMe || msg.isGroupMsg) return;

        console.log(`Received message from ${msg.from}: ${msg.body}`);

        try {
            const reply = await generateReply(msg.body, msg.from);
            if (reply) {
                await msg.reply(reply);
                console.log(`Replied to ${msg.from}`);
            }
        } catch (error) {
            console.error('Failed to reply to message:', error);
        }
    });

    client.initialize().catch(err => {
        console.error('Failed to initialize WhatsApp client', err);
        status = 'error';
        if (client) {
            try { client.destroy(); } catch (e) { }
            client = null;
        }
    });
}

function getStatus() {
    return status;
}

function getQR() {
    return qrCodeDataUrl;
}

function getPhoneNumber() {
    return connectedPhoneNumber;
}

async function logout() {
    if (client) {
        try {
            await client.logout();
        } catch (e) {
            console.error('Error during logout:', e);
        }
        status = 'disconnected';
        qrCodeDataUrl = null;
        connectedPhoneNumber = null;
        if (client) {
            client.destroy();
            client = null;
        }
    }
}

async function destroyClient() {
    if (client) {
        try {
            console.log('Destroying WhatsApp client gracefully...');
            await client.destroy();
        } catch (e) {
            console.error('Error destroying client:', e);
        }
        client = null;
    }
}

// ===================== SEND & CONTACT LOOKUP =====================

/**
 * Get all active (open) WhatsApp chats with name and last message.
 */
async function getActiveChats() {
    if (!client || status !== 'connected') {
        throw new Error('WhatsApp client is not connected');
    }
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

/**
 * Fuzzy-find a chat by contact name. Matches partial, case-insensitive.
 * e.g. "mama" matches "Mama ❤️", "ion" matches "Ion Popescu"
 */
async function findChatByName(name) {
    if (!client || status !== 'connected') {
        throw new Error('WhatsApp client is not connected');
    }
    const chats = await client.getChats();
    const needle = name.toLowerCase().trim();

    // 1. Exact match (case-insensitive)
    let found = chats.find(c => (c.name || '').toLowerCase() === needle);
    if (found) return { id: found.id._serialized, name: found.name };

    // 2. Starts with
    found = chats.find(c => (c.name || '').toLowerCase().startsWith(needle));
    if (found) return { id: found.id._serialized, name: found.name };

    // 3. Contains
    found = chats.find(c => (c.name || '').toLowerCase().includes(needle));
    if (found) return { id: found.id._serialized, name: found.name };

    // 4. Reverse: needle contains chat name
    found = chats.find(c => c.name && needle.includes(c.name.toLowerCase()));
    if (found) return { id: found.id._serialized, name: found.name };

    return null;
}

/**
 * Send a WhatsApp message to a chat by its serialized ID.
 */
async function sendWhatsAppMessage(chatId, message) {
    if (!client || status !== 'connected') {
        throw new Error('WhatsApp client is not connected');
    }
    const result = await client.sendMessage(chatId, message);
    console.log(`[WhatsApp] Message sent to ${chatId}: "${message.substring(0, 50)}..."`);
    return result;
}

/**
 * Get the raw client instance.
 */
function getClient() {
    return client;
}

module.exports = {
    initializeWhatsApp,
    getStatus,
    getQR,
    getPhoneNumber,
    logout,
    destroyClient,
    getActiveChats,
    findChatByName,
    sendWhatsAppMessage,
    getClient
};