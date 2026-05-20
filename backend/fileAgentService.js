/**
 * File Agent Service
 * Creates, lists, reads and deletes files in the app's files directory.
 * Files persist on disk so they can be referenced by Messenger for attachments.
 */
const fs = require('fs');
const path = require('path');

const FILES_DIR = path.join(__dirname, 'files');

// In-memory reference to the most recently created file (for same-turn attach)
let _lastCreatedFilePath = null;

function getLastCreatedFilePath() { return _lastCreatedFilePath; }

function ensureDir() {
    if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
}

function safeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._\-À-ɏ]/g, '_').replace(/_{2,}/g, '_');
}

// ── Actions ───────────────────────────────────────────────────────────────────

function createFile({ filename, content, subdir }) {
    ensureDir();
    const dir = subdir ? path.join(FILES_DIR, safeFilename(subdir)) : FILES_DIR;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const safeName = safeFilename(filename || `document_${Date.now()}.txt`);
    const filePath = path.join(dir, safeName);

    fs.writeFileSync(filePath, content || '', 'utf8');
    _lastCreatedFilePath = filePath;

    const size = fs.statSync(filePath).size;
    console.log(`[FileAgent] Created: ${filePath} (${size} bytes)`);
    return { path: filePath, filename: safeName, size, directory: dir };
}

function listFiles({ subdir } = {}) {
    ensureDir();
    const dir = subdir ? path.join(FILES_DIR, safeFilename(subdir)) : FILES_DIR;
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
        .filter(f => !f.startsWith('.'))
        .map(f => {
            const fp = path.join(dir, f);
            const stat = fs.statSync(fp);
            return { filename: f, path: fp, size: stat.size, modified: stat.mtime };
        })
        .sort((a, b) => b.modified - a.modified);
}

function readFile({ path: filePath, filename }) {
    const fp = filePath || path.join(FILES_DIR, safeFilename(filename || ''));
    if (!fs.existsSync(fp)) throw new Error(`Fișierul nu există: ${fp}`);
    return { path: fp, filename: path.basename(fp), content: fs.readFileSync(fp, 'utf8') };
}

function deleteFile({ path: filePath, filename }) {
    const fp = filePath || path.join(FILES_DIR, safeFilename(filename || ''));
    if (!fs.existsSync(fp)) throw new Error(`Fișierul nu există: ${fp}`);
    fs.unlinkSync(fp);
    if (_lastCreatedFilePath === fp) _lastCreatedFilePath = null;
    console.log(`[FileAgent] Deleted: ${fp}`);
    return { deleted: path.basename(fp) };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

function executeFileAction(data) {
    if (!data) return null;
    const { action } = data;

    switch (action) {
        case 'create': return createFile(data);
        case 'list':   return listFiles(data);
        case 'read':   return readFile(data);
        case 'delete': return deleteFile(data);
        default: throw new Error(`Unknown file action: ${action}`);
    }
}

function setLastCreatedFilePath(p) { _lastCreatedFilePath = p; }

module.exports = { executeFileAction, getLastCreatedFilePath, setLastCreatedFilePath, FILES_DIR };
