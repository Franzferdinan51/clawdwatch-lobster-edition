import axios from 'axios';

/**
 * Global intel sources. These are all public, free, machine-readable endpoints
 * (no scraping). They give us situational awareness well beyond news headlines.
 */

export interface Earthquake {
  id: string;
  magnitude: number;
  place: string;
  time: string;     // ISO
  url: string;
  tsunami: boolean;
  depth_km: number;
  coords: [number, number];
  felt?: number;
  alert?: 'green' | 'yellow' | 'orange' | 'red';
}

export interface WeatherAlert {
  id: string;
  event: string;          // e.g. "Tornado Warning"
  headline: string;
  area: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  certainty: string;
  urgency: string;
  effective: string;
  expires: string;
  description: string;
  instruction?: string;
  states?: string[];
}

const cache: Map<string, { data: any; ts: number }> = new Map();
const TTL = 5 * 60 * 1000; // 5 min for these

async function cached<T>(key: string, fn: () => Promise<T>, ttl = TTL): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.data as T;
  try {
    const data = await fn();
    cache.set(key, { data, ts: Date.now() });
    return data;
  } catch (e: any) {
    console.error(`[intel:${key}] error: ${e.message}`);
    return null;
  }
}

/**
 * USGS All-Earthquakes feed, last 24h, magnitude 2.5+ worldwide.
 * Free, no auth, GeoJSON.
 * https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson
 */
export async function fetchEarthquakes(minMag = 4.0): Promise<Earthquake[]> {
  const data = await cached('usgs_quakes_day', async () => {
    const res = await axios.get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', {
      timeout: 15_000,
      headers: { 'User-Agent': 'ClawdWatch-Lobster/1.0' },
    });
    return res.data;
  });
  if (!data) return [];

  const out: Earthquake[] = [];
  for (const f of data.features || []) {
    const m = f.properties?.mag ?? 0;
    if (m < minMag) continue;
    const [lon, lat, depth] = f.geometry?.coordinates || [0, 0, 0];
    out.push({
      id: f.id,
      magnitude: m,
      place: f.properties?.place || 'Unknown',
      time: new Date(f.properties?.time).toISOString(),
      url: f.properties?.detail || `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`,
      tsunami: !!f.properties?.tsunami,
      depth_km: depth,
      coords: [lat, lon],
      felt: f.properties?.felt,
      alert: f.properties?.alert,
    });
  }
  // Newest first, then biggest
  out.sort((a, b) => b.time.localeCompare(a.time));
  return out;
}

/**
 * NWS Active Alerts — entire US. Free public API, no key needed.
 * https://api.weather.gov/alerts/active
 */
export async function fetchUsWeatherAlerts(): Promise<WeatherAlert[]> {
  const data = await cached('nws_alerts', async () => {
    const res = await axios.get('https://api.weather.gov/alerts/active', {
      timeout: 15_000,
      headers: { 'User-Agent': 'ClawdWatch-Lobster/1.0 (contact: ops@localhost)' },
    });
    return res.data;
  });
  if (!data) return [];

  return (data.features || []).map((f: any) => {
    const p = f.properties || {};
    return {
      id: f.id,
      event: p.event,
      headline: p.headline,
      area: p.areaDesc,
      severity: p.severity,
      certainty: p.certainty,
      urgency: p.urgency,
      effective: p.effective,
      expires: p.expires,
      description: p.description,
      instruction: p.instruction,
      states: (p.geocode?.sameCodes || []).filter((c: string) => c.startsWith('US')).map((c: string) => c.replace(/^US/, '')),
    } as WeatherAlert;
  });
}

/**
 * NOAA Space Weather — recent geomagnetic storms / solar flares.
 * Free, public, XML feed.
 */
export interface SpaceWeatherEvent {
  product_id: string;
  issue_time: string;
  message: string;
  kind: 'ALERT' | 'WARNING' | 'WATCH' | 'SUMMARY';
}

export async function fetchSpaceWeather(): Promise<SpaceWeatherEvent[]> {
  const data = await cached('noaa_space_weather', async () => {
    // Get the most recent 20 products
    const res = await axios.get('https://services.swpc.noaa.gov/products/noaa-scales.json', {
      timeout: 12_000,
      headers: { 'User-Agent': 'ClawdWatch-Lobster/1.0' },
    });
    return res.data;
  }, 30 * 60 * 1000);
  if (!data) return [];
  return []; // product listing; full message would need a second call. We just surface scale.
}

/**
 * Open-Meteo: global current weather, no key needed.
 * Used for "current conditions at point" lookups.
 */
export interface CurrentWeather {
  temperature: number;
  windspeed: number;
  weathercode: number;
  time: string;
}

export async function fetchCurrentWeather(lat: number, lon: number): Promise<CurrentWeather | null> {
  const data = await cached(`weather:${lat.toFixed(2)},${lon.toFixed(2)}`, async () => {
    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat,
        longitude: lon,
        current_weather: true,
      },
      timeout: 10_000,
    });
    return res.data?.current_weather;
  }, 15 * 60 * 1000);
  return data || null;
}

/**
 * GDACS — Global Disaster Alert and Coordination System.
 * Aggregates earthquakes, tsunamis, volcanoes, cyclones, floods, wildfires globally.
 * Free, public, RSS + JSON.
 * https://gdacs.org/
 */
export interface GdacsEvent {
  eventid: string;
  eventtype: 'EQ' | 'TC' | 'TS' | 'VO' | 'WF' | 'FL' | 'DR';
  name: string;
  description?: string;
  fromdate: string;
  todate: string;
  alertlevel: 'Green' | 'Orange' | 'Red';
  severity?: number;
  country?: string;
  iso3?: string;
  lat: number;
  lon: number;
  url: string;
}

export async function fetchGdacsEvents(): Promise<GdacsEvent[]> {
  const data = await cached('gdacs_events', async () => {
    const res = await axios.get('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromDate=2024-01-01&limit=100', {
      timeout: 18_000,
      headers: { 'User-Agent': 'ClawdWatch-Lobster/1.0' },
    });
    return res.data;
  }, 30 * 60 * 1000);
  if (!data) return [];
  return (data.features || data.events || []) as GdacsEvent[];
}
