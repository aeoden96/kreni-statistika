/**
 * The rankings — scoped to the hour on the slider, and computed here rather than
 * baked.
 *
 * ## Why the hour, and not the day
 *
 * The baked boards ranked by a whole-day average, which on this network is an
 * average over a bimodal day and answers a question nobody asks. Route 268 to
 * Velika Gorica is +17 min at 16:00 and roughly fine at 08:00; averaged, it
 * vanishes and appears on no board at all — so a rider asking the most natural
 * question, "is my line bad?", found nothing. Worse, the page showed a map of
 * 08:00 beside tables of the whole week beside a headline about the whole month:
 * three different questions on one screen.
 *
 * ## Why computed, not baked
 *
 * One source of truth. These read the same `stations.geojson` the map reads, so
 * a board can never disagree with the dots next to it, and the tram/bus filter
 * applies for free. 1,276 stations x a sort is nothing.
 *
 * ## Why the floors are not decoration
 *
 * `wdCount` is the reason this file can exist honestly. Ranking by mean alone put
 * "Jačkovina 46, 24.4 min early" at the top of the old board — a stop with data
 * in 2 of its 24 hours, whose number rests on roughly one cell that scraped past
 * the sample threshold. It is the single most prominent lie the site told. A mean
 * is only as good as its weight, so nothing enters a board without both a sample
 * floor and a service floor.
 */

import { cellIndex, type CityCurve, type DayMode, type Seconds, type StopFeature, type StopProperties } from './data';
import type { FilterMode } from './map';
import { diagnose, type Diagnosis, type RouteEntry, type RouteFile } from './routes';

/**
 * Observations behind an hour's mean before it may be ranked. MIN_SAMPLES (10)
 * is enough to *draw* a dot, nowhere near enough to call something the worst in
 * the city — the top of a 1,276-row ranking is exactly where noise collects.
 */
export const BOARD_MIN_SAMPLES = 40;

/** Scheduled departures in the hour. Filters stops nobody can actually catch. */
export const BOARD_MIN_DEPARTURES = 10;

export const BOARD_SIZE = 12;

export interface BoardRow {
  deviation: Seconds;
  departures: number;
  id: string;
  name: string;
  samples: number;
}

const wdDays = [1, 2, 3, 4, 5];
const weDays = [6, 0];

/** Departures in this hour across the days the mode covers. */
export function departuresAt(p: StopProperties, mode: DayMode, hour: number): number {
  let n = 0;
  for (const dow of mode === 'wd' ? wdDays : weDays) n += p.departures[cellIndex(dow, hour)] ?? 0;
  return n;
}

/** Every station that may honestly be ranked at this hour. */
function eligible(features: StopFeature[], mode: DayMode, hour: number): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const f of features) {
    const p = f.properties;
    const deviation = p[mode][hour];
    if (deviation === null || deviation === undefined) continue;
    const samples = (mode === 'wd' ? p.wdCount : p.weCount)?.[hour] ?? 0;
    if (samples < BOARD_MIN_SAMPLES) continue;
    const departures = departuresAt(p, mode, hour);
    if (departures < BOARD_MIN_DEPARTURES) continue;
    rows.push({ departures, deviation, id: String(f.id), name: p.name, samples });
  }
  return rows;
}

export interface StopBoards {
  early: BoardRow[];
  eligible: number;
  late: BoardRow[];
  punctual: BoardRow[];
}

export function stopBoards(features: StopFeature[], mode: DayMode, hour: number): StopBoards {
  const rows = eligible(features, mode, hour);
  const by = (f: (r: BoardRow) => number) => [...rows].sort((a, b) => f(b) - f(a)).slice(0, BOARD_SIZE);
  return {
    early: by((r) => -r.deviation),
    eligible: rows.length,
    late: by((r) => r.deviation),
    // Tie-broken by service: among stops equally on schedule, the one carrying
    // more departures is the more meaningful "most punctual".
    punctual: [...rows].sort((a, b) => Math.abs(a.deviation) - Math.abs(b.deviation) || b.departures - a.departures).slice(0, BOARD_SIZE),
  };
}

export interface RouteRow {
  d: Diagnosis;
  headway: number | null;
  mean: Seconds;
  route: RouteEntry;
  stops: number;
}

/**
 * Lines ranked by how far off schedule they are at this hour.
 *
 * Ranked by **mean deviation, not by slope**. A trend explains a line once you
 * are looking at it; it cannot rank one, and only ~54 paths have a quotable
 * trend at all. "How late is my line right now" is well defined for every path
 * with coverage, which is the question a rider actually arrives with.
 */
export function routeBoard(file: RouteFile, mode: DayMode, hour: number, filter: FilterMode = 'all', minStops = 6): RouteRow[] {
  const rows: RouteRow[] = [];
  for (const route of file.routes) {
    // Same vehicle filter as the map and the stop boards. A "Tram" view listing
    // buses would be the tables contradicting the controls above them.
    if (filter === 'tram' && route.type !== 0) continue;
    if (filter === 'bus' && route.type === 0) continue;
    const mean = route[mode].mean[hour];
    if (mean === null || route[mode].n[hour] < minStops) continue;
    rows.push({
      d: diagnose(route, mode, hour),
      headway: route[mode === 'wd' ? 'wdHeadway' : 'weHeadway'][hour],
      mean,
      route,
      stops: route[mode].n[hour],
    });
  }
  return rows.sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
}

/** The hour a rider should most avoid, and the one the schedule fits best. */
export function extremes(curve: CityCurve): { late: number; early: number } {
  let late = 0;
  let early = 0;
  for (let h = 0; h < 24; h++) {
    const v = curve.mean[h];
    if (v === null) continue;
    if (v > (curve.mean[late] ?? -Infinity)) late = h;
    if (v < (curve.mean[early] ?? Infinity)) early = h;
  }
  return { early, late };
}
