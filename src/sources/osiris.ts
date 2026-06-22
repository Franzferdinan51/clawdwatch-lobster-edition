import axios from 'axios';

/**
 * OSIRIS-derived intel sources.
 *
 * Inspired by github.com/simplifaisoul/osiris but reimplemented in ClawdWatch's
 * Node.js / API-only style. Each source here exposes one or more lookup functions
 * that the HTTP layer maps to REST endpoints.
 *
 * Endpoints exposed (see http.ts route registration):
 *   GET /sanctions?q=<name>           — OFAC SDN + OpenSanctions person/org/vessel
 *   GET /crypto/btc/:address         — BTC address trace (blockstream.info)
 *   GET /crypto/eth/:address         — ETH address trace (Blockscout)
 *   GET /fires?hours=<n>             — NASA FIRMS active fire hotspots
 *   GET /cve/:id                     — NVD CVE detail lookup
 *   GET /cve/recent?days=<n>         — recent CVEs from NVD
 *   GET /whois/:domain               — WHOIS lookup
 *   GET /dns/:domain                 — DNS records (A/AAAA/MX/TXT/NS)
 *   GET /telegram/:channel           — public Telegram channel recent messages
 *   GET /space-weather               — NOAA SWPC Kp index, solar flares, alerts
 *   GET /sentinel?lat=&lng=           — Sentinel-1/2 satellite imagery search
 *   GET /satellites?category=        — Satellite TLE catalog (Celestrak)
 *   GET /cyber-threats               — CISA Known Exploited Vulnerabilities
 *   GET /geo?ip=                      — IP geolocation (3-provider cascade)
 *   GET /air-quality?limit=          — OpenAQ global PM2.5 stations
 */

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

const cache: Map<string, { data: any; ts: number }> = new Map();

async function cached<T>(key: string, fn: () => Promise<T>, ttlMs: number): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.data as T;
  try {
    const data = await fn();
    cache.set(key, { data, ts: Date.now() });
    return data;
  } catch (e: any) {
    console.error(`[osiris:${key}] error: ${e.message}`);
    return null;
  }
}

const TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// OFAC SDN + OpenSanctions lookup
// ---------------------------------------------------------------------------

export interface SanctionEntity {
  name: string;
  type: 'person' | 'organization' | 'vessel' | 'unknown';
  programs: string[];          // e.g. ['SDGT', 'CYBER2']
  aliases: string[];
  remarks?: string;
  birth_dates?: string[];
  birth_places?: string[];
  nationalities?: string[];
  addresses?: string[];
  source: 'OFAC' | 'OpenSanctions';
}

const SANCTIONS_URL = 'https://api.opensanctions.org/search/default?limit=20';

/**
 * Search OpenSanctions for a person/org/vessel name.
 * OpenSanctions aggregates OFAC SDN + EU CFSP + UN + UK HMT + ~30 other lists.
 * Free public API, no key required.
 */
export async function searchSanctions(q: string): Promise<SanctionEntity[]> {
  if (!q || q.trim().length < 2) return [];

  const apiKey = process.env.OPENSANCTIONS_API_KEY;

  return (await cached(
    `sanctions:${q.toLowerCase()}`,
    async () => {
      const url = `https://api.opensanctions.org/search/default?q=${encodeURIComponent(q)}&limit=20`;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (apiKey) headers['Authorization'] = `ApiKey ${apiKey}`;
      const r = await axios.get(url, {
        timeout: TIMEOUT,
        headers,
      });

      const results = r.data?.results || [];
      return results.map((row: any): SanctionEntity => {
        const props = row.properties || {};
        const caption = (props.caption?.[0] || row.caption || q) as string;
        const datasets = (props.datasets || row.datasets || []) as string[];
        const programs = datasets
          .filter((d: string) => d.startsWith('us_ofac_sdn'))
          .map((d: string) => d.replace(/^us_ofac_sdn_?/, '').toUpperCase())
          .filter((p: string) => p.length > 0);

        return {
          name: caption,
          type: row.schema?.includes('Person') ? 'person'
              : row.schema?.includes('Organization') ? 'organization'
              : row.schema?.includes('Vessel') ? 'vessel'
              : 'unknown',
          programs: programs.length ? programs : (datasets.length ? [datasets[0]] : []),
          aliases: (props.alias || []).slice(0, 10),
          remarks: (props.notes || []).slice(0, 3).join(' '),
          birth_dates: (props.birthDate || []).slice(0, 3),
          birth_places: (props.birthPlace || []).slice(0, 3),
          nationalities: (props.nationality || []).slice(0, 5),
          addresses: (props.address || []).slice(0, 5),
          source: datasets.some((d: string) => d.startsWith('us_ofac')) ? 'OFAC' : 'OpenSanctions',
        };
      });
    },
    60 * 60 * 1000, // 1h cache (sanctions data is stable)
  )) || [];
}

// ---------------------------------------------------------------------------
// Crypto wallet tracing — BTC + ETH
// ---------------------------------------------------------------------------

export interface BtcAddressInfo {
  address: string;
  chain: 'BTC';
  balance_sats: number;
  balance_btc: number;
  total_received_sats: number;
  total_sent_sats: number;
  tx_count: number;
  first_seen?: string;  // ISO timestamp
}

export interface EthAddressInfo {
  address: string;
  chain: 'ETH';
  balance_wei: string;
  balance_eth: number;
  tx_count: number;
  ens_name?: string;
  contract_name?: string;
  is_contract: boolean;
}

export async function traceBtcAddress(address: string): Promise<BtcAddressInfo | null> {
  if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{6,87}$/.test(address)) return null;

  return cached(
    `btc:${address}`,
    async () => {
      const r = await axios.get(`https://blockstream.info/api/address/${address}`, { timeout: TIMEOUT });
      const stats = r.data;
      // chain_stats has funded/spent counts; total_received = chain_stats.funded_txo_sum
      const cs = stats.chain_stats || {};
      const ms = stats.mempool_stats || {};
      const totalRecv = (cs.funded_txo_sum || 0) + (ms.funded_txo_sum || 0);
      const totalSent = (cs.spent_txo_sum || 0) + (ms.spent_txo_sum || 0);
      return {
        address,
        chain: 'BTC' as const,
        balance_sats: (cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0),
        balance_btc: ((cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0)) / 1e8,
        total_received_sats: totalRecv,
        total_sent_sats: totalSent,
        tx_count: (cs.tx_count || 0) + (ms.tx_count || 0),
      };
    },
    5 * 60 * 1000,
  );
}

export async function traceEthAddress(address: string): Promise<EthAddressInfo | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;

  return cached(
    `eth:${address.toLowerCase()}`,
    async () => {
      // Blockscout public API — no key required
      const r = await axios.get(
        `https://eth.blockscout.com/api/v2/addresses/${address}`,
        { timeout: TIMEOUT }
      );
      const d = r.data || {};
      return {
        address,
        chain: 'ETH' as const,
        balance_wei: d.balance || '0',
        balance_eth: (parseFloat(d.balance || '0') / 1e18),
        tx_count: d.transactions_count || 0,
        ens_name: d.ens_domain_name,
        contract_name: d.name,
        is_contract: d.has_contract || d.is_contract || false,
      };
    },
    5 * 60 * 1000,
  );
}

// ---------------------------------------------------------------------------
// NASA FIRMS active fire hotspots
// ---------------------------------------------------------------------------

export interface FireHotspot {
  latitude: number;
  longitude: number;
  brightness_kelvin: number;
  scan_km: number;
  track_km: number;
  acq_date: string;        // YYYY-MM-DD
  acq_time: string;        // HHMM
  satellite: 'Terra' | 'Aqua' | 'NOAA-20' | 'NOAA-21';
  confidence: 'low' | 'nominal' | 'high';
  frp_mw: number;          // fire radiative power (MW)
  daynight: 'D' | 'N';
}

const NASA_FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
// Free MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/area/ — required.
// Without it, /fires returns "Invalid MAP_KEY" 401 from NASA.
const FIRMS_KEY = process.env.FIRMS_MAP_KEY;

export async function fetchFireHotspots(hours = 24, region?: string): Promise<FireHotspot[]> {
  if (!FIRMS_KEY) {
    console.warn('[osiris:fires] FIRMS_MAP_KEY not set — endpoint returns empty');
    return [];
  }

  // FIRMS provides 24h or 7d windows, not arbitrary hours. Map hours → window.
  const windowDays = hours <= 24 ? 1 : hours <= 168 ? 7 : 10;

  return (await cached(
    `fires:${windowDays}d:${region || 'world'}`,
    async () => {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_KEY}/VIIRS_NOAA20_NRT/world/${windowDays}`;
      const r = await axios.get(url, { timeout: TIMEOUT, responseType: 'text' });
      const lines = (r.data || '').split('\n').filter((l: string) => l.trim());
      if (lines.length < 2) return [];

      const header = lines[0].split(',');
      const rows = lines.slice(1).map((line: string) => {
        const cols = line.split(',');
        const row: any = {};
        header.forEach((h: string, i: number) => (row[h.trim()] = cols[i]));
        return row;
      });

      return rows
        .filter((row: any) => row.latitude && row.longitude)
        .filter((row: any) => !region || isInRegion(parseFloat(row.latitude), parseFloat(row.longitude), region))
        .map((row: any): FireHotspot => ({
          latitude: parseFloat(row.latitude),
          longitude: parseFloat(row.longitude),
          brightness_kelvin: parseFloat(row.brightness || '0'),
          scan_km: parseFloat(row.scan || '0'),
          track_km: parseFloat(row.track || '0'),
          acq_date: row.acq_date || '',
          acq_time: row.acq_time || '',
          satellite: (row.satellite || '').includes('Terra') ? 'Terra'
                    : (row.satellite || '').includes('Aqua') ? 'Aqua'
                    : 'NOAA-20',
          confidence: (row.confidence || 'nominal').toLowerCase() as any,
          frp_mw: parseFloat(row.frp || '0'),
          daynight: row.daynight === 'D' ? 'D' : 'N',
        }))
        .slice(0, 1000);
    },
    30 * 60 * 1000,
  )) || [];
}

function isInRegion(lat: number, lon: number, region: string): boolean {
  const regions: Record<string, [[number, number], [number, number]]> = {
    middle_east: [[12, 25], [60, 42]],
    europe: [[35, 71], [-10, 40]],
    north_america: [[15, 72], [-170, -50]],
    africa: [[-35, 38], [-18, 52]],
    asia: [[-10, 75], [60, 150]],
    oceania: [[-50, 0], [110, 180]],
    south_america: [[-55, 13], [-82, -34]],
  };
  const box = regions[region];
  if (!box) return true;
  const [[latMin, latMax], [lonMin, lonMax]] = box;
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

// ---------------------------------------------------------------------------
// NVD CVE lookup
// ---------------------------------------------------------------------------

export interface CveRecord {
  id: string;
  published: string;
  last_modified: string;
  description: string;
  cvss_v3_score?: number;
  cvss_v3_severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  references: string[];
}

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

export async function fetchCve(id: string): Promise<CveRecord | null> {
  const cvePattern = /^CVE-\d{4}-\d{4,7}$/i;
  if (!cvePattern.test(id)) return null;
  const normalized = id.toUpperCase();

  return cached(
    `cve:${normalized}`,
    async () => {
      const r = await axios.get(NVD_BASE, {
        params: { cveId: normalized },
        timeout: TIMEOUT,
      });
      const vuln = r.data?.vulnerabilities?.[0]?.cve;
      if (!vuln) return null;

      const cvss = vuln.metrics?.cvssMetricV31?.[0]?.cvssData;
      return {
        id: vuln.id,
        published: vuln.published,
        last_modified: vuln.lastModified,
        description: (vuln.descriptions?.find((d: any) => d.lang === 'en')?.value || '').slice(0, 1000),
        cvss_v3_score: cvss?.baseScore,
        cvss_v3_severity: cvss?.baseSeverity,
        references: (vuln.references || []).slice(0, 10).map((x: any) => x.url),
      };
    },
    24 * 60 * 60 * 1000, // CVEs don't change
  );
}

export async function fetchRecentCves(days = 7, minCvssScore?: number): Promise<CveRecord[]> {
  const validDays = Math.min(Math.max(days, 1), 30);
  const end = new Date();
  const start = new Date(Date.now() - validDays * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return (await cached(
    `cves:${validDays}d:${minCvssScore || 'any'}`,
    async () => {
      const r = await axios.get(NVD_BASE, {
        params: {
          lastModStartDate: `${fmt(start)}T00:00:00.000`,
          lastModEndDate: `${fmt(end)}T23:59:59.999`,
          resultsPerPage: 50,
        },
        timeout: TIMEOUT,
      });
      const items = r.data?.vulnerabilities || [];
      return items
        .map((v: any) => v.cve)
        .filter((c: any) => c)
        .map((cve: any): CveRecord => {
          const cvss = cve.metrics?.cvssMetricV31?.[0]?.cvssData;
          return {
            id: cve.id,
            published: cve.published,
            last_modified: cve.lastModified,
            description: (cve.descriptions?.find((d: any) => d.lang === 'en')?.value || '').slice(0, 500),
            cvss_v3_score: cvss?.baseScore,
            cvss_v3_severity: cvss?.baseSeverity,
            references: (cve.references || []).slice(0, 3).map((x: any) => x.url),
          };
        })
        .filter((c: CveRecord) => !minCvssScore || (c.cvss_v3_score && c.cvss_v3_score >= minCvssScore))
        .slice(0, 50);
    },
    60 * 60 * 1000,
  )) || [];
}

// ---------------------------------------------------------------------------
// WHOIS + DNS lookups
// ---------------------------------------------------------------------------

export async function whoisLookup(domain: string): Promise<any> {
  if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) return null;

  return cached(
    `whois:${domain.toLowerCase()}`,
    async () => {
      // Use RDAP (Registration Data Access Protocol) — modern, structured, free.
      // Fall back to whois.iana.org first to find the registrar's RDAP endpoint.
      const r = await axios.get(`https://rdap.org/domain/${domain}`, { timeout: TIMEOUT });
      const d = r.data || {};
      return {
        domain: d.ldhName || domain,
        handle: d.handle,
        status: d.status || [],
        events: (d.events || []).map((e: any) => ({ event: e.eventAction, date: e.eventDate })),
        nameservers: (d.nameservers || []).map((n: any) => n.ldhName).filter(Boolean),
        entities: (d.entities || []).map((e: any) => ({
          role: e.roles?.[0],
          name: e.vcardArray?.[1]?.find((v: any) => v[0] === 'fn')?.[3],
          handle: e.handle,
        })),
      };
    },
    24 * 60 * 60 * 1000,
  );
}

export async function dnsLookup(domain: string): Promise<any> {
  if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) return null;

  return cached(
    `dns:${domain.toLowerCase()}`,
    async () => {
      // Google DNS-over-HTTPS API
      const types = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'];
      const results: any = { domain, records: {} };

      await Promise.all(types.map(async (t) => {
        try {
          const r = await axios.get(`https://dns.google/resolve?name=${domain}&type=${t}`, {
            timeout: 5000,
          });
          const answers = r.data?.Answer || [];
          results.records[t] = answers.map((a: any) => ({
            name: a.name,
            value: a.data,
            ttl: a.TTL,
          }));
        } catch (e) {
          results.records[t] = [];
        }
      }));

      return results;
    },
    60 * 60 * 1000,
  );
}

// ---------------------------------------------------------------------------
// Telegram public channel OSINT (web preview scraping)
// ---------------------------------------------------------------------------

export interface TelegramMessage {
  id: number;
  text: string;
  timestamp: string;
  views?: number;
  forwards?: number;
  author?: string;
}

export async function fetchTelegramChannel(channel: string, limit = 10): Promise<TelegramMessage[]> {
  // Strip @ prefix and normalize
  const handle = channel.replace(/^@/, '').toLowerCase();
  if (!/^[a-zA-Z0-9_]{4,32}$/.test(handle)) return [];

  return (await cached(
    `telegram:${handle}:${limit}`,
    async () => {
      const r = await axios.get(`https://t.me/s/${handle}`, {
        timeout: TIMEOUT,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClawdWatch/2.0)' },
      });
      const html = r.data as string;

      // Use simple regex extraction (no cheerio to keep deps light)
      // Match tgme_widget_message_wrap blocks
      const msgRegex = /<div class="tgme_widget_message_wrap[^"]*"[^>]*>(.*?)<\/div>\s*<\/div>\s*<\/div>/gs;
      const textRegex = /<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)<\/div>/s;
      const timeRegex = /<time[^>]*datetime="([^"]+)"/;
      const viewsRegex = /<span class="tgme_widget_message_views">([^<]+)/;

      const messages: TelegramMessage[] = [];
      const blocks = html.match(/<div class="tgme_widget_message[^"]*"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) || [];

      blocks.slice(0, limit).forEach((block: string, idx: number) => {
        const textMatch = block.match(textRegex);
        const timeMatch = block.match(timeRegex);
        const viewsMatch = block.match(viewsRegex);

        const rawText = textMatch ? textMatch[1] : '';
        const text = rawText
          .replace(/<br\s*\/?>/g, '\n')
          .replace(/<[^>]+>/g, '')
          .trim();

        if (text) {
          messages.push({
            id: idx + 1,
            text: text.slice(0, 1000),
            timestamp: timeMatch ? timeMatch[1] : '',
            views: viewsMatch ? parseInt(viewsMatch[1].replace(/\D/g, ''), 10) : undefined,
          });
        }
      });

      return messages;
    },
    15 * 60 * 1000,
  )) || [];
}

// ---------------------------------------------------------------------------
// NOAA Space Weather Prediction Center (Kp index, solar flares, alerts)
// ---------------------------------------------------------------------------

export interface SpaceWeatherReport {
  kp_index: number;
  kp_timestamp: string;
  storm_level: string;        // Quiet, Unsettled, Minor (G1), ..., Extreme (G5)
  storm_color: string;
  alerts: Array<{ id: string; issue_datetime: string; message: string; type?: string }>;
  recent_flares: Array<{ flare_id: string; class: string; peak_time: string; intensity?: number }>;
  timestamp: string;
}

function classifyKp(kp: number): { level: string; color: string } {
  if (kp >= 8) return { level: 'Extreme (G5)', color: '#FF1744' };
  if (kp >= 7) return { level: 'Severe (G4)', color: '#FF3D3D' };
  if (kp >= 6) return { level: 'Strong (G3)', color: '#FF9500' };
  if (kp >= 5) return { level: 'Moderate (G2)', color: '#FFD700' };
  if (kp >= 4) return { level: 'Minor (G1)', color: '#FFD700' };
  if (kp >= 3) return { level: 'Unsettled', color: '#D4AF37' };
  return { level: 'Quiet', color: '#00E676' };
}

export async function fetchSpaceWeather(): Promise<SpaceWeatherReport | null> {
  return cached(
    'space-weather:current',
    async () => {
      const [kpRes, alertsRes, flareRes] = await Promise.allSettled([
        axios.get('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', { timeout: 8000 }).then(r => r.data),
        axios.get('https://services.swpc.noaa.gov/json/alerts.json', { timeout: 8000 }).then(r => r.data),
        axios.get('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json', { timeout: 8000 }).then(r => r.data),
      ]);

      let kpIndex = 0;
      let kpTimestamp = '';
      if (kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) && kpRes.value.length > 0) {
        const latest = kpRes.value[kpRes.value.length - 1];
        kpIndex = parseFloat(latest.kp_index ?? latest.Kp ?? 0);
        kpTimestamp = latest.time_tag ?? '';
      }

      const { level, color } = classifyKp(kpIndex);

      const alerts: SpaceWeatherReport['alerts'] = [];
      if (alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value)) {
        for (const alert of alertsRes.value.slice(0, 10)) {
          alerts.push({
            id: alert.product_id ?? `alert-${Date.now()}`,
            issue_datetime: alert.issue_datetime ?? '',
            message: alert.message ?? '',
            type: alert.type ?? alert._typename,
          });
        }
      }

      const flares: SpaceWeatherReport['recent_flares'] = [];
      if (flareRes.status === 'fulfilled' && Array.isArray(flareRes.value)) {
        for (const f of flareRes.value.slice(0, 10)) {
          flares.push({
            flare_id: f.flareID ?? '',
            class: f.classType ?? '',
            peak_time: f.peakTime ?? '',
            intensity: f.intensity,
          });
        }
      }

      return {
        kp_index: kpIndex,
        kp_timestamp: kpTimestamp,
        storm_level: level,
        storm_color: color,
        alerts,
        recent_flares: flares,
        timestamp: new Date().toISOString(),
      };
    },
    5 * 60 * 1000,
  );
}

// ---------------------------------------------------------------------------
// Sentinel-1/2 satellite imagery search (Element84 Earth Search STAC)
// ---------------------------------------------------------------------------

export interface SentinelScene {
  id: string;
  datetime: string;
  platform: string;            // 'Sentinel-1' or 'Sentinel-2'
  cloud_cover?: number;
  thumbnail?: string;
  bbox?: number[];
  source: string;
}

export async function searchSentinelScenes(
  lat: number,
  lng: number,
  radius = 2,
  days = 30,
  platform: 'sentinel-1-grd' | 'sentinel-2-l2a' = 'sentinel-2-l2a',
): Promise<SentinelScene[]> {
  if (isNaN(lat) || isNaN(lng)) return [];

  return (await cached(
    `sentinel:${lat.toFixed(2)}:${lng.toFixed(2)}:${radius}:${days}:${platform}`,
    async () => {
      const bbox = [lng - radius, lat - radius, lng + radius, lat + radius];
      const now = new Date();
      const from = new Date(now.getTime() - days * 86_400_000);
      const datetime = `${from.toISOString().split('.')[0]}Z/${now.toISOString().split('.')[0]}Z`;

      const scenes: SentinelScene[] = [];
      try {
        const res = await axios.post(
          'https://earth-search.aws.element84.com/v1/search',
          {
            collections: [platform],
            bbox,
            datetime,
            limit: 20,
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 12_000,
          },
        );
        for (const f of res.data?.features ?? []) {
          scenes.push({
            id: f.id,
            datetime: f.properties?.datetime ?? '',
            platform: f.properties?.platform ?? platform,
            cloud_cover: f.properties?.['eo:cloud_cover'],
            thumbnail: f.assets?.thumbnail?.href,
            bbox: f.bbox,
            source: 'element84',
          });
        }
      } catch (e: any) {
        console.error(`[osiris:sentinel] error: ${e.message}`);
      }
      return scenes;
    },
    60 * 60 * 1000,
  )) ?? [];
}

// ---------------------------------------------------------------------------
// Satellite TLE catalog (Celestrak — free, no key)
// ---------------------------------------------------------------------------

export interface SatelliteEntry {
  name: string;
  norad_id: number;
  category: string;            // 'stations', 'weather', 'amateur', 'starlink', etc.
  mission: string;
  color: string;
  tle_line1: string;
  tle_line2: string;
}

const MISSION_CLASSIFY: Record<string, { mission: string; color: string }> = {
  ISS: { mission: 'Space Station', color: '#FFD700' },
  TIANGONG: { mission: 'Space Station', color: '#FFD700' },
  GPS: { mission: 'Navigation', color: '#448AFF' },
  NAVSTAR: { mission: 'Navigation', color: '#448AFF' },
  GLONASS: { mission: 'Navigation', color: '#448AFF' },
  GALILEO: { mission: 'Navigation', color: '#448AFF' },
  BEIDOU: { mission: 'Navigation', color: '#448AFF' },
  STARLINK: { mission: 'Commercial Comms', color: '#00E676' },
  ONEWEB: { mission: 'Commercial Comms', color: '#00E676' },
  NOAA: { mission: 'Weather', color: '#87CEEB' },
  GOES: { mission: 'Weather', color: '#87CEEB' },
  METEOSAT: { mission: 'Weather', color: '#87CEEB' },
  FENGYUN: { mission: 'Weather', color: '#87CEEB' },
  HUBBLE: { mission: 'Space Telescope', color: '#FFD700' },
  'JAMES WEBB': { mission: 'Space Telescope', color: '#FFD700' },
  SENTINEL: { mission: 'Earth Observation', color: '#90EE90' },
  LANDSAT: { mission: 'Earth Observation', color: '#90EE90' },
  TERRA: { mission: 'Earth Science', color: '#90EE90' },
  AQUA: { mission: 'Earth Science', color: '#90EE90' },
  PLANET: { mission: 'Earth Imaging', color: '#00E676' },
  WORLDVIEW: { mission: 'Commercial Imaging', color: '#00E676' },
  USA: { mission: 'Military Recon', color: '#FF3D3D' },
  NROL: { mission: 'NRO Classified', color: '#FF3D3D' },
};

function classifySat(name: string): { mission: string; color: string } {
  const upper = name.toUpperCase();
  for (const [k, info] of Object.entries(MISSION_CLASSIFY)) {
    if (upper.includes(k)) return info;
  }
  return { mission: 'Unknown', color: '#00E5FF' };
}

export async function fetchSatelliteCatalog(
  category = 'stations',
  limit = 50,
): Promise<SatelliteEntry[]> {
  return (await cached(
    `satellites:${category}:${limit}`,
    async () => {
      const safeCategory = /^[a-z0-9-]+$/.test(category) ? category : 'stations';
      const r = await axios.get(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${safeCategory}&FORMAT=tle`,
        { timeout: 12_000, transformResponse: [(d: string) => d] },
      );
      const text = r.data as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      const entries: SatelliteEntry[] = [];
      for (let i = 0; i + 2 < lines.length && entries.length < limit; i += 3) {
        const name = lines[i].trim();
        const l1 = lines[i + 1];
        const l2 = lines[i + 2];
        if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
        const norad = parseInt(l2.substring(2, 7).trim(), 10);
        const { mission, color } = classifySat(name);
        entries.push({
          name,
          norad_id: norad,
          category: safeCategory,
          mission,
          color,
          tle_line1: l1,
          tle_line2: l2,
        });
      }
      return entries;
    },
    6 * 60 * 60 * 1000,
  )) ?? [];
}

// ---------------------------------------------------------------------------
// Cyber threat intelligence (CISA Known Exploited Vulnerabilities)
// ---------------------------------------------------------------------------

export interface CyberThreat {
  id: string;
  name: string;
  vendor: string;
  product: string;
  severity: string;
  date: string;
  due: string;
  source: string;
}

export interface CyberThreatReport {
  threats: CyberThreat[];
  stats: { cisa_total: number; shadowserver: string };
  timestamp: string;
}

export async function fetchCyberThreats(daysWindow = 30): Promise<CyberThreatReport | null> {
  return cached(
    `cyber-threats:${daysWindow}`,
    async () => {
      const results: CyberThreatReport = {
        threats: [],
        stats: { cisa_total: 0, shadowserver: 'unknown' },
        timestamp: new Date().toISOString(),
      };

      // CISA KEV (Known Exploited Vulnerabilities) — authoritative US gov feed
      try {
        const r = await axios.get(
          'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
          { timeout: 10_000 },
        );
        const vulns = r.data?.vulnerabilities ?? [];
        results.stats.cisa_total = vulns.length;
        const cutoff = Date.now() - daysWindow * 86_400_000;
        for (const v of vulns.slice(0, 200)) {
          const added = new Date(v.dateAdded).getTime();
          if (added < cutoff) continue;
          results.threats.push({
            id: v.cveID,
            name: v.vulnerabilityName,
            vendor: v.vendorProject,
            product: v.product,
            severity: 'CRITICAL',
            date: v.dateAdded,
            due: v.dueDate,
            source: 'CISA KEV',
          });
          if (results.threats.length >= 25) break;
        }
      } catch (e: any) {
        console.error(`[osiris:cyber-threats/cisa] error: ${e.message}`);
      }

      return results;
    },
    30 * 60 * 1000,
  );
}

// ---------------------------------------------------------------------------
// IP geolocation (3-provider cascade: ipapi.co → freeipapi.com → ipwho.is)
// ---------------------------------------------------------------------------

export interface GeoLocation {
  ip: string;
  lat: number;
  lon: number;
  city: string;
  region: string;
  country: string;
  country_code: string;
  isp: string;
  org: string;
  asn: string;
  timezone: string;
  source: string;
}

async function geoViaIpapi(ip: string): Promise<GeoLocation | null> {
  try {
    const url = ip ? `https://ipapi.co/${ip}/json/` : 'https://ipapi.co/json/';
    const r = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'ClawdWatch/2.2' } });
    const d = r.data;
    if (!d || d.error || !d.latitude) return null;
    return {
      ip: d.ip ?? ip,
      lat: parseFloat(d.latitude),
      lon: parseFloat(d.longitude),
      city: d.city ?? '',
      region: d.region ?? '',
      country: d.country_name ?? '',
      country_code: d.country_code ?? '',
      isp: d.org ?? '',
      org: d.org ?? '',
      asn: d.asn ? `AS${d.asn} ${d.org ?? ''}`.replace(/^ASAS/, 'AS').trim() : '',
      timezone: d.timezone ?? '',
      source: 'ipapi.co',
    };
  } catch {
    return null;
  }
}

async function geoViaFreeIpApi(ip: string): Promise<GeoLocation | null> {
  try {
    const url = ip ? `https://freeipapi.com/api/json/${ip}` : 'https://freeipapi.com/api/json';
    const r = await axios.get(url, { timeout: 5000 });
    const d = r.data;
    if (!d || d.error || !d.latitude) return null;
    return {
      ip: d.ipAddress ?? ip,
      lat: parseFloat(d.latitude),
      lon: parseFloat(d.longitude),
      city: d.cityName ?? '',
      region: d.regionName ?? '',
      country: d.countryName ?? '',
      country_code: d.countryCode ?? '',
      isp: d.isp ?? '',
      org: d.organization ?? '',
      asn: '',
      timezone: d.timeZone ?? '',
      source: 'freeipapi.com',
    };
  } catch {
    return null;
  }
}

async function geoViaIpWhoIs(ip: string): Promise<GeoLocation | null> {
  try {
    const url = ip ? `https://ipwho.is/${ip}` : 'https://ipwho.is/';
    const r = await axios.get(url, { timeout: 5000 });
    const d = r.data;
    if (!d || d.success === false) return null;
    return {
      ip: d.ip ?? ip,
      lat: parseFloat(d.latitude ?? 0),
      lon: parseFloat(d.longitude ?? 0),
      city: d.city ?? '',
      region: d.region ?? '',
      country: d.country ?? '',
      country_code: d.country_code ?? '',
      isp: d.connection?.isp ?? '',
      org: d.connection?.org ?? '',
      asn: d.connection?.asn ? `AS${d.connection.asn}` : '',
      timezone: d.timezone?.id ?? '',
      source: 'ipwho.is',
    };
  } catch {
    return null;
  }
}

export async function geoLocate(ip: string): Promise<GeoLocation | null> {
  return cached(
    `geo:${ip || 'self'}`,
    async () => {
      const providers = [geoViaIpapi, geoViaFreeIpApi, geoViaIpWhoIs];
      for (const p of providers) {
        const r = await p(ip);
        if (r) return r;
      }
      return null;
    },
    60 * 60 * 1000,
  );
}

// ---------------------------------------------------------------------------
// Air Quality (Open-Meteo Air Quality API — free, no key required)
// Returns current AQI/PM2.5/PM10/O3 readings for major global cities.
// ---------------------------------------------------------------------------

export interface AirQualityStation {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  pm25: number;
  pm10: number;
  ozone: number;
  us_aqi?: number;
  level: string;                // Good / Moderate / Unhealthy / etc.
  color: string;
  timestamp: string;
}

function classifyUsAqi(aqi?: number): { level: string; color: string } {
  if (aqi == null) return { level: 'Unknown', color: '#888' };
  if (aqi > 300) return { level: 'Hazardous', color: '#7E0023' };
  if (aqi > 200) return { level: 'Very Unhealthy', color: '#8F3F97' };
  if (aqi > 150) return { level: 'Unhealthy', color: '#FF0000' };
  if (aqi > 100) return { level: 'Unhealthy (Sensitive)', color: '#FF7E00' };
  if (aqi > 50) return { level: 'Moderate', color: '#FFFF00' };
  if (aqi > 0) return { level: 'Good', color: '#00E400' };
  return { level: 'Unknown', color: '#888' };
}

// Major cities we always snapshot when /air-quality is hit with no params.
// Lat/lng pulled from Open-Meteo geocoding for accuracy.
const DEFAULT_CITIES: Array<{ city: string; country: string; lat: number; lon: number }> = [
  { city: 'New York',       country: 'USA',          lat: 40.7128,  lon: -74.0060 },
  { city: 'Los Angeles',    country: 'USA',          lat: 34.0522,  lon: -118.2437 },
  { city: 'Chicago',        country: 'USA',          lat: 41.8781,  lon: -87.6298 },
  { city: 'Houston',        country: 'USA',          lat: 29.7604,  lon: -95.3698 },
  { city: 'London',         country: 'UK',           lat: 51.5074,  lon: -0.1278 },
  { city: 'Paris',          country: 'France',       lat: 48.8566,  lon: 2.3522 },
  { city: 'Berlin',         country: 'Germany',      lat: 52.5200,  lon: 13.4050 },
  { city: 'Moscow',         country: 'Russia',       lat: 55.7558,  lon: 37.6173 },
  { city: 'Beijing',        country: 'China',        lat: 39.9042,  lon: 116.4074 },
  { city: 'Shanghai',       country: 'China',        lat: 31.2304,  lon: 121.4737 },
  { city: 'Tokyo',          country: 'Japan',        lat: 35.6895,  lon: 139.6917 },
  { city: 'Seoul',          country: 'South Korea',  lat: 37.5665,  lon: 126.9780 },
  { city: 'Mumbai',         country: 'India',        lat: 19.0760,  lon: 72.8777 },
  { city: 'Delhi',          country: 'India',        lat: 28.7041,  lon: 77.1025 },
  { city: 'Dubai',          country: 'UAE',          lat: 25.2048,  lon: 55.2708 },
  { city: 'Cairo',          country: 'Egypt',        lat: 30.0444,  lon: 31.2357 },
  { city: 'Lagos',          country: 'Nigeria',      lat: 6.5244,   lon: 3.3792 },
  { city: 'Sao Paulo',      country: 'Brazil',       lat: -23.5505, lon: -46.6333 },
  { city: 'Buenos Aires',   country: 'Argentina',    lat: -34.6037, lon: -58.3816 },
  { city: 'Sydney',         country: 'Australia',    lat: -33.8688, lon: 151.2093 },
  { city: 'Mexico City',    country: 'Mexico',       lat: 19.4326,  lon: -99.1332 },
  { city: 'Huber Heights',  country: 'USA',          lat: 39.7589,  lon: -84.1916 },
];

export async function fetchAirQuality(): Promise<AirQualityStation[]> {
  return (await cached(
    'air-quality:cities',
    async () => {
      const stations: AirQualityStation[] = [];
      await Promise.allSettled(DEFAULT_CITIES.map(async (c) => {
        try {
          const r = await axios.get(
            `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${c.lat}&longitude=${c.lon}&current=us_aqi,pm2_5,pm10,ozone`,
            { timeout: 8_000 },
          );
          const cur = r.data?.current;
          if (!cur) return;
          const { level, color } = classifyUsAqi(cur.us_aqi);
          stations.push({
            id: `aq-${c.city.toLowerCase().replace(/\s+/g, '-')}`,
            name: c.city,
            city: c.city,
            country: c.country,
            lat: c.lat,
            lon: c.lon,
            pm25: cur.pm2_5 ?? 0,
            pm10: cur.pm10 ?? 0,
            ozone: cur.ozone ?? 0,
            us_aqi: cur.us_aqi,
            level,
            color,
            timestamp: cur.time ?? new Date().toISOString(),
          });
        } catch (e: any) {
          console.error(`[osiris:air-quality:${c.city}] error: ${e.message}`);
        }
      }));
      // Sort by AQI descending so worst air first
      stations.sort((a, b) => (b.us_aqi ?? 0) - (a.us_aqi ?? 0));
      return stations;
    },
    30 * 60 * 1000,
  )) ?? [];
}
