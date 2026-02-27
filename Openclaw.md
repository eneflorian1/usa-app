# 🦞 OpenClaw — Referință Completă Tehnologii & Tools

> Acest fișier documentează **toate** tehnologiile, skill-urile, librăriile, extensiile și tool-urile pe care le folosește OpenClaw. Folosește-l ca referință rapidă când vrei să implementezi ceva nou.

---

## 📦 Stack Principal

| Categorie | Tehnologie | Versiune |
|---|---|---|
| **Runtime** | Node.js | ≥22.12.0 |
| **Limbaj** | TypeScript | 5.9.3 |
| **Package Manager** | pnpm | 10.23.0 |
| **Build** | tsdown | 0.20.3 |
| **Bundler/Runner** | tsx | 4.21.0 |
| **Linter** | oxlint | 1.50.0 |
| **Formatter** | oxfmt | 0.35.0 |
| **Testing** | Vitest | 4.0.18 |
| **Web Server** | Express | 5.2.1 |
| **WebSocket** | ws | 8.19.0 |
| **Schema Validation** | @sinclair/typebox | 0.34.48 |
| **CLI Framework** | Commander | 14.0.3 |
| **UI Framework** | Lit (Web Components) | 3.3.2 |

---

## 🤖 AI / LLM Providers & Librării

| Librărie | Scop | Cum se folosește |
|---|---|---|
| **@mariozechner/pi-agent-core** | Core agent runtime — gestionează conversații, tool calls, streaming | Agent-ul principal "Pi" care procesează mesajele |
| **@mariozechner/pi-ai** | Adaptor multi-model AI (Anthropic, OpenAI, Gemini, Mistral, Bedrock) | Schimbi modelul cu o singură setare, failover automat |
| **@mariozechner/pi-coding-agent** | Agent specializat pentru cod | Skill `coding-agent` |
| **@mariozechner/pi-tui** | Terminal UI interactiv pentru agent | Comandă `openclaw tui` |
| **@aws-sdk/client-bedrock** | AWS Bedrock (Claude, Llama pe AWS) | Provider alternativ |
| **node-llama-cpp** | LLM local Llama pe CPU/GPU | Opțional, pentru modele locale |
| **zod** | Schema validation (v4) | Validarea input-urilor la tools |

> [!TIP]
> OpenClaw suportă **orice model** prin `pi-ai`: Anthropic Claude (Opus/Sonnet), OpenAI GPT/o-series, Google Gemini, Mistral, AWS Bedrock, și modele locale via llama.cpp.

---

## 📱 Canale de Comunicare (Extensions)

Fiecare canal este implementat ca extensie în `extensions/`:

### Principale (built-in)

| Canal | Librărie | Fișier Config | Descriere |
|---|---|---|---|
| **WhatsApp** | `@whiskeysockets/baileys` 7.0.0 | `channels.whatsapp` | WhatsApp via Baileys (QR pairing). Suportă mesaje, media, grupuri |
| **Telegram** | `grammy` 1.40.1 + `@grammyjs/runner` | `channels.telegram` | Bot Telegram complet cu suport grupuri, media, inline |
| **Slack** | `@slack/bolt` 4.6.0 + `@slack/web-api` | `channels.slack` | Slack app cu Socket Mode, threads, reacții |
| **Discord** | `@buape/carbon` + `@discordjs/voice` + `opusscript` | `channels.discord` | Bot Discord cu voice, slash commands |
| **Signal** | CLI `signal-cli` | `channels.signal` | Signal messaging via signal-cli subprocess |
| **iMessage (BlueBubbles)** | HTTP API BlueBubbles | `channels.bluebubbles` | iMessage recomandat — server BlueBubbles pe Mac |
| **iMessage (Legacy)** | CLI `imsg` | `channels.imessage` | iMessage direct via macOS Messages |
| **Google Chat** | Google Chat API | `channels.googlechat` | Google Workspace Chat |
| **Microsoft Teams** | Bot Framework | `channels.msteams` | Teams bot cu adaptoare Azure |
| **WebChat** | Built-in WebSocket | Gateway WS | Chat web integrat în dashboard |

### Extensii Adiționale

| Canal | Descriere |
|---|---|
| **Matrix** | Protocol federat Matrix |
| **Zalo** | Zalo OA (Official Account) |
| **Zalo Personal** | Zalo personal messaging |
| **Line** | LINE Messaging API (`@line/bot-sdk`) |
| **Feishu/Lark** | Lark messaging (`@larksuiteoapi/node-sdk`) |
| **IRC** | Internet Relay Chat |
| **Mattermost** | Mattermost self-hosted |
| **Nextcloud Talk** | Nextcloud Talk API |
| **Nostr** | Protocol descentralizat Nostr |
| **Synology Chat** | Synology NAS chat |
| **Tlon** | Urbit/Tlon messaging |
| **Twitch** | Twitch chat bot |

---

## 🛠️ Skills (52 total)

Fiecare skill este un folder în `skills/` cu un `SKILL.md`.

### 🌐 Web & Social

| Skill | Ce face | Tool necesar | API Key? |
|---|---|---|---|
| **xurl** | Client CLI complet pentru X/Twitter API v2 — post, reply, search, DM, follow, media upload | CLI `xurl` (brew/npm) | ❌ (OAuth) |
| **gifgrep** | Căutare GIF-uri pe Tenor | CLI `gifgrep` | ❌ |
| **blogwatcher** | Monitorizare bloguri/RSS feeds | — | ❌ |

### 📧 Email & Communication

| Skill | Ce face | Tool necesar | API Key? |
|---|---|---|---|
| **himalaya** | Client email CLI — list, read, write, reply, forward, search. Suportă IMAP/SMTP multiple conturi | CLI `himalaya` | ❌ (IMAP creds) |
| **imsg** | Trimite iMessage de pe macOS | CLI `imsg` | ❌ |
| **bluebubbles** | iMessage via BlueBubbles server | BlueBubbles server | ❌ |
| **wacli** | WhatsApp CLI tool | CLI `wacli` | ❌ |
| **voice-call** | Apeluri vocale AI | Extension voice-call | Da (ElevenLabs) |

### 📝 Note-taking & Productivitate

| Skill | Ce face | Tool necesar |
|---|---|---|
| **apple-notes** | CRUD Apple Notes pe macOS | AppleScript |
| **apple-reminders** | CRUD Apple Reminders pe macOS | AppleScript |
| **bear-notes** | Manage Bear notes | CLI Bear |
| **notion** | Notion API — pagini, databases, blocks | Notion API key |
| **obsidian** | Citire/scriere Obsidian vault-uri | Filsystem Obsidian vault |
| **things-mac** | Things 3 task manager pe macOS | CLI `things3-cli` |
| **trello** | Board management Trello | CLI `trello` |
| **session-logs** | Exportă loguri de sesiune | Built-in |

### 🔍 Căutare & Informații

| Skill | Ce face | Tool necesar | API Key? |
|---|---|---|---|
| **weather** | Vreme curentă & forecast via wttr.in | CLI `curl` | ❌ |
| **goplaces** | Google Places cu reviews & detalii | CLI `goplaces` | Da (Google) |
| **oracle** | Web scraping și research avansat | Built-in | ❌ |
| **summarize** | Sumarizare documente lungi | Built-in | ❌ |

### 🎵 Media & Divertisment

| Skill | Ce face | Tool necesar | API Key? |
|---|---|---|---|
| **spotify-player** | Control Spotify — play, pause, search, playlists | CLI `spotify_player` | Da (Spotify OAuth) |
| **sonoscli** | Control Sonos speakers | CLI `SonoSequencr` | ❌ |
| **songsee** | Recunoaștere muzică (Shazam-like) | CLI `songsee` | ❌ |
| **openai-image-gen** | Generare imagini cu DALL-E 3 / GPT Image | API OpenAI | Da |
| **video-frames** | Extrage frame-uri din video pentru analiză | CLI `ffmpeg` | ❌ |
| **camsnap** | Captură cameră/screenshot de pe device | Via node | ❌ |

### 🗣️ Voice / TTS

| Skill | Ce face | Tool necesar | API Key? |
|---|---|---|---|
| **sag** | ElevenLabs TTS cu playback local. Modele: v3 (expresiv), multilingual_v2, flash_v2.5 | CLI `sag` | Da (ELEVENLABS_API_KEY) |
| **sherpa-onnx-tts** | TTS offline via Sherpa ONNX (fără cloud) | Sherpa ONNX binary | ❌ |
| **openai-whisper** | Transcriere audio locală via Whisper | Whisper local | ❌ |
| **openai-whisper-api** | Transcriere audio via OpenAI Whisper API | API OpenAI | Da |

### 🏠 Smart Home & IoT

| Skill | Ce face | Tool necesar | API Key? |
|---|---|---|---|
| **openhue** | Control Philips Hue — lumini, scene, grupuri | CLI `openhue` | ❌ (bridge local) |
| **eightctl** | Control Eight Sleep (pat inteligent) | CLI `eightctl` | ❌ |

### 💻 Developer Tools

| Skill | Ce face | Tool necesar | API Key? |
|---|---|---|---|
| **github** | GitHub API — repos, PRs, issues, acțiuni. Folosește `gh` CLI + API directă | CLI `gh` + `curl` | GH_TOKEN |
| **gh-issues** | GitHub Issues management dedicat | CLI `gh` | GH_TOKEN |
| **coding-agent** | Agent AI specializat pentru cod (pi-coding-agent) | Built-in | ❌ |
| **tmux** | Management sesiuni tmux | CLI `tmux` | ❌ |

### 🔐 Securitate & Utilități

| Skill | Ce face | Tool necesar |
|---|---|---|
| **1password** | Acces 1Password items (parole, note securizate) | CLI `op` (1Password CLI) |
| **gog** | Security audit & hardening recomandări | CLI tools |
| **healthcheck** | Health check-uri pentru servicii | Built-in |
| **peekaboo** | File analysis cu macOS Peekaboo | CLI `peekaboo` |
| **nano-pdf** | Citire & extracție text din PDF-uri | Built-in (pdfjs-dist) |
| **nano-banana-pro** | Banana Pro hardware control | CLI |

### 🔗 Integrări & Platform

| Skill | Ce face | Tool necesar |
|---|---|---|
| **canvas** | Workspace vizual controlat de agent (A2UI) | Gateway + macOS/iOS |
| **clawhub** | Registry de skills — caută și instalează skills noi | Built-in |
| **mcporter** | Bridge MCP (Model Context Protocol) — conectează orice MCP server | CLI `mcporter` |
| **skill-creator** | Crează skills noi automat | Built-in |
| **model-usage** | Tracking usage modele AI (costuri, tokens) | Built-in |
| **discord** | Discord-specific actions (roles, channels) | Discord bot token |
| **slack** | Slack-specific actions (channels, reactions) | Slack tokens |
| **gemini** | Google Gemini specifice | Gemini API key |
| **ordercli** | CLI pentru comenzi/ordering | CLI `ordercli` |

---

## 📚 Librării NPM Principale (dependencies)

### Messaging & Canale

| Pachet | Versiune | Scop |
|---|---|---|
| `@whiskeysockets/baileys` | 7.0.0-rc.9 | WhatsApp Web API (fără Selenium, protocol direct) |
| `grammy` | 1.40.1 | Framework Telegram Bot (grammY) |
| `@slack/bolt` | 4.6.0 | Slack app framework |
| `@slack/web-api` | 7.14.1 | Slack Web API client |
| `@buape/carbon` | beta | Discord framework |
| `@discordjs/voice` | 0.19.0 | Discord voice connections |
| `opusscript` | 0.1.1 | Opus audio codec (Discord voice) |
| `@line/bot-sdk` | 10.6.0 | LINE Messaging API |
| `@larksuiteoapi/node-sdk` | 1.59.0 | Lark/Feishu API |

### Browser & Web Scraping

| Pachet | Versiune | Scop |
|---|---|---|
| `playwright-core` | 1.58.2 | Browser automation CDP (Chrome DevTools Protocol). Controlează Chrome/Chromium programatic |
| `@mozilla/readability` | 0.6.0 | Extrage conținut lizibil din pagini web (ca Firefox Reader View) |
| `linkedom` | 0.18.12 | DOM parser fără browser (HTML → DOM) |
| `undici` | 7.22.0 | HTTP client rapid (fetch nativ Node) |

### Media & Procesare

| Pachet | Versiune | Scop |
|---|---|---|
| `sharp` | 0.34.5 | Procesare imagini (resize, convert, optimizare) |
| `pdfjs-dist` | 5.4.624 | Citire PDF-uri (Mozilla PDF.js) |
| `node-edge-tts` | 1.2.10 | Microsoft Edge TTS (text-to-speech gratuit) |
| `file-type` | 21.3.0 | Detectare tip fișier din bytes |
| `jszip` | 3.10.1 | Creare/citire arhive ZIP |

### Networking & Infrastructure

| Pachet | Versiune | Scop |
|---|---|---|
| `ws` | 8.19.0 | WebSocket server/client |
| `express` | 5.2.1 | HTTP server (gateway API + dashboard) |
| `https-proxy-agent` | 7.0.6 | Proxy support pentru requests |
| `@homebridge/ciao` | 1.3.5 | mDNS/Bonjour discovery (găsire dispozitive pe LAN) |
| `ipaddr.js` | 2.3.0 | Parsare adrese IP |
| `tar` | 7.5.9 | Creare/extragere arhive tar |

### Cron & Scheduling

| Pachet | Versiune | Scop |
|---|---|---|
| `croner` | 10.0.1 | Cron job scheduler — suportă syntax cron clasic + expresii avansate |

### Database & Memory

| Pachet | Versiune | Scop |
|---|---|---|
| `sqlite-vec` | 0.1.7-alpha.2 | SQLite cu extensii vectoriale (embeddings) — alternativă la LanceDB |

> [!IMPORTANT]
> OpenClaw folosește **SQLite + sqlite-vec** pentru memorie vectorială (nu LanceDB). Extensia `memory-lancedb` există dar `sqlite-vec` e default-ul.

### Terminal & CLI

| Pachet | Versiune | Scop |
|---|---|---|
| `@lydell/node-pty` | 1.2.0-beta.3 | Pseudo-terminal (PTY) — rulează procese cu terminal real (necesar pentru tmux, git, etc) |
| `@clack/prompts` | 1.0.1 | Beautiful CLI prompts (wizard onboarding) |
| `chalk` | 5.6.2 | Terminal colors |
| `cli-highlight` | 2.1.11 | Syntax highlighting in terminal |
| `commander` | 14.0.3 | CLI argument parser |
| `qrcode-terminal` | 0.12.0 | Afișare QR code în terminal (WhatsApp pairing) |
| `osc-progress` | 0.3.0 | Terminal progress bars |

### Config & Data

| Pachet | Versiune | Scop |
|---|---|---|
| `json5` | 2.2.3 | JSON cu comentarii (config files) |
| `yaml` | 2.8.2 | YAML parser |
| `dotenv` | 17.3.1 | Environment variables din `.env` |
| `ajv` | 8.18.0 | JSON Schema validation |
| `chokidar` | 5.0.0 | File watcher (reîncarcă config la modificare) |

### Markdown & Rendering

| Pachet | Versiune | Scop |
|---|---|---|
| `markdown-it` | 14.1.1 | Markdown → HTML rendering |

### Logging

| Pachet | Versiune | Scop |
|---|---|---|
| `tslog` | 4.10.2 | Logger structurat cu nivele |

### Protocols

| Pachet | Versiune | Scop |
|---|---|---|
| `@agentclientprotocol/sdk` | 0.14.1 | Agent Client Protocol (ACP) SDK |
| `@snazzah/davey` | 0.1.9 | Protocol helper |
| `long` | 5.3.2 | Numere 64-bit (protocol buffers) |

---

## 🏗️ Arhitectura Source Code (`src/`)

| Modul | Ce face |
|---|---|
| `src/gateway/` | **WebSocket control plane** — server principal, routing, autentificare, health checks |
| `src/agents/` | Agent runtime — gestionare agenți, workspace, prompt injection |
| `src/sessions/` | Session management — izolare, contexte, multi-agent |
| `src/channels/` | Abstracție canale — routing mesaje, media pipeline |
| `src/browser/` | Browser control via Playwright CDP — screenshots, navigare, acțiuni |
| `src/canvas-host/` | Canvas A2UI hosting — workspace vizual controlat de agent |
| `src/cron/` | Cron jobs — scheduling recurent |
| `src/memory/` | Memory system — persistență conversații, context |
| `src/media/` | Media pipeline — procesare imagini/audio/video, transcripție |
| `src/media-understanding/` | Analiză media cu AI (ce e în imagine/video) |
| `src/link-understanding/` | Extragere conținut din URL-uri |
| `src/providers/` | Model provider adapters (Anthropic, OpenAI, Gemini, etc) |
| `src/plugins/` | Plugin system — încărcare, registry, lifecycle |
| `src/plugin-sdk/` | SDK pentru scrierea de plugins |
| `src/routing/` | Message routing — care mesaj merge la care agent/canal |
| `src/security/` | Security — sandbox, permissions, DM policy |
| `src/secrets/` | Secret management |
| `src/pairing/` | Device pairing — Bonjour/mDNS discovery |
| `src/node-host/` | Node host — gestionare dispozitive conectate (macOS/iOS/Android) |
| `src/tts/` | Text-to-Speech engine abstraction |
| `src/hooks/` | Hook system — extensii la lifecycle events |
| `src/cli/` | CLI commands implementation |
| `src/wizard/` | Onboarding wizard |
| `src/web/` | Web UI server (Control Panel + WebChat) |
| `src/tui/` | Terminal UI (interactive chat) |
| `src/auto-reply/` | Auto-reply logic — când și cum răspunde agentul |
| `src/logging/` | Logging infrastructure |
| `src/daemon/` | Background service (launchd/systemd) |
| `src/process/` | Process management — exec, spawn, PTY |
| `src/config/` | Configuration loading & validation |
| `src/infra/` | Infrastructure utilities |
| `src/shared/` | Shared types & utilities |

---

## 🔌 MCP Support (Model Context Protocol)

OpenClaw suportă MCP prin skill-ul **mcporter**:

```bash
# Instalare mcporter
brew install steipete/tap/mcporter

# Utilizare
mcporter --server "npx -y @modelcontextprotocol/server-filesystem /"
```

- **Abordare bridge** — mcporter convertește orice MCP server într-un tool OpenClaw
- **Decuplat de core** — adaugi/schimbi MCP servers fără restart gateway
- **Suport** — orice server MCP standard funcționează

---

## 🐳 Docker & Deployment

| Fișier | Scop |
|---|---|
| `Dockerfile` | Container principal OpenClaw |
| `Dockerfile.sandbox` | Sandbox per-sesiune (izolare securizată) |
| `Dockerfile.sandbox-browser` | Sandbox cu browser (Playwright) |
| `docker-compose.yml` | Multi-container setup |
| `docker-setup.sh` | Script auto-setup Docker |
| `fly.toml` / `fly.private.toml` | Deploy pe Fly.io |
| `render.yaml` | Deploy pe Render |

---

## 🖥️ Companion Apps

| Platformă | Limbaj | Ce face |
|---|---|---|
| **macOS** (OpenClaw.app) | Swift | Menu bar app, Voice Wake, Talk Mode, WebChat, debug tools |
| **iOS** | Swift (XcodeGen) | Canvas, Voice Wake, Talk Mode, camera, Bonjour pairing |
| **Android** | Kotlin (Gradle) | Canvas, Talk Mode, camera, screen recording, SMS opțional |

---

## ⚙️ CLI Commands

```bash
openclaw onboard              # Wizard setup complet
openclaw gateway              # Pornește gateway-ul
openclaw gateway restart      # Restart gateway
openclaw doctor               # Diagnosticare probleme
openclaw agent --message "X"  # Trimite mesaj la agent
openclaw message send --to X  # Trimite mesaj pe canal
openclaw channels login       # Login canale (WhatsApp QR, etc)
openclaw pairing approve X Y  # Aprobă un device nou
openclaw update               # Update la ultima versiune
openclaw nodes                # Listează dispozitive conectate
openclaw tui                  # Terminal UI interactiv
```

---

## 🔐 Securitate

| Feature | Descriere |
|---|---|
| **DM Pairing** | Contacte necunoscute primesc cod de pairing, nu mesaj procesat |
| **Docker Sandbox** | Sesiuni non-main rulează în containere Docker izolate |
| **Token Auth** | Gateway protejat cu token sau password |
| **Tailscale** | Serve (tailnet) sau Funnel (public) cu HTTPS automat |
| **Tool Allowlist/Denylist** | Controlezi ce tools sunt disponibile per sesiune |
| **Elevated Mode** | `/elevated on` pentru acces avansat, controlat per sesiune |

---

## 📁 Structura Fișierelor Config

```
~/.openclaw/
├── openclaw.json          # Config principal (model, channels, gateway)
├── credentials/           # Tokens canale (WhatsApp, etc)
├── workspace/
│   ├── AGENTS.md          # System prompt principal
│   ├── SOUL.md            # Personalitate agent
│   ├── TOOLS.md           # Tool instructions
│   └── skills/            # Skills custom
│       └── my-skill/
│           └── SKILL.md
└── sessions/              # Sesiuni salvate
```

### Exemplu Config Minimal

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-6",
  },
  gateway: {
    port: 18789,
    bind: "lan",
    auth: {
      mode: "token",
      token: "your-token"
    }
  },
  channels: {
    whatsapp: {
      allowFrom: ["+40712345678"]
    },
    telegram: {
      botToken: "123:ABC"
    }
  }
}
```

---

## 🔗 Link-uri Utile

| Resursă | URL |
|---|---|
| **Documentație** | https://docs.openclaw.ai |
| **GitHub** | https://github.com/openclaw/openclaw |
| **ClawHub (Skills)** | https://clawhub.com |
| **Discord** | https://discord.gg/clawd |
| **DeepWiki** | https://deepwiki.com/openclaw/openclaw |
