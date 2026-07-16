/**
 * The rankings, for the hour on the slider.
 *
 * Present for four reasons, any one of which would justify it:
 *   - MapLibre needs WebGL; without it the map is a blank box, and a blank box
 *     that explains nothing is the worst possible failure.
 *   - A chart must never be the only way to reach its numbers.
 *   - "Which stops are worst" is a ranking question — a table answers it better
 *     than a map does, and it is what search engines can actually read.
 *   - "Is *my* line bad?" is the question riders actually arrive with, and until
 *     the line board existed the site could not answer it at all.
 *
 * Everything here is scoped to one hour, deliberately. A whole-day average on
 * this network averages across a sign change — route 268 is +17 min at 16:00 and
 * roughly fine at 08:00, and the mean of those describes neither. Averaged, 268
 * appeared on no board at all.
 */

import { stopBoards, routeBoard, BOARD_MIN_SAMPLES, type BoardRow, type RouteRow } from './boards';
import type { DayMode, StopFeature } from './data';
import type { FilterMode } from './map';
import type { RouteFile } from './routes';
import { colorFor, describe, type Mode } from './scale';

const escape = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Sample count rides in the row tooltip: a confidence signal, not a sort key. */
const stopRows = (list: BoardRow[], theme: Mode) =>
  list
    .map(
      (r, i) => `<tr class="pick" data-stop="${escape(r.id)}" title="${escape(r.name)} — ${r.samples.toLocaleString('en')} observations, ${r.departures} departures this hour">
        <td class="rank">${i + 1}</td>
        <td>${escape(r.name)}</td>
        <td class="num"><span class="dot" style="background:${colorFor(r.deviation, theme)}"></span>${describe(r.deviation)}</td>
        <td class="num">${r.departures}</td>
      </tr>`,
    )
    .join('');

/**
 * The trend is an annotation, never the sort key. Only ~54 paths have a quotable
 * trend, while "how far off is this line right now" is well defined for every
 * path with coverage — and it is the question being asked.
 */
const routeRows = (list: RouteRow[], theme: Mode) =>
  list
    .map((r, i) => {
      const mark =
        r.d.kind === 'accumulating'
          ? '<span class="mark" title="Deviation builds up along this path — traffic, not the timetable">↗ builds up on the way</span>'
          : r.d.kind === 'shedding'
            ? '<span class="mark" title="Runs further ahead as it goes">↘ gains time on the way</span>'
            : r.d.kind === 'flat'
              ? '<span class="mark" title="Off by the same amount for its whole length — a timetable that does not match the road">→ off by the same all the way</span>'
              : '';
      return `<tr title="${escape(r.route.headsign)} — ${r.stops} stops with data${r.headway ? `, about every ${r.headway} min` : ''}">
        <td class="rank">${i + 1}</td>
        <td>${escape(r.route.name)} → ${escape(r.route.headsign || 'terminus')}${mark ? `<br><span class="tiny">${mark}</span>` : ''}</td>
        <td class="num"><span class="dot" style="background:${colorFor(r.mean, theme)}"></span>${describe(r.mean)}</td>
        <td class="num">${r.headway ? `${r.headway}′` : '—'}</td>
      </tr>`;
    })
    .join('');

const board = (title: string, blurb: string, head: 'Line' | 'Stop', rows: string) =>
  !rows
    ? ''
    : `<section class="board">
        <h3>${title}</h3>
        <p class="note">${blurb}</p>
        <div class="scroll">
          <table><thead><tr><th></th><th>${head}</th><th class="num">Typical</th><th class="num">${head === 'Line' ? 'Every' : 'Dep'}</th></tr></thead>
          <tbody>${rows}</tbody></table>
        </div>
      </section>`;

export function tableView(
  features: StopFeature[],
  routes: RouteFile | null,
  mode: DayMode,
  hour: number,
  theme: Mode,
  filter: FilterMode = 'all',
): string {
  const s = stopBoards(features, mode, hour);
  const lines = routes ? routeBoard(routes, mode, hour, filter) : [];
  const when = `${hh(hour)}, ${mode === 'wd' ? 'weekdays' : 'weekends'}`;

  if (!s.eligible) {
    return `<p class="note">Nothing is measured well enough to rank at ${when}. At night most stops have no service
      at all, which is not the same as no data.</p>`;
  }

  return (
    board(
      `Lines furthest off schedule at ${hh(hour)}`,
      'Ranked by how far from its timetable the whole line runs at this hour — early and late alike.',
      'Line',
      routeRows(lines.slice(0, 12), theme),
    ) +
    board(`Running latest at ${hh(hour)}`, `Stops behind schedule at ${when}.`, 'Stop', stopRows(s.late, theme)) +
    board(
      `Running earliest at ${hh(hour)}`,
      `Stops ahead of schedule at ${when}. Whether that costs you the vehicle depends on if it waits — which this data cannot say.`,
      'Stop',
      stopRows(s.early, theme),
    ) +
    board(`Closest to schedule at ${hh(hour)}`, `The stops that simply work at ${when}, busiest first among equals.`, 'Stop', stopRows(s.punctual, theme)) +
    `<p class="note tiny board-foot">Ranked across ${s.eligible.toLocaleString('en')} stations carrying at least
      ${BOARD_MIN_SAMPLES} observations in this hour. A mean built on fewer is not evidence — ranking without that
      floor is what once put a stop with two measured hours out of twenty-four at the top of this page.</p>`
  );
}
