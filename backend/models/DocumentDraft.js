const mongoose = require('mongoose');

const SectionSchema = new mongoose.Schema({
    type: { type: String, enum: ['heading', 'paragraph', 'code', 'list', 'tip', 'warning', 'note', 'image', 'divider', 'intro', 'conclusion'], default: 'paragraph' },
    text: String,
    level: { type: Number, default: 2 },   // for heading: 1-4
    code: String,
    lang: { type: String, default: 'text' },
    items: [String],
    url: String,
    caption: String,
}, { _id: false });

const DocumentDraftSchema = new mongoose.Schema({
    docId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    categoryId: { type: String, default: 'ai-agents' },
    slug: { type: String, default: '' },
    badges: { type: [String], default: ['text'] },
    author: { type: String, default: 'Ilie AI' },
    premium: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'built', 'published'], default: 'draft' },
    sections: [SectionSchema],
    htmlContent: { type: String, default: '' },
    filePath: { type: String, default: '' },
    pdfPath: { type: String, default: '' },
    publishedUrl: { type: String, default: '' },
    sessionId: { type: String, default: '' },
    // Raw voice/conversational notes — unstructured, synthesized later
    notes: [{ type: String }],
}, { timestamps: true });

module.exports = mongoose.model('DocumentDraft', DocumentDraftSchema);
