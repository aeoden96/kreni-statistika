/**
 * The baked artifacts, produced by kreni-core's `yarn bake`.
 *
 * Read the units carefully — the sign is the whole story:
 *
 *  - Values are **seconds of deviation from schedule**, and **negative means
 *    EARLY**. On this network early is the common case, not the exception:
 *    57% of scheduled departures run early, 23% on time, 19% late.
 *  - `delay[]` is 7x24, Sunday-first (`dow * 24 + hour`). `wd[]`/`we[]` are 24
 *    weekday/weekend means aggregated from raw sample counts upstream.
 *  - `null` means **too few samples to say** — it is not zero, and not
 *    "on time".
 *  - `departures[i] === 0` means **no service was scheduled** in that cell.
 *    That is a different fact from `null`, and the UI must not conflate them:
 *    at 03h, 85% of stops have no service, so an empty night map is correct.
 */

export type Seconds = number;

/** A cell is one of three states, and they must render differently. */
export type CellState = 'value' | 'low-data' | 'no-service';

export interface StopProperties {
  /** 7x24, Sunday-first. null below the sample threshold. */
  delay: (Seconds | null)[];
  /** 7x24 scheduled departures in the reference week. 0 = no service. */
  departures: number[];
  /** Sum of |deviation| x departures, seconds. Ranks "least trustworthy". */
  deviation: number;
  name: string;
  routeTypes: number[];
  /** 24 weekday means. Far better populated than a single day of `delay`. */
  wd: (Seconds | null)[];
  /** 24 weekend means. */
  we: (Seconds | null)[];
  /** stations.geojson only: child platform ids. */
  platforms?: string[];
  /** stops.geojson only: parent station id. */
  parent?: string;
}

export type StopFeature = GeoJSON.Feature<GeoJSON.Point, StopProperties>;
export type StopCollection = GeoJSON.FeatureCollection<GeoJSON.Point, StopProperties> & {
  metadata: { generatedAt: string; minSamples: number; note: string; schemaVersion: number };
};

export interface CitySummary {
  coverage: {
    cellsAboveThreshold: number;
    minSamples: number;
    stationsMapped: number;
    stopsInAggregate: number;
    stopsMapped: number;
    stopsUnmatched: number;
    trams: number;
  };
  generatedAt: string;
  gtfs: {
    feedStartDate: string | null;
    feedVersion: string | null;
    referenceWeek: Record<string, string>;
    scheduledDepartures: number;
    tripsActive: number;
  };
  headline: {
    byDepartureShare: { early: number; late: number; onTime: number };
    bySampleShare: { early: number; late: number; onTime: number };
    deadbandSeconds: number;
    deviationHoursPerWeek: number;
    meanEarlySeconds: number | null;
    meanLateSeconds: number | null;
    netMeanSeconds: number | null;
  };
  city: { delay: (Seconds | null)[]; departures: number[]; samples: number[] };
  leaderboards: Record<string, LeaderboardRow[]>;
  source: { bytes: number; lastDecay: string | null; lastUpdated: string | null; totalSamples: number | null };
}

export interface LeaderboardRow {
  deviationHours: number;
  meanSeconds: number;
  name: string;
  samples: number;
  stopId: string;
  weeklyDepartures: number;
}

const base = import.meta.env.BASE_URL;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}data/${path}`);
  if (!res.ok) {
    throw new Error(
      `Could not load ${path} (${res.status}). Run \`yarn bake\` in kreni-core and copy dist/congestion/ to public/data/.`,
    );
  }
  return (await res.json()) as T;
}

export const loadStations = () => getJson<StopCollection>('stations.geojson');
export const loadSummary = () => getJson<CitySummary>('city-summary.json');
/** Lazy: only needed when drilling into a station's platforms. */
export const loadStops = () => getJson<StopCollection>('stops.geojson');
/** Lazy: route sequences carry no deviations, only the join keys into stops.geojson. */
export const loadRoutes = () => getJson<import('./routes').RouteFile>('routes.json');

/**
 * The route view needs stops.geojson *and* routes.json — together ~650 KB gz,
 * which is not worth spending on a first paint the map does not need. Fetch once,
 * on the first drill-down, and share the promise so a fast double-click cannot
 * start two downloads.
 */
let deepData: Promise<{ byStop: Map<string, StopProperties>; routes: import('./routes').RouteFile }> | null = null;
export function loadRouteData() {
  if (!deepData) {
    deepData = Promise.all([loadStops(), loadRoutes()]).then(([stops, routes]) => ({
      byStop: new Map(stops.features.map((f) => [String(f.id), f.properties])),
      routes,
    }));
  }
  return deepData;
}

/** Index into a 7x24 array. Sunday is 0 — the Worker's getDay() convention. */
export const cellIndex = (dow: number, hour: number) => dow * 24 + hour;

export type DayMode = 'wd' | 'we';

/**
 * Resolve one cell to a value plus its state.
 *
 * Weekday/weekend mode reads the pre-aggregated arrays, which carry ~5x the
 * samples of any single day and so stay populated where `delay[]` goes null.
 * Service is still checked against the 7x24 departures, summed over the days
 * the mode covers.
 */
export function readCell(props: StopProperties, mode: DayMode, hour: number): { state: CellState; value: Seconds | null } {
  const days = mode === 'wd' ? [1, 2, 3, 4, 5] : [6, 0];
  let departures = 0;
  for (const dow of days) departures += props.departures[cellIndex(dow, hour)];
  if (departures === 0) return { state: 'no-service', value: null };
  const value = props[mode][hour];
  return value === null ? { state: 'low-data', value: null } : { state: 'value', value };
}
