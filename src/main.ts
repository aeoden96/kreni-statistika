/**
 * statistika.kreni.app — how punctual is ZET, by stop and hour.
 *
 * "Punctuality", not "congestion" and not "delays": the aggregate measures
 * schedule adherence, and on this network the common failure is running EARLY
 * (57% of departures), not late (19%). The naming, the scale and the copy all
 * have to survive that fact.
 *
 * Zero API calls at runtime — everything is in the baked files.
 */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { extremes } from './boards';
import { barChart, cityCurve, routeProfile } from './chart';
import {
  loadPlatforms,
  loadRoutes,
  loadStations,
  loadSummary,
  readCell,
  type CitySummary,
  type DayMode,
  type StopCollection,
  type StopFeature,
  type StopProperties,
} from './data';
import { DelayMap, matchesFilter, type FilterMode } from './map';
import { diagnose, indexByStop, routeLabel, EXCLUSIVE_IS_LINE, type RouteEntry, type RouteFile } from './routes';
import { tableView } from './table';
import { colorFor, describe, stops, type Mode } from './scale';
import './style.css';

const theme: Mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const state = {
  filter: 'all' as FilterMode,
  hour: 8,
  mode: 'wd' as DayMode,
  route: null as string | null,
  selected: null as string | null,
};

/**
 * The view lives in the URL.
 *
 * A finding no one can link to is a finding no one repeats: "ZET runs 14 minutes
 * late by Botinec at 08:00" is worth an argument, and it needs an address. The
 * hour and day are as much a part of a claim here as the stop is, since the
 * network flips from early to late across the day — a bare stop link would drop
 * the half that makes the number mean anything.
 */
function readUrl() {
  const q = new URLSearchParams(location.search);
  // An absent param must not be read as a value: Number(null) is 0, which is a
  // perfectly valid hour, so a plain visit would silently load at midnight.
  const rawHour = q.get('hour');
  if (rawHour !== null && rawHour !== '') {
    const hour = Number(rawHour);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) state.hour = hour;
  }
  if (q.get('day') === 'we') state.mode = 'we';
  const filter = q.get('filter');
  if (filter === 'tram' || filter === 'bus') state.filter = filter;
  state.selected = q.get('stop');
  state.route = q.get('line');
}

function writeUrl() {
  const q = new URLSearchParams();
  if (state.hour !== 8) q.set('hour', String(state.hour));
  if (state.mode !== 'wd') q.set('day', state.mode);
  if (state.filter !== 'all') q.set('filter', state.filter);
  if (state.selected) q.set('stop', state.selected);
  if (state.route) q.set('line', state.route);
  const qs = q.toString();
  // replaceState, not pushState: scrubbing the hour slider would otherwise bury
  // the back button under a hundred history entries.
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

/** routes.json is loaded up front — it powers the line board. */
let routeFile: RouteFile | null = null;
let routesAtStop: Map<string, RouteEntry[]> = new Map();
/** Platform detail arrives on the first drill-down, for the route profiles. */
let platforms: Map<string, StopProperties> | null = null;

/**
 * Re-render everything for the current hour/day/filter. Assigned by main().
 *
 * The whole page describes one hour now — map, boards and headline — so there is
 * one repaint, not three that can disagree with each other.
 */
let redraw: () => void = () => {};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

async function main() {
  document.documentElement.dataset.theme = theme;
  readUrl();
  let stations: StopCollection;
  let summary: CitySummary;
  let loadedRoutes: RouteFile | null = null;
  try {
    // routes.json rides along with the first paint: the line board is a headline
    // answer, not a drill-down, so it cannot wait for a click.
    [stations, summary, loadedRoutes] = await Promise.all([loadStations(), loadSummary(), loadRoutes().catch(() => null)]);
    routeFile = loadedRoutes;
    if (routeFile) routesAtStop = indexByStop(routeFile);
  } catch (err) {
    $('#app').innerHTML = `<div class="error"><strong>No data.</strong><br>${(err as Error).message}</div>`;
    return;
  }

  renderLegend();

  // MapLibre needs WebGL. Where it is unavailable (old hardware, blocked
  // drivers, some headless/VM setups) the map must say so rather than leave a
  // blank rectangle — the tables below still answer the ranking questions.
  let map: DelayMap;
  try {
    map = new DelayMap($('#map'), theme, (id) => select(id));
    await map.ready();
    map.setData(stations);
  } catch (err) {
    $('#map').innerHTML =
      `<div class="error"><strong>The map needs WebGL, which this browser did not provide.</strong><br>` +
      `The rankings below work without it.<br><span class="tiny">${escapeHtml((err as Error).message).slice(0, 300)}</span></div>`;
    $('.controls').setAttribute('hidden', '');
    return;
  }

  const byId = new Map(stations.features.map((f) => [String(f.id), f as StopFeature]));

  const shown = () => stations.features.filter((f) => matchesFilter(f.properties.routeTypes, state.filter)) as StopFeature[];

  const draw = () => {
    map.render(state.mode, state.hour, state.filter);
    const c = map.counts(state.mode, state.hour, state.filter);
    writeUrl();
    $('#hour-label').textContent = `${String(state.hour).padStart(2, '0')}:00`;
    // Say out loud how much is actually shown. ~55% of cells are below the
    // sample threshold, and a map that hides that reads as more authoritative
    // than the data earns.
    $('#coverage').textContent =
      `${c.value} stations shown · ${c.lowData} too few samples · ${c.noService} no service scheduled`;
    // Headline, boards and map all describe the SAME hour. That coherence is the
    // point: the page used to show a map of 08:00 beside tables of the whole week
    // beside a headline about the whole month.
    renderHeadline(summary);
    $('#tables').innerHTML = tableView(shown(), routeFile, state.mode, state.hour, theme, state.filter);
    for (const row of document.querySelectorAll<HTMLTableRowElement>('#tables tr[data-stop]')) {
      row.addEventListener('click', () => {
        const id = row.dataset.stop;
        if (!id) return;
        void select(id);
        const f = byId.get(id);
        if (f) map.flyTo(f);
      });
    }
    if (state.selected) renderPanel(byId.get(state.selected));
  };
  redraw = draw;

  const select = async (id: string, keepRoute = false) => {
    state.selected = id;
    if (!keepRoute) state.route = null;
    writeUrl();
    renderPanel(byId.get(id));
    // Platform detail is 535 KB and only the profile needs it, so the panel
    // renders now and gains its charts a moment later rather than blocking.
    if (!platforms) {
      try {
        platforms = await loadPlatforms();
      } catch {
        return; // The panel is still useful without profiles; say nothing.
      }
    }
    if (state.selected === id) renderPanel(byId.get(id));
  };

  $<HTMLInputElement>('#hour').addEventListener('input', (e) => {
    state.hour = Number((e.target as HTMLInputElement).value);
    draw();
  });
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    el.addEventListener('click', () => {
      state.mode = el.dataset.mode as DayMode;
      document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b === el));
      draw();
    });
  }
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
    el.addEventListener('click', () => {
      state.filter = el.dataset.filter as FilterMode;
      document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('on', b === el));
      draw();
    });
  }

  let playing: number | null = null;
  $('#play').addEventListener('click', () => {
    const btn = $<HTMLButtonElement>('#play');
    if (playing !== null) {
      clearInterval(playing);
      playing = null;
      btn.textContent = '▶ Play day';
      return;
    }
    btn.textContent = '❚❚ Pause';
    playing = window.setInterval(() => {
      state.hour = (state.hour + 1) % 24;
      $<HTMLInputElement>('#hour').value = String(state.hour);
      draw();
    }, 700);
  });

  // Reflect a linked view in the controls before the first paint, so the page
  // never shows 08:00 while the URL says 17:00.
  $<HTMLInputElement>('#hour').value = String(state.hour);
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) el.classList.toggle('on', el.dataset.mode === state.mode);
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-filter]')) el.classList.toggle('on', el.dataset.filter === state.filter);

  draw();

  if (state.selected) {
    const linked = state.selected;
    const wanted = state.route;
    if (byId.has(linked)) {
      await select(linked, true);
      state.route = wanted;
      renderPanel(byId.get(linked));
      map.flyTo(byId.get(linked)!);
    }
  }
}

/**
 * The headline.
 *
 * It used to lead with "57.1% of departures run early", which is an average over
 * a bimodal day and the fastest way to lose a reader: someone who looks up their
 * own 16:00 bus finds it 17 minutes late and concludes the site is wrong. It also
 * asserted "arrive on time and it has already gone", which the feed cannot
 * support — ZET stamps one delay per stop into both the arrival and departure
 * fields (208 of 210 identical), so "arrived early and is waiting" and "left
 * early" are indistinguishable in this data.
 *
 * So it leads with the shape instead, which is defensible, matches what riders
 * feel, and is the more interesting claim anyway.
 */
function renderHeadline(s: CitySummary) {
  const curve = s.cityByHour[state.mode];
  const { early, late } = extremes(curve);
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const peakLate = curve.mean[late] ?? 0;
  const peakEarly = curve.mean[early] ?? 0;

  const day = state.mode === 'wd' ? 'weekdays' : 'weekends';

  // Claim, then the numbers it rests on, then the evidence beside it. The three
  // stats are pulled out of the lede because they are what survives skimming —
  // and the third is there to undercut the first two on purpose.
  $('#headline').innerHTML = `
    <div class="hero-copy">
      <h1>ZET runs late when you need it, and early when you don't</h1>
      <p class="lede">It depends entirely on <strong>when</strong> you travel. Through the afternoon the network runs
        <strong>minutes behind</strong> its timetable; overnight it runs <strong>minutes ahead</strong> of it. Running ahead
        is not a bonus — though this data cannot tell you whether an early vehicle waits for you or leaves without you.</p>
    </div>
    <figure class="curve">
      <figcaption class="curve-cap">The whole network, hour by hour · ${day}</figcaption>
      ${cityCurve(curve, theme, state.hour)}
      <p class="note tiny">Typical deviation from schedule, weighted by scheduled departures. Click an hour to send the
        map and the rankings to it.</p>
    </figure>
    <div class="stats">
      <div class="stat">
        <span class="k">Worst hour</span><span class="v">${hh(late)}</span>
        <span class="s">${plainDeviation(peakLate)} · ${curve.late[late]}% of departures late</span>
      </div>
      <div class="stat">
        <span class="k">Furthest ahead</span><span class="v">${hh(early)}</span>
        <span class="s">${plainDeviation(peakEarly)} · ${curve.early[early]}% run early</span>
      </div>
      <div class="stat">
        <span class="k">Whole-week average</span><span class="v">${plainDeviation(s.headline.netMeanSeconds ?? 0)}</span>
        <span class="s">describes no journey anyone makes</span>
      </div>
    </div>`;

  renderProvenance(s);

  for (const el of document.querySelectorAll<SVGRectElement>('.hbar')) {
    el.addEventListener('click', () => {
      const h = Number(el.dataset.hour);
      if (!Number.isInteger(h)) return;
      state.hour = h;
      $<HTMLInputElement>('#hour').value = String(h);
      redraw();
    });
  }
}

/**
 * Where the numbers come from, and what they cannot say.
 *
 * In the footer rather than the hero: it is what a reader checks *after* being
 * convinced, and eleven lines of feed versions and sample thresholds under the
 * headline buried the argument they were meant to support. Demoted, not dropped —
 * the caveats are the reason to trust the rest.
 */
function renderProvenance(s: CitySummary) {
  const week = Object.values(s.gtfs.referenceWeek).sort()[0];
  $('#prov').innerHTML = `
    <p class="note">Built from ${(s.source.totalSamples ?? 0).toLocaleString('en')} observations of ZET's public
      GTFS-Realtime feed across ${s.coverage.stationsMapped.toLocaleString('en')} stations, compared against the scheduled
      times in ZET's GTFS feed ${escapeHtml(s.gtfs.feedVersion ?? '—')} (reference week ${week}). Every figure is a typical
      deviation from the timetable, in minutes; negative is early.</p>
    <p class="note">ZET's feed reports a single deviation per stop rather than separate arrival and departure times, so a
      vehicle that arrives early and waits cannot be distinguished from one that leaves early. Hours with fewer than
      ${s.coverage.minSamples} observations are marked as too few samples and never drawn as zero, and stops with no
      scheduled service are drawn as nothing at all. An independent project; not affiliated with or endorsed by ZET.</p>`;
}

/** Legend is always present: identity must never be colour-alone. */
function renderLegend() {
  const swatches = stops(theme)
    .filter(([v]) => v % 100 === 0 || v === 0)
    .map(([v]) => `<span class="sw" style="background:${colorFor(v, theme)}" title="${describe(v)}"></span>`)
    .join('');
  $('#legend').innerHTML = `
    <span class="cap">early</span>${swatches}<span class="cap">late</span>
    <span class="sep"></span>
    <span class="sw ring"></span><span class="cap">too few samples</span>`;
}

function renderPanel(f: StopFeature | undefined) {
  if (!f) return;
  const { state: cellState, value } = readCell(f.properties, state.mode, state.hour);
  const now =
    cellState === 'no-service'
      ? 'no service scheduled this hour'
      : cellState === 'low-data'
        ? 'too few samples this hour'
        : describe(value!);
  $('#panel').innerHTML = `
    <button id="close" aria-label="Close">×</button>
    <h2>${escapeHtml(f.properties.name)}</h2>
    <p class="sub">${f.properties.routeTypes.includes(0) ? 'Tram' : 'Bus'} ·
      ${f.properties.platforms?.length ?? 1} platform(s) · at ${String(state.hour).padStart(2, '0')}:00 — <strong>${now}</strong></p>
    ${barChart(f.properties, state.mode, theme, state.hour)}
    <p class="note">Typical deviation by hour, ${state.mode === 'wd' ? 'weekdays' : 'weekends'}.
      Below the line = early. Flat hairline = too few samples to say.</p>
    ${renderLines(f)}`;
  $('#close').addEventListener('click', () => {
    state.selected = null;
    state.route = null;
    $('#panel').innerHTML = '';
  });
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-route]')) {
    el.addEventListener('click', () => {
      state.route = state.route === el.dataset.route ? null : (el.dataset.route ?? null);
      writeUrl();
      renderPanel(f);
    });
  }
}

/**
 * The lines through this stop, and what happens along each one's path.
 *
 * This is the question the map cannot answer: a red dot says the vehicle is
 * late here, not whether it arrived late or got late on the way. Deliberately
 * placed under the hour chart, because it is a drill-down from "this stop" — not
 * a competing headline.
 */
function renderLines(f: StopFeature): string {
  if (!routeFile) return '';
  const platforms = f.properties.platforms ?? [String(f.id)];
  const seen = new Set<string>();
  const lines: RouteEntry[] = [];
  for (const p of platforms) {
    for (const r of routesAtStop.get(p) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      lines.push(r);
    }
  }
  if (!lines.length) return `<p class="note">No line pattern in the schedule touches this stop.</p>`;

  lines.sort((a, b) => b.trips - a.trips);
  const shown = lines.slice(0, 12);
  // Both directions of a line reach the same stop, and they routinely disagree —
  // 110 accumulates towards Botinec and is flat coming back. Two chips reading
  // "110" would make the reader hover to find out which is which, so the
  // headsign is shown wherever a name appears twice.
  const duplicated = new Set(shown.filter((r, i) => shown.findIndex((o) => o.name === r.name) !== i).map((r) => r.name));
  const chips = shown
    .map((r) => {
      const d = diagnose(r, state.mode, state.hour);
      const headway = r[state.mode === 'wd' ? 'wdHeadway' : 'weHeadway'][state.hour];
      const mark = d.kind === 'accumulating' ? '↗' : d.kind === 'shedding' ? '↘' : d.kind === 'flat' ? '→' : '·';
      const label = duplicated.has(r.name) ? `${r.name} → ${truncate(r.headsign || `dir ${r.direction}`, 12)}` : r.name;
      return `<button class="chip${state.route === r.id ? ' on' : ''}" data-route="${r.id}"
        title="${escapeHtml(routeLabel(r))}${headway ? ` — about every ${headway} min` : ''}">${mark} ${escapeHtml(label)}</button>`;
    })
    .join('');

  const active = lines.find((r) => r.id === state.route);
  return `
    <h3 class="lines-h">Lines through here</h3>
    <div class="chips">${chips}</div>
    ${active ? renderRoute(active, platforms) : `<p class="note">Pick a line to see what its whole path does at this hour.</p>`}`;
}

function renderRoute(r: RouteEntry, stationPlatforms: string[]): string {
  const d = diagnose(r, state.mode, state.hour);
  const here = r.stops.find((s) => stationPlatforms.includes(s));
  const headway = r[state.mode === 'wd' ? 'wdHeadway' : 'weHeadway'][state.hour];
  const mins = (s: number) => `${(Math.abs(s) / 60).toFixed(1)} min`;

  // Each verdict states what it rests on. "Noisy" is a real answer, not a
  // failure to compute one — it means position along the route does not predict
  // deviation here, and no trend may be claimed.
  const verdict =
    d.kind === 'no-fit'
      ? `<strong>Not enough of this path has data</strong> at this hour to say anything about its shape.`
      : d.kind === 'noisy'
        ? `<strong>No trend along the path.</strong> Deviation drifts about ${mins(d.total)} end to end, but how far
           along you are does not explain it (fit quality ${d.r2.toFixed(2)} — too low to quote a trend). Scatter,
           not accumulation.`
        : d.kind === 'flat'
          ? // Flat is not automatically bad news. A line that is flat AND on time is
            // simply working, and calling that "a miscalibrated timetable" would
            // libel the best-run routes on the network.
            Math.abs(d.mean) <= 60
            ? `<strong>Runs to schedule the whole way</strong> — typically ${describe(d.mean)}, and it does not drift
               along the path. This is what a line that works looks like.`
            : `<strong>Off by the same amount the whole way</strong> — typically ${describe(d.mean)}, end to end.
               Vehicles are not losing time along this path; they are off-schedule for its entire length, which is
               what a miscalibrated timetable looks like rather than congestion.`
          : d.kind === 'accumulating'
            ? `<strong>Deviation builds up along the path</strong> — about ${mins(d.total)} more late by the terminus
               than at the origin (${d.slope.toFixed(0)} s per stop, fit quality ${d.r2.toFixed(2)}). This is traffic
               eating the route as it goes, not a timetable error.`
            : `<strong>Runs further ahead as it goes</strong> — about ${mins(d.total)} earlier by the terminus
               (${d.slope.toFixed(0)} s per stop, fit quality ${d.r2.toFixed(2)}).`;

  // The corridor caveat is shown, never buried: only ~14 of 250 paths are
  // mostly-exclusive, so for most of them this profile is every line through
  // those platforms, and saying otherwise would be a claim the data cannot make.
  const scope =
    r.exclusiveShare >= EXCLUSIVE_IS_LINE
      ? `${r.exclusiveShare}% of these stops are served only by this line, so this really is line ${escapeHtml(r.name)}.`
      : `Only ${r.exclusiveShare}% of these stops are served by this line alone — elsewhere the number includes
         every line through the same platform. Read this as the <em>corridor</em> this line runs along, not as
         line ${escapeHtml(r.name)} by itself.`;

  return `
    <div class="route">
      <p class="sub">${escapeHtml(routeLabel(r))} · ${r.stops.length} stops${headway ? ` · about every ${headway} min at this hour` : ''}</p>
      ${platforms ? routeProfile(r, platforms, state.mode, theme, state.hour, here) : '<p class="note tiny">Loading stop detail…</p>'}
      <p class="note">${verdict}</p>
      <p class="note tiny">${scope}${r.patternShare < 80 ? ` Only ${r.patternShare}% of its trips follow this exact stop pattern.` : ''}</p>
    </div>`;
}

const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/**
 * "26 s early", not describe()'s "on time (-26 s)". The deadband wrapper reads
 * right on a chart label and clumsy mid-sentence.
 */
const plainDeviation = (v: number) => {
  const abs = Math.abs(v);
  const unit = abs >= 90 ? `${(abs / 60).toFixed(1)} min` : `${Math.round(abs)} s`;
  return `${unit} ${v < 0 ? 'early' : 'late'}`;
};

void maplibregl;
main();
