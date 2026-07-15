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

import { barChart } from './chart';
import { loadStations, loadSummary, readCell, type CitySummary, type DayMode, type StopCollection, type StopFeature } from './data';
import { DelayMap, type FilterMode } from './map';
import { tableView } from './table';
import { colorFor, describe, stops, type Mode } from './scale';
import './style.css';

const theme: Mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const state = { filter: 'all' as FilterMode, hour: 8, mode: 'wd' as DayMode, selected: null as string | null };

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

async function main() {
  document.documentElement.dataset.theme = theme;
  let stations: StopCollection;
  let summary: CitySummary;
  try {
    [stations, summary] = await Promise.all([loadStations(), loadSummary()]);
  } catch (err) {
    $('#app').innerHTML = `<div class="error"><strong>No data.</strong><br>${(err as Error).message}</div>`;
    return;
  }

  renderHeadline(summary);
  renderLegend();
  $('#tables').innerHTML = tableView(summary, theme);

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

  const draw = () => {
    map.render(state.mode, state.hour, state.filter);
    const c = map.counts(state.mode, state.hour, state.filter);
    $('#hour-label').textContent = `${String(state.hour).padStart(2, '0')}:00`;
    // Say out loud how much is actually shown. ~55% of cells are below the
    // sample threshold, and a map that hides that reads as more authoritative
    // than the data earns.
    $('#coverage').textContent =
      `${c.value} stations shown · ${c.lowData} too few samples · ${c.noService} no service scheduled`;
    if (state.selected) renderPanel(byId.get(state.selected));
  };

  const select = (id: string) => {
    state.selected = id;
    renderPanel(byId.get(id));
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

  draw();
}

function renderHeadline(s: CitySummary) {
  const d = s.headline.byDepartureShare;
  // Lead with the finding, not a vanity number: the network runs early.
  $('#headline').innerHTML = `
    <h1>How punctual is ZET?</h1>
    <p class="lede">Weighted by scheduled departures, <strong>${d.early}% of departures run early</strong>,
      ${d.onTime}% on time and ${d.late}% late. Typical early departure:
      <strong>${describe(s.headline.meanEarlySeconds ?? 0)}</strong>; typical late one:
      <strong>${describe(s.headline.meanLateSeconds ?? 0)}</strong>.</p>
    <p class="note">An early tram is not a bonus — arrive on time and it has already gone.
      Network mean ${s.headline.netMeanSeconds} s (negative = early).
      Based on ${(s.source.totalSamples ?? 0).toLocaleString('en')} observations across
      ${s.coverage.stationsMapped.toLocaleString('en')} stations; schedule from ZET feed
      ${s.gtfs.feedVersion}, reference week ${Object.values(s.gtfs.referenceWeek).sort()[0]}.</p>`;
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
    <h2>${f.properties.name}</h2>
    <p class="sub">${f.properties.routeTypes.includes(0) ? 'Tram' : 'Bus'} ·
      ${f.properties.platforms?.length ?? 1} platform(s) · at ${String(state.hour).padStart(2, '0')}:00 — <strong>${now}</strong></p>
    ${barChart(f.properties, state.mode, theme, state.hour)}
    <p class="note">Typical deviation by hour, ${state.mode === 'wd' ? 'weekdays' : 'weekends'}.
      Below the line = early. Flat hairline = too few samples to say.</p>`;
  $('#close').addEventListener('click', () => {
    state.selected = null;
    $('#panel').innerHTML = '';
  });
}

const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

void maplibregl;
main();
