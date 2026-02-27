# GitHub Tool Integration — usa-app

Adaugă un tool GitHub nativ în orchestrator și glasses gateway, permițând operații GitHub (issues, PRs, CI status) prin voce sau chat. Folosește GitHub REST API direct (fără dependența `gh` CLI), urmând exact same pattern ca celelalte tool-uri existente (`BOOKING_JSON`, `TASK_JSON`, `WHATSAPP_JSON`).

## User Review Required

> [!IMPORTANT]
> **GitHub Token**: Vei avea nevoie de un GitHub Personal Access Token (classic) cu permisiuni `repo` + `read:user`. Îl vei salva din pagina Settings a aplicației, la fel ca Gemini API key.

> [!IMPORTANT]
> **Fără `gh` CLI**: Implementarea folosește `fetch()` direct pe GitHub REST API — nu necesită instalarea `gh` CLI. Funcționează pe orice OS fără dependențe extra.

## Proposed Changes

### Backend Service

#### [NEW] [githubService.js](file:///c:/Users/Admin/Documents/GitHub/usa-app/backend/githubService.js)

Serviciu dedicat GitHub cu funcții:

| Funcție | Ce face | GitHub API Endpoint |
|---|---|---|
| `getToken()` | Citește GH_TOKEN din Settings MongoDB | — |
| `listIssues(owner, repo, options)` | Listează issues (open/closed, label, limit) | `GET /repos/{owner}/{repo}/issues` |
| `createIssue(owner, repo, title, body, labels)` | Creează un issue nou | `POST /repos/{owner}/{repo}/issues` |
| `closeIssue(owner, repo, issueNumber)` | Închide un issue | `PATCH /repos/{owner}/{repo}/issues/{n}` |
| `listPRs(owner, repo, state)` | Listează pull requests | `GET /repos/{owner}/{repo}/pulls` |
| `getPRStatus(owner, repo, prNumber)` | Status PR + CI checks | `GET /repos/{owner}/{repo}/pulls/{n}` + `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` |
| `getRepoInfo(owner, repo)` | Info repo (stars, forks, open issues) | `GET /repos/{owner}/{repo}` |
| `listCIRuns(owner, repo, limit)` | Ultimele workflow runs | `GET /repos/{owner}/{repo}/actions/runs` |

Toate funcțiile returnează obiecte JSON curate (nu raw API response).

---

### Orchestrator Integration

#### [MODIFY] [orchestratorService.js](file:///c:/Users/Admin/Documents/GitHub/usa-app/backend/orchestratorService.js)

1. **System prompt** — adaugă noul tool `GITHUB_JSON` la secțiunea TOOLS DISPONIBILE:
```
Pentru GITHUB (operații GitHub — issues, PRs, CI):
<GITHUB_JSON>{"action":"list_issues","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"create_issue","owner":"eneflorian1","repo":"usa-app","title":"Bug: X","body":"Detalii"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"list_prs","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"pr_status","owner":"eneflorian1","repo":"usa-app","pr":55}</GITHUB_JSON>
<GITHUB_JSON>{"action":"ci_status","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
<GITHUB_JSON>{"action":"close_issue","owner":"eneflorian1","repo":"usa-app","issue":42}</GITHUB_JSON>
<GITHUB_JSON>{"action":"repo_info","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
```

2. **Intent detection** — adaugă `github` intent:
```js
if (/github|issue|pull.?request|PR|commit|CI|workflow|repo/i.test(lower)) return 'github';
```

3. **Action extraction** — extrage `GITHUB_JSON` tag și execută prin `githubService`

4. **cleanAllTags** — adaugă regex pentru `GITHUB_JSON`

---

### Glasses Gateway Integration

#### [MODIFY] [glassesGatewayService.js](file:///c:/Users/Admin/Documents/GitHub/usa-app/backend/glassesGatewayService.js)

1. **System prompt** — adaugă instrucțiuni pentru GitHub:
```
GITHUB (operații pe repository):
<GITHUB_JSON>{"action":"list_issues","owner":"eneflorian1","repo":"usa-app"}</GITHUB_JSON>
```

2. **Action extraction** — adaugă `GITHUB_JSON` extraction la linia cu celelalte acțiuni

3. **Action execution** — procesează acțiunile GitHub

4. **cleanAllTags** — adaugă regex GITHUB_JSON

---

### Server Routes

#### [MODIFY] [server.js](file:///c:/Users/Admin/Documents/GitHub/usa-app/backend/server.js)

**Settings routes** (GH_TOKEN management):
- `GET /api/settings/github-token` — returnează token mascat
- `POST /api/settings/github-token` — salvează token nou

**Direct GitHub API routes** (pentru frontend dashboard):
- `GET /api/github/issues/:owner/:repo` — listează issues
- `POST /api/github/issues/:owner/:repo` — creează issue
- `PATCH /api/github/issues/:owner/:repo/:number/close` — închide issue
- `GET /api/github/prs/:owner/:repo` — listează PRs
- `GET /api/github/prs/:owner/:repo/:number` — detalii PR + CI
- `GET /api/github/ci/:owner/:repo` — ultimele CI runs
- `GET /api/github/repo/:owner/:repo` — repo info

---

## Verification Plan

### Automated Tests (via API calls)

Testăm cu `curl` direct din terminal (no test framework — consistent cu proiectul existent):

```bash
# 1. Save GH_TOKEN
curl -X POST http://localhost:5000/api/settings/github-token \
  -H "Content-Type: application/json" \
  -d '{"token":"ghp_YOUR_TOKEN_HERE"}'

# 2. Get masked token
curl http://localhost:5000/api/settings/github-token

# 3. List issues
curl http://localhost:5000/api/github/issues/eneflorian1/usa-app

# 4. List PRs
curl http://localhost:5000/api/github/prs/eneflorian1/usa-app

# 5. Repo info
curl http://localhost:5000/api/github/repo/eneflorian1/usa-app

# 6. CI runs
curl http://localhost:5000/api/github/ci/eneflorian1/usa-app

# 7. Test orchestrator intent
curl -X POST http://localhost:5000/api/orchestrator/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Ce issues am deschise pe GitHub?"}'
```

### Manual Verification

1. **Pornește serverul** — `cd backend && node server.js`
2. **Setează token** — din Settings page sau curl
3. **Testează din Orchestrator chat** — scrie "arată-mi issues de pe GitHub" și verifică că primești lista
4. **Verifică logurile** — caută `[GitHub]` în console output



==================================
 Ce s-a implementat
1. 

githubService.js
 (NOU)
8 funcții: 

listIssues
, 

createIssue
, 

closeIssue
, 

commentOnIssue
, 

listPRs
, 

getPRStatus
, 

listCIRuns
, 

getRepoInfo
Folosește fetch() direct pe GitHub REST API — zero dependențe noi

executeGitHubAction()
 dispatcher care rutează orice <GITHUB_JSON> tag
2. orchestratorService.js — <GITHUB_JSON> tag
Orchestratorul detectează intent 

github
 și execută acțiuni automat
"Ce issues am?" → Gemini generează <GITHUB_JSON> → se execută → răspuns
3. glassesGatewayService.js — comenzi vocale GitHub
Prin ochelari poți zice "ce issues am pe GitHub?" și primești răspuns vocal
4. server.js — 9 rute noi
2 rute settings (GET/POST token)
7 rute API directe (/api/github/issues/..., /api/github/prs/..., etc.)
🧪 Verificare
✅ node --check server.js — fără erori
✅ Toate modulele se încarcă corect
📋 Următorul pas
Ca să testezi live, ai nevoie de un GitHub Personal Access Token:

bash
# 1. Pornește serverul
cd backend && node server.js
# 2. Salvează tokenul
curl -X POST http://localhost:5000/api/settings/github-token -H "Content-Type: application/json" -d "{\"token\":\"ghp_YOUR_TOKEN\"}"
# 3. Testează
curl http://localhost:5000/api/github/repo/eneflorian1/usa-app