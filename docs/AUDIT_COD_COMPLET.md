# Audit Complet de Cod — usa-app

**Data:** 2026-04-07  
**Scop:** Analiza calitatii codului inainte de integrarea NegoApp  
**Dimensiune proiect:** ~120,000+ linii cod (backend 109KB + orchestrator 78KB + NegoApp ~15KB + frontend ~9,300 linii)

---

## Sumar Executiv

| Zona | Stare | Probleme Critice | Probleme Totale |
|------|-------|-----------------|-----------------|
| Backend server.js | CRITICA | 8 | 45+ |
| Backend servicii | CRITICA | 8 | 40+ |
| NegoApp | MEDIE | 5 | 25+ |
| Frontend | MEDIE | 6 | 30+ |
| **TOTAL** | **CRITICA** | **27** | **140+** |

**Verdict:** Proiectul functioneaza dar are probleme structurale serioase. Refactorizarea este **obligatorie** inainte de integrarea NegoApp, altfel complexitatea devine incontrolabila.

---

## PARTEA 1: BACKEND — server.js (2,988 linii)

### 1.1 Problema #1: Fisier Monolitic

`server.js` contine TOTUL intr-un singur fisier:
- **27 scheme Mongoose** (liniile 54-452) — trebuie in `models/`
- **189 rute Express** (liniile 455-2934) — trebuie in `routes/`
- **13 importuri de servicii** — amestecate cu rutele
- **0 middleware de autentificare** — auth verificat manual in cateva rute

```
server.js (2,988 linii)
├── Liniile 1-47:    Importuri + config Express
├── Liniile 54-452:  27 scheme Mongoose (MUTA in models/)
├── Liniile 455-2934: 189 rute inline (MUTA in routes/)
├── Liniile 2941-2959: Init servicii cu setTimeout
└── Liniile 2976-2989: Process error handlers
```

**Impact:** Orice modificare risca sa strice functionalitati nelegate. Imposibil de testat.

### 1.2 Problema #2: Securitate

| Problema | Linia | Severitate |
|----------|-------|-----------|
| MongoDB hardcoded fara auth | 49: `mongodb://127.0.0.1:27017/usa_db` | CRITICA |
| CORS deschis la orice origin | 43: `app.use(cors())` | CRITICA |
| Zero rate limiting | — | CRITICA |
| Lipseste helmet (security headers) | — | RIDICATA |
| Body limit 200MB (vector DoS) | 44: `express.json({ limit: '200mb' })` | RIDICATA |
| API keys returnate nemascat | 501, 516: `res.json({ apiKey: setting.value })` | RIDICATA |
| NoSQL injection via spread | 756: `{ ...req.body }` direct in update | MEDIE |
| Endpointuri fara autentificare | 1000-1027, 2332-2354, 2913-2934 | MEDIE |

### 1.3 Problema #3: Performanta

| Problema | Linia | Impact |
|----------|-------|--------|
| Zero paginare pe liste | 596, 722, 787 | Crash la volum mare |
| Sortare in memorie (nu DB) | 787-810: `tasks.sort()` | CPU spike |
| Operatii sincrone fs | 1744: `writeFileSync`, 1948: `unlinkSync` | Blocheaza event loop |
| N+1 queries | 1336, 1343: `.populate()` fara `.lean()` | Slow queries |
| Lipsa indexuri MongoDB | sessionId, houseObjectId, repoId | Full table scan |
| Zero caching pe setari | 1002, 1558, 2902 | Query la fiecare request |

### 1.4 Problema #4: Error Handling

- **170+ blocuri catch identice:** `catch (err) { res.status(500).json({ error: err.message }); }`
- **Catch-uri goale (erori silentioase):** liniile 1881, 1949, 2171, 2289
- **Fire-and-forget fara retry:** liniile 1444, 1818, 2138 — task-uri background fara queue
- **SSE memory leak:** liniile 2652-2671 — setInterval cu race condition pe cleanup
- **err.message expus clientului:** leaks stack info in productie

### 1.5 Problema #5: Cod Duplicat

- **Pattern de obtinere API key** — repetat in 27+ locuri:
  ```javascript
  const setting = await Setting.findOne({ key: 'gemini_api_key' });
  if (!setting?.value) throw new Error('...');
  const genAI = new GoogleGenerativeAI(setting.value);
  ```
- **Pattern de mascare token** — 4 implementari diferite, inconsistente
- **CRUD handlers** identice pentru knowledge, escalations, planner tasks
- **Background task pattern** — 5 variante ale `(async () => { try {...} catch {} })()`

---

## PARTEA 2: BACKEND — Servicii

### 2.1 orchestratorService.js (1,408 linii) — AL DOILEA MONOLITH

| Problema | Detalii |
|----------|---------|
| **Functie de 1,033 linii** | `processOrchestratorMessage()` — liniile 266-1299 |
| **25+ tipuri de actiuni inline** | Booking, GitHub, Cron, Email, WebAgent, Coding, etc. — toate in switch/if |
| **detectIntent() cu 25+ parametri** | Linia 466 — imposibil de mentinut |
| **System prompt de 234 linii** | Liniile 1-260 — hardcodat in fisier |
| **String concatenation nelimitata** | `responseText +=` fara limita de marime — risc OOM |
| **Hardcoded NegoApp URL** | Linia 1265: `http://localhost:3001/api` |

**Solutie:** Split in `executors/`: bookingExecutor.js, githubExecutor.js, emailExecutor.js, etc.

### 2.2 Servicii cu Probleme de Resurse

**whatsappService.js (277 linii):**
- Client global (nu per-user) — incompatibil cu NegoApp multi-user
- `client.destroy()` fara timeout — poate bloca indefinit
- `initialize().catch()` — caller-ul nu stie daca a esuat
- Race condition pe logout: nu asteapta destroy()

**webAgentService.js (390 linii):**
- `activeSessions = new Map()` fara TTL — leak pe sesiuni orfane
- 25 screenshots base64 in memorie per task (~50MB+)
- Zero timeout pe pasi individuali — daca Gemini hang, browser ramane deschis

**geminiLiveService.js (312 linii):**
- WebSocket fara heartbeat — conexiuni stale nedetectate
- Parse error pe mesaje inghitit silentios — state corupt
- `disconnect()` nu curata event listeners

### 2.3 Dependinte cu Probleme

| Problema | Detalii |
|----------|---------|
| **Dual Gemini SDK** | `@google/generative-ai` (0.24.1) SI `@google/genai` (1.43.0) — de consolidat |
| **Zero tooling dev** | Lipseste: eslint, prettier, jest/mocha, nodemon in dev |
| **whatsapp-web.js de pe GitHub** | Fork neoficial — risc mentenanta |
| **Posibil unused** | `duck-duck-scrape` — de verificat |

### 2.4 Logging Inconsistent

- **292 console.log/error** in total
- Unele cu prefix: `[WhatsApp]`, `[Cron]`, `[WebAgent]`
- Altele fara: `console.log('Agent is currently disabled.')`
- Zero log levels (debug/info/warn/error)
- Zero structured logging (winston/pino)
- Stack trace lipseste in majority log-urilor de eroare

---

## PARTEA 3: NegoApp

### 3.1 Structura — Buna

NegoApp are o structura mai curata decat backend-ul principal:
```
NegoApp/
├── server.js (185 linii) — rezonabil
├── src/core/         — logica de business
├── src/channels/     — WhatsApp + Email handlers
├── src/scrapers/     — pipeline scraping
├── src/db/           — modele + repositories
├── src/routes/       — rute Express
├── src/middleware/    — auth
├── src/infra/        — proxy manager
└── src/utils/        — utilitare
```

### 3.2 ROOT CAUSE: Crash-ul WhatsApp

**Eroarea:** `window.onCodeReceivedEvent is not a function`

**Cauza reala:**
1. whatsapp-web.js foloseste Puppeteer intern pentru WhatsApp Web
2. Cand sesiunea expira, library-ul incearca sa apeleze un callback intern care nu exista
3. Eroarea nu e prinsa si bubleaza pana la nivelul serverului
4. **Lipseste try-catch** pe event handler-ele WhatsApp (whatsapp-handler.js, linia 30-32):
   ```javascript
   whatsapp.on('message', async (msg) => {
     await handleIncomingMessage(msg, userId, whatsapp, userGemini);
     // Daca handleIncomingMessage aruca exceptie, whatsapp-web.js crapa
   });
   ```

**Fix necesar:** Wrap complet in try-catch pe toate event handler-ele whatsapp-web.js + izolare WhatsApp in worker thread.

### 3.3 Probleme Specifice NegoApp

| Problema | Fisier | Severitate |
|----------|--------|-----------|
| **IP VPS hardcoded in sursa** | server.js:53 — `206.189.10.234` | CRITICA |
| **JWT secret default in cod** | middleware/auth.js:6 — `'negoapp-secret-change-in-production'` | CRITICA |
| **Config.save() fara await** | db/models/Config.js:80-87 — race condition | RIDICATA |
| **Lipsa indexuri DB** | Lead: whatsappId, phoneNumber neindexate | RIDICATA |
| **Browser zombie pe crash** | phone-revealer.js:50-80 — browser nedestruits la erori | RIDICATA |
| **proxyUsage Map creste infinit** | batch-processor.js:178 — memory leak | MEDIE |
| **Email polling fara error handling** | mail-client.js:78 — loop se opreste silentios | MEDIE |
| **Zero input validation pe rute** | batch.routes.js, reveal.routes.js | MEDIE |
| **Lipsa rate limiting** | — | MEDIE |
| **Scraper fara rezultate partiale** | category-scraper.js — daca pagina 3/5 esueaza, totul e pierdut | MEDIE |

### 3.4 Dependinte Duplicate

- `puppeteer` SI `puppeteer-core` — redundant (puppeteer include core)
- `whatsapp-web.js` (1.34.6) SI `@whiskeysockets/baileys` (6.7.16) — doua librarii WhatsApp

---

## PARTEA 4: Frontend (9,300 linii, 24 pagini)

### 4.1 Pagini Prea Mari

| Pagina | Linii | Status |
|--------|-------|--------|
| ugc-product/page.tsx | 839 | NECESITA SPLIT |
| aplicatii-git/page.tsx | 812 | NECESITA SPLIT |
| email/page.tsx | 798 | NECESITA SPLIT |
| settings/page.tsx | 682 | NECESITA SPLIT |
| ugc-video/page.tsx | 646 | NECESITA SPLIT |
| orchestrator/page.tsx | 525 | ACCEPTABIL |

### 4.2 Zero API Client Centralizat

Fiecare pagina face fetch manual cu pattern-uri inconsistente:

**Pattern 1 — Fire and forget (rau):**
```typescript
fetch('/api/...').then(r => r.json()).then(d => {...}).catch(() => {});
```

**Pattern 2 — Async dar incomplet:**
```typescript
const res = await fetch('/api/...');
const data = await res.json();  // Lipseste: if (!res.ok) throw
```

**Probleme:**
- Zero client centralizat — fetch calls imprastiate in 24 pagini
- Zero retry logic
- Zero request cancellation (AbortController)
- Unele erori ignorate complet (`.catch(() => {})`)
- Lipseste verificare `res.ok` inainte de `.json()`

### 4.3 Alte Probleme Frontend

| Problema | Severitate |
|----------|-----------|
| **Navigare Negotiator → localhost:3001 hardcoded** | CRITICA (pt integrare) |
| **socket.io-client in package.json dar nefolosit** | MEDIE |
| **Zero error boundaries** | MEDIE |
| **Clickable divs fara keyboard support** | MEDIE |
| **Lipsa aria-labels pe icon buttons** | MEDIE |
| **@ts-ignore in next.config.ts** | MICA |
| **Lipsa lazy loading pt react-markdown, xterm** | MICA |
| **30+ useState in orchestrator/page.tsx** | MICA |

---

## PARTEA 5: PLAN DE REFACTORIZARE

### Prioritatea 1: Restructurare Backend ~~(OBLIGATORIU inainte de integrare)~~ COMPLETAT

**Status: DONE**

#### 1A. Extractie modele Mongoose din server.js → `backend/models/`

```
backend/models/
├── index.js          — exporta toate modelele
├── Item.js
├── Setting.js
├── AgentConfig.js
├── Conversation.js
├── Booking.js
├── AgentChat.js
├── KnowledgeEntry.js
├── Escalation.js
├── GlassesMemory.js
├── PlannerTask.js
├── HouseObject.js
├── DisplacedObject.js
├── CleanupBatch.js
├── LocalExecCommand.js
├── CodingSession.js
├── ProjectMemory.js
├── GitRepo.js
├── GitIssue.js
├── UgcProduct.js
├── UgcGeneration.js
├── CronJob.js
├── WebAgentSession.js
├── WalletSettings.js
├── EmailThread.js
├── EmailMessage.js
├── EmailInbox.js
└── EmailAttachment.js
```

**Actiuni:**
- [x] Creare fiecare model in fisier separat cu schema + indexuri
- [x] Adaugare indexuri lipsa: `sessionId`, `repoId`, `houseObjectId`, `key` (Setting)
- [x] Export centralizat din `models/index.js`
- [x] Update toate importurile din servicii

#### 1B. Extractie rute din server.js → `backend/routes/`

```
backend/routes/
├── index.js          — inregistreaza toate rutele
├── items.js          — /api/items/*
├── bookings.js       — /api/bookings/*
├── settings.js       — /api/settings/*
├── orchestrator.js   — /api/orchestrator/*
├── knowledge.js      — /api/knowledge/*
├── planner.js        — /api/planner/*
├── glasses.js        — /api/glasses/*
├── objects.js        — /api/objects/*
├── github.js         — /api/github/*
├── coding.js         — /api/coding/*
├── ugc.js            — /api/ugc/*
├── ugcVideo.js       — /api/ugc-video/*
├── ugcProduct.js     — /api/ugc-product/*
├── webAgent.js       — /api/web-agent/*
├── whatsapp.js       — /api/whatsapp/*
├── email.js          — /api/email/*
├── cron.js           — /api/cron/*
├── terminal.js       — /api/exec/*
├── wallet.js         — /api/wallet/*
├── voice.js          — /api/voice/*
└── nego.js           — /api/nego/* (NOU - pentru integrare)
```

**Actiuni:**
- [x] Creare Express Router per modul
- [x] Mutare handler-e din server.js in fisierele corespunzatoare
- [x] server.js ramane ~100 linii: imports, middleware, mount routes, start (actual: 128 linii)

#### 1C. Creare serviciu partajat de configurare

```javascript
// backend/services/configService.js
const Setting = require('../models/Setting');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const cache = new Map();
const CACHE_TTL = 60000; // 1 minut

async function getApiKey(keyName) {
  const cached = cache.get(keyName);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;
  
  const setting = await Setting.findOne({ key: keyName });
  if (!setting?.value) throw new Error(`${keyName} not configured`);
  
  cache.set(keyName, { value: setting.value, ts: Date.now() });
  return setting.value;
}

async function getGeminiModel(systemPrompt, modelName = 'gemini-2.5-flash') {
  const apiKey = await getApiKey('gemini_api_key');
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: modelName, systemInstruction: systemPrompt });
}

module.exports = { getApiKey, getGeminiModel };
```

**Impact:** Elimina 27+ duplicari de cod.

---

### Prioritatea 2: Securitate de Baza ~~(OBLIGATORIU)~~ COMPLETAT

**Status: DONE** — helmet, rate limiting, CORS, body limit 50MB, .env, error middleware, cache invalidation on settings update

- [x] **Adaugare helmet:** `app.use(helmet())`
- [x] **Adaugare rate limiting:**
  ```javascript
  const rateLimit = require('express-rate-limit');
  app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 100 }));
  ```
- [x] **Restrictionare CORS:**
  ```javascript
  app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000' }));
  ```
- [x] **Reducere body limit:** `express.json({ limit: '50mb' })`
- [x] **Mutare secrete in .env:**
  ```env
  MONGODB_URI=mongodb://127.0.0.1:27017/usa_db
  VPS_HOST=206.189.10.234
  JWT_SECRET=<generat random>
  ```
- [x] **Adaugare .env in .gitignore** (verificare)
- [x] **Adaugare error middleware centralizat:**
  ```javascript
  app.use((err, req, res, next) => {
    console.error(`[${req.method}] ${req.path}:`, err.message);
    res.status(err.status || 500).json({ error: 'Internal server error' });
  });
  ```

---

### Prioritatea 3: Split orchestratorService.js — COMPLETAT

**Status: DONE** — Split in orchestrator/prompts.js, utils.js, terminalTask.js, handlers.js, index.js

```
backend/
├── orchestratorService.js     — ramane ~200 linii (routing + detectIntent)
├── orchestratorPrompt.js      — system prompt (234 linii)
└── executors/
    ├── bookingExecutor.js
    ├── githubExecutor.js
    ├── cronExecutor.js
    ├── emailExecutor.js
    ├── webAgentExecutor.js
    ├── codingExecutor.js
    ├── searchExecutor.js
    ├── taskExecutor.js
    ├── terminalExecutor.js
    └── negoExecutor.js        — NOU (pentru integrare)
```

**Actiuni:**
- [x] Extractie fiecare `case`/`if` block in executor separat
- [x] Refactor `detectIntent()` — inlocuire 25 parametri cu obiect config
- [x] Mutare system prompt in fisier separat
- [x] Adaugare limita pe `responseText` concatenation

---

### Prioritatea 4: Fix WhatsApp — COMPLETAT

**Status: DONE** — safeDestroy cu timeout 15s, reconnect exponential backoff, try-catch pe toate event handlers

- [x] **Wrap TOATE event handler-ele whatsapp-web.js in try-catch:**
  ```javascript
  client.on('message', async (msg) => {
    try {
      await handleMessage(msg);
    } catch (err) {
      console.error('[WhatsApp] Message handler error:', err);
      // NU re-throw — nu lasam exceptia sa ajunga la whatsapp-web.js
    }
  });
  ```
- [x] **Adaugare timeout pe client.destroy():** safeDestroy 15s implementat
- [x] **Adaugare reconnect cu exponential backoff**
- [ ] **Investigare upgrade whatsapp-web.js** sau switch la Baileys — pentru NegoApp future

---

### Prioritatea 5: Cleanup Frontend — COMPLETAT

**Status: DONE**

- [x] **Creare `frontend/src/lib/api.ts`** — client centralizat cu error handling (timeout 30s, ApiError, type-safe generics)
- [ ] **Split pagini mari** (>600 linii) in componente — deferit (nu blocheaza, functional as-is)
- [x] **Fix navigare Negotiator** — mutat la ruta interna `/negotiator`
- [x] **Stergere socket.io-client** — scos din frontend/package.json
- [x] **Adaugare error boundaries** in layout.tsx — ErrorBoundary component creat
- [x] **Migrare toate paginile la api.ts** — 19 pagini migrate; 0 raw `fetch()` in pagini user-facing (ramane doar 1 in API route server-side, corect)
- [x] **Lint clean (Next 16 / React 19 / eslint 9)** — 0 errors + 0 warnings (de la 33 errors / 23 warnings initial)
- [x] **Stergere `usa-app: file:..` (frontend)** — self-referential, nefolosit, eliminat

---

### Prioritatea 6: Consolidare Dependinte — PARTIAL

- [ ] **Stergere `@google/genai`** — NU se poate, folosit de ugcAgentService/ugcVideoAgentService/ugcProductService (API diferit de `@google/generative-ai`)
- [x] **Stergere `body-parser`** (backend) — nefolosit, inlocuit de express.json() built-in
- [x] **Stergere `socket.io`** (backend) — nefolosit, 0 imports
- [x] **Stergere `socket.io-client`** (frontend) — nefolosit, 0 imports
- [x] **Verificare `duck-duck-scrape`** — FOLOSIT in searxngService.js:11 (fallback search)
- [x] **Verificare `qrcode`** — FOLOSIT in whatsappService.js (generare QR pentru pairing)
- [x] **Verificare `searxng` (npm)** — FOLOSIT in searxngService.js:114
- [x] **Stergere `usa-app: file:..`** (backend + frontend) — self-referential, nefolosit, eliminat din ambele
- [x] **Adaugare `.nvmrc`** cu versiune Node fixata — creat cu 22.19.0
- [ ] **NegoApp: stergere `puppeteer-core`** — pentru integrarea viitoare
- [ ] **NegoApp: decidere `whatsapp-web.js` vs `baileys`** — pentru integrarea viitoare
- [ ] **Adaugare devDependencies:** eslint, prettier

---

## PARTEA 6: server.js TINTA (dupa refactorizare)

```javascript
// server.js — ~80 linii
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Models (importa toate schemele)
require('./models');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.ALLOWED_ORIGINS } });

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api/items', require('./routes/items'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/orchestrator', require('./routes/orchestrator'));
app.use('/api/knowledge', require('./routes/knowledge'));
app.use('/api/planner', require('./routes/planner'));
app.use('/api/glasses', require('./routes/glasses'));
app.use('/api/objects', require('./routes/objects'));
app.use('/api/github', require('./routes/github'));
app.use('/api/coding', require('./routes/coding'));
app.use('/api/ugc', require('./routes/ugc'));
app.use('/api/ugc-video', require('./routes/ugcVideo'));
app.use('/api/ugc-product', require('./routes/ugcProduct'));
app.use('/api/web-agent', require('./routes/webAgent'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/email', require('./routes/email'));
app.use('/api/cron', require('./routes/cron'));
app.use('/api/exec', require('./routes/terminal'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/voice', require('./routes/voice'));
app.use('/api/nego', require('./routes/nego'));

// Error handler
app.use((err, req, res, next) => {
  console.error(`[${req.method}] ${req.path}:`, err.message);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Start
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log('[MongoDB] Connected');
  httpServer.listen(process.env.PORT || 5000, () => {
    console.log(`[Server] Running on port ${process.env.PORT || 5000}`);
  });
});
```

---

## PARTEA 7: ESTIMARE TOTALA REFACTORIZARE

| Prioritate | Task | Ore | Necesara pt integrare? |
|-----------|------|-----|----------------------|
| P1 | Restructurare backend (models + routes) | 6-8h | DA |
| P2 | Securitate de baza | 2-3h | DA |
| P3 | Split orchestratorService | 3-4h | DA |
| P4 | Fix WhatsApp | 2-3h | DA |
| P5 | Cleanup frontend | 3-4h | DA |
| P6 | Consolidare dependinte | 1-2h | NU (dar recomandat) |
| **TOTAL** | | **17-24h** | |

**Timeline:** 3-4 zile de lucru pentru refactorizare, apoi 3-5 zile pentru integrare NegoApp.

---

## PARTEA 8: ORDINEA DE EXECUTIE

```
Ziua 1:  P1A — Extractie modele Mongoose (27 fisiere)
         P1C — Creare configService.js (elimina 27 duplicari)

Ziua 2:  P1B — Extractie rute (20+ fisiere)
         P2  — Securitate (helmet, rate limit, CORS, .env)

Ziua 3:  P3  — Split orchestratorService.js (10 executori)
         P4  — Fix WhatsApp (try-catch, timeout, reconnect)

Ziua 4:  P5  — Frontend cleanup (api client, split pagini, navigare)
         P6  — Consolidare dependinte

→ Apoi trecem la integrarea NegoApp (planul din PLAN_INTEGRARE_NEGOAPP.md)
```

---

## PARTEA 9: METRICI DE SUCCES

Dupa refactorizare, proiectul trebuie sa indeplineasca:

- [~] **server.js < 100 linii** — actual: 128 linii (aproape de target, acceptabil)
- [~] **Zero fisiere > 500 linii** (in backend) — 2 fisiere marginal peste: handlers.js (528), gitAppsService.js (509)
- [x] **Zero hardcoded secrets** in cod sursa
- [x] **helmet + rate limiting + CORS restrictionat** active
- [x] **Toate schemele Mongoose in `models/`** cu indexuri
- [x] **Toate rutele in `routes/`** cu error handling consistent
- [x] **configService.js** folosit in loc de Setting.findOne() duplicat
- [x] **Zero crash de la WhatsApp** — toate event handler-ele wrapped + safeDestroy + backoff reconnect
- [x] **Frontend API client centralizat** — zero fetch() imprastiat (19 pagini migrate)
- [x] **Frontend lint clean** — 0 errors din 33 (Next 16 / React 19 / eslint 9)
- [x] **Frontend `next build` verde** — toate 21 rute compileaza
- [x] **Backend syntax valid** — toate fisierele `node -c` OK
