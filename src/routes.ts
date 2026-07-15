/**
 * The route dimension.
 *
 * The map answers *where* deviation happens. It cannot answer *why*, because the
 * two causes look identical stop by stop:
 *
 *   - deviation **flat** along a whole path → the timetable there is wrong
 *   - deviation **climbing** with each stop → traffic is eating the route live
 *
 * Only the sequence separates them, and the sequence is what routes.json adds.
 *
 * ## Two limits this module enforces rather than documents
 *
 * **Never show a slope without its r2.** Least squares returns a confident
 * number for pure scatter — one real path fits "+24 s/stop, accumulating" to the
 * profile +0.5, +0.6, +3.1, +2.9, +0.5, +3.4 min, which is noise. Median r2 is
 * 0.22 and only ~54 of 250 fitted paths carry a real trend, so `diagnose()`
 * returns `noisy` rather than let a number like that reach the page.
 *
 * **These are corridors, not lines.** Only ~14 of 250 route+directions are >=80%
 * exclusive; trunk trams share every stop, so their profile is every tram on
 * that corridor. The copy says "along this path", never "tram 33 is mistimed" —
 * `exclusiveShare` is how much of a profile is really this line, and the UI
 * shows it rather than hiding the caveat.
 */

import type { DayMode, Seconds } from './data';

export interface RouteFit {
  /** Mean deviation across covered stops, seconds. */
  mean: (Seconds | null)[];
  /** How many stops carried data for this hour's fit. */
  n: number[];
  /** Fitted deviation at the origin — the timetable signal. */
  offset: (Seconds | null)[];
  /** Goodness of fit. Without it a slope is unquotable. */
  r2: (number | null)[];
  /** Seconds gained per stop along the path — the congestion signal. */
  slope: (number | null)[];
}

export interface RouteEntry {
  direction: number;
  /** Per stop: is this path the only one serving it? */
  exclusive: boolean[];
  /** Percentage of `exclusive` that is true. Low = this is a corridor reading. */
  exclusiveShare: number;
  headsign: string;
  id: string;
  name: string;
  /** Share of this line's trips that follow this exact stop pattern. */
  patternShare: number;
  routeId: string;
  stops: string[];
  trips: number;
  type: number;
  wd: RouteFit;
  wdHeadway: (number | null)[];
  we: RouteFit;
  weHeadway: (number | null)[];
}

export interface RouteFile {
  generatedAt: string;
  minRouteStops: number;
  note: string;
  routes: RouteEntry[];
  schemaVersion: number;
}

/**
 * Thresholds for reading a fit. Chosen against the real distribution, not taste:
 * at 08h, r2 >= 0.5 keeps 61 of 250 paths and r2 < 0.3 rejects 143 — the shape
 * of the data, which is mostly flat-or-noisy with a real minority that climbs.
 */
export const R2_TRUST = 0.5;
export const R2_REJECT = 0.3;
/** Below this, a "trend" is not worth a sentence: 10 s/stop over 20 stops is 3 min. */
export const SLOPE_MEANINGFUL = 10;
/** Below this, `exclusiveShare` means the profile is a corridor, not a line. */
export const EXCLUSIVE_IS_LINE = 80;

export type Diagnosis =
  | { kind: 'no-fit' }
  | { kind: 'noisy'; slope: number; r2: number }
  | { kind: 'flat'; offset: Seconds; slope: number; r2: number }
  | { kind: 'accumulating'; slope: number; r2: number; total: Seconds }
  | { kind: 'shedding'; slope: number; r2: number; total: Seconds };

/**
 * What this path's deviation does along its length, at one hour.
 *
 * `total` is the drift across the whole path — slope x stops — because "gains
 * 84 seconds per stop" is not a human unit and "arrives 11 minutes later than it
 * left" is.
 */
export function diagnose(route: RouteEntry, mode: DayMode, hour: number): Diagnosis {
  const fit = route[mode];
  const slope = fit.slope[hour];
  const r2 = fit.r2[hour];
  const offset = fit.offset[hour];
  if (slope === null || r2 === null || offset === null) return { kind: 'no-fit' };

  const total = slope * (route.stops.length - 1);
  if (Math.abs(slope) < SLOPE_MEANINGFUL) return { kind: 'flat', offset, r2, slope };
  if (r2 < R2_REJECT) return { kind: 'noisy', r2, slope };
  if (r2 < R2_TRUST) return { kind: 'flat', offset, r2, slope };
  return slope > 0 ? { kind: 'accumulating', r2, slope, total } : { kind: 'shedding', r2, slope, total };
}

/** Which paths touch a given platform. */
export function indexByStop(file: RouteFile): Map<string, RouteEntry[]> {
  const out = new Map<string, RouteEntry[]>();
  for (const r of file.routes) {
    for (const s of r.stops) {
      let list = out.get(s);
      if (!list) out.set(s, (list = []));
      if (!list.includes(r)) list.push(r);
    }
  }
  return out;
}

/**
 * The paths where deviation demonstrably builds up — the site's strongest claim,
 * and a deliberately small list. Everything else has no trend to report.
 */
export function accumulating(file: RouteFile, mode: DayMode, hour: number): { d: Diagnosis; route: RouteEntry }[] {
  return file.routes
    .map((route) => ({ d: diagnose(route, mode, hour), route }))
    .filter((x) => x.d.kind === 'accumulating')
    .sort((a, b) => Math.abs((b.d as { total: number }).total) - Math.abs((a.d as { total: number }).total));
}

export const routeLabel = (r: RouteEntry) => `${r.name} → ${r.headsign || 'terminus'}`;
