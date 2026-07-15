/**
 * The table view.
 *
 * Present for three reasons, any one of which would justify it:
 *   - MapLibre needs WebGL; without it the map is a blank box, and a blank box
 *     that explains nothing is the worst possible failure.
 *   - A chart must never be the only way to reach its numbers.
 *   - "Which stops are worst" is a ranking question — a table answers it better
 *     than a map does, and it is what search engines can actually read.
 *
 * Ranked by |deviation| x departures, so early and late both count: the point
 * is where the schedule cannot be trusted, in either direction.
 */

import type { CitySummary, LeaderboardRow } from './data';
import { colorFor, describe, type Mode } from './scale';

const BOARDS: { key: string; title: string; blurb: string }[] = [
  {
    blurb: 'Ranked by total schedule deviation across scheduled departures — early and late alike.',
    key: 'leastReliable',
    title: 'Where the schedule is least trustworthy',
  },
  { blurb: 'Stops running furthest ahead of schedule. Arrive on time and it has gone.', key: 'mostEarly', title: 'Runs earliest' },
  { blurb: 'Stops running furthest behind schedule.', key: 'mostLate', title: 'Runs latest' },
  { blurb: 'Closest to schedule, weighted by how much service they carry.', key: 'mostPunctual', title: 'Most punctual' },
];

/**
 * Four columns, not five. Sample count is a confidence signal, not something a
 * reader ranks by, so it rides in the row tooltip — five columns across four
 * boards clipped the rightmost one off the page entirely.
 */
const rows = (list: LeaderboardRow[], theme: Mode, limit: number) =>
  list
    .slice(0, limit)
    .map(
      (r, i) => `<tr title="${escape(r.name)} — ${r.samples.toLocaleString('en')} observations, ${r.weeklyDepartures.toLocaleString('en')} departures/week">
        <td class="rank">${i + 1}</td>
        <td>${escape(r.name)}</td>
        <td class="num">
          <span class="dot" style="background:${colorFor(r.meanSeconds, theme)}"></span>${describe(r.meanSeconds)}
        </td>
        <td class="num">${r.weeklyDepartures.toLocaleString('en')}</td>
      </tr>`,
    )
    .join('');

export function tableView(s: CitySummary, theme: Mode, limit = 15): string {
  return BOARDS.filter((b) => s.leaderboards[b.key]?.length).map(
    (b) => `
      <section class="board">
        <h3>${b.title}</h3>
        <p class="note">${b.blurb}</p>
        <div class="scroll">
          <table>
            <thead>
              <tr><th></th><th>Stop</th><th class="num">Typical</th><th class="num">Dep/wk</th></tr>
            </thead>
            <tbody>${rows(s.leaderboards[b.key], theme, limit)}</tbody>
          </table>
        </div>
      </section>`,
  ).join('');
}

const escape = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
