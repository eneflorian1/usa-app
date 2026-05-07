const router = require('express').Router();
const mongoose = require('mongoose');

const Profile = mongoose.model('Profile');

router.get('/', async (req, res) => {
    try {
        const profile = await Profile.findOne() || {};
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const existing = await Profile.findOne();
        if (existing) {
            Object.assign(existing, req.body);
            await existing.save();
            res.json(existing);
        } else {
            const profile = await Profile.create(req.body);
            res.status(201).json(profile);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
