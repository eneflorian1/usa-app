const router = require('express').Router();
const x402Payment = require('../x402PaymentService');

router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = await x402Payment.getTransactionHistory(limit);
    res.json(history);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/balance', async (req, res) => {
  try {
    const balance = await x402Payment.getWalletBalance();
    res.json(balance);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
