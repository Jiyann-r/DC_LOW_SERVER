# 🚀 Roblox Live Server Tracker & Discord Auto-Join Dispatcher

A high-performance, lightweight, 24/7 autonomous microservice that polls the Roblox Public Game API, identifies low-latency/low-player instances, and streams real-time server telemetry to a single, dynamically updated Discord embed with 1-click auto-join and executor teleport integration.

---

## 📌 Problem & Motivation

In competitive or grind-heavy Roblox games (e.g., *Steal an Egg*, *Pet Simulator 99*), players frequently need low-population servers to transfer items safely, farm without disruption, or secure top trading booths.

* **The Traditional Approach:** Running Luau scripts inside Roblox client executors. This required players to keep their game client open, consumed significant local CPU/RAM, stopped when the game was closed, and suffered frequent crashes.
* **The Engineered Solution:** A decoupled, serverless-ready Node.js backend running 24/7 in the cloud with zero local overhead, zero external package bloat, and an in-place dynamic Discord interface that never spams channels.

---

## 🏗️ System Architecture

```
                       ┌────────────────────────┐
                       │   Roblox Public API    │
                       └───────────┬────────────┘
                                   │ (HTTP GET every 15s)
                                   ▼
                       ┌────────────────────────┐
                       │  Node.js Core Engine   │
                       │   (Zero Dependencies)  │
                       └───────────┬────────────┘
                                   │
               ┌───────────────────┴───────────────────┐
               ▼                                       ▼
    ┌──────────────────────┐               ┌───────────────────────┐
    │ State & Filter Logic │               │ Embedded HTTP Server  │
    │  - Ghost server drop │               │  - Port 3000 /health  │
    │  - Ping asc sort     │               │  - UptimeRobot Pings  │
    │  - state.json map    │               │  - 24/7 Sleep Bypass  │
    └──────────┬───────────┘               └───────────────────────┘
               │
               │ (POST on boot / PATCH every 15s)
               ▼
    ┌──────────────────────┐
    │   Discord Webhook    │
    │ (Single Live Embed)  │
    └──────────┬───────────┘
               │
         ┌─────┴────────────────────────┐
         ▼                              ▼
┌─────────────────┐           ┌───────────────────┐
│ 1-Click AutoJoin│           │ Tap-to-Copy Luau  │
│ (Custom Gateway)│           │ (TeleportService) │
└─────────────────┘           └───────────────────┘
```

---

## ✨ Key Features & Engineering Highlights

### 1. In-Place Dynamic Updates (Zero Webhook Spam)
Instead of cluttering Discord channels with endless new notifications:
* On initialization, the dispatcher sends an HTTP `POST ?wait=true` to capture the unique Discord `Message ID`.
* It persists the `placeId -> messageId` pairing in `state.json`.
* Every polling tick (15s), it executes an HTTP `PATCH` on `/messages/{messageId}`, updating player counts, latency, and heartbeat timestamps seamlessly in-place.

### 2. Zero-Dependency Native Architecture
Built intentionally with **zero external NPM packages** (using Node.js native `http`, `fs`, `path`, and built-in `fetch`):
* Includes a lightweight, zero-dependency `.env` file parser written from scratch.
* Ultra-fast cold starts (<200ms) with minimal attack surface and zero vulnerability maintenance (`npm audit 0`).

### 3. Ghost Server & Desync Elimination
In high-concurrency games, the Roblox API frequently serves "ghost servers" (instances with 0 or dying connections that trigger Roblox `Error 769: Teleport Failed` or `Unknown Status` upon connection).
* **The Solution:** Implemented a strict filtering pipeline (`srv.playing > 0 && srv.playing <= targetMaxPlayers`) and prioritized ping-ascending sorting so only reachable, healthy servers are surfaced to players.

### 4. 24/7 Free Cloud Resilience (Keep-Alive Architecture)
Free-tier hosting providers (e.g., Render) place idle containers to sleep after 15 minutes of inactivity.
* Integrated a native Node.js HTTP server exposing a `/health` endpoint returning real-time status and uptime.
* Paired with an external cloud monitor (UptimeRobot) sending continuous 5-minute health pings, guaranteeing 100% 24/7 uptime at zero monthly cost.

### 5. Graceful State & Shutdown Handlers
* Captures process signals (`SIGINT`, `SIGTERM`).
* Automatically dispatches a graceful shutdown payload to Discord, coloring the live board **Red** and marking the status as `OFFLINE` before exiting so users are never misled by stale server data.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js (v18+) | Async I/O, event-loop driven polling |
| **Network & APIs** | Native `fetch` | Roblox Public Games API & Discord Webhook REST API |
| **Web Server** | Native `http` | Lightweight `/health` probe for cloud keep-alive |
| **State Storage** | File-backed JSON (`state.json`) | Persistent placeId-to-messageId mapping |
| **Deployment** | Render.com Web Service | Cloud container hosting connected to private GitHub repo |
| **Monitoring** | UptimeRobot | Automated HTTP health checks preventing container sleep |

---

## ⚙️ Configuration & Environment

### 1. Environment Variables (`.env`)
Create a `.env` file in the root directory:
```env
# Discord Webhook URL with message-editing permissions
WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN

# Optional: Override listening port (default: 3000)
PORT=3000
```

### 2. Games Configuration (`config.json`)
Easily track single or multiple games concurrently:
```json
{
  "refreshInterval": 15,
  "customJoinRedirect": "https://your-redirect-gateway.netlify.app/",
  "port": 3000,
  "games": [
    {
      "placeId": 107778070777162,
      "name": "Steal an Egg",
      "targetMaxPlayers": 4,
      "maxServersToDisplay": 10
    }
  ]
}
```

---

## 🚀 Local Installation & Execution

```bash
# 1. Clone repository
git clone https://github.com/your-username/DC_LOW_SERVER.git
cd DC_LOW_SERVER

# 2. Configure environment
cp .env.example .env
# Edit .env and paste your Discord Webhook URL

# 3. Start service
npm start
```

---

## 🌐 Production Deployment Guide (Free Tier 24/7)

1. **Deploy to Render:**
   * Create a new **Web Service** on [Render.com](https://render.com) linked to your GitHub repository.
   * **Runtime:** Node
   * **Build Command:** `npm install` (or leave empty)
   * **Start Command:** `node index.js`
   * Under **Environment Variables**, add:
     * `WEBHOOK_URL` = your private Discord webhook URL.
2. **Prevent Container Sleep:**
   * Copy the assigned Render URL (e.g. `https://your-app.onrender.com`).
   * Create a free HTTP(s) Monitor on [UptimeRobot](https://uptimerobot.com) targeting `https://your-app.onrender.com/health` with a **5-minute** interval.

---

## 🔒 Security Best Practices
* **Zero Secret Leakage:** `.env` and `state.json` are excluded via `.gitignore` to prevent secret exposure.
* **Environment Injection:** Production webhook URLs are injected strictly at runtime via container environment variables.
* **User-Agent Header:** All outgoing Roblox API requests carry custom headers to adhere to standard REST API etiquette and prevent automated scraping blocks.

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
