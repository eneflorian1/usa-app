# usa-app — orchestrator AI multi-serviciu

**usa-app** este nucleul unui ecosistem format din trei aplicații care colaborează prin două bridge-uri WebSocket. Primește mesaje de la utilizator (chat / WhatsApp), interpretează intenția cu Gemini 2.5 Flash și rutează cererile către serviciile specializate:

- **NegoApp** — agent AI de negociere pe marketplaces (OLX, eBay, Autovit, Facebook Marketplace)
- **book2** — platformă AI pentru generare cărți și publicare automată pe Amazon KDP

Stack: Node.js + Express (backend, port 5000), Next.js (frontend), MongoDB / Redis, Google Gemini, WebSocket MCP (Model Context Protocol), PM2, nginx.

---

## Arhitectură

```
                    ┌─────────────────┐
                    │   User (chat)   │
                    └────────┬────────┘
                             │ HTTP / WhatsApp
                             ▼
                ┌────────────────────────┐
                │  usa-app  (port 5000)  │
                │  - Express + Next.js   │
                │  - Gemini orchestrator │
                │  - MCP WS server       │ ◄────── /ws/mcp-bridge
                └──────┬──────────┬──────┘
                       │ WS       │ WS
              ┌────────┘          └────────┐
              ▼                            ▼
     ┌────────────────┐           ┌────────────────┐
     │  nego-bridge   │           │  book-bridge   │
     │  (WS client)   │           │  (WS client)   │
     └────────┬───────┘           └────────┬───────┘
              │ HTTP localhost             │ HTTP localhost
              ▼                            ▼
     ┌────────────────┐           ┌────────────────┐
     │ NegoApp :3001  │           │  book2 :3002   │
     └────────────────┘           └────────────────┘
```

usa-app este **server-ul** WebSocket. Ambele bridge-uri sunt **clienți** care se conectează *către* el. Pattern-ul invers (server central, mulți clienți) permite ca serviciile să stea pe alte mașini sau în spatele NAT — singurul lucru obligatoriu e ca bridge-urile să poată ajunge la usa-app.

---

## Cum funcționează un bridge (protocol MCP)

Bridge-urile vorbesc cu usa-app printr-un singur endpoint WebSocket: `ws://localhost:5000/ws/mcp-bridge` (server-ul: [backend/mcpBridgeService.js](backend/mcpBridgeService.js)).

**1. Înregistrare** (la conectare, client → server):
```json
{ "type": "register", "agent": "negoapp", "tools": [ { "name": "nego_get_leads", ... } ] }
```

**2. Apel tool** (server → client):
```json
{ "id": "uuid-...", "tool": "nego_get_leads", "params": { "limit": 50 } }
```

**3. Răspuns** (client → server):
```json
{ "id": "uuid-...", "result": { "leads": [...] } }
```
sau în caz de eroare:
```json
{ "id": "uuid-...", "error": "..." }
```

**4. Keep-alive**: ping/pong la 20s.

În usa-app, conexiunile active sunt ținute într-un `Map` indexat după numele agentului (`"negoapp"`, `"book2"`), iar `callMcpTool(tool, params, { agent })` întoarce o promisiune care se rezolvă când răspunsul cu același `id` ajunge înapoi.

---

## Fluxul end-to-end (exemplu: utilizatorul cere "arată-mi leads")

1. Mesajul ajunge la endpoint-ul de chat din usa-app.
2. Orchestratorul rulează prompt-urile din [backend/orchestrator/prompts.js](backend/orchestrator/prompts.js); Gemini returnează un tag `<NEGO_JSON>{"action":"leads"}`.
3. [backend/orchestrator/index.js](backend/orchestrator/index.js) detectează tag-ul și rutează către `handleNego()`.
4. [backend/orchestrator/handlers.js](backend/orchestrator/handlers.js) apelează `callMcpTool('nego_get_leads', params, { agent: 'negoapp' })`.
5. Serverul WS livrează mesajul către `nego-bridge`, care face `GET http://localhost:3001/api/leads` în NegoApp.
6. Răspunsul revine prin WebSocket până la handler.
7. Handler-ul aplică `responseOverride` — un format curat (markdown + emoji, stil WhatsApp) care înlocuiește output-ul brut al lui Gemini, ca utilizatorul să nu vadă JSON sau task ID-uri.

Același flux funcționează pentru book2: tag-ul este `<BOOK_APP_JSON>` și ținta e `book-bridge`.

---

## Tools disponibile

### NegoApp (15 tools) — sursa: [NegoApp/mcp-bridge-client.js](../NegoApp/mcp-bridge-client.js)

**Leads & conversații**
- `nego_get_leads` — listă leads (paginată)
- `nego_get_lead` — detalii lead
- `nego_create_lead` — adaugă lead manual
- `nego_get_conversations` — mesajele unui lead

**Misiuni de scraping**
- `nego_start_mission` — pornește o misiune (URL categorie, max pagini, max reveals)
- `nego_get_missions` / `nego_get_mission` — listă / detalii
- `nego_stop_mission` — oprește o misiune în execuție

**Reveal & contact**
- `nego_reveal_phone` — extrage numărul de telefon dintr-un anunț (Puppeteer)
- `nego_chat_reply` — generează un răspuns AI pentru un lead (canal: whatsapp / email)
- `nego_send_whatsapp` — trimite mesaj direct
- `nego_whatsapp_status` — status conexiune WhatsApp

**Monitoring**
- `nego_health` — health check
- `nego_get_config` — configurația curentă a userului
- `nego_get_stats` — statistici dashboard

### book2 (11 tools) — sursa: [book2/mcp-bridge/src/tools.ts](../../Desktop/X/Work/book2/mcp-bridge/src/tools.ts)

**Cărți**
- `list_books` — toate cărțile userului
- `get_book` — detalii carte + capitole
- `create_book` — carte nouă
- `delete_book` — șterge carte
- `start_generation` — pornește generarea AI dintr-un prompt

**Niche research**
- `list_niches` — niche-uri descoperite
- `trigger_niche_research` — rulează agentul de niche research

**Settings & memorie agent**
- `get_agent_logs` — log-uri execuție
- `get_settings` / `update_settings`
- `get_memory` — memoria persistentă a agentului

---

## Deployment (PM2 + nginx)

Cele 5 procese rulează pe același server, orchestrate de [ecosystem.config.js](ecosystem.config.js):

| Proces         | cwd (server)                   | Script                              | Port | Memory |
|----------------|--------------------------------|-------------------------------------|------|--------|
| `usaapp`       | `/root/usa-app/backend`        | `server.js`                         | 5000 | 200M   |
| `nego-backend` | `/root/NegoApp`                | `server.js`                         | 3001 | 200M   |
| `nego-bridge`  | `/root/NegoApp`                | `mcp-bridge-client.js`              | —    | 100M   |
| `book2`        | `/home/administrator/book2`    | `next start -p 3002`                | 3002 | 300M   |
| `book-bridge`  | `/home/administrator/book2`    | `tsx mcp-bridge/src/index.ts`       | —    | 100M   |

**nginx**: `azbook.site` → `localhost:3002` (book2). Reverse proxy cu suport WebSocket upgrade, body limit 50MB, read timeout 300s.

---

## Variabile de mediu pentru bridges

```bash
# nego-bridge
BRIDGE_URL=ws://localhost:5000/ws/mcp-bridge
NEGO_API=http://localhost:3001
NEGO_USER=a
NEGO_PASS=123456

# book-bridge
MCP_WS_URL=ws://localhost:5000/ws/mcp-bridge
BOOK2_BASE_URL=http://localhost:3002
```

---

## Verificare rapidă

1. `pm2 list` — toate cele 5 procese trebuie să fie `online`.
2. Status bridge-uri:
   ```bash
   curl http://localhost:5000/api/mcp-bridge/status
   ```
   Trebuie să vezi ambii agenți (`negoapp`, `book2`) cu `connected: true`.
3. Test direct un tool:
   ```bash
   curl -X POST http://localhost:5000/api/mcp-bridge/call \
        -H "Content-Type: application/json" \
        -d '{"agent":"negoapp","tool":"nego_health","params":{}}'
   ```
4. Test end-to-end: trimite un mesaj de chat ("arată-mi leads") — răspunsul ar trebui să vină formatat WhatsApp-style, nu JSON brut.

---

## Fișiere cheie pentru înțelegerea integrării

- [backend/mcpBridgeService.js](backend/mcpBridgeService.js) — server-ul WebSocket MCP
- [backend/orchestrator/index.js](backend/orchestrator/index.js) — dispatcher principal pe baza intenției
- [backend/orchestrator/handlers.js](backend/orchestrator/handlers.js) — `handleNego()` și `handleBookApp()`
- [backend/orchestrator/prompts.js](backend/orchestrator/prompts.js) — schema JSON cu tag-urile pe care Gemini trebuie să le emită
- [ecosystem.config.js](ecosystem.config.js) — definiția PM2 a celor 5 procese
