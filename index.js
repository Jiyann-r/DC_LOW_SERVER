// =======================================================================
// Jiyan's Independent 24/7 Discord Live Server Feeder
// Multi-Game Support & Free Cloud Host Ready (Secure Env Var Edition)
// =======================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');

// Automatically read .env if present (Zero external dependencies)
const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  try {
    const envLines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {
    console.warn('[Warning] Could not load .env file:', e.message);
  }
}

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'state.json');

// 1. Load Configuration
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  console.error('[Error] Could not read config.json:', err.message);
  process.exit(1);
}

// 2. Validate Secure Webhook URL
const webhookUrl = process.env.WEBHOOK_URL || config.webhookUrl;
if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
  console.error('[Security Error] Missing or invalid Discord Webhook URL!');
  console.error('Please configure WEBHOOK_URL in your .env file or environment variables.');
  process.exit(1);
}

// 3. Load or Initialize State (Mapping placeId -> messageId)
let state = {};
if (fs.existsSync(STATE_PATH)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    console.warn('[Warning] Failed to parse state.json. Initializing new state.');
    state = {};
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[Error] Failed to save state.json:', err.message);
  }
}

// Cache game names so we don't spam Roblox Marketplace API
const gameNameCache = {};

async function getGameName(placeId, fallbackName) {
  if (gameNameCache[placeId]) return gameNameCache[placeId];
  if (fallbackName) {
    gameNameCache[placeId] = fallbackName;
    return fallbackName;
  }

  try {
    const resInfo = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    if (resInfo.ok) {
      const data = await resInfo.json();
      if (data.universeId) {
        const uRes = await fetch(`https://games.roblox.com/v1/games?universeIds=${data.universeId}`);
        const uData = await uRes.json();
        if (uData.data && uData.data[0] && uData.data[0].name) {
          gameNameCache[placeId] = uData.data[0].name;
          return uData.data[0].name;
        }
      }
    }
  } catch (e) {}

  gameNameCache[placeId] = `Roblox Game (${placeId})`;
  return gameNameCache[placeId];
}

// 4. Update Discord Board (POST if new, PATCH if exists)
async function updateDiscordBoard(placeId, embedData) {
  const currentMessageId = state[String(placeId)];
  let targetUrl = webhookUrl;
  let method = 'POST';

  const payload = { embeds: [embedData] };

  if (currentMessageId) {
    targetUrl = `${webhookUrl}/messages/${currentMessageId}`;
    method = 'PATCH';
  } else {
    const separator = webhookUrl.includes('?') ? '&' : '?';
    targetUrl = `${webhookUrl}${separator}wait=true`;
    payload.username = 'Server Tracker';
    payload.avatar_url = 'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=420&height=420&format=png';
  }

  try {
    const response = await fetch(targetUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.status === 200 && !currentMessageId) {
      const data = await response.json();
      if (data && data.id) {
        state[String(placeId)] = data.id;
        saveState();
        console.log(`[Discord] Created new Live Board for Place ${placeId} (Msg ID: ${data.id})`);
      }
    } else if (response.status === 404 && currentMessageId) {
      console.warn(`[Discord] Message ${currentMessageId} not found (deleted?). Resetting...`);
      delete state[String(placeId)];
      saveState();
    } else if (!response.ok) {
      const errText = await response.text();
      console.warn(`[Discord Warning] Status ${response.status}: ${errText}`);
    }
  } catch (err) {
    console.error(`[Discord Error] Failed request for Place ${placeId}:`, err.message);
  }
}

// 5. Fetch Servers for a single game
async function fetchGameServers(gameConfig) {
  const placeId = gameConfig.placeId;
  const targetMaxPlayers = gameConfig.targetMaxPlayers ?? 1;
  const maxDisplay = gameConfig.maxServersToDisplay ?? 10;
  const gameName = await getGameName(placeId, gameConfig.name);

  const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?sortOrder=Asc&limit=100`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Roblox/WinInet' }
    });

    if (res.status === 429) {
      console.warn(`[Roblox API Rate Limit] 429 received for Place ${placeId}. Skipping tick.`);
      return;
    }

    if (!res.ok) {
      console.warn(`[Roblox API Error] Place ${placeId} returned status ${res.status}`);
      return;
    }

    const data = await res.json();
    const validServers = [];

    if (data && Array.isArray(data.data)) {
      for (const srv of data.data) {
        if (srv.id && typeof srv.playing === 'number' && srv.playing <= targetMaxPlayers) {
          validServers.push(srv);
        }
      }
    }

    // Sort by ping ascending
    validServers.sort((a, b) => {
      const pingA = Number(a.ping) || 999;
      const pingB = Number(b.ping) || 999;
      return pingA - pingB;
    });

    const fields = [];
    const count = Math.min(maxDisplay, validServers.length);

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const srv = validServers[i];
        const pingStr = srv.ping != null ? String(srv.ping) : 'N/A';
        const joinLink = `${config.customJoinRedirect}?placeId=${placeId}&jobId=${srv.id}`;

        fields.push({
          name: `Server #${i + 1}  •  ${srv.playing}/${srv.maxPlayers} Players  •  ${pingStr}ms`,
          value: `### [❯ Click to Auto Join Server](${joinLink})\n> \`game:GetService('TeleportService'):TeleportToPlaceInstance(${placeId}, '${srv.id}')\``,
          inline: false
        });
      }
    } else {
      fields.push({
        name: 'No Servers Available',
        value: `Waiting for servers with ≤ ${targetMaxPlayers} players to appear...`,
        inline: false
      });
    }

    const nowUnix = Math.floor(Date.now() / 1000);

    const embed = {
      title: `Live Servers: ${gameName}`,
      description: `**Status:** \`ONLINE\`\n**Heartbeat:** <t:${nowUnix}:R>\n\nTracking top servers (≤ ${targetMaxPlayers} players), prioritized by ping.`,
      color: 2336089, // Discord Online Green (0x23A559)
      fields: fields,
      footer: { text: `Jiyan's Independent Tracker • Refreshes every ${config.refreshInterval}s` },
      timestamp: new Date().toISOString()
    };

    await updateDiscordBoard(placeId, embed);
  } catch (err) {
    console.error(`[Error] Failed scanning Place ${placeId}:`, err.message);
  }
}

// 6. Send Offline Embed for all or specific Place
async function sendOfflineStatus(reason = 'Service Shutdown') {
  console.log(`[Shutdown] Sending OFFLINE status to Discord (${reason})...`);
  const nowUnix = Math.floor(Date.now() / 1000);

  const updates = (config.games || []).map(async (g) => {
    const currentMsgId = state[String(g.placeId)];
    if (!currentMsgId) return;

    const gameName = await getGameName(g.placeId, g.name);
    const offlineEmbed = {
      title: `Live Servers: ${gameName}`,
      description: `**Status:** \`OFFLINE\`\n\nThe tracking server stopped (${reason}). Displayed servers may be expired.\n\n**Last Active:** <t:${nowUnix}:t> (<t:${nowUnix}:R>)`,
      color: 15548997, // Discord Red (0xED4245)
      footer: { text: "Jiyan's Independent Tracker • Offline" },
      timestamp: new Date().toISOString()
    };

    try {
      await fetch(`${webhookUrl}/messages/${currentMsgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [offlineEmbed] })
      });
      console.log(`[Offline] Marked Place ${g.placeId} as OFFLINE on Discord.`);
    } catch (e) {
      console.error(`[Offline Error] Place ${g.placeId}:`, e.message);
    }
  });

  await Promise.all(updates);
}

// 7. Graceful Shutdown handlers
let isShuttingDown = false;
async function handleExit(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  await sendOfflineStatus(`Signal: ${signal}`);
  process.exit(0);
}

process.on('SIGINT', () => handleExit('SIGINT'));
process.on('SIGTERM', () => handleExit('SIGTERM'));

// 8. Dummy HTTP Server for 24/7 Uptime Pingers
const port = process.env.PORT || config.port || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ONLINE',
      trackedGames: (config.games || []).length,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(port, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Tracker Web Server listening on port ${port}`);
  console.log(`📡 Ping endpoint: http://localhost:${port}/health`);
  console.log(`🎮 Tracking ${(config.games || []).length} game(s) every ${config.refreshInterval}s`);
  console.log(`🔒 Webhook: Protected via Environment Variables`);
  console.log(`=======================================================`);
});

// 9. Main Polling Loop
async function tick() {
  if (isShuttingDown) return;
  const games = config.games || [];
  for (const game of games) {
    await fetchGameServers(game);
  }
}

// Run immediately, then start interval
tick();
setInterval(tick, (config.refreshInterval || 15) * 1000);
