<div align="center">

```
   ██████╗██╗      █████╗ ██╗    ██╗██████╗ ██╗    ██╗ █████╗ ████████╗ ██████╗██╗  ██╗
  ██╔════╝██║     ██╔══██╗██║    ██║██╔══██╗██║    ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║
  ██║     ██║     ███████║██║ █╗ ██║██║  ██║██║ █╗ ██║███████║   ██║   ██║     ███████║
  ██║     ██║     ██╔══██║██║███╗██║██║  ██║██║███╗██║██╔══██║   ██║   ██║     ██╔══██║
  ╚██████╗███████╗██║  ██║╚███╔███╔╝██████╔╝╚███╔███╔╝██║  ██║   ██║   ╚██████╗██║  ██║
   ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝

      ███████╗ ██████╗ ██████╗ ███████╗    ███████╗██╗   ██╗██████╗ ███████╗██╗     ██╗██╗  ██╗
      ██╔════╝██╔═══██╗██╔══██╗██╔════╝    ██╔════╝██║   ██║██╔══██╗██╔════╝██║     ██║╚██╗██╔╝
      █████╗  ██║   ██║██████╔╝█████╗      ███████╗██║   ██║██████╔╝█████╗  ██║     ██║ ╚███╔╝
      ██╔══╝  ██║   ██║██╔══██╗██╔══╝      ╚════██║██║   ██║██╔══██╗██╔══╝  ██║     ██║ ██╔██╗
      ██║     ╚██████╔╝██║  ██║███████╗    ███████║╚██████╔╝██║  ██║███████╗███████╗███████╗██║ ██╔╝
      ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝    ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝
```

<br>

### 🦀 CLAWDWATCH LOBSTER EDITION — v2.0

*"See what they don't want you to see — everywhere on Earth"*

<br>

| | |
|:--|:--|
| 🟢 **HTTP API** | Port 3444 |
| 🌍 **Coverage** | 44 regions across 6 continents |
| ✈️ **Flights** | OpenSky Network (global) |
| 📰 **News** | 30 RSS feeds, global |
| 🌋 **Disasters** | USGS earthquakes, GDACS global alerts |
| 🌦 **Weather** | NOAA NWS, Open-Meteo |
| 🔌 **MCP** | LM Studio ready |

<br>

[![Status](https://img.shields.io/badge/STATUS-ACTIVE-red?style=flat-square&labelColor=000)](https://github.com/Franzferdinan51/clawdwatch-lobster-edition)
[![HTTP API](https://img.shields.io/badge/HTTP%20API-Port%203444-blue?style=flat-square&labelColor=000)](https://github.com/Franzferdinan51/clawdwatch-lobster-edition)
[![Version](https://img.shields.io/badge/VERSION-2.0--lobster-orange?style=flat-square&labelColor=000)](https://github.com/Franzferdinan51/clawdwatch-lobster-edition)
[![License](https://img.shields.io/badge/LICENSE-MIT-green?style=flat-square&labelColor=000)](LICENSE)

---

## 🌟 What's New in v2.0

| | |
|--|--|
| 🌍 **Global regions** | 44 regions (was 21) — all 6 continents, sub-regional granularity |
| 📰 **30 RSS feeds** | BBC, NYT, Guardian, France 24, DW, NPR, CBS, ABC, TASS, SCMP, Kyodo, Times of India, Al Jazeera, Reuters (via GN), AP (via GN), CNN (via GN), i24, JPost, VOA, Politico, LA Times, Straits Times, Independent, The Hindu, Indian Express, Kyiv Independent (via GN), ABC Australia, Middle East Eye, Times of Israel, Arab News (404) |
| 🌋 **Earthquakes** | USGS M2.5+ global feed, last 24h |
| 🌪 **Disasters** | GDACS global disaster alerts (cyclones, quakes, volcanoes, floods, wildfires) |
| 🌦 **US Weather** | NOAA NWS active alerts (139+) |
| 🌡 **World weather** | Open-Meteo current conditions (any lat/lon) |
| 📊 **Feed health** | `/news/health` shows per-feed OK/error |
| ⚙️ **Smart caching** | 5-min flight cache, 10-min RSS cache, respects OpenSky rate limits |

---

## 🚀 Quick Start

```bash
git clone https://github.com/Franzferdinan51/clawdwatch-lobster-edition.git
cd clawdwatch-lobster-edition
npm install
npm run start    # HTTP API on http://localhost:3444
```

---

## 🌐 HTTP API Endpoints

### Core
| Endpoint | Description |
|----------|-------------|
| `GET /` | Index of endpoints |
| `GET /status` | Service health (regions, feeds, cache state) |
| `GET /regions` | All 44 regions with lat/lon bounds, groups, priority |

### Flights (OpenSky)
| Endpoint | Description |
|----------|-------------|
| `GET /flights` | Aggregate counts across 20 priority regions |
| `GET /flights/all` | Every defined region (44 queries, slower) |
| `GET /flights/:region` | Single region by id or alias (e.g. `/flights/me`, `/flights/jp`) |
| `GET /flights/global` | Whole-world OpenSky query |

### News (30 RSS feeds)
| Endpoint | Description |
|----------|-------------|
| `GET /news` | All feeds, deduped, sorted newest first |
| `GET /news/:region` | Filter by region group (`world`, `middle_east`, `asia`, `europe`, `south_asia`, `russia`, `eastern_europe`, `africa`, `israel`, `tech`, `oceania`) |
| `GET /news/sources` | List all configured feeds |
| `GET /news/health` | Per-source OK/error status |

### Intel (earthquakes, weather, disasters)
| Endpoint | Description |
|----------|-------------|
| `GET /earthquakes?min=4.0` | USGS M2.5+ last 24h, min magnitude filter |
| `GET /gdacs` | Global Disaster Alert and Coordination System events |
| `GET /weather/us` | NOAA NWS active US alerts |
| `GET /weather?lat=&lon=` | Current weather from Open-Meteo |

### Aggregates
| Endpoint | Description |
|----------|-------------|
| `GET /osint` | Global situational summary (one call, ~21k flights + earthquakes + news + weather) |
| `GET /snapshot` | Cheaper variant for daily briefs |
| `GET /conflict` | ME-focused conflict summary (legacy, backward compat) |

### Example
```bash
# One-call global summary
curl http://localhost:3444/osint | jq '.summary'

#{
#  "flights": 21917,
#  "regionsTracked": 20,
#  "earthquakes45": 15,
#  "gdacsEvents": 100,
#  "usWeatherAlerts": 140,
#  "newsHeadlines": 20
#}

# Flights in Japan
curl http://localhost:3444/flights/japan

# Earthquakes M4.5+ last 24h
curl 'http://localhost:3444/earthquakes?min=4.5'

# News for Asia region
curl http://localhost:3444/news/asia

# Per-feed health
curl http://localhost:3444/news/health
```

---

## 🌍 Global Region Coverage (44 regions)

### Global (1)
`global` — full planet OpenSky query

### Continental (6)
`europe` · `north_america` · `south_america` · `africa` · `asia` · `oceania`

### Middle East / Gulf (13)
`middle_east` · `iran` · `israel` · `lebanon` · `syria` · `iraq` · `yemen` · `saudi_arabia` · `uae` · `qatar` · `kuwait` · `oman` · `turkey`

### Europe (4)
`eastern_europe` · `british_isles` · `mediterranean` · `scandinavia`

### Americas (6)
`usa` · `canada` · `mexico` · `caribbean` · `brazil` · `argentina`

### Asia (7)
`central_asia` · `south_asia` · `east_asia` · `southeast_asia` · `china` · `japan` · `korea` · `india`

### Africa (4)
`north_africa` · `west_africa` · `east_africa` · `southern_africa`

### Oceania (2)
`australia` · `new_zealand`

All regions support aliases (e.g. `me`, `gulf`, `levant`, `ksa`, `apac`, `nafrica`).

---

## 📰 News Sources (30 feeds, 28 currently live)

| Source | Region | Notes |
|--------|--------|-------|
| BBC World | world | Direct RSS |
| The Guardian World | world | Direct RSS |
| NYT World | world | Direct RSS |
| Reuters | middle_east | via Google News proxy (Reuters blocks scrapers) |
| AP News | world | via Google News proxy |
| CNN World | world | via Google News proxy |
| Al Jazeera | middle_east | Direct RSS |
| France 24 | world | Direct RSS |
| Deutsche Welle | world | Direct RSS |
| NPR World | world | Direct RSS |
| CBS News | world | Direct RSS |
| ABC News | world | Direct RSS |
| Politico | world | Direct RSS (intermittent 403s) |
| LA Times | world | Direct RSS |
| The Straits Times | world | Direct RSS |
| The Independent | world | Direct RSS |
| Times of Israel | israel | Direct RSS |
| Middle East Eye | middle_east | Direct RSS (intermittent 404) |
| i24 News | israel | Direct RSS |
| Jerusalem Post | israel | Direct RSS |
| VOA Middle East | middle_east | Direct RSS |
| Kyiv Independent | eastern_europe | via Google News proxy |
| TASS | russia | Direct RSS |
| South China Morning Post | asia | Direct RSS |
| Kyodo News | asia | via Google News proxy |
| Times of India | south_asia | Direct RSS |
| The Hindu | south_asia | Direct RSS |
| Indian Express | south_asia | Direct RSS |
| ABC News Australia | oceania | Direct RSS |
| Reuters Tech | tech | via Google News proxy |

Check live status anytime: `GET /news/health`

---

## ⚠️ OpenSky Rate Limiting

OpenSky Network free tier: **400 credits/day**, **10s resolution**. ClawdWatch uses:
- **5-minute cache** per region URL
- **10-second minimum interval** between OpenSky calls
- **429-aware retry** with 15s backoff

For higher limits, sign up at https://opensky-network.org/api/ and set `OPENSKY_API_KEY` env var.

---

## 🤖 LM Studio MCP Integration

Add to `~/.lmstudio/mcp.json`:
```json
{
  "mcpServers": {
    "clawdwatch": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\franz\\.openclaw\\workspace\\mcp-clawdwatch\\index.mjs"
      ]
    }
  }
}
```

The MCP server proxies to `http://localhost:3444` and exposes: `clawdwatch_status`, `clawdwatch_flights`, `clawdwatch_news`, `clawdwatch_earthquakes`, `clawdwatch_weather`, `clawdwatch_osint`, `clawdwatch_snapshot`.

---

## 🔧 Configuration

Create `.env` in the project root:
```bash
# Optional: higher OpenSky rate limits
OPENSKY_API_KEY=your_key_here

# Optional: Telegram alerts (alerts module)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Optional: ship tracking (AISStream)
AISSTREAM_API_KEY=your_key

# Optional: satellite imagery (Sentinel Hub)
SENTINEL_HUB_CLIENT_ID=your_id
SENTINEL_HUB_CLIENT_SECRET=your_secret
```

---

## 📂 Project Structure

```
clawdwatch-lobster-edition/
├── src/
│   ├── http.ts           # HTTP API server (port 3444)
│   ├── regions.ts        # 44 region definitions (lat/lon, group, priority)
│   ├── index.ts          # Main CLI entry
│   ├── cli.ts            # Command-line interface
│   ├── alerts/
│   │   └── telegram.ts   # Telegram alert dispatcher
│   └── sources/
│       ├── flights.ts    # OpenSky + ADS-B Exchange flight logic
│       ├── news.ts       # News aggregator base class
│       ├── rss.ts        # RSS/Atom feed parser + 30-feed registry
│       ├── intel.ts      # USGS, GDACS, NWS, Open-Meteo
│       ├── ships.ts      # AIS Stream ship tracking
│       ├── satellite.ts  # Sentinel Hub
│       ├── social.ts     # Twitter/X social signals
│       └── internet.ts   # NetBlocks connectivity
├── mcp-clawdwatch/       # MCP server for LM Studio
├── skill/                # OpenClaw / Hermes skill manifest
├── scripts/              # OS-specific installers (win/mac/linux)
├── README.md
└── package.json
```

---

## 🛠️ Scripts

| Script | Description |
|--------|-------------|
| `npm run start` | Start HTTP API on port 3444 |
| `npm run dev` | Nodemon-watched dev mode |
| `npm run watch` | CLI continuous monitoring |
| `npm run snapshot` | One-shot OSINT snapshot to console |
| `npm run regions` | List regions with bounds |
| `npm run build` | Compile TypeScript |

---

## 📜 License

MIT

---

## ⚠️ Disclaimer

Clawdwatch aggregates **publicly available** information from public APIs and RSS feeds only. This tool is for **informational purposes** — always verify critical information through official channels.

<div align="center">

*In the fog of war, be the one who sees clearly.*

🦀
</div>
