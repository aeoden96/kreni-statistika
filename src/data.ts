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
  /**
   * stations.geojson only: observations behind each `wd`/`we` mean.
   *
   * A mean without its weight cannot be ranked honestly — a cell scraping past
   * the sample threshold and one built from 500 observations look identical. Not
   * shipped for platforms, where nothing reads them.
   */
  wdCount?: number[];
  weCount?: number[];
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
  /**
   * The day's shape, departure-weighted, per hour. The argument the site leads
   * with: the network is ~2 min early overnight and ~2 min late at 16:00, and
   * the whole-week average describes no journey anyone makes.
   */
  cityByHour: Record<DayMode, CityCurve>;
  leaderboards: Record<string, LeaderboardRow[]>;
  source: { bytes: number; lastDecay: string | null; lastUpdated: string | null; totalSamples: number | null };
}

/** Per-hour, departure-weighted. `mean` is null where no hour had enough samples. */
export interface CityCurve {
  departures: number[];
  early: number[];
  late: number[];
  mean: (Seconds | null)[];
  onTime: number[];
  stops: number[];
}

export interface LeaderboardRow {
  deviationHours: number;
  meanSeconds: number;
  name: string;
  samples: number;
  stopId: string;
  weeklyDepartures: number;
}

/**
 * The time series, built by kreni-core `yarn trends` from the dated
 * `data-archive` snapshots. Optional: the file may not exist yet, and the site
 * must render without it. `netMeanSeconds` is null for a gap (a missing day or a
 * decay artifact); the early/on-time/late split is null before the snapshot
 * enrichment date (schema v2), so treat it as "may be absent" everywhere.
 */
export interface TrendWeek {
  days: number;
  decayCrossing: boolean;
  early: number | null;
  late: number | null;
  netMeanSeconds: number | null;
  onTime: number | null;
  samples: number;
  weekStart: string;
}
export interface TrendDay {
  date: string;
  decayCrossing: boolean;
  netMeanSeconds: number | null;
  samples: number | null;
}
export interface Trends {
  daily: TrendDay[];
  generatedAt: string;
  latest: { netMeanSeconds: number | null; vsPriorMonthSeconds: number | null };
  schemaVersion: number;
  weekly: TrendWeek[];
  window: { days: number; firstDate: string | null; lastDate: string | null; weeks: number };
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
/** Optional: call with `.catch(() => null)` — a missing file is not an error. */
export const loadTrends = () => getJson<Trends>('trends.json');

/**
 * Platform detail, for drawing a route's profile. 535 KB gz and needed only once
 * someone drills into a stop, so it is fetched then — the promise is shared so a
 * fast double-click cannot start two downloads.
 *
 * routes.json is NOT lazy: at 121 KB it powers the "lines furthest off schedule"
 * board, which is a headline answer to "is my line bad?" and cannot wait for the
 * reader to click something first.
 */
let platformData: Promise<Map<string, StopProperties>> | null = null;
export function loadPlatforms() {
  if (!platformData) {
    platformData = loadStops().then((stops) => new Map(stops.features.map((f) => [String(f.id), f.properties])));
  }
  return platformData;
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
