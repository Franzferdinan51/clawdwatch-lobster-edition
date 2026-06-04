/**
 * Global region registry. Each region has lat/lon bounds for OpenSky queries,
 * a human-readable name, region grouping (used for news filtering), and aliases.
 *
 * This is THE source of truth for region definitions. http.ts wires these up.
 */

export interface Bounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export interface RegionDefinition {
  id: string;
  name: string;
  description: string;
  flightBounds: Bounds;
  /** grouping tag for news filtering */
  group: 'middle_east' | 'europe' | 'americas' | 'asia' | 'africa' | 'oceania' | 'world';
  aliases: string[];
  priority: number; // lower = higher priority
}

// === Global tier (the whole world) ===
const GLOBAL: RegionDefinition = {
  id: 'global',
  name: 'Global',
  description: 'Whole-world OpenSky query.',
  flightBounds: { latMin: -60, latMax: 85, lonMin: -180, lonMax: 180 },
  group: 'world',
  aliases: ['world', 'planet', 'earth'],
  priority: 99,
};

// === Continent-level tiers ===
const CONTINENTS: RegionDefinition[] = [
  { id: 'europe',       name: 'Europe',         description: 'Continental Europe, Iceland to Urals.',           flightBounds: { latMin: 35, latMax: 72, lonMin: -10, lonMax: 60 }, group: 'europe',  aliases: ['eu', 'european'], priority: 2 },
  { id: 'north_america',name: 'North America',  description: 'USA, Canada, Mexico, Caribbean.',                flightBounds: { latMin: 5,  latMax: 85, lonMin: -170, lonMax: -50 }, group: 'americas', aliases: ['na', 'namerica'], priority: 2 },
  { id: 'south_america',name: 'South America',  description: 'South of Panama.',                                flightBounds: { latMin: -60, latMax: 15, lonMin: -85, lonMax: -30 }, group: 'americas', aliases: ['sa', 'samerica', 'latam'], priority: 2 },
  { id: 'africa',       name: 'Africa',         description: 'All of continental Africa + Madagascar.',        flightBounds: { latMin: -35, latMax: 37, lonMin: -20, lonMax: 55 }, group: 'africa',  aliases: ['af'], priority: 2 },
  { id: 'asia',         name: 'Asia',           description: 'Continental Asia, Russia east, Japan, Indonesia.',flightBounds: { latMin: -10, latMax: 75, lonMin: 60, lonMax: 180 }, group: 'asia',    aliases: ['apac', 'asia_pacific'], priority: 2 },
  { id: 'oceania',      name: 'Oceania',        description: 'Australia, NZ, Pacific Islands.',                 flightBounds: { latMin: -50, latMax: 0,  lonMin: 110, lonMax: 180 }, group: 'oceania', aliases: ['aus', 'pac'], priority: 3 },
];

// === Sub-region tiers (better focus for OSINT) ===
const SUBREGIONS: RegionDefinition[] = [
  // Middle East / Gulf
  { id: 'middle_east',  name: 'Middle East',    description: 'Gulf, Levant, Red Sea, Iran.',                    flightBounds: { latMin: 12, latMax: 42, lonMin: 25, lonMax: 65 }, group: 'middle_east', aliases: ['me', 'gulf', 'levant'], priority: 1 },
  { id: 'iran',         name: 'Iran',           description: 'Iran airspace.',                                 flightBounds: { latMin: 25, latMax: 40, lonMin: 44, lonMax: 63 }, group: 'middle_east', aliases: [], priority: 1 },
  { id: 'israel',       name: 'Israel/Palestine', description: 'Israel + OPT.',                                flightBounds: { latMin: 29, latMax: 34, lonMin: 34, lonMax: 36 }, group: 'middle_east', aliases: [], priority: 1 },
  { id: 'lebanon',      name: 'Lebanon',        description: 'Lebanon + coastal Syria.',                       flightBounds: { latMin: 33, latMax: 36, lonMin: 35, lonMax: 37 }, group: 'middle_east', aliases: [], priority: 1 },
  { id: 'syria',        name: 'Syria',          description: 'Syria.',                                         flightBounds: { latMin: 32, latMax: 38, lonMin: 35, lonMax: 42 }, group: 'middle_east', aliases: [], priority: 1 },
  { id: 'iraq',         name: 'Iraq',           description: 'Iraq.',                                          flightBounds: { latMin: 29, latMax: 38, lonMin: 38, lonMax: 49 }, group: 'middle_east', aliases: [], priority: 1 },
  { id: 'yemen',        name: 'Yemen',          description: 'Yemen + Bab al-Mandab.',                         flightBounds: { latMin: 12, latMax: 20, lonMin: 42, lonMax: 55 }, group: 'middle_east', aliases: [], priority: 1 },
  { id: 'saudi_arabia', name: 'Saudi Arabia',   description: 'KSA.',                                           flightBounds: { latMin: 16, latMax: 33, lonMin: 34, lonMax: 56 }, group: 'middle_east', aliases: ['ksa'], priority: 2 },
  { id: 'uae',          name: 'UAE',            description: 'United Arab Emirates.',                          flightBounds: { latMin: 22, latMax: 27, lonMin: 51, lonMax: 57 }, group: 'middle_east', aliases: [], priority: 2 },
  { id: 'qatar',        name: 'Qatar',          description: 'Qatar + Bahrain.',                               flightBounds: { latMin: 24, latMax: 27, lonMin: 50, lonMax: 52 }, group: 'middle_east', aliases: [], priority: 2 },
  { id: 'kuwait',       name: 'Kuwait',         description: 'Kuwait.',                                        flightBounds: { latMin: 28, latMax: 31, lonMin: 46, lonMax: 49 }, group: 'middle_east', aliases: [], priority: 2 },
  { id: 'oman',         name: 'Oman',           description: 'Oman + Gulf of Oman.',                           flightBounds: { latMin: 16, latMax: 27, lonMin: 51, lonMax: 60 }, group: 'middle_east', aliases: [], priority: 2 },
  { id: 'turkey',       name: 'Turkey',         description: 'Turkey + Bosphorus.',                            flightBounds: { latMin: 36, latMax: 42, lonMin: 26, lonMax: 45 }, group: 'middle_east', aliases: ['tr', 'turkiye'], priority: 2 },

  // Europe subregions
  { id: 'eastern_europe', name: 'Eastern Europe', description: 'Ukraine, Belarus, Russia west, Baltics.',       flightBounds: { latMin: 44, latMax: 70, lonMin: 15, lonMax: 60 }, group: 'europe', aliases: ['ee', 'black_sea', 'baltics'], priority: 1 },
  { id: 'british_isles',  name: 'British Isles',  description: 'UK + Ireland.',                                flightBounds: { latMin: 49, latMax: 61, lonMin: -11, lonMax: 2 },  group: 'europe', aliases: ['uk', 'britain'], priority: 3 },
  { id: 'mediterranean',  name: 'Mediterranean',  description: 'Med Sea coast + North Africa rim.',            flightBounds: { latMin: 30, latMax: 47, lonMin: -10, lonMax: 38 }, group: 'europe', aliases: ['med'], priority: 3 },
  { id: 'scandinavia',    name: 'Scandinavia',    description: 'Norway, Sweden, Finland.',                      flightBounds: { latMin: 55, latMax: 72, lonMin: 4, lonMax: 32 }, group: 'europe', aliases: ['nordics'], priority: 3 },

  // Americas
  { id: 'usa',         name: 'USA',         description: 'Continental US.',                   flightBounds: { latMin: 24, latMax: 50, lonMin: -125, lonMax: -66 }, group: 'americas', aliases: ['us', 'united_states', 'conus'], priority: 2 },
  { id: 'canada',      name: 'Canada',      description: 'Canada + Arctic.',                  flightBounds: { latMin: 42, latMax: 84, lonMin: -141, lonMax: -52 }, group: 'americas', aliases: [], priority: 3 },
  { id: 'mexico',      name: 'Mexico',      description: 'Mexico + Central America.',         flightBounds: { latMin: 8,  latMax: 33, lonMin: -118, lonMax: -86 }, group: 'americas', aliases: [], priority: 3 },
  { id: 'caribbean',   name: 'Caribbean',   description: 'Caribbean islands.',                flightBounds: { latMin: 8,  latMax: 28, lonMin: -90, lonMax: -60 }, group: 'americas', aliases: [], priority: 3 },
  { id: 'brazil',      name: 'Brazil',      description: 'Brazil.',                           flightBounds: { latMin: -34, latMax: 6, lonMin: -74, lonMax: -34 }, group: 'americas', aliases: [], priority: 3 },
  { id: 'argentina',   name: 'Argentina',   description: 'Argentina + Chile + Uruguay.',      flightBounds: { latMin: -56, latMax: -20, lonMin: -76, lonMax: -53 }, group: 'americas', aliases: [], priority: 3 },

  // Asia
  { id: 'central_asia',  name: 'Central Asia',  description: '-stans.',                  flightBounds: { latMin: 30, latMax: 56, lonMin: 46, lonMax: 90 }, group: 'asia', aliases: ['stans'], priority: 3 },
  { id: 'south_asia',    name: 'South Asia',    description: 'India, Pakistan, Bangladesh, Sri Lanka.', flightBounds: { latMin: 5, latMax: 40, lonMin: 60, lonMax: 100 }, group: 'asia', aliases: [], priority: 3 },
  { id: 'east_asia',     name: 'East Asia',     description: 'China, Japan, Korea, Taiwan.', flightBounds: { latMin: 15, latMax: 55, lonMin: 95, lonMax: 155 }, group: 'asia', aliases: [], priority: 3 },
  { id: 'southeast_asia',name: 'Southeast Asia',description: 'ASEAN.',                    flightBounds: { latMin: -15, latMax: 30, lonMin: 92, lonMax: 145 }, group: 'asia', aliases: ['asean'], priority: 3 },
  { id: 'china',         name: 'China',         description: 'PRC + Hainan + Taiwan.',   flightBounds: { latMin: 18, latMax: 54, lonMin: 73, lonMax: 135 }, group: 'asia', aliases: ['prc'], priority: 3 },
  { id: 'japan',         name: 'Japan',         description: 'Japan archipelago.',       flightBounds: { latMin: 24, latMax: 46, lonMin: 128, lonMax: 146 }, group: 'asia', aliases: [], priority: 3 },
  { id: 'korea',         name: 'Korea',         description: 'DPRK + ROK.',              flightBounds: { latMin: 33, latMax: 43, lonMin: 124, lonMax: 132 }, group: 'asia', aliases: [], priority: 3 },
  { id: 'india',         name: 'India',         description: 'India + adjacent waters.', flightBounds: { latMin: 6,  latMax: 38, lonMin: 68, lonMax: 98 }, group: 'asia', aliases: [], priority: 3 },

  // Africa
  { id: 'north_africa',  name: 'North Africa',  description: 'Maghreb + Egypt + Sudan.', flightBounds: { latMin: 10, latMax: 38, lonMin: -17, lonMax: 38 }, group: 'africa', aliases: ['nafrica', 'maghreb'], priority: 3 },
  { id: 'west_africa',   name: 'West Africa',   description: 'ECOWAS region.',          flightBounds: { latMin: -5, latMax: 22, lonMin: -18, lonMax: 16 }, group: 'africa', aliases: [], priority: 3 },
  { id: 'east_africa',   name: 'East Africa',   description: 'Horn of Africa.',         flightBounds: { latMin: -15, latMax: 18, lonMin: 30, lonMax: 52 }, group: 'africa', aliases: ['horn'], priority: 3 },
  { id: 'southern_africa',name: 'Southern Africa',description: 'S of the equator.',      flightBounds: { latMin: -35, latMax: 0,  lonMin: 11, lonMax: 41 }, group: 'africa', aliases: [], priority: 3 },

  // Oceania
  { id: 'australia',     name: 'Australia',     description: 'Aussie continent + Tasmania.', flightBounds: { latMin: -45, latMax: -10, lonMin: 112, lonMax: 154 }, group: 'oceania', aliases: ['aus'], priority: 3 },
  { id: 'new_zealand',   name: 'New Zealand',   description: 'NZ.',                            flightBounds: { latMin: -48, latMax: -34, lonMin: 165, lonMax: 179 }, group: 'oceania', aliases: ['nz'], priority: 3 },
];

export const ALL_REGIONS: RegionDefinition[] = [GLOBAL, ...CONTINENTS, ...SUBREGIONS];

/** Find a region by id, alias, or fuzzy match. */
export function findRegion(query: string): RegionDefinition | undefined {
  if (!query) return undefined;
  const q = query.trim().toLowerCase().replace(/[\s-]+/g, '_');
  for (const r of ALL_REGIONS) {
    if (r.id === q) return r;
    if (r.aliases.includes(q)) return r;
  }
  return undefined;
}

export function getRegionById(id: string): RegionDefinition | undefined {
  return ALL_REGIONS.find((r) => r.id === id);
}

/** High-priority regions that should be queried on the global /flights default */
export function getDefaultFlightRegions(): RegionDefinition[] {
  return ALL_REGIONS
    .filter((r) => r.priority <= 2)
    .sort((a, b) => a.priority - b.priority);
}

export function getAllRegionGroups(): string[] {
  return Array.from(new Set(ALL_REGIONS.map((r) => r.group)));
}
