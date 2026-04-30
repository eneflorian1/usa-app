# Plan de Integrare NegoApp in usa-app

**Data:** 2026-04-07  
**Status:** Draft  
**Scop:** Eliminarea NegoApp ca aplicatie separata (port 3001) si integrarea serviciilor direct in backend-ul principal (port 5000) + frontend-ul Next.js (port 3000).

---

## 1. Problema Curenta

### Arhitectura actuala (3 procese separate)
```
Frontend (Next.js :3000)
    ├── /api/* → Backend (:5000)
    └── /api/nego/* → Backend proxy → NegoApp (:3001)
                                         ↑ PUNCT DE ESEC

NegoApp (:3001) - proces separat cu:
    - Propriul Express server
    - Propriul frontend Vite+React (dist/)
    - Propriile node_modules (~200MB+)
    - WhatsApp Manager (duplicat cu backend)
    - Email Handler (duplicat cu backend)
    - MongoDB: baza "negoapp" separata
```

### Probleme identificate

| # | Problema | Impact |
|---|---------|--------|
| 1 | **NegoApp crash = negotiator mort** | WhatsApp pairing code fails → server crash → tot modulul pica |
| 2 | **WhatsApp duplicat** | Backend are `whatsappService.js` + NegoApp are `WhatsAppManager` — ambele folosesc whatsapp-web.js dar versiuni diferite |
| 3 | **Email duplicat** | Backend `emailService.js` + NegoApp `email-handler.js` — ambele polling pe AgentMail |
| 4 | **Frontend separat** | Negotiator page deschide `localhost:3001` in tab nou — UX rupt, nu merge pe mobile/deploy |
| 5 | **3 procese de mentinut** | `concurrently` ruleaza frontend + backend, dar NegoApp trebuie pornit manual sau adaugat separat |
| 6 | **node_modules duplicat** | NegoApp are propriile dependente (~puppeteer, whatsapp-web.js) — spatiu si conflicte |
| 7 | **Nu e deployable** | Hardcoded localhost:3001 peste tot — nu merge in prod/cloud |

---

## 2. Solutia Propusa: Integrare Completa

### Arhitectura tinta (2 procese)
```
Frontend (Next.js :3000)
    └── /api/* → Backend (:5000)
                    ├── /api/nego/*     (rute negotiator)
                    ├── /api/missions/* (misiuni scraping)
                    ├── /api/leads/*    (lead management)
                    ├── /api/whatsapp/* (unificat)
                    └── /api/email/*    (unificat)

Backend (:5000)
    ├── Servicii existente (orchestrator, coding, web-agent, etc.)
    ├── negoService.js          ← NOU (din NegoApp core)
    ├── scrapingService.js      ← NOU (din NegoApp scraper pipeline)
    ├── negotiationService.js   ← NOU (din NegoApp negotiation engine)
    ├── whatsappService.js      ← UNIFICAT (merge NegoApp WhatsAppManager)
    └── emailService.js         ← UNIFICAT (merge NegoApp email-handler)

MongoDB (usa_db)
    ├── Colectii existente
    ├── nego_leads       ← migrat din negoapp DB
    ├── nego_missions    ← migrat din negoapp DB
    ├── nego_messages    ← migrat din negoapp DB
    └── nego_configs     ← migrat din negoapp DB
```

---

## 3. Plan de Implementare pe Faze

### Faza 1: Pregatire si Migrare Date (Estimare: 2-3 ore)

**1.1 — Creare modele Mongoose in backend** — DONE
- [x] Creare `backend/models/NegoLead.js` (bazat pe NegoApp/src/db/models/)
- [x] Creare `backend/models/NegoMission.js`
- [x] Creare `backend/models/NegoMessage.js`
- [x] Creare `backend/models/NegoConfig.js`
- [x] Prefix `nego_` la toate colectiile pentru a evita coliziuni (`collection: 'nego_*'`)
- [x] Inregistrare in `backend/models/index.js` (33 modele total acum)

**1.2 — Script de migrare date** — DONE (neexecutat inca)
- [x] Creare `backend/scripts/migrate-negoapp.js`
- [x] Copiaza datele din DB `negoapp` → colectii `nego_*` din `usa_db` (upsert idempotent)
- [x] Suporta `--dry-run` pentru verificare inainte de migrare
- [ ] Testare cu date reale (47 misiuni, 151 mesaje, 16 leads) — necesita rulare manuala

**Risc:** Pierdere date daca migrarea nu e completa  
**Mitigare:** Backup MongoDB inainte de migrare, pastrare DB veche 30 zile

---

### Faza 2: Migrare Servicii Core (Estimare: 4-6 ore)

**2.1 — Negotiation Engine → `backend/negotiationService.js`** — DONE
- [x] Copiere + adaptare `NegoApp/src/core/negotiation-service.js` (CommonJS port)
- [x] Integrare cu Gemini via `configService.getGeminiModel()` (wrapper `geminiGenerate`)
- [x] Exports: `isBotSuspicion`, `analyzeConversation`, `updatePriceFromAnalysis`, `generateReply`, `generateFirstMessage`
- [x] Syntax check OK (`node -c`)
- [ ] Copiere `NegoApp/src/core/product-extractor.js` (separat, urmeaza in 2.2/2.3)
- [ ] Teste unitare (deferred — vor veni cu rute API in F6)

**2.2 — Scraper Pipeline → `backend/scraping/`** — DONE
- [x] `backend/scraping/proxyManager.js` — port CJS (smoke test OK)
- [x] `backend/scraping/domainStrategy.js` — port CJS, storage `backend/data/strategies/`
- [x] ~~`NegoApp/src/core/site-analyzer.js`~~ — SCHELET NEFOLOSIT (depinde de un `apiClient.analyze()` fictiv care nu exista). NU portat.
- [x] ~~`NegoApp/src/core/product-extractor.js`~~ — IDEM, schelet abandonat. NU portat.
- [x] Adaugat in `backend/package.json`: `puppeteer`, `puppeteer-core`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`, `p-queue`, `cheerio`, `@whiskeysockets/baileys` (versiuni identice cu NegoApp)
- [x] `npm install` rulat — 123 packages added
- [x] `backend/scraping/stealthBrowser.js` — port CJS (Puppeteer + stealth plugin + zombie cleanup)
- [x] `backend/scraping/olxSession.js` — port CJS (login OLX, cookie persistence, xvfb support)
- [x] `backend/scraping/categoryScraper.js` — port CJS (extract listings + paginare)
- [x] `backend/scraping/phoneRevealer.js` — port CJS (4 strategii + API interception)
- [x] `backend/scraping/batchProcessor.js` — port CJS (proxy rotation + resume + EventEmitter)
- [x] **Decizie luata:** Pastram Puppeteer (nu Playwright) — phone revealer e tight-coupled si nu merita rescris
- [x] Toate 5 modulele: `node -c` OK, `require()` OK, instantiere OK

**2.3 — Agent Orchestrator → `backend/negoOrchestratorService.js`** — DONE
- [x] Port CJS din `NegoApp/src/core/agent-orchestrator.js` (~360 linii)
- [x] Bonus: portat si `NegoApp/src/scraper/site-intelligence.js` (~540 linii) — necesar pentru AI strategy discovery
- [x] Bonus: creat `backend/scraping/geminiAdapter.js` — wrapper care expune interfata `gemini.generate(prompt, opts)` din NegoApp peste `configService.getGeminiModel()` din backend (skip GeminiClient.js din NegoApp care e nefolosit)
- [x] Syntax check + instantiere OK pentru toate 3 fisierele
- [ ] Conectare la modelele Mongoose noi (nego_*) — se face in F6 (rute API), missions sunt momentan in-memory
- [ ] Integrare cu `orchestratorService.js` principal (tool nou: NEGOTIATOR) — Faza 7

**Risc:** Scraper pipeline e complex (proxy rotation, resume capability)  
**Mitigare:** Testare fiecare componenta izolat inainte de integrare

---

### Faza 3: Unificare WhatsApp (Estimare: 3-4 ore)

**Aceasta e faza critica — sursa principala a crash-urilor actuale.**

**3.1 — Analiza diferente**
| Aspect | Backend (actual) | NegoApp (actual) | Tinta |
|--------|-----------------|-------------------|-------|
| Instante | 1 (global) | Per-user | Per-user |
| Auth | LocalAuth | LocalAuth per userId | LocalAuth per userId |
| Versiune whatsapp-web.js | ? | 1.34.6 | 1.34.6 (sau mai noua) |
| Mesaje incoming | → orchestrator | → lead detection + nego | Ambele, pe baza de context |

**3.2 — Implementare WhatsApp unificat**
- [ ] Refactor `backend/whatsappService.js` sa preia arhitectura per-user din NegoApp
- [ ] Adaugat routing inteligent mesaje: 
  - Daca mesajul e de la un lead cunoscut → negotiation engine
  - Altfel → orchestrator / chat normal
- [ ] Handling robust pentru disconnect/reconnect (fix crash actual)
- [ ] **Fix pairing code error:** `window.onCodeReceivedEvent is not a function`
  - Cauza: Versiune whatsapp-web.js incompatibila cu WhatsApp Web update
  - Solutie: Upgrade la ultima versiune stabila sau switch la QR-only auth

**3.3 — Error handling imbunatatit**
- [ ] Try-catch pe toate operatiile Puppeteer/WhatsApp
- [ ] Reconnect automat cu backoff exponential
- [ ] Nu mai crapa tot serverul daca WhatsApp session fails
- [ ] Izolare proces: WhatsApp in worker thread sau child process

**Risc:** WhatsApp Web se schimba frecvent, whatsapp-web.js e fragil  
**Mitigare:** Consideram Baileys ca alternativa daca whatsapp-web.js continua sa crape

---

### Faza 4: Unificare Email ✅ DONE

**4.1 — Merge email handlers**
- [x] Adaugat `tryHandleAsNegoLead(msg, inboxId)` in `backend/emailAgentService.js`
- [x] Un singur polling loop pe AgentMail (cel existent din `processNewMessages`)
- [x] Routing: dupa spam filter → check `NegoLead` by phoneNumber/sellerName → daca match, ruleaza `negotiationService.analyzeConversation` → `updatePriceFromAnalysis` → `generateReply` → `sendEmail` → stocheaza `NegoMessage`; altfel fall-through la `EmailThread` normal
- [x] Bot-suspicion short-circuit (nu raspunde daca vanzatorul intreaba daca e bot)
- [x] `accepted` status → seteaza `finalPrice`, dezactiveaza `isBotActive`
- [x] Pastrat inbox creation/management din backend (nicio modificare)

**Risc:** Scazut — routing adaugat inainte de EmailThread path, cu try/catch fall-through  
**Mitigare:** Daca routing throw-uieste, `continue` nu se executa si mesajul intra pe path-ul vechi EmailThread

---

### Faza 5: Migrare Frontend (Estimare: 3-4 ore)

**5.1 — Pagini noi in Next.js**
- [ ] `frontend/src/app/negotiator/page.tsx` — Dashboard principal (NU redirect la :3001)
- [ ] `frontend/src/app/negotiator/leads/page.tsx` — Lista si management leads
- [ ] `frontend/src/app/negotiator/missions/page.tsx` — Misiuni de scraping
- [ ] `frontend/src/app/negotiator/chat/[leadId]/page.tsx` — Conversatie cu lead

**5.2 — Componente reutilizabile**
- [ ] `LeadCard` — card cu info lead (pret, telefon, status, canal)
- [ ] `MissionProgress` — progress bar misiune scraping
- [ ] `NegotiationChat` — chat interface cu lead (similar cu cel din NegoApp/dist)
- [ ] `LeadFilters` — filtrare dupa status, canal, pret

**5.3 — API hooks**
- [ ] Toate call-urile merg la `/api/nego/*` pe backend (:5000) — fara proxy
- [ ] React hooks: `useLeads()`, `useMissions()`, `useNegotiationChat(leadId)`
- [ ] WebSocket pentru update-uri real-time (mesaje noi, status changes)

**5.4 — Curatare Navigation**
- [ ] Scos `external: true` de pe Negotiator link
- [ ] Mutat la ruta interna `/negotiator`

**Risc:** UI/UX diferit fata de NegoApp Vite frontend — userul trebuie sa se obisnuiasca  
**Mitigare:** Pastram layout-ul similar, portam CSS-ul relevant

---

### Faza 6: Rute API in Backend (Estimare: 2-3 ore) — DONE

**6.1 — Noi rute Express in server.js**
```
POST   /api/nego/missions          — creare misiune noua
GET    /api/nego/missions          — lista misiuni
GET    /api/nego/missions/:id      — detalii misiune
DELETE /api/nego/missions/:id      — stergere misiune
POST   /api/nego/missions/:id/run  — pornire misiune

GET    /api/nego/leads             — lista leads
GET    /api/nego/leads/:id         — detalii lead
PUT    /api/nego/leads/:id         — update lead
DELETE /api/nego/leads/:id         — stergere lead
POST   /api/nego/leads/:id/message — trimite mesaj manual

GET    /api/nego/messages/:leadId  — mesaje conversatie
POST   /api/nego/chat              — chat cu AI despre negociere

GET    /api/nego/config             — configurare negotiator
PUT    /api/nego/config             — update configurare

GET    /api/nego/batch/status       — status batch processing
POST   /api/nego/reveal             — reveal phone number
```

**6.1 — Implementare** — DONE
- [x] Creat `backend/routes/nego.js` (~430 linii) cu **39 endpoint-uri**
- [x] Persistare automata mission → MongoDB via `orchestrator.on('mission:updated', persistMission)`
- [x] Singletons pentru `activeBatch` si `activeReveal` (one-at-a-time)
- [x] Mountat in `server.js`: `app.use('/api/nego', require('./routes/nego'))`
- [x] Sarit endpoint-urile virtual-browser (`/session/olx/vb/*`) — necesita OlxVirtualBrowser nepor­tat
- [x] Sarit endpoint-urile WhatsApp pair/QR — vor fi rebuilt in Faza 3

**6.2 — Stergere proxy middleware** — DONE
- [x] Scos `createProxyMiddleware` pentru `/api/nego` din server.js
- [x] Eliminat dep `http-proxy-middleware` din `backend/package.json` + `npm uninstall` (15 packages removed)
- [x] Eliminat `NEGO_PORT` env var
- [x] Rutele sunt acum native in backend, nu mai depind de NegoApp running pe :3001

---

### Faza 7: Integrare cu Orchestratorul Principal ✅ DONE (7.1)

**7.1 — Tool `NEGOTIATOR` (NEGO_JSON) in orchestratorul principal**
- [x] Extras singleton-ul in `backend/negoSingleton.js` (shared intre `routes/nego.js` si `orchestrator/handlers.js`)
- [x] Refactorizat `handleNego` in `orchestrator/handlers.js`: nu mai face HTTP fetch la port 3001, foloseste `orchestrator.executeMission` / `PhoneRevealer` / `NegoLead` / `NegoMission` direct in-process
- [x] `action: "scan"` → lanseaza misiune in background, intoarce missionId imediat (pentru polling la `/api/nego/missions/:id`)
- [x] `action: "reveal"` → sincron, telefon direct
- [x] `action: "leads"` → top 20 din `NegoLead`
- [x] `action: "missions"` → top 20 din `NegoMission`
- [x] `action: "stats"` → `orchestrator.getStats()` (agregat)
- [x] Update `orchestrator/prompts.js`: scos "port 3001", adaugat `stats`, adaugat query/maxPages/etc.
- [x] `routes/nego.js` refactorizat sa importe singleton din `negoSingleton` (nu mai are propriul `new NegoOrchestratorService()`)

**7.2 — Dashboard unificat** (ramane pentru sesiune ulterioara, depinde de F5)
- [ ] Negotiator stats vizibile in dashboard-ul principal
- [ ] Notificari: "Lead nou gasit", "Mesaj primit de la vanzator", "Misiune completa"

---

### Faza 8: Curatare si Finalizare (Estimare: 1-2 ore)

- [ ] Stergere folder `NegoApp/` (dupa confirmare ca totul merge)
- [ ] Stergere referinta `"usa-app": "file:.."` din dependente
- [ ] Update `package.json` root (scos script-uri NegoApp)
- [ ] Update `.gitignore` daca e nevoie
- [ ] Update documentatie
- [ ] Cleanup node_modules regenerat

---

## 4. Estimare Totala

| Faza | Ore | Prioritate | Dependente |
|------|-----|-----------|------------|
| F1: Pregatire + Migrare Date | 2-3h | CRITICA | — |
| F2: Servicii Core | 4-6h | CRITICA | F1 |
| F3: Unificare WhatsApp | 3-4h | CRITICA | F2 |
| F4: Unificare Email | 1-2h | MEDIE | F2 |
| F5: Frontend Next.js | 3-4h | MEDIE | F6 |
| F6: Rute API Backend | 2-3h | CRITICA | F2 |
| F7: Integrare Orchestrator | 2-3h | MICA | F2, F6 |
| F8: Curatare | 1-2h | MICA | Toate |
| **TOTAL** | **18-27h** | | |

**Timeline recomandat:** 3-5 zile de lucru

---

## 5. Ordine de Executie Recomandata

```
Ziua 1:  F1 (date) + F6 (rute API) + F2 partial (negotiation engine)
Ziua 2:  F2 complet (scraper pipeline) + F3 (WhatsApp — cea mai critica)
Ziua 3:  F4 (email) + F5 (frontend pages)
Ziua 4:  F5 complet + F7 (orchestrator integration)
Ziua 5:  F8 (curatare) + testare end-to-end
```

---

## 6. Riscuri si Mitigare

| Risc | Probabilitate | Impact | Mitigare |
|------|--------------|--------|----------|
| WhatsApp-web.js crash dupa migrare | RIDICAT | RIDICAT | Izolare in worker thread; try-catch agresiv; fallback la Baileys |
| Pierdere date migrare | SCAZUT | RIDICAT | Backup MongoDB complet inainte |
| Scraper pipeline nu merge cu noul Puppeteer | MEDIU | MEDIU | Testare izolata; pastrat versiunea exacta din NegoApp |
| Frontend regressions | MEDIU | SCAZUT | Port UI incremental; pastrat NegoApp functional pana la validare |
| Proxy infrastructure conflicts | SCAZUT | MEDIU | Proxy manager e independent — copy-paste direct |

---

## 7. Decizii de Luat Inainte de Start

1. **Puppeteer vs Playwright pentru scraping?**
   - Recomandare: Puppeteer (compatibilitate directa cu codul existent)

2. **whatsapp-web.js vs Baileys?**
   - Recomandare: Fix whatsapp-web.js mai intai, plan B = Baileys

3. **Multi-user in backend?**
   - NegoApp e multi-user, backend-ul nu — pastram multi-user doar pe modulul nego?
   - Recomandare: Da, izolam multi-user la nego_* colectii

4. **Pastram NegoApp functional in paralel pe durata migrarii?**
   - Recomandare: Da, nu stergem pana nu e totul validat

---

## 8. Criterii de Succes

- [ ] `npm start` porneste DOAR frontend + backend (fara NegoApp separat)
- [ ] Navigatie la `/negotiator` arata dashboard-ul integrat (nu redirect extern)
- [ ] Misiunile de scraping functioneaza din interfata Next.js
- [ ] WhatsApp nu mai crapa serverul la erori de pairing
- [ ] Email polling e un singur loop, nu doua
- [ ] Orchestratorul poate lansa comenzi de negociere
- [ ] Toate cele 16 leads + 47 misiuni + 151 mesaje sunt accesibile
- [ ] Folder `NegoApp/` sters, 0 referinte la port 3001
