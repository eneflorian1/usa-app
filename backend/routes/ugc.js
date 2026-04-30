const router = require('express').Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const ugcAgent = require('../ugcAgentService');

const UgcReferenceImage = mongoose.model('UgcReferenceImage');
const UgcGeneration = mongoose.model('UgcGeneration');
const ugcOutputPath = path.join(__dirname, '..', 'ugc-output');

// Serve generated images statically
router.use('/images', require('express').static(ugcOutputPath));

router.get('/references', async (req, res) => {
  try {
    const refs = await UgcReferenceImage.find().sort({ createdAt: -1 });
    const result = refs.map(r => ({
      _id: r._id, name: r.name, mimeType: r.mimeType, imageData: r.imageData, createdAt: r.createdAt
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/references', async (req, res) => {
  try {
    const { name, imageData, mimeType } = req.body;
    if (!name || !imageData) return res.status(400).json({ error: 'name and imageData are required' });
    const ref = await UgcReferenceImage.create({ name, imageData, mimeType: mimeType || 'image/jpeg' });
    res.status(201).json(ref);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/references/:id', async (req, res) => {
  try {
    const ref = await UgcReferenceImage.findByIdAndDelete(req.params.id);
    if (!ref) return res.status(404).json({ error: 'Reference image not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/generate', async (req, res) => {
  try {
    const { prompt, referenceImageIds, aspectRatio, resolution } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    if (!referenceImageIds || !referenceImageIds.length) {
      return res.status(400).json({ error: 'At least one reference image is required' });
    }
    const gen = await UgcGeneration.create({
      prompt, referenceImageIds, aspectRatio: aspectRatio || 'auto', resolution: resolution || '1K', status: 'pending'
    });
    const refs = await UgcReferenceImage.find({ _id: { $in: referenceImageIds } });
    const base64Images = refs.map(r => ({ data: r.imageData, mimeType: r.mimeType }));
    try {
      const result = await ugcAgent.generateImage(prompt, base64Images, {
        aspectRatio: aspectRatio || 'auto', resolution: resolution || '1K'
      });
      gen.resultFilename = result.filename;
      gen.description = result.description;
      gen.status = 'completed';
      await gen.save();
      res.json(gen);
    } catch (genErr) {
      gen.status = 'failed';
      gen.error = genErr.message;
      await gen.save();
      res.status(500).json({ error: genErr.message, generation: gen });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/generations', async (req, res) => {
  try {
    const gens = await UgcGeneration.find().sort({ createdAt: -1 }).limit(50);
    for (const gen of gens) {
      if (gen.resultImageData && !gen.resultFilename) {
        try {
          const filename = `ugc_${gen._id}.png`;
          const filePath = path.join(ugcOutputPath, filename);
          const buffer = Buffer.from(gen.resultImageData, 'base64');
          await fs.promises.writeFile(filePath, buffer);
          gen.resultFilename = filename;
          gen.resultImageData = '';
          await gen.save();
          console.log(`[UGC] Migrated generation ${gen._id} to file: ${filename}`);
        } catch (migErr) {
          console.error(`[UGC] Migration failed for ${gen._id}:`, migErr.message);
        }
      }
    }
    res.json(gens);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/generations/:id', async (req, res) => {
  try {
    const gen = await UgcGeneration.findByIdAndDelete(req.params.id);
    if (!gen) return res.status(404).json({ error: 'Generation not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
