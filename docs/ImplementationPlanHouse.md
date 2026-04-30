Vector Search + House Object Tracking Agent
Adăugăm vector search semantic la MongoDB și construim un agent de tracking obiecte casă care rulează în background pe frame-urile camerei de la ochelari.

Cum funcționează (arhitectura)
Ray-Ban Glasses → Gemini Live (vede frame-uri ~1fps)
       │
       │ tool call: execute("scan objects")
       ▼
Backend /v1/chat/completions
       │
       ├── Glasess Gateway (normal) → Răspunde la conversație
       │
       └── objectTrackingService.js [NOU] → Background processing
              │
              ├── Primește descrierea scenei de la Gemini
              ├── Compară cu locațiile cunoscute (vector search)
              ├── Dacă obiect mutat → creează DisplacedObject
              └── Dacă 5+ displaced → notifică user (push notification)
IMPORTANT

Abordare cheie: Nu trimitem frame-uri separate la backend. Gemini deja vede prin cameră. Modificăm system prompt-ul din 

glassesGatewayService.js
 să includă instrucțiuni de scanare obiecte, iar Gemini va raporta ce vede prin tag-uri <OBJECT_SCAN_JSON>. Procesarea se face silent (nu afectează conversația principală).

Proposed Changes
Componenta 1: Vector Search (Embedding Service)
[NEW] 

embeddingService.js
Serviciu de generare embeddings cu Gemini text-embedding-004:

generateEmbedding(text) — generează vector 768-dim pentru un text
semanticSearch(query, collection, field, limit) — caută în MongoDB prin cosine similarity
Folosește MongoDB $vectorSearch aggregation (dacă Atlas) sau fallback cu calcul local
[MODIFY] 

knowledgeService.js
Adaugă semanticSearchKnowledge(query) care folosește embeddings în loc de regex
Funcția 

searchKnowledge()
 existentă rămâne ca fallback
[MODIFY] 

package.json
Adaugă dependință mongodb (driver nativ) pentru operații vector dacă e nevoie, sau folosim Mongoose direct
Componenta 2: House Object Tracking Schema
[MODIFY] 

server.js
Adaugă 3 modele Mongoose noi:

javascript
// Obiect cunoscut din casă (registrul de obiecte)
const HouseObjectSchema = new mongoose.Schema({
  name: String,                    // "Telecomanda TV"
  description: String,             // "Telecomandă neagră Samsung"
  expectedLocation: String,        // "Pe masă la sufragerie, lângă TV"
  imageDescription: String,        // Descriere vizuală de la Gemini
  embedding: [Number],             // Vector 768-dim pentru semantic search
  lastSeen: Date,
  lastSeenLocation: String,
  timesDisplaced: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
// Obiect detectat mutat din locul lui
const DisplacedObjectSchema = new mongoose.Schema({
  houseObjectId: mongoose.Schema.Types.ObjectId,
  objectName: String,
  expectedLocation: String,
  foundLocation: String,
  status: { type: String, enum: ['pending', 'added_to_calendar', 'resolved'], default: 'pending' },
  detectedAt: { type: Date, default: Date.now }
});
// Batch de notificări (grupează 5+ obiecte deplasate)
const CleanupBatchSchema = new mongoose.Schema({
  displacedObjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DisplacedObject' }],
  status: { type: String, enum: ['pending', 'approved', 'dismissed'], default: 'pending' },
  notifiedAt: { type: Date, default: Date.now }
});
Adaugă rute API:

GET /api/house-objects — listare obiecte cunoscute
POST /api/house-objects — adaugă obiect nou (manual sau din scanare)
PATCH /api/house-objects/:id — actualizare locație
DELETE /api/house-objects/:id — șterge obiect
GET /api/displaced-objects — obiecte deplasate pending
POST /api/displaced-objects/:batchId/approve — approve batch → creează task-uri
POST /api/displaced-objects/:batchId/dismiss — dismiss batch
Componenta 3: Object Tracking Service (Backend)
[NEW] 

objectTrackingService.js
Serviciul principal de tracking:

processObjectScan(scannedObjects) — primește lista de obiecte detectate de Gemini
Pentru fiecare obiect: verifică dacă e cunoscut (semantic search cu embedding)
Dacă e cunoscut și e în altă locație → creează DisplacedObject
Dacă e necunoscut și utilizatorul a cerut tracking → adaugă în HouseObject
checkAndNotify() — verifică dacă sunt 5+ obiecte displasate pending
Dacă da → creează CleanupBatch + trimite notificare (endpoint frontend)
learnObject(name, description, location, imageDesc) — învață un obiect nou
getObjectContext() — returnează context rezumat pentru system prompt
[MODIFY] 

glassesGatewayService.js
Modificări la system prompt + procesare:

Adaugă în system prompt instrucțiunea de background scanning:
BACKGROUND SCAN (rulează automat, NU afișa în răspuns):
Când vezi obiecte în casă prin camera ochelarilor, raportează-le SILENT:
<OBJECT_SCAN_JSON>{"objects":[{"name":"telecomandă","location":"pe canapea","description":"telecomandă neagră Samsung"}]}</OBJECT_SCAN_JSON>
Fă asta DOAR când ești acasă și vezi obiecte de uz casnic.
NU menționa scanarea în răspunsul vocal.
Procesează tag-ul OBJECT_SCAN_JSON în 

processGlassesRequest()
 — similar cu cum procesezi deja TASK_JSON, WHATSAPP_JSON, etc.

Adaugă tool de învățare — când utilizatorul zice "ține minte că telecomanda stă pe masă", se creează HouseObject

Componenta 4: Frontend — House Objects Page
[NEW] 

page.tsx
Pagină nouă cu:

Lista obiecte cunoscute — cu descriere, locație așteptată, ultima vedere
Obiecte deplasate — card-uri cu "Telecomanda e pe canapea, ar trebui pe masă"
Cleanup Batch notification — banner cu "5 obiecte sunt deplasate" + buton Approve (creează task-uri) și Dismiss
Adaugă obiect manual — formular simplu
[MODIFY] 

Navigation.tsx
Adaugă link "🏠 House Objects" în navigare
User Review Required
IMPORTANT

Întrebare design: Gemini Live primește frame-uri la ~1fps. Scanarea de obiecte va fi inclusă în system prompt-ul existent (economie de API calls) — nu face un call separat. Asta înseamnă că fiecare răspuns poate conține și <OBJECT_SCAN_JSON>, dar scanarea nu va fi menționată vocal. E OK această abordare?

WARNING

Vector embeddings pe MongoDB local: Folosești MongoDB local (mongodb://127.0.0.1:27017), nu Atlas. Vom genera embeddings cu Gemini text-embedding-004 și le stocam ca array de numere în MongoDB. Căutarea se face cu calcul local de cosine similarity (nu $vectorSearch Atlas). Pentru un număr mic de obiecte casnice (<500), performanța e excelentă.

Verification Plan
Automated Tests
Nu există teste automatizate în proiect (backend-ul nu are framework de test). Vom verifica manual.

Manual Verification
Vector Search:

Pornește backend-ul cu npm run dev din root
Adaugă câteva house objects via API: curl -X POST http://localhost:5000/api/house-objects -H "Content-Type: application/json" -d '{"name":"telecomandă","description":"telecomandă neagră Samsung","expectedLocation":"pe masă lângă TV"}'
Verifică semantic search: curl http://localhost:5000/api/house-objects/search?q=remote+control (ar trebui să găsească "telecomandă")
Object Tracking Flow:

Trimite un request simulat la gateway cu OBJECT_SCAN: curl -X POST http://localhost:5000/v1/chat/completions -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"test"}]}'
Verifică că obiectele deplasate apar: curl http://localhost:5000/api/displaced-objects
Cleanup Batch Notification:

Adaugă 5+ obiecte deplasate
Verifică că se creează batch: curl http://localhost:5000/api/displaced-objects/batches
Approve batch: verifică că se creează task-uri planner
Frontend: Deschide http://localhost:3000/house-objects în browser și verifică UI-ul

Testare cu ochelarii: Utilizatorul testează verbal spunând "ține minte că telecomanda stă pe masă" și apoi mută telecomanda — la următoarea scanare ar trebui să apară deplasare

====================

Ce s-a creat:

Fișier	Tip	Ce face
backend/embeddingService.js	NOU	Vector search cu Gemini text-embedding-004 + cosine similarity
backend/objectTrackingService.js	NOU	Tracking obiecte, detecție deplasări, batch-uri notificare
backend/server.js	MODIFICAT	3 scheme noi + 12 rute API
backend/glassesGatewayService.js	MODIFICAT	OBJECT_SCAN_JSON + OBJECT_LEARN_JSON + context injectat
frontend/src/app/house-objects/page.tsx	NOU	Pagină cu tabs, banner approve/dismiss, formular
frontend/src/components/Navigation.tsx	MODIFICAT	Link "House" adăugat
Cum funcționează:

Toggle ON în pagina House Objects → activează scanarea
Spui ochelarilor "ține minte că telecomanda stă pe masă" → Gemini creează OBJECT_LEARN_JSON
Gemini scanează SILENT obiecte prin cameră → OBJECT_SCAN_JSON
Dacă un obiect e în alt loc → se salvează ca "deplasate"
La 5+ obiecte deplasate → banner notificare cu Approve (creează task-uri) / Dismiss
Verificare: Frontend build ✅ (0 erori) | Backend syntax ✅ (toate fișierele)