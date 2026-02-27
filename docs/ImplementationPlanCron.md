# Cron Job Agent — Inspired by OpenClaw `src/cron/`

Implement a complete cron job scheduling system allowing the user to create, manage, and execute recurring automated actions — both via the frontend UI and through voice/chat commands via the orchestrator.

## Proposed Changes

### Backend Core — Cron Service

#### [NEW] [cronService.js](file:///c:/Users/Admin/Documents/GitHub/usa-app/backend/cronService.js)

Core cron engine using [croner](https://www.npmjs.com/package/croner) (same lib OpenClaw uses). Responsibilities:

- **`createCronJob(name, cronExpression, actionType, actionPayload)`** — Schedules a new job in-memory and persists to MongoDB
- **`pauseCronJob(id)`** / **`resumeCronJob(id)`** — Toggle job execution
- **`deleteCronJob(id)`** — Stop and remove
- **`listCronJobs()`** — Return all jobs with next-run info
- **`restoreJobs()`** — Called on server boot, re-activates all `status: 'active'` jobs from DB

**Supported action types:**
| Action | What it does |
|---|---|
| `notification` | Emits a log/console message (future: push notification) |
| `task` | Creates a PlannerTask automatically |
| `whatsapp` | Sends a WhatsApp message via `whatsappService` |
| `http` | Makes an HTTP request to a URL |

Each job execution is logged to `CronJobLog` for history/debugging.

---

#### [MODIFY] [server.js](file:///c:/Users/Admin/Documents/GitHub/usa-app/backend/server.js)

1. **Add `CronJob` and `CronJobLog` Mongoose schemas** (after line ~157, near existing schemas):

```js
const CronJobSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cronExpression: { type: String, required: true },
  actionType: { type: String, enum: ['notification', 'task', 'whatsapp', 'http'], required: true },
  actionPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['active', 'paused'], default: 'active' },
  lastRun: { type: Date, default: null },
  nextRun: { type: Date, default: null },
  runCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const CronJobLogSchema = new mongoose.Schema({
  cronJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CronJob' },
  jobName: String,
  actionType: String,
  result: { type: String, enum: ['success', 'error'], default: 'success' },
  output: String,
  executedAt: { type: Date, default: Date.now }
});
```

2. **Add REST API routes** for full CRUD + pause/resume/logs:
   - `GET /api/cron-jobs` — List all
   - `POST /api/cron-jobs` — Create new
   - `PATCH /api/cron-jobs/:id` — Update
   - `DELETE /api/cron-jobs/:id` — Delete
   - `POST /api/cron-jobs/:id/pause` — Pause
   - `POST /api/cron-jobs/:id/resume` — Resume
   - `GET /api/cron-jobs/:id/logs` — Execution history
   - `GET /api/cron-jobs/logs/recent` — Recent logs across all jobs

3. **Call `cronService.restoreJobs()` on server startup** (in `app.listen` callback)

---

#### [MODIFY] [orchestratorService.js](file:///c:/Users/Admin/Documents/GitHub/usa-app/backend/orchestratorService.js)

Add `CRON_JSON` tag support so the AI agent can create/manage cron jobs via chat/voice:

```
<CRON_JSON>{"action":"create","name":"Morning reminder","cron":"0 8 * * *","type":"notification","payload":{"message":"Time to start the day!"}}</CRON_JSON>
<CRON_JSON>{"action":"list"}</CRON_JSON>
<CRON_JSON>{"action":"pause","id":"..."}</CRON_JSON>
<CRON_JSON>{"action":"delete","id":"..."}</CRON_JSON>
```

---

### Frontend

#### [NEW] [page.tsx](file:///c:/Users/Admin/Documents/GitHub/usa-app/frontend/src/app/cron-jobs/page.tsx)

Full management page with:
- **Jobs list** — cards showing name, cron expression (human-readable), status badge, next run, run count
- **Create dialog** — form with name, cron expression (with presets like "Every hour", "Every day at 8am"), action type, payload
- **Actions** — pause/resume toggle, delete, view logs
- **Logs panel** — recent execution logs with success/error status
- Gradient accent color: **orange/amber** (to differentiate from teal planner)

#### [MODIFY] [Navigation.tsx](file:///c:/Users/Admin/Documents/GitHub/usa-app/frontend/src/components/Navigation.tsx)

Add cron jobs nav entry:
```ts
{ href: '/cron-jobs', icon: Timer, label: 'Cron Jobs', showOnMobile: false }
```

---

## Verification Plan

### Manual Testing

1. **Start the backend**: `cd backend && node server.js`
2. **Create a cron job via API**:
   ```bash
   curl -X POST http://localhost:5000/api/cron-jobs \
     -H "Content-Type: application/json" \
     -d '{"name":"Test Job","cronExpression":"* * * * *","actionType":"notification","actionPayload":{"message":"Test ping"}}'
   ```
3. **Verify it fires** — Watch the server console for `[Cron]` log messages appearing every minute
4. **List jobs**: `curl http://localhost:5000/api/cron-jobs` — Verify the job appears with `runCount` incrementing
5. **Pause**: `curl -X POST http://localhost:5000/api/cron-jobs/<id>/pause` — Verify logs stop
6. **Resume**: `curl -X POST http://localhost:5000/api/cron-jobs/<id>/resume` — Verify logs resume
7. **Delete**: `curl -X DELETE http://localhost:5000/api/cron-jobs/<id>` — Verify job is fully gone
8. **Check logs**: `curl http://localhost:5000/api/cron-jobs/<id>/logs` — See execution history
9. **Frontend**: Navigate to `/cron-jobs` in the browser, verify UI renders correctly
10. **Orchestrator**: Send a chat message like "Creează un cron job care să mă notifice în fiecare zi la ora 8" and verify a job is created



=================================================

Ce s-a creat:

cronService.js — engine cu croner, 4 tipuri de acțiuni (notification, task, whatsapp, http), persistență MongoDB, auto-restore la restart
8 API routes — CRUD + pause/resume + logs
Orchestrator integration — poți crea/lista/pausa/șterge cron jobs prin voce sau chat (ex: "Creează un cron job care să mă notifice în fiecare zi la ora 8")
Frontend /cron-jobs — pagină completă cu carduri, formă de creare cu preseturi, logs, temă amber/orange
Build verificat — compilare Next.js reușită, 0 erori
Pornește backend-ul (node server.js) și navighează la /cron-jobs pentru a testa.