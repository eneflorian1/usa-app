const router = require('express').Router();
const whatsappService = require('../whatsappService');

router.get('/status', (req, res) => {
  res.json({ status: whatsappService.getStatus() });
});

router.get('/qr', (req, res) => {
  res.json({ qr: whatsappService.getQR() });
});

router.post('/connect', (req, res) => {
  whatsappService.initializeWhatsApp();
  res.json({ message: 'Initializing WhatsApp Client...' });
});

router.post('/logout', async (req, res) => {
  await whatsappService.logout();
  res.json({ message: 'Logged out successfully' });
});

router.get('/phoneNumber', (req, res) => {
  res.json({ phoneNumber: whatsappService.getPhoneNumber() });
});

router.get('/chats', async (req, res) => {
  try {
    const chats = await whatsappService.getActiveChats();
    res.json(chats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/send', async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to (contact name) and message are required' });
    const result = await whatsappService.sendWhatsAppByName(to, message);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
