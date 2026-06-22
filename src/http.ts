import express from 'express';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

import { ALL_REGIONS, getDefaultFlightRegions, getRegionById, findRegion, type RegionDefinition } from './regions';
import { RSS_FEEDS, fetchFeed, fetchFeeds, getFeedHealth, type NewsItem, type RssFeed, type FeedHealth } from './sources/rss';
import { fetchEarthquakes, fetchUsWeatherAlerts, fetchCurrentWeather, fetchGdacsEvents, fetchDefconLevel } from './sources/intel';
import {
  searchSanctions,
  traceBtcAddress,
  traceEthAddress,
  fetchFireHotspots,
  fetchCve,
  fetchRecentCves,
  whoisLookup,
  dnsLookup,
  fetchTelegramChannel,
} from './sources/osiris';

const app = express();
const PORT = 3444;

// ============================================================
// OpenSky rate limiting + cache
// ============================================================
const OPENSKY_BASE = 'https://opensky-network.org/api/states/all';
const OPENSKY_KEY = process.env.OPENSKY_API_KEY || '';
const OPENSKY_AUTH_HEADER = OPENSKY_KEY ? { 'Authorization': `Bearer ${OPENSKY_KEY}` } : {};

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 10_000;   // 10s — strict enough to be polite
const MAX_RETRIES = 2;
const RETRY_DELAY = 15_000;

const cache: { [key: string]: { data: any; timestamp: number } } = {};
const CACHE_TTL = 5 * 60 * 1000;       // 5 min for flight data

async function fetchOpenSky(url: string, useCache = true): Promise<any> {
  const cacheKey = url;

  if (useCache && cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  // rate limit
  const now = Date.now();
  const wait = MIN_REQUEST_INTERVAL - (now - lastRequestTime);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: { ...OPENSKY_AUTH_HEADER, 'User-Agent': 'ClawdWatch-Lobster/1.0' },
        timeout: 15_000,
        validateStatus: () => true,
      });

      if (response.status === 429) {
        console.warn(`[opensky] rate limited, retrying in ${RETRY_DELAY}ms`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        continue;
      }

      if (response.status >= 400) {
        return { error: `OpenSky HTTP ${response.status}`, states: [] };
      }

      if (response.data?.states) {
        cache[cacheKey] = { data: response.data, timestamp: Date.now() };
        return response.data;
      }

      return { states: [] };
    } catch (e: any) {
      if (attempt === MAX_RETRIES - 1) {
        return { error: e.message, states: [] };
      }
    }
  }
  return { error: 'OpenSky: max retries exceeded', states: [] };
}

// ============================================================
// Flight region fetcher
// ============================================================
async function getFlightsForRegion(region: RegionDefinition) {
  const { flightBounds, name, id } = region;
  const url = `${OPENSKY_BASE}?lamin=${flightBounds.latMin}&lomin=${flightBounds.lonMin}&lamax=${flightBounds.latMax}&lomax=${flightBounds.lonMax}`;
  const data = await fetchOpenSky(url);

  if (data.error) {
    return { regionId: id, region: name, total: 0, flights: [], error: data.error };
  }
  return {
    regionId: id,
    region: name,
    group: region.group,
    total: data.states?.length || 0,
    flights: (data.states || []).slice(0, 50),
  };
}

// Aggregate flight counts across many regions. Designed to be cache-friendly.
async function getFlightSummary(regions: RegionDefinition[]) {
  const results = await Promise.all(regions.map(getFlightsForRegion));
  const totalFlights = results.reduce((s, r) => s + (r.total || 0), 0);
  const errors = results.filter((r) => r.error);
  return {
    timestamp: new Date().toISOString(),
    source: 'OpenSky Network',
    regionsQueried: regions.length,
    totalFlights,
    regions: results.map((r) => ({
      id: r.regionId,
      name: r.region,
      group: (regions.find((reg) => reg.id === r.regionId))?.group,
      flights: r.total,
      error: r.error,
    })),
    degraded: errors.length > 0,
  };
}

// ============================================================
// CORS
// ============================================================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ============================================================
// ROUTES
// ============================================================

app.get('/', (req, res) => {
  res.json({
    service: 'clawdwatch-lobster-edition',
    version: '2.2.0-lobster',
    description: 'Global OSINT aggregator — flights, news, disasters, weather, DEFCON, sanctions, crypto, fires, CVEs, WHOIS, DNS, Telegram',
    endpoints: {
      status:       'GET /status',
      regions:      'GET /regions',
      flights:      'GET /flights               (priority regions)',
      flightsRegion:'GET /flights/:region       (single region by id or alias)',
      flightsAll:   'GET /flights/all           (every defined region, slower)',
      news:         'GET /news                  (all enabled RSS feeds)',
      newsRegion:   'GET /news/:region          (filter by region group)',
      newsHealth:   'GET /news/health           (per-source health)',
      newsSources:  'GET /news/sources          (configured RSS feeds)',
      earthquakes:  'GET /earthquakes?min=4.0   (USGS, 2.5+ last 24h)',
      gdacs:        'GET /gdacs                 (global disaster alerts)',
      weatherAlerts:'GET /weather/us            (NWS active US alerts)',
      weather:      'GET /weather?lat=&lon=     (current wx from Open-Meteo)',
      defcon:       'GET /defcon                (current DEFCON level from defconlevel.com)',
      conflict:     'GET /conflict              (ME-focused legacy summary)',
      osint:        'GET /osint                 (global situational summary)',
      snapshot:     'GET /snapshot              (one-call daily brief)',
      // OSIRIS-derived endpoints (v2.2)
      sanctions:    'GET /sanctions?q=<name>     (OFAC SDN + OpenSanctions person/org/vessel)',
      cryptoBtc:    'GET /crypto/btc/:address    (BTC wallet trace via blockstream.info)',
      cryptoEth:    'GET /crypto/eth/:address    (ETH wallet trace via Blockscout)',
      fires:        'GET /fires?hours=24&region= (NASA FIRMS active fire hotspots)',
      cve:          'GET /cve/:id                (NVD CVE detail, e.g. CVE-2024-12345)',
      cveRecent:    'GET /cve/recent?days=7      (recently modified CVEs)',
      whois:        'GET /whois/:domain          (RDAP lookup, free, no key)',
      dns:          'GET /dns/:domain            (A, AAAA, MX, TXT, NS, CNAME via Google DoH)',
      telegram:     'GET /telegram/:channel      (public channel recent messages)',
    },
  });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    service: 'clawdwatch-lobster-edition',
    port: PORT,
    version: '2.1.0-lobster',
    regions: ALL_REGIONS.length,
    newsFeeds: RSS_FEEDS.filter((f) => f.enabled).length,
    cacheActive: true,
    timestamp: new Date().toISOString(),
  });
});

app.get('/regions', (req, res) => {
  res.json({
    total: ALL_REGIONS.length,
    regions: ALL_REGIONS.map((r) => ({
      id: r.id,
      name: r.name,
      group: r.group,
      description: r.description,
      bounds: r.flightBounds,
      aliases: r.aliases,
      priority: r.priority,
    })),
  });
});

// === FLIGHTS ===
app.get('/flights', async (req, res) => {
  const summary = await getFlightSummary(getDefaultFlightRegions());
  res.json({
    ...summary,
    // Keep flights in default for backward compat
    flights: summary.regions.flatMap((r) => []).slice(0, 0), // intentionally empty; use /flights/:region
    note: 'This endpoint returns aggregate counts. For raw flight lists, call /flights/:region.',
  });
});

app.get('/flights/all', async (req, res) => {
  const summary = await getFlightSummary(ALL_REGIONS);
  res.json(summary);
});

app.get('/flights/:region', async (req, res) => {
  const region = findRegion(req.params.region);
  if (!region) {
    return res.status(404).json({ error: `Unknown region: ${req.params.region}. Try /regions.` });
  }
  const result = await getFlightsForRegion(region);
  res.json({
    timestamp: new Date().toISOString(),
    source: 'OpenSky Network',
    ...result,
  });
});

// === NEWS (RSS) ===
// === NEWS (RSS) — specific routes BEFORE /news/:region ===
app.get('/news/health', (req, res) => {
  const health: FeedHealth[] = getFeedHealth();
  res.json({
    timestamp: new Date().toISOString(),
    ok: health.filter((h) => h.ok).length,
    failing: health.filter((h) => !h.ok).length,
    feeds: health,
  });
});

app.get('/news/sources', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    total: RSS_FEEDS.length,
    enabled: RSS_FEEDS.filter((f) => f.enabled).length,
    feeds: RSS_FEEDS.map((f) => ({
      id: f.id,
      name: f.name,
      region: f.region,
      feedUrl: f.feedUrl,
      enabled: f.enabled,
      weight: f.weight,
    })),
  });
});

app.get('/news', async (req, res) => {
  const all = await fetchFeeds(RSS_FEEDS, true);
  // Dedupe by URL
  const seen = new Set<string>();
  const deduped = all.filter((n) => {
    if (seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
  // Newest first
  deduped.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  res.json({
    timestamp: new Date().toISOString(),
    sourcesCount: RSS_FEEDS.filter((f) => f.enabled).length,
    total: deduped.length,
    news: deduped.slice(0, 50),
  });
});

app.get('/news/:region', async (req, res) => {
  const regionParam = req.params.region.toLowerCase();
  const matchingFeeds = RSS_FEEDS.filter(
    (f) => f.region === regionParam || f.id === regionParam,
  );
  if (matchingFeeds.length === 0) {
    return res.status(404).json({
      error: `No RSS feeds for region "${regionParam}".`,
      available: Array.from(new Set(RSS_FEEDS.map((f) => f.region))),
    });
  }
  const all = await fetchFeeds(matchingFeeds, true);
  const seen = new Set<string>();
  const deduped = all.filter((n) => {
    if (seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
  deduped.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  res.json({
    timestamp: new Date().toISOString(),
    region: regionParam,
    sources: matchingFeeds.map((f) => f.name),
    total: deduped.length,
    news: deduped.slice(0, 30),
  });
});

// === INTEL (Earthquakes, Disasters, Weather) ===
app.get('/earthquakes', async (req, res) => {
  const min = parseFloat((req.query.min as string) || '4.0');
  const quakes = await fetchEarthquakes(min);
  res.json({
    timestamp: new Date().toISOString(),
    source: 'USGS',
    minMagnitude: min,
    total: quakes.length,
    earthquakes: quakes.slice(0, 50),
  });
});

app.get('/gdacs', async (req, res) => {
  const events = await fetchGdacsEvents();
  res.json({
    timestamp: new Date().toISOString(),
    source: 'GDACS',
    total: events.length,
    events,
  });
});

app.get('/weather/us', async (req, res) => {
  const alerts = await fetchUsWeatherAlerts();
  res.json({
    timestamp: new Date().toISOString(),
    source: 'NOAA NWS',
    total: alerts.length,
    alerts,
  });
});

app.get('/weather', async (req, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'Provide ?lat=<num>&lon=<num>' });
  }
  const current = await fetchCurrentWeather(lat, lon);
  if (!current) {
    return res.status(502).json({ error: 'Weather source unavailable' });
  }
  res.json({
    timestamp: new Date().toISOString(),
    source: 'Open-Meteo',
    lat, lon,
    current,
  });
});

// === DEFCON ===
app.get('/defcon', async (req, res) => {
  const status = await fetchDefconLevel();
  if (!status) {
    return res.status(502).json({ error: 'DEFCON source unavailable' });
  }
  res.json(status);
});

// === AGGREGATES ===
app.get('/conflict', async (req, res) => {
  // Legacy ME-focused endpoint, kept for backward compat with the evening brief.
  const meRegionIds = ['iran', 'israel', 'lebanon', 'syria', 'iraq', 'yemen', 'saudi_arabia', 'uae', 'qatar', 'kuwait', 'turkey'];
  const conflictRegions = meRegionIds
    .map((id) => getRegionById(id))
    .filter((r): r is RegionDefinition => !!r);

  const flightResults = await Promise.all(conflictRegions.map(getFlightsForRegion));
  const newsFeeds = RSS_FEEDS.filter((f) => f.region === 'middle_east' || f.region === 'israel' || f.region === 'eastern_europe');
  const news = await fetchFeeds(newsFeeds);
  const seen = new Set<string>();
  const dedupedNews = news.filter((n) => {
    if (seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });

  res.json({
    timestamp: new Date().toISOString(),
    source: 'OpenSky + RSS',
    conflictZones: flightResults.map((r) => ({ id: r.regionId, name: r.region, flights: r.total })),
    totalConflictFlights: flightResults.reduce((s, r) => s + (r.total || 0), 0),
    news: { total: dedupedNews.length, sources: newsFeeds.map((f) => f.name), latest: dedupedNews.slice(0, 10) },
  });
});

app.get('/osint', async (req, res) => {
  // Global situational summary. This is the one for the daily brief.
  const [flightSummary, quakes, gdacs, usWeather, defcon] = await Promise.all([
    getFlightSummary(getDefaultFlightRegions()),
    fetchEarthquakes(4.5),
    fetchGdacsEvents(),
    fetchUsWeatherAlerts(),
    fetchDefconLevel(),
  ]);

  // Pull top news from global RSS feeds (priority weight 1-2)
  const topFeeds = RSS_FEEDS.filter((f) => f.enabled && f.weight <= 2);
  const topNews = await fetchFeeds(topFeeds);
  const seen = new Set<string>();
  const dedupedNews = topNews
    .filter((n) => { if (seen.has(n.url)) return false; seen.add(n.url); return true; })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 20);

  res.json({
    timestamp: new Date().toISOString(),
    summary: {
      defcon: defcon?.level ?? null,
      defconDescription: defcon?.description ?? null,
      flights: flightSummary.totalFlights,
      regionsTracked: flightSummary.regionsQueried,
      earthquakes45: quakes.length,
      gdacsEvents: gdacs.length,
      usWeatherAlerts: usWeather.length,
      newsHeadlines: dedupedNews.length,
    },
    defcon,
    flights: flightSummary,
    earthquakes: quakes.slice(0, 10),
    disasters: gdacs.slice(0, 10),
    weather: usWeather.slice(0, 10),
    news: dedupedNews,
  });
});

app.get('/snapshot', async (req, res) => {
  // One-call daily brief. Cheap version of /osint.
  const [flightSummary, quakes, defcon] = await Promise.all([
    getFlightSummary(getDefaultFlightRegions()),
    fetchEarthquakes(5.0),
    fetchDefconLevel(),
  ]);
  const topFeeds = RSS_FEEDS.filter((f) => f.enabled && f.weight <= 2);
  const topNews = await fetchFeeds(topFeeds);
  const seen = new Set<string>();
  const dedupedNews = topNews
    .filter((n) => { if (seen.has(n.url)) return false; seen.add(n.url); return true; })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 8);

  res.json({
    timestamp: new Date().toISOString(),
    version: '2.1.0-lobster',
    defcon,
    flights: {
      total: flightSummary.totalFlights,
      byRegion: flightSummary.regions.map((r) => ({ name: r.name, flights: r.flights })),
    },
    earthquakes: { total: quakes.length, top: quakes.slice(0, 3) },
    news: { total: dedupedNews.length, top: dedupedNews },
  });
});

// ============================================================
// OSIRIS-derived endpoints (Phase 1: intel)
// ============================================================

// GET /sanctions?q=<name> — OFAC SDN + OpenSanctions person/org/vessel search
app.get('/sanctions', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    return res.status(400).json({ error: 'Missing required query param: q', example: '/sanctions?q=Evgeniy' });
  }
  const results = await searchSanctions(q);
  res.json({
    query: q,
    count: results.length,
    timestamp: new Date().toISOString(),
    results,
  });
});

// GET /crypto/btc/:address — BTC wallet trace via blockstream.info
app.get('/crypto/btc/:address', async (req, res) => {
  const info = await traceBtcAddress(req.params.address);
  if (!info) {
    return res.status(400).json({ error: 'Invalid BTC address', address: req.params.address });
  }
  res.json(info);
});

// GET /crypto/eth/:address — ETH wallet trace via Blockscout
app.get('/crypto/eth/:address', async (req, res) => {
  const info = await traceEthAddress(req.params.address);
  if (!info) {
    return res.status(400).json({ error: 'Invalid ETH address', address: req.params.address });
  }
  res.json(info);
});

// GET /fires?hours=24&region=middle_east — NASA FIRMS hotspots
app.get('/fires', async (req, res) => {
  const hours = Math.min(Math.max(parseInt(String(req.query.hours || '24'), 10) || 24, 1), 168);
  const region = req.query.region ? String(req.query.region) : undefined;
  const fires = await fetchFireHotspots(hours, region);
  res.json({
    window_hours: hours,
    region: region || 'world',
    count: fires.length,
    timestamp: new Date().toISOString(),
    hotspots: fires,
  });
});

// IMPORTANT: /cve/recent must come BEFORE /cve/:id, otherwise Express matches "recent" as the :id.
app.get('/cve/recent', async (req, res) => {
  const days = parseInt(String(req.query.days || '7'), 10) || 7;
  const minCvss = req.query.min_cvss ? parseFloat(String(req.query.min_cvss)) : undefined;
  const cves = await fetchRecentCves(days, minCvss);
  res.json({
    window_days: days,
    min_cvss: minCvss,
    count: cves.length,
    timestamp: new Date().toISOString(),
    cves,
  });
});

// GET /cve/:id — single CVE lookup (e.g. CVE-2024-12345)
app.get('/cve/:id', async (req, res) => {
  const cve = await fetchCve(req.params.id);
  if (!cve) {
    return res.status(404).json({ error: 'CVE not found or invalid format', id: req.params.id });
  }
  res.json(cve);
});

// GET /whois/:domain — RDAP/WHOIS lookup
app.get('/whois/:domain', async (req, res) => {
  const w = await whoisLookup(req.params.domain);
  if (!w) {
    return res.status(400).json({ error: 'Invalid domain', domain: req.params.domain });
  }
  res.json(w);
});

// GET /dns/:domain — DNS records (A, AAAA, MX, TXT, NS, CNAME)
app.get('/dns/:domain', async (req, res) => {
  const d = await dnsLookup(req.params.domain);
  if (!d) {
    return res.status(400).json({ error: 'Invalid domain', domain: req.params.domain });
  }
  res.json(d);
});

// GET /telegram/:channel — recent messages from public channel
// (e.g. /telegram/durov, /telegram/reuters)
app.get('/telegram/:channel', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '10'), 10) || 10, 1), 30);
  const msgs = await fetchTelegramChannel(req.params.channel, limit);
  if (!msgs || msgs.length === 0) {
    return res.json({
      channel: req.params.channel,
      count: 0,
      messages: [],
      note: 'No public messages found. Channel may be private or handle invalid.',
    });
  }
  res.json({
    channel: req.params.channel,
    count: msgs.length,
    timestamp: new Date().toISOString(),
    messages: msgs,
  });
});

app.listen(PORT, () => {
  console.log(`ClawdWatch Lobster Edition v2.2 running on port ${PORT}`);
  console.log(`  regions:  ${ALL_REGIONS.length}`);
  console.log(`  rss:      ${RSS_FEEDS.filter((f) => f.enabled).length} feeds enabled`);
  console.log(`  defcon:   GET /defcon for current DEFCON level`);
  console.log(`  osiris:   GET /sanctions /crypto/* /fires /cve/* /whois/* /dns/* /telegram/*`);
});
