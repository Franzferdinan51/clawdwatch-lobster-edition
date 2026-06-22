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
