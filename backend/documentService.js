/**
 * Document Service
 * Multi-turn document creation: draft → build HTML → PDF → publish to eneflorian.com
 */
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const FILES_DIR = path.join(__dirname, 'files');
const PUBLISH_URL = 'http://127.0.0.1:3004/api/publish';

// ── HTML Template ─────────────────────────────────────────────────────────────

function renderSectionHTML(s) {
    switch (s.type) {
        case 'heading': {
            const tag = `h${Math.min(Math.max(s.level || 2, 1), 4)}`;
            const cls = s.level <= 2 ? 'section-heading' : 'sub-heading';
            return `<${tag} class="${cls}">${s.text || ''}</${tag}>`;
        }
        case 'intro':
            return `<div class="intro-block"><p>${(s.text || '').replace(/\n/g, '</p><p>')}</p></div>`;
        case 'paragraph':
            return `<p>${(s.text || '').replace(/\n/g, '</p><p>')}</p>`;
        case 'code':
            return `<div class="code-block"><div class="code-lang">${s.lang || 'text'}</div><pre><code>${escHtml(s.code || '')}</code></pre></div>`;
        case 'list':
            if (!s.items?.length) return '';
            return `<ul class="content-list">${s.items.map(i => `<li>${i}</li>`).join('')}</ul>`;
        case 'tip':
            return `<div class="callout callout-tip"><span class="callout-icon">💡</span><div><strong>Tip</strong><p>${s.text || ''}</p></div></div>`;
        case 'warning':
            return `<div class="callout callout-warning"><span class="callout-icon">⚠️</span><div><strong>Atenție</strong><p>${s.text || ''}</p></div></div>`;
        case 'note':
            return `<div class="callout callout-note"><span class="callout-icon">📝</span><div><strong>Notă</strong><p>${s.text || ''}</p></div></div>`;
        case 'image':
            return `<figure class="content-figure"><img src="${s.url || ''}" alt="${s.caption || ''}" />${s.caption ? `<figcaption>${s.caption}</figcaption>` : ''}</figure>`;
        case 'divider':
            return `<hr class="section-divider" />`;
        case 'conclusion':
            return `<div class="conclusion-block"><h3>Concluzie</h3><p>${(s.text || '').replace(/\n/g, '</p><p>')}</p></div>`;
        default:
            return `<p>${s.text || ''}</p>`;
    }
}

function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildTableOfContents(sections) {
    const headings = sections.filter(s => s.type === 'heading' && s.level <= 2);
    if (headings.length < 2) return '';
    const items = headings.map((h, i) =>
        `<li><a href="#section-${i}">${h.text}</a></li>`
    ).join('');
    return `<nav class="toc"><h3>Cuprins</h3><ol>${items}</ol></nav>`;
}

function addSectionIds(sections) {
    let idx = 0;
    return sections.map(s => {
        if (s.type === 'heading' && s.level <= 2) {
            const id = `section-${idx++}`;
            const tag = `h${Math.min(Math.max(s.level || 2, 1), 4)}`;
            const cls = s.level <= 2 ? 'section-heading' : 'sub-heading';
            return `<${tag} id="${id}" class="${cls}">${s.text || ''}</${tag}>`;
        }
        return renderSectionHTML(s);
    });
}

function buildFullHTML(doc, forPdf = false) {
    const tocHTML = buildTableOfContents(doc.sections || []);
    const bodyParts = addSectionIds(doc.sections || []);
    const today = new Date().toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
    const badgeHtml = (doc.badges || []).map(b => `<span class="badge">${b}</span>`).join('');

    return `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${doc.title}</title>
<style>
  :root {
    --primary: #6366f1;
    --primary-dark: #4f46e5;
    --accent: #10b981;
    --warn: #f59e0b;
    --danger: #ef4444;
    --bg: #0f0f1a;
    --surface: #1a1a2e;
    --surface2: #16213e;
    --border: #2a2a4a;
    --text: #e2e8f0;
    --text-muted: #94a3b8;
    --code-bg: #0d0d1f;
    --radius: 12px;
    --font: 'Segoe UI', system-ui, sans-serif;
    --font-mono: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  }
  ${forPdf ? `
  :root { --bg: #fff; --surface: #f8fafc; --surface2: #f1f5f9; --border: #e2e8f0; --text: #1e293b; --text-muted: #64748b; --code-bg: #1e293b; }
  ` : ''}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 16px; line-height: 1.75; }

  .tutorial-container { max-width: 860px; margin: 0 auto; padding: ${forPdf ? '20px 32px' : '40px 24px'}; }

  .tutorial-header { margin-bottom: 40px; padding-bottom: 32px; border-bottom: 2px solid var(--border); }
  .tutorial-category { font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--primary); margin-bottom: 12px; }
  .tutorial-title { font-size: ${forPdf ? '32px' : '2.4rem'}; font-weight: 800; line-height: 1.2; margin-bottom: 16px; background: linear-gradient(135deg, var(--primary), var(--accent)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  ${forPdf ? '.tutorial-title { color: var(--primary); background: none; -webkit-text-fill-color: var(--primary); }' : ''}
  .tutorial-description { font-size: 1.1rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 20px; }
  .tutorial-meta { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .meta-item { font-size: 13px; color: var(--text-muted); }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; background: var(--primary); color: #fff; margin-right: 6px; }

  .toc { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px 28px; margin: 32px 0; }
  .toc h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); margin-bottom: 14px; }
  .toc ol { padding-left: 20px; }
  .toc li { margin-bottom: 6px; }
  .toc a { color: var(--primary); text-decoration: none; font-size: 15px; }
  .toc a:hover { text-decoration: underline; }

  .tutorial-body p { margin-bottom: 18px; }
  .tutorial-body p:last-child { margin-bottom: 0; }

  .section-heading { font-size: ${forPdf ? '22px' : '1.6rem'}; font-weight: 700; margin: 48px 0 20px; padding-bottom: 12px; border-bottom: 1px solid var(--border); color: var(--text); }
  .sub-heading { font-size: ${forPdf ? '18px' : '1.25rem'}; font-weight: 600; margin: 32px 0 14px; color: var(--text); }

  .intro-block { background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(16,185,129,0.1)); border-left: 4px solid var(--primary); border-radius: 0 var(--radius) var(--radius) 0; padding: 20px 24px; margin-bottom: 32px; }

  .code-block { background: var(--code-bg); border-radius: var(--radius); overflow: hidden; margin: 24px 0; border: 1px solid var(--border); }
  .code-lang { background: rgba(99,102,241,0.2); color: var(--primary); font-size: 12px; font-weight: 700; padding: 8px 16px; text-transform: uppercase; letter-spacing: 1px; }
  .code-block pre { padding: 20px; overflow-x: auto; }
  .code-block code { font-family: var(--font-mono); font-size: 14px; line-height: 1.6; color: ${forPdf ? '#e2e8f0' : 'var(--text)'}; }

  .content-list { padding-left: 24px; margin: 16px 0; }
  .content-list li { margin-bottom: 10px; }

  .callout { display: flex; gap: 16px; padding: 18px 22px; border-radius: var(--radius); margin: 24px 0; }
  .callout-icon { font-size: 22px; flex-shrink: 0; margin-top: 2px; }
  .callout strong { display: block; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .callout p { margin: 0; font-size: 15px; }
  .callout-tip { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); }
  .callout-tip strong { color: var(--accent); }
  .callout-warning { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); }
  .callout-warning strong { color: var(--warn); }
  .callout-note { background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3); }
  .callout-note strong { color: var(--primary); }

  .content-figure { text-align: center; margin: 28px 0; }
  .content-figure img { max-width: 100%; border-radius: var(--radius); border: 1px solid var(--border); }
  .content-figure figcaption { font-size: 13px; color: var(--text-muted); margin-top: 10px; }

  .section-divider { border: none; border-top: 1px solid var(--border); margin: 40px 0; }

  .conclusion-block { background: var(--surface); border-radius: var(--radius); padding: 28px; margin-top: 48px; border: 1px solid var(--border); }
  .conclusion-block h3 { font-size: 18px; color: var(--primary); margin-bottom: 14px; }

  .tutorial-footer { margin-top: 60px; padding-top: 24px; border-top: 1px solid var(--border); font-size: 13px; color: var(--text-muted); text-align: center; }

  @media print { body { background: white; color: black; } }
</style>
</head>
<body>
<div class="tutorial-container">
  <header class="tutorial-header">
    <div class="tutorial-category">${doc.categoryId || 'Tutorial'}</div>
    <h1 class="tutorial-title">${doc.title}</h1>
    <p class="tutorial-description">${doc.description || ''}</p>
    <div class="tutorial-meta">
      <span class="meta-item">✍️ ${doc.author || 'Ilie AI'}</span>
      <span class="meta-item">📅 ${today}</span>
      <span>${badgeHtml}</span>
    </div>
  </header>
  ${tocHTML}
  <div class="tutorial-body">
    ${bodyParts.join('\n    ')}
  </div>
  <footer class="tutorial-footer">
    Generat de Ilie AI • eneflorian.com
  </footer>
</div>
</body>
</html>`;
}

// ── PDF Generation via Playwright ─────────────────────────────────────────────

async function generatePDF(doc) {
    const { chromium } = require('playwright');
    if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

    const htmlContent = buildFullHTML(doc, true);
    const pdfPath = path.join(FILES_DIR, `${doc.slug || doc.docId}.pdf`);

    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle' });
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
            printBackground: true,
        });
        console.log('[DocAgent] PDF generated:', pdfPath);
        return pdfPath;
    } finally {
        if (browser) await browser.close();
    }
}

// ── Publish to eneflorian.com ─────────────────────────────────────────────────

async function publishToSite(doc) {
    const payload = {
        type: 'tutorial',
        content: {
            slug: doc.slug,
            title: doc.title,
            description: doc.description,
            categoryId: doc.categoryId,
            date: new Date().toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }),
            badges: doc.badges || ['text'],
            content: doc.htmlContent,
        }
    };

    const res = await fetch(PUBLISH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Publish failed (${res.status}): ${body}`);
    }

    const result = await res.json();
    console.log('[DocAgent] Published to eneflorian.com:', doc.slug);
    return result;
}

// ── Service Functions ─────────────────────────────────────────────────────────

async function getModel() {
    return mongoose.model('DocumentDraft');
}

function makeDocId() {
    return 'doc_' + randomUUID().split('-')[0];
}

function makeSlug(title) {
    return title.toLowerCase()
        .replace(/[ăâ]/g, 'a').replace(/[îí]/g, 'i').replace(/[ș]/g, 's').replace(/[ț]/g, 't').replace(/[é]/g, 'e')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function startDraft({ title, description, categoryId, slug, badges, author, premium, sessionId }) {
    const Doc = await getModel();
    const docId = makeDocId();
    const doc = await Doc.create({
        docId,
        title,
        description: description || '',
        categoryId: categoryId || 'ai-agents',
        slug: slug || makeSlug(title),
        badges: badges || ['text'],
        author: author || 'Ilie AI',
        premium: premium || false,
        sessionId: sessionId || '',
        sections: [],
    });
    console.log('[DocAgent] Draft started:', docId, title);
    return doc;
}

async function addSection(docId, section) {
    const Doc = await getModel();
    const doc = await Doc.findOneAndUpdate(
        { docId },
        { $push: { sections: section }, status: 'draft' },
        { new: true }
    );
    if (!doc) throw new Error(`Draft not found: ${docId}`);
    console.log(`[DocAgent] Section added to ${docId}: ${section.type} "${section.text?.substring(0, 40) || ''}"`);
    return doc;
}

async function setSections(docId, sections) {
    const Doc = await getModel();
    const doc = await Doc.findOneAndUpdate(
        { docId },
        { sections, status: 'draft' },
        { new: true }
    );
    if (!doc) throw new Error(`Draft not found: ${docId}`);
    console.log(`[DocAgent] ${sections.length} sections set on ${docId}`);
    return doc;
}

async function updateMeta(docId, updates) {
    const Doc = await getModel();
    const allowed = ['title', 'description', 'categoryId', 'slug', 'badges', 'author', 'premium'];
    const patch = {};
    for (const k of allowed) { if (updates[k] !== undefined) patch[k] = updates[k]; }
    const doc = await Doc.findOneAndUpdate({ docId }, patch, { new: true });
    if (!doc) throw new Error(`Draft not found: ${docId}`);
    return doc;
}

async function buildDoc(docId) {
    const Doc = await getModel();
    const doc = await Doc.findOne({ docId }).lean();
    if (!doc) throw new Error(`Draft not found: ${docId}`);
    if (!doc.sections?.length) throw new Error('Documentul nu are secțiuni. Adaugă conținut mai întâi (note → synthesize sau add).');

    const htmlContent = buildFullHTML(doc, false);
    if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
    const htmlPath = path.join(FILES_DIR, `${doc.slug || docId}.html`);
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');

    await Doc.findOneAndUpdate({ docId }, { htmlContent, filePath: htmlPath, status: 'built' });
    console.log('[DocAgent] HTML built:', htmlPath);

    // Auto-generate PDF — WhatsApp/email clients handle PDF far better than HTML
    let pdfPath = null;
    try {
        const docWithHtml = { ...doc, htmlContent };
        pdfPath = await generatePDF(docWithHtml);
        await Doc.findOneAndUpdate({ docId }, { pdfPath });
        const { setLastCreatedFilePath } = require('./fileAgentService');
        setLastCreatedFilePath(pdfPath);
        console.log('[DocAgent] PDF auto-generated:', pdfPath);
    } catch (pdfErr) {
        console.warn('[DocAgent] PDF generation failed, falling back to HTML:', pdfErr.message);
        const { setLastCreatedFilePath } = require('./fileAgentService');
        setLastCreatedFilePath(htmlPath);
    }

    return { ...doc, htmlContent, filePath: htmlPath, pdfPath };
}

async function generatePDFAction(docId) {
    const Doc = await getModel();
    let doc = await Doc.findOne({ docId }).lean();
    if (!doc) throw new Error(`Draft not found: ${docId}`);
    if (!doc.sections?.length) throw new Error('Documentul nu are secțiuni. Adaugă conținut mai întâi.');
    if (!doc.htmlContent) { doc = await buildDoc(docId); }

    const pdfPath = await generatePDF(doc);
    await Doc.findOneAndUpdate({ docId }, { pdfPath });
    // Prefer PDF over HTML for last_created
    const { setLastCreatedFilePath } = require('./fileAgentService');
    setLastCreatedFilePath(pdfPath);
    console.log('[DocAgent] PDF generated:', pdfPath);
    return { ...doc, pdfPath };
}

async function publishDoc(docId) {
    const Doc = await getModel();
    let doc = await Doc.findOne({ docId }).lean();
    if (!doc) throw new Error(`Draft not found: ${docId}`);
    if (!doc.htmlContent) { doc = await buildDoc(docId); }

    const result = await publishToSite(doc);
    const publishedUrl = `https://eneflorian.com/tutorials/${doc.slug}`;
    await Doc.findOneAndUpdate({ docId }, { status: 'published', publishedUrl });
    return { ...doc, publishedUrl, publishResult: result };
}

async function getDraftStatus(docId) {
    const Doc = await getModel();
    const doc = await Doc.findOne({ docId }).lean();
    if (!doc) throw new Error(`Draft not found: ${docId}`);
    return doc;
}

async function listDrafts() {
    const Doc = await getModel();
    return Doc.find().select('docId title status categoryId sections updatedAt').sort({ updatedAt: -1 }).limit(20).lean();
}

async function getLatestDraft(sessionId) {
    const Doc = await getModel();
    // 1. Session-specific with sections (best match)
    if (sessionId) {
        const sessionDoc = await Doc.findOne({ sessionId, 'sections.0': { $exists: true } }).sort({ updatedAt: -1 }).lean();
        if (sessionDoc) return sessionDoc;
        // 2. Session-specific any status
        const sessionAny = await Doc.findOne({ sessionId }).sort({ updatedAt: -1 }).lean();
        if (sessionAny) return sessionAny;
    }
    // 3. Global: prefer docs with sections, any status
    const withSections = await Doc.findOne({ 'sections.0': { $exists: true } }).sort({ updatedAt: -1 }).lean();
    if (withSections) return withSections;
    // 4. Fallback: anything
    return Doc.findOne({}).sort({ updatedAt: -1 }).lean();
}

// ── Note: capture raw conversational idea ─────────────────────────────────────

async function addNote(docId, text) {
    const Doc = await getModel();
    const doc = await Doc.findOneAndUpdate(
        { docId },
        { $push: { notes: text } },
        { new: true }
    );
    if (!doc) throw new Error(`Draft not found: ${docId}`);
    console.log(`[DocAgent] Note added to ${docId}: "${text.substring(0, 60)}..."`);
    return doc;
}

// ── Synthesize: convert buffered notes → structured sections via Gemini ───────

async function synthesizeNotes(docId) {
    const Doc = await getModel();
    const doc = await Doc.findOne({ docId }).lean();
    if (!doc) throw new Error(`Draft not found: ${docId}`);

    const allNotes = doc.notes || [];
    if (allNotes.length === 0) throw new Error('Nu există note de sintetizat. Adaugă câteva idei mai întâi.');

    const existingSections = doc.sections || [];
    const sectionsContext = existingSections.length > 0
        ? `\nSecțiuni deja existente în document (NU le duplica):\n${existingSections.map(s => `- [${s.type}] ${s.text?.substring(0, 80) || s.code?.substring(0, 40) || ''}`).join('\n')}`
        : '';

    const synthesisPrompt = `Ești un parser de text. Convertești note brute în secțiuni JSON pentru un document.

Document: "${doc.title}"
Categorie: ${doc.categoryId}
${sectionsContext}

NOTE BRUTE din conversație:
${allNotes.map((n, i) => `[Nota ${i + 1}]: ${n}`).join('\n')}

REGULI STRICTE:
1. PĂSTREAZĂ textul EXACT cum este dictat — nu rescrie, nu parafrazezi, nu reformulezi, nu "îmbunătățești" stilul
2. Singurele modificări permise: corectează greșelile clare de transcriere vocală (cuvinte lipsite de sens)
3. Ignoră DOAR frazele complet lipsite de conținut: "ok", "da", "deci", "mhm", salutări scurte
4. Elimină repetiții EXACTE ale aceleiași fraze, dar nu "compacta" idei diferite
5. Decide EXCLUSIV tipul de secțiune și structura logică — nu rescrie conținutul
6. Returnează STRICT un array JSON valid, fără text în afara lui

Format fiecare secțiune ca obiect cu câmpurile:
- type: "heading" | "paragraph" | "code" | "list" | "tip" | "warning" | "note" | "conclusion"
- text: string (pentru heading, paragraph, tip, warning, note, conclusion)
- level: number (2 sau 3, doar pentru heading)
- code: string + lang: string (pentru code)
- items: string[] (pentru list)

Returnează DOAR array-ul JSON:
[{"type":"heading","text":"...","level":2}, {"type":"paragraph","text":"..."}, ...]`;

    const { getGeminiModel } = require('./configService');
    const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
    let responseText = '';
    for (const modelName of MODELS) {
        try {
            const model = await getGeminiModel(null, modelName);
            const chat = model.startChat({ history: [] });
            const result = await chat.sendMessage(synthesisPrompt);
            responseText = result.response.text().trim();
            if (modelName !== MODELS[0]) console.log(`[DocAgent] Used fallback model: ${modelName}`);
            break;
        } catch (err) {
            const retryable = err.message?.includes('429') || err.message?.includes('404') || err.message?.includes('not found');
            if (retryable && modelName !== MODELS[MODELS.length - 1]) {
                console.warn(`[DocAgent] ${modelName} unavailable, trying next...`);
                continue;
            }
            throw err;
        }
    }

    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Sinteza nu a returnat JSON valid. Încearcă din nou.');

    const newSections = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(newSections) || newSections.length === 0) {
        throw new Error('Sinteza a returnat 0 secțiuni. Poate notele nu conțin conținut documentar suficient.');
    }

    await Doc.findOneAndUpdate({ docId }, {
        $push: { sections: { $each: newSections } },
        $set: { notes: [], status: 'draft' },
    });

    const updated = await Doc.findOne({ docId }).lean();
    console.log(`[DocAgent] Synthesized ${newSections.length} sections from ${allNotes.length} notes on ${docId}`);
    return { doc: updated, synthesized: newSections.length, fromNotes: allNotes.length };
}

// ── Compile: synthesize text passed directly (no notes buffer needed) ─────────

async function compileFromText(docId, text) {
    const Doc = await getModel();
    const doc = await Doc.findOne({ docId }).lean();
    if (!doc) throw new Error(`Draft not found: ${docId}`);

    const existingSections = doc.sections || [];
    const sectionsContext = existingSections.length > 0
        ? `\nSecțiuni deja existente (NU le duplica):\n${existingSections.map(s => `- [${s.type}] ${(s.text || s.code || '').substring(0, 80)}`).join('\n')}`
        : '';

    const prompt = `Ești un parser de text. Convertești textul de mai jos în secțiuni JSON pentru un document.

Document: "${doc.title}"
Categorie: ${doc.categoryId}
${sectionsContext}

TEXT DE CONVERTIT:
${text}

REGULI STRICTE:
1. PĂSTREAZĂ textul EXACT cum este — nu rescrie, nu parafrazezi, nu reformulezi, nu "îmbunătățești"
2. Singurele modificări permise: corectează greșelile clare de transcriere vocală (cuvinte lipsite de sens)
3. Ignoră DOAR frazele complet lipsite de conținut: "ok", "da", "deci", "mhm", salutări scurte
4. Decide EXCLUSIV tipul de secțiune (heading/paragraph/list etc.) și organizează blocurile
5. Returnează STRICT un array JSON valid, fără text în afara lui

Format: [{"type":"heading","text":"...","level":2}, {"type":"paragraph","text":"..."}, {"type":"list","items":["..."]}, ...]
Returnează DOAR array-ul JSON:`;

    const { getGeminiModel } = require('./configService');
    const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
    let responseText = '';
    for (const modelName of MODELS) {
        try {
            const model = await getGeminiModel(null, modelName);
            const result = await model.startChat({ history: [] }).sendMessage(prompt);
            responseText = result.response.text().trim();
            if (modelName !== MODELS[0]) console.log(`[DocAgent] Used fallback model: ${modelName}`);
            break;
        } catch (err) {
            const retryable = err.message?.includes('429') || err.message?.includes('404') || err.message?.includes('not found');
            if (retryable && modelName !== MODELS[MODELS.length - 1]) {
                console.warn(`[DocAgent] ${modelName} unavailable, trying next...`);
                continue;
            }
            throw err;
        }
    }

    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Compilarea nu a returnat JSON valid.');
    const newSections = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(newSections) || newSections.length === 0) throw new Error('Compilarea a returnat 0 secțiuni.');

    await Doc.findOneAndUpdate({ docId }, {
        $push: { sections: { $each: newSections } },
        $set: { status: 'draft' },
    });

    const updated = await Doc.findOne({ docId }).lean();
    console.log(`[DocAgent] Compiled ${newSections.length} sections from direct text on ${docId}`);
    return { doc: updated, compiled: newSections.length };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

async function executeDocAction(data, sessionId) {
    const action = data.action;

    // Resolve docId: explicit or latest for session
    let docId = data.docId;
    if (!docId && action !== 'start' && action !== 'list') {
        const latest = await getLatestDraft(sessionId);
        if (latest) docId = latest.docId;
    }

    switch (action) {
        case 'start': {
            const draft = await startDraft({ ...data, sessionId });
            // If content/text provided with start, auto-compile into sections
            const startContent = data.content || data.text;
            if (startContent) {
                try {
                    await compileFromText(draft.docId, startContent);
                    const withSections = await mongoose.model('DocumentDraft').findOne({ docId: draft.docId }).lean();
                    console.log(`[DocAgent] Auto-compiled ${withSections.sections?.length || 0} sections on start`);
                    return withSections;
                } catch (compileErr) {
                    console.warn('[DocAgent] Auto-compile on start failed:', compileErr.message);
                    return draft; // return draft without sections, compile can be retried
                }
            }
            return draft;
        }

        case 'note': {
            if (!docId) throw new Error('Niciun document activ. Folosește action:"start" mai întâi.');
            const noteText = data.text || data.note;
            if (!noteText) throw new Error('Câmpul "text" este necesar pentru note.');
            return addNote(docId, noteText);
        }

        case 'synthesize': {
            if (!docId) throw new Error('Niciun document activ.');
            return synthesizeNotes(docId);
        }

        case 'compile': {
            if (!docId) throw new Error('Niciun document activ. Folosește action:"start" mai întâi.');
            const compileText = data.text || data.content;
            if (!compileText) throw new Error('Câmpul "text" este necesar pentru compile.');
            return compileFromText(docId, compileText);
        }

        case 'add': {
            if (!docId) throw new Error('Niciun document activ. Folosește action:"start" mai întâi.');
            const section = {
                type: data.type || 'paragraph',
                text: data.text,
                level: data.level,
                code: data.code,
                lang: data.lang,
                items: data.items,
                url: data.url,
                caption: data.caption,
            };
            return addSection(docId, section);
        }

        case 'set_sections': {
            if (!docId) throw new Error('Niciun document activ.');
            return setSections(docId, data.sections || []);
        }

        case 'update_meta': {
            if (!docId) throw new Error('Niciun document activ.');
            return updateMeta(docId, data);
        }

        case 'status': {
            if (!docId) {
                const latest = await getLatestDraft(sessionId);
                if (!latest) return { message: 'Niciun document activ.' };
                return latest;
            }
            return getDraftStatus(docId);
        }

        case 'list':
            return listDrafts();

        case 'build': {
            if (!docId) throw new Error('Niciun document activ.');
            return buildDoc(docId);
        }

        case 'pdf': {
            if (!docId) throw new Error('Niciun document activ.');
            return generatePDFAction(docId);
        }

        case 'publish': {
            if (!docId) throw new Error('Niciun document activ.');
            return publishDoc(docId);
        }

        default:
            throw new Error(`Unknown doc action: ${action}`);
    }
}

module.exports = { executeDocAction, buildFullHTML, getLatestDraft };
