const router = require('express').Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const ugcProductService = require('../ugcProductService');

const UgcProduct = mongoose.model('UgcProduct');

router.get('/', async (req, res) => {
  try {
    const products = await UgcProduct.find().sort({ updatedAt: -1 }).select('-productImages.imageData -referenceImages.imageData -generations.resultImageData');
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const product = await UgcProduct.create({ name, description });
    res.status(201).json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    product.updatedAt = Date.now();
    await product.save();
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const product = await UgcProduct.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    for (const gen of product.generations || []) {
      if (gen.resultFilename) {
        try { await fs.promises.unlink(path.join(__dirname, '..', 'ugc-output', gen.resultFilename)); } catch { }
      }
    }
    res.json({ message: 'Product deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Image uploads
router.post('/:id/product-images', async (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !images.length) return res.status(400).json({ error: 'images array is required' });
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    for (const img of images) {
      product.productImages.push({ imageData: img.imageData, mimeType: img.mimeType || 'image/jpeg', name: img.name || `product_${Date.now()}` });
    }
    product.updatedAt = Date.now();
    await product.save();
    res.json({ count: images.length, totalProductImages: product.productImages.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/product-images/:imgIdx', async (req, res) => {
  try {
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const idx = parseInt(req.params.imgIdx);
    if (idx < 0 || idx >= product.productImages.length) return res.status(404).json({ error: 'Image index out of range' });
    product.productImages.splice(idx, 1);
    product.updatedAt = Date.now();
    await product.save();
    res.json({ message: 'Product image deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/reference-images', async (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !images.length) return res.status(400).json({ error: 'images array is required' });
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    for (const img of images) {
      product.referenceImages.push({ imageData: img.imageData, mimeType: img.mimeType || 'image/jpeg', name: img.name || `ref_${Date.now()}`, label: img.label || `Image ${product.referenceImages.length + 1}` });
    }
    product.updatedAt = Date.now();
    await product.save();
    res.json({ count: images.length, totalReferenceImages: product.referenceImages.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/reference-images/:imgIdx', async (req, res) => {
  try {
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const idx = parseInt(req.params.imgIdx);
    if (idx < 0 || idx >= product.referenceImages.length) return res.status(404).json({ error: 'Image index out of range' });
    product.referenceImages.splice(idx, 1);
    product.updatedAt = Date.now();
    await product.save();
    res.json({ message: 'Reference image deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/avatar-images', async (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || images.length === 0) return res.status(400).json({ error: 'images array is required' });
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    for (const img of images) {
      if (!img.imageData) continue;
      product.avatarImages.push({ imageData: img.imageData, mimeType: img.mimeType || 'image/jpeg', name: img.name || `avatar_${Date.now()}`, label: img.label || `Avatar Image ${product.avatarImages.length + 1}` });
    }
    product.updatedAt = Date.now();
    await product.save();
    res.json({ count: images.length, totalAvatarImages: product.avatarImages.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/avatar-images/:imgIdx', async (req, res) => {
  try {
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const idx = parseInt(req.params.imgIdx);
    if (idx < 0 || idx >= product.avatarImages.length) return res.status(404).json({ error: 'Image index out of range' });
    product.avatarImages.splice(idx, 1);
    product.updatedAt = Date.now();
    await product.save();
    res.json({ message: 'Avatar image deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/system-prompt', async (req, res) => {
  try {
    const { systemPrompt } = req.body;
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    product.systemPrompt = systemPrompt || ugcProductService.DEFAULT_VISUAL_BIBLE_PROMPT;
    product.updatedAt = Date.now();
    await product.save();
    res.json({ systemPrompt: product.systemPrompt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/visual-bible', async (req, res) => {
  try {
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.referenceImages.length === 0) return res.status(400).json({ error: 'Upload reference images before generating a Visual Bible' });
    const refImages = product.referenceImages.map(r => ({ data: r.imageData, mimeType: r.mimeType }));
    const visualBible = await ugcProductService.generateVisualBible(product.systemPrompt, refImages);
    product.visualBible = visualBible;
    product.visualBibleGeneratedAt = Date.now();
    product.updatedAt = Date.now();
    await product.save();
    res.json({ visualBible, generatedAt: product.visualBibleGeneratedAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/generate', async (req, res) => {
  try {
    const { prompt, aspectRatio } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.productImages.length === 0) return res.status(400).json({ error: 'Upload product images before generating UGC content' });

    const genEntry = { prompt, status: 'pending', aspectRatio: aspectRatio || 'auto' };
    product.generations.push(genEntry);
    await product.save();
    const genIdx = product.generations.length - 1;
    const genId = product.generations[genIdx]._id;

    res.status(202).json({ _id: genId, index: genIdx, status: 'pending', message: 'Generation started' });

    (async () => {
      try {
        const prodImages = product.productImages.map(p => ({ data: p.imageData, mimeType: p.mimeType }));
        const avaImages = product.avatarImages ? product.avatarImages.map(p => ({ data: p.imageData, mimeType: p.mimeType })) : [];
        const result = await ugcProductService.generateProductUGC(prodImages, product.visualBible, prompt, { aspectRatio: aspectRatio || 'auto' }, avaImages);
        const updatedProduct = await UgcProduct.findById(req.params.id);
        const gen = updatedProduct.generations.id(genId);
        if (gen) { gen.resultFilename = result.filename; gen.description = result.description; gen.status = 'completed'; updatedProduct.updatedAt = Date.now(); await updatedProduct.save(); }
        console.log(`[UGC Product] Generation ${genId} completed: ${result.filename}`);
      } catch (genErr) {
        console.error(`[UGC Product] Generation ${genId} failed:`, genErr.message);
        try { const up = await UgcProduct.findById(req.params.id); const g = up.generations.id(genId); if (g) { g.status = 'failed'; g.error = genErr.message; await up.save(); } } catch { }
      }
    })();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/cancel-generation', async (req, res) => {
  try {
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    let cancelled = 0;
    for (const gen of product.generations) { if (gen.status === 'pending') { gen.status = 'cancelled'; cancelled++; } }
    if (cancelled > 0) { product.updatedAt = Date.now(); await product.save(); }
    res.json({ message: `Cancelled ${cancelled} pending generations` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/generate-collection', async (req, res) => {
  try {
    const { count = 10, aspectRatio = 'auto', avatarDesc = '' } = req.body;
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.productImages.length === 0) return res.status(400).json({ error: 'Upload product images before generating UGC content' });
    if (!product.visualBible) return res.status(400).json({ error: 'Generate a Visual Bible first' });

    let scenePrompts;
    try { scenePrompts = await ugcProductService.generateScenePrompts(product.visualBible, count, avatarDesc); }
    catch (e) { return res.status(500).json({ error: 'Failed to generate scene prompts: ' + e.message }); }

    const addedGenerations = [];
    for (const prompt of scenePrompts) {
      product.generations.push({ prompt, status: 'pending', aspectRatio });
      addedGenerations.push(product.generations[product.generations.length - 1]);
    }
    await product.save();

    res.status(202).json({ message: `Started generating ${scenePrompts.length} images`, count: scenePrompts.length, generations: addedGenerations });

    (async () => {
      const prodImages = product.productImages.map(p => ({ data: p.imageData, mimeType: p.mimeType }));
      const avaImages = product.avatarImages ? product.avatarImages.map(p => ({ data: p.imageData, mimeType: p.mimeType })) : [];
      for (const genInfo of addedGenerations) {
        try {
          const checkProduct = await UgcProduct.findById(req.params.id);
          if (checkProduct) { const cg = checkProduct.generations.id(genInfo._id); if (!cg || cg.status === 'cancelled') { console.log(`[UGC Product] Generation ${genInfo._id} cancelled, skipping.`); continue; } }
          const result = await ugcProductService.generateProductUGC(prodImages, product.visualBible, genInfo.prompt, { aspectRatio }, avaImages);
          const up = await UgcProduct.findById(req.params.id); const g = up.generations.id(genInfo._id);
          if (g) { g.resultFilename = result.filename; g.description = result.description; g.status = 'completed'; up.updatedAt = Date.now(); await up.save(); }
          console.log(`[UGC Product] Generation ${genInfo._id} completed`);
        } catch (genErr) {
          console.error(`[UGC Product] Generation ${genInfo._id} failed:`, genErr.message);
          try { const up = await UgcProduct.findById(req.params.id); const g = up.generations.id(genInfo._id); if (g) { g.status = 'failed'; g.error = genErr.message; await up.save(); } } catch { }
        }
      }
    })();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/generations/:genId', async (req, res) => {
  try {
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const gen = product.generations.id(req.params.genId);
    if (!gen) return res.status(404).json({ error: 'Generation not found' });
    res.json(gen);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/generations/:genId', async (req, res) => {
  try {
    const product = await UgcProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const gen = product.generations.id(req.params.genId);
    if (!gen) return res.status(404).json({ error: 'Generation not found' });
    if (gen.resultFilename) {
      try { await fs.promises.unlink(path.join(__dirname, '..', 'ugc-output', gen.resultFilename)); } catch { }
    }
    product.generations.pull(req.params.genId);
    product.updatedAt = Date.now();
    await product.save();
    res.json({ message: 'Generation deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
