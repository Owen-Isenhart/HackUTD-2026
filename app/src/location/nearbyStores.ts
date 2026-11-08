// Finds every store within a radius of the user, using OpenStreetMap data through the
// public Overpass API (a free query service for OpenStreetMap, no API key).
// The output (NearbyStoresResult) is the input the recommendation algorithm will rank later.
//
// Adapted from two open-source projects (full notices in THIRD_PARTY_NOTICES.md):
// - nirholas/x402-places, src/service.ts, Apache-2.0: the "around a point" query, the
//   OpenStreetMap-element-to-record mapping, the address builder and the quote escaping.
// - zeSchlausKwab/earthly, contextvm/tools/overpass.ts, MIT: trying several Overpass
//   servers in turn with a 25-second timeout each.
// Changes from those sources: store categories instead of "any amenity"; brand fields kept
// for rewards matching; distance added, strict radius filter and nearest-first order;
// live/demo source recorded; React Native-safe fetch (no process.env, no AbortSignal.timeout);
// Yelp lookup and its made-up fallback data removed.
import { distanceInMeters, type LocationEvent } from './geo';

// One store near the user.
export type NearbyStore = {
  id: string; // "node-123", "way-123" or "relation-123": stable OpenStreetMap identity
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  name: string;
  // The chain, when OpenStreetMap records one, e.g. "Starbucks". Rewards programs belong to
  // chains, so this is the field to match Capital One offers and store programs against.
  brand: string | null;
  // Wikidata ID of the brand (a global identifier, e.g. "Q37158" is Starbucks). Matches the
  // same chain even when the shop's name is spelled differently.
  brandWikidata: string | null;
  // What kind of place it is: the OpenStreetMap key and value, e.g. shop=supermarket.
  category: { key: 'shop' | 'amenity'; value: string };
  latitude: number;
  longitude: number;
  distanceM: number; // straight-line distance from the user's position
  address: string | null;
  openingHours: string | null; // raw OpenStreetMap opening_hours text, not parsed
  website: string | null;
  tags: Record<string, string>; // everything OpenStreetMap has on it, for later use
};

// The full answer for one search.
export type NearbyStoresResult = {
  provider: 'openstreetmap-overpass';
  // Where and how the search was made. The location source travels with the data, so a
  // demo search can never be mistaken for a live one further down the pipeline.
  query: {
    latitude: number;
    longitude: number;
    radiusM: number;
    locationSource: LocationEvent['source'];
    locationTimestamp: number;
  };
  stores: NearbyStore[]; // nearest first, all within radiusM
  retrievedAt: number; // milliseconds since 1970
};

// Amenity values that are places people buy things. Everything tagged "shop" is included
// too. Adjust this list to change what counts as a store.
export const STORE_AMENITIES = [
  'restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream', 'food_court', 'fuel', 'pharmacy',
];

// Largest radius allowed, so one search cannot ask a free public server for a whole city.
export const MAX_RADIUS_M = 5000;
// At most this many raw results per search.
const RESULT_LIMIT = 300;

// Public Overpass servers, tried in this order. From earthly's list.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// Overpass asks every client to identify itself. Browsers ignore this header; phones send it.
const USER_AGENT = 'Nessential-HackUTD2026/0.1 (+https://github.com/arjuns694201107/HackUTD-2026)';
const TIMEOUT_MS = 25_000;

// Shape of one element in Overpass's JSON answer.
export type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

// Escapes a value for use inside an Overpass quoted string. From x402-places.
function esc(v: string): string {
  return v.replace(/[\\"]/g, '\\$&');
}

// Builds the Overpass query: every named shop, and every named store-like amenity, within
// radiusM metres of the point. "out tags center" returns tags plus one centre point for
// stores mapped as building outlines.
export function buildNearbyStoresQuery(latitude: number, longitude: number, radiusM: number): string {
  const around = `(around:${radiusM},${latitude},${longitude})`;
  const amenities = STORE_AMENITIES.map(esc).join('|');
  return `[out:json][timeout:25];
(
  nwr["shop"]["name"]${around};
  nwr["amenity"~"^(${amenities})$"]["name"]${around};
);
out tags center ${RESULT_LIMIT};`;
}

// Joins the address parts OpenStreetMap has. From x402-places.
function buildAddress(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
    tags['addr:postcode'],
  ].filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(', ') : null;
}

// Turns one Overpass element into a NearbyStore. Returns null for elements that are not a
// usable store (no name, no position, wrong kind). Mapping adapted from x402-places' toPoi.
export function toNearbyStore(
  el: OverpassElement,
  from: { latitude: number; longitude: number },
): NearbyStore | null {
  const tags = el.tags ?? {};
  const latitude = el.lat ?? el.center?.lat;
  const longitude = el.lon ?? el.center?.lon;
  if (!tags.name || latitude === undefined || longitude === undefined) return null;
  const category = tags.shop
    ? { key: 'shop' as const, value: tags.shop }
    : tags.amenity && STORE_AMENITIES.includes(tags.amenity)
      ? { key: 'amenity' as const, value: tags.amenity }
      : null;
  if (!category) return null;
  return {
    id: `${el.type}-${el.id}`,
    osmType: el.type,
    osmId: el.id,
    name: tags.name,
    brand: tags.brand ?? null,
    brandWikidata: tags['brand:wikidata'] ?? null,
    category,
    latitude,
    longitude,
    distanceM: distanceInMeters(from, { latitude, longitude }),
    address: buildAddress(tags),
    openingHours: tags.opening_hours ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    tags,
  };
}

// Converts the raw answer into the final list: valid stores only, one entry per OpenStreetMap
// element, strictly inside the radius, nearest first. Ties are broken by id so the same data
// always comes out in the same order.
export function toNearbyStores(
  elements: OverpassElement[],
  from: { latitude: number; longitude: number },
  radiusM: number,
): NearbyStore[] {
  const seen = new Set<string>();
  const stores: NearbyStore[] = [];
  for (const el of elements) {
    const store = toNearbyStore(el, from);
    // Overpass counts a building as "around" if any corner is in range, so its centre can
    // fall just outside. The radius is a hard limit, so those are dropped here.
    if (!store || store.distanceM > radiusM || seen.has(store.id)) continue;
    seen.add(store.id);
    stores.push(store);
  }
  return stores.sort((a, b) => a.distanceM - b.distanceM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// An error caused by the query itself. Every server would reject it too, so it is not retried.
class OverpassQueryError extends Error {}

// Server answers that mean "busy, try later" rather than "your query is wrong".
// overpass-api.de answers 502 when its queue is full.
const BUSY_STATUSES = [429, 502, 503, 504];
// Waits before the second and third rounds over all servers. Overpass asks clients to back
// off this way when it is busy; derhuerst/query-overpass retries the same way.
export const RETRY_WAITS_MS = [1_000, 2_000];

// Waits ms milliseconds, or stops early with an error if the search is cancelled.
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('Search cancelled'));
    });
  });
}

// Sends one query. Tries each server in turn when one is busy, down or slow, and goes
// round all servers again (up to RETRY_WAITS_MS.length more times) after a growing wait.
async function runOverpassQuery(query: string, signal?: AbortSignal): Promise<OverpassElement[]> {
  let lastError: Error | null = null;
  for (let round = 0; round <= RETRY_WAITS_MS.length; round++) {
    if (round > 0) await wait(RETRY_WAITS_MS[round - 1], signal);
    try {
      return await tryEachServer(query, signal);
    } catch (err) {
      if (signal?.aborted || err instanceof OverpassQueryError) throw err;
      lastError = err as Error;
    }
  }
  throw new Error(`No Overpass server answered. Last error: ${lastError?.message ?? 'unknown'}`);
}

// One round over the servers. Adapted from earthly's executeQuery.
async function tryEachServer(query: string, signal?: AbortSignal): Promise<OverpassElement[]> {
  let lastError: Error | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) throw new Error('Search cancelled');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 200);
        // Busy or rate-limited: try the next server. Any other error is the query's fault.
        if (BUSY_STATUSES.includes(res.status)) {
          lastError = new Error(`Overpass ${res.status}: ${text}`);
          continue;
        }
        throw new OverpassQueryError(`Overpass rejected the search (${res.status}): ${text}`);
      }
      const body = (await res.json()) as { elements?: OverpassElement[] };
      if (!Array.isArray(body.elements)) throw new Error('Overpass returned an unexpected answer');
      return body.elements;
    } catch (err) {
      if (signal?.aborted) throw new Error('Search cancelled');
      if (err instanceof OverpassQueryError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      // A timeout or network failure: try the next server.
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError ?? new Error('unknown');
}

// The entry point: all stores within radiusM of a location event.
export async function findNearbyStores(
  at: LocationEvent,
  radiusM: number,
  signal?: AbortSignal,
): Promise<NearbyStoresResult> {
  if (!(radiusM > 0) || radiusM > MAX_RADIUS_M) {
    throw new Error(`Radius must be between 1 and ${MAX_RADIUS_M} metres`);
  }
  const radius = Math.round(radiusM);
  const elements = await runOverpassQuery(buildNearbyStoresQuery(at.latitude, at.longitude, radius), signal);
  return {
    provider: 'openstreetmap-overpass',
    query: {
      latitude: at.latitude,
      longitude: at.longitude,
      radiusM: radius,
      locationSource: at.source,
      locationTimestamp: at.timestamp,
    },
    stores: toNearbyStores(elements, at, radius),
    retrievedAt: Date.now(),
  };
}
