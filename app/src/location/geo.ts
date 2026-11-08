// Location event shape and geometry shared by live GPS and the dragged demo position.
// The distance maths and the 20-second freshness limit are copied from the feat-rs branch
// (src/nearbyOffers.js and src/routineOffers.js), so both apps measure the same way.

// Where a position came from. The spec requires every location to carry this, so live
// readings and simulated movement can go down the same pipeline without being confused.
export type LocationSource = 'live' | 'demo';

// One position reading. Matches the "Location" row of the data contracts in context.md
// section 14 (coordinates, accuracy, timestamp, live/demo source). Owner is added server-side.
export type LocationEvent = {
  latitude: number;
  longitude: number;
  // Radius in metres the phone says the true position is within. Null when the platform
  // does not report it. Zero for the demo marker, which is placed exactly.
  accuracyM: number | null;
  // Milliseconds since 1970 when the reading was taken (not when we received it).
  timestamp: number;
  source: LocationSource;
};

// A live reading older than this is shown as stale. Same value feat-rs uses.
export const MAX_FIX_AGE_MS = 20_000;

// Straight-line distance over the Earth's surface, in metres (haversine formula).
export function distanceInMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const radians = Math.PI / 180;
  const halfLatitude = ((to.latitude - from.latitude) * radians) / 2;
  const halfLongitude = ((to.longitude - from.longitude) * radians) / 2;
  const haversine =
    Math.sin(halfLatitude) ** 2 +
    Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians) * Math.sin(halfLongitude) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

// The real-world rectangle the Deals map stands for: Richardson, TX around UT Dallas.
// It covers the feat-rs demo spot (Campbell Rd Chipotle) and the UTD Student Union.
// The demo marker can only be dragged inside this rectangle ("restricted" in the spec).
export const DEMO_AREA = {
  north: 32.992,
  south: 32.968,
  west: -96.758,
  east: -96.712,
};

// The spot the demo marker starts on: feat-rs's DEMO_LOCATION.
export const DEMO_START = { latitude: 32.97666, longitude: -96.72106 };

// Converts a map position (0..1 across, 0..1 down) to coordinates inside DEMO_AREA.
// A flat linear mapping is fine at this scale (a few kilometres).
export function mapFractionToCoords(fx: number, fy: number) {
  const x = Math.min(1, Math.max(0, fx));
  const y = Math.min(1, Math.max(0, fy));
  return {
    latitude: DEMO_AREA.north - y * (DEMO_AREA.north - DEMO_AREA.south),
    longitude: DEMO_AREA.west + x * (DEMO_AREA.east - DEMO_AREA.west),
  };
}

// The reverse: where on the map a coordinate sits. Returns null when it is outside the
// map area, so a live reading from elsewhere is reported rather than pinned to an edge.
export function coordsToMapFraction(p: { latitude: number; longitude: number }) {
  const fx = (p.longitude - DEMO_AREA.west) / (DEMO_AREA.east - DEMO_AREA.west);
  const fy = (DEMO_AREA.north - p.latitude) / (DEMO_AREA.north - DEMO_AREA.south);
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return { fx, fy };
}
