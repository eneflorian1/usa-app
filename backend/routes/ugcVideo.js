const router = require('express').Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const ugcVideoAgent = require('../ugcVideoAgentService');

const UgcReferenceImage = mongoose.model('UgcReferenceImage');
const UgcVideoGeneration = mongoose.model('UgcVideoGeneration');

router.use('/files', require('express').static(path.join(__dirname, '..', 'ugc-output')));

router.post('/analyze', async (req, res) => {
  try {
    const { referenceImageIds } = req.body;
    if (!referenceImageIds || !referenceImageIds.length) return res.status(400).json({ error: 'At least one reference image is required' });
    const refs = await UgcReferenceImage.find({ _id: { $in: referenceImageIds } });
    if (refs.length === 0) return res.status(404).json({ error: 'No reference images found' });
    const base64Images = refs.map(r => ({ data: r.imageData, mimeType: r.mimeType }));
    const analysis = await ugcVideoAgent.analyzeReferenceImages(base64Images);
    res.json({ analysis });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/generate', async (req, res) => {
  try {
    const { prompt, referenceImageIds, aspectRatio, duration } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    if (!referenceImageIds || !referenceImageIds.length) return res.status(400).json({ error: 'At least one reference image is required' });

    const gen = await UgcVideoGeneration.create({
      prompt, referenceImageIds, aspectRatio: aspectRatio || '16:9', duration: duration || '8', status: 'pending'
    });
    res.status(202).json({ _id: gen._id, status: 'pending', message: 'Video generation started' });

    (async () => {
      try {
        const refs = await UgcReferenceImage.find({ _id: { $in: referenceImageIds } });
        const base64Images = refs.map(r => ({ data: r.imageData, mimeType: r.mimeType }));
        gen.status = 'analyzing';
        await gen.save();
        const result = await ugcVideoAgent.generateUGCVideo(prompt, base64Images, { aspectRatio: aspectRatio || '16:9', duration: duration || '8' });
        gen.analysis = result.analysis;
        gen.videoPrompt = result.videoPrompt;
        gen.videoFilename = result.videoFilename;
        gen.status = 'completed';
        await gen.save();
        console.log(`[UGC Video Route] Generation ${gen._id} completed: ${result.videoFilename}`);
      } catch (genErr) {
        console.error(`[UGC Video Route] Generation ${gen._id} failed:`, genErr.message);
        gen.status = 'failed';
        gen.error = genErr.message;
        await gen.save();
      }
    })();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/generations', async (req, res) => {
  try {
    const gens = await UgcVideoGeneration.find().sort({ createdAt: -1 }).limit(50);
    res.json(gens);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/generations/:id', async (req, res) => {
  try {
    const gen = await UgcVideoGeneration.findById(req.params.id);
    if (!gen) return res.status(404).json({ error: 'Generation not found' });
    res.json(gen);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/generations/:id', async (req, res) => {
  try {
    const gen = await UgcVideoGeneration.findByIdAndDelete(req.params.id);
    if (!gen) return res.status(404).json({ error: 'Generation not found' });
    if (gen.videoFilename) {
      try { await fs.promises.unlink(path.join(__dirname, '..', 'ugc-output', gen.videoFilename)); } catch { }
    }
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
