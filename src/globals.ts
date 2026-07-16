/**
 * Whole-week global rankings — at the very bottom, walled off from the
 * hour-scoped boards above.
 *
 * The page deliberately leads with hour-scoped boards: on this network the day
 * averages across a sign change, so a whole-week mean hides the very afternoon
 * that makes a stop notable (see `boards.ts`). These global boards are back only
 * as orientation and as something shareable — a first-time visitor with no hour
 * in mind, and a stable "worst overall" that does not move as the slider drags.
 * They are captioned as whole-week context so they never compete with the
 * primary boards.
 *
 * ## The honesty floor is not optional
 *
 * The baked leaderboards are sorted by raw mean with no real sample floor, so
 * `mostEarly`/`mostLate` arrive noise-first: their top rows are stops measured in
 * a handful of hours — "Jačkovina 46, 24 min early on 116 samples" is the single
 * most prominent lie the old site ever told. A mean is only as good as its
 * weight, exactly as in `boards.ts`, so nothing is drawn here without both a
 * sample floor and a weekly-service floor. That knocks the junk off every board
 * and leaves the honest tail.
 */

import type { LeaderboardRow } from './data';
import { colorFor, describe, type Mode } from './scale';

const escape = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

/** Observations behind a whole-week mean before it may be ranked globally. */
export const GLOBAL_MIN_SAMPLES = 500;

/** Scheduled departures across the reference week. Drops near-dead stops. */
export const GLOBAL_MIN_DEPARTURES = 100;

export const GLOBAL_BOARD_SIZE = 10;

const eligible = (rows: LeaderboardRow[]): LeaderboardRow[] =>
  rows.filter((r) => r.samples >= GLOBAL_MIN_SAMPLES && r.weeklyDepartures >= GLOBAL_MIN_DEPARTURES);

/** The board's fourth column: what the ranking is really weighted by. */
interface Weight {
  head: string;
  cell: (r: LeaderboardRow) => string;
}

/** Weekly departures — the service behind a mean-ranked board. */
const depCol: Weight = { head: 'Dep/wk', cell: (r) => r.weeklyDepartures.toLocaleString('en') };

/**
 * Total rider-facing deviation, hours per week (|deviation| × departures). This
 * IS the sort key for the burden board, so it must be visible — otherwise a busy
 * stop at −3 min ranks above a quiet one at +10 min with no shown reason.
 */
const burdenCol: Weight = { head: 'Hrs off/wk', cell: (r) => Math.round(r.deviationHours).toLocaleString('en') };

const rowsHtml = (list: LeaderboardRow[], theme: Mode, weight: Weight): string =>
  list
    .map(
      (r, i) => `<tr class="pick" data-stop="${escape(r.stopId)}" title="${escape(r.name)} — ${r.samples.toLocaleString('en')} observations, ${r.weeklyDepartures.toLocaleString('en')} departures/week">
        <td class="rank">${i + 1}</td>
        <td>${escape(r.name)}</td>
        <td class="num"><span class="dot" style="background:${colorFor(r.meanSeconds, theme)}"></span>${describe(r.meanSeconds)}</td>
        <td class="num">${weight.cell(r)}</td>
      </tr>`,
    )
    .join('');

const board = (title: string, blurb: string, weight: Weight, list: LeaderboardRow[], theme: Mode): string => {
  const rows = rowsHtml(eligible(list).slice(0, GLOBAL_BOARD_SIZE), theme, weight);
  if (!rows) return '';
  return `<section class="board">
      <h3>${title}</h3>
      <p class="note">${blurb}</p>
      <div class="scroll">
        <table><thead><tr><th></th><th>Stop</th><th class="num">Typical</th><th class="num">${weight.head}</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    </section>`;
};

/**
 * Render the four whole-week boards. Independent of hour/day/filter — the baked
 * leaderboards carry no vehicle type, so this is the whole network, by design.
 */
export function globalBoards(leaderboards: Record<string, LeaderboardRow[]>, theme: Mode): string {
  return (
    board(
      'Latest all week',
      'The stops running furthest behind schedule averaged over the whole week.',
      depCol,
      leaderboards.mostLate ?? [],
      theme,
    ) +
    board(
      'Earliest all week',
      'The stops most often ahead of schedule. Whether that costs you the vehicle depends on if it waits — which this data cannot say.',
      depCol,
      leaderboards.mostEarly ?? [],
      theme,
    ) +
    board(
      'Most time off schedule',
      'Ranked by total deviation across all its service, not by its average — busy stops with a persistent offset, where the timetable misses by the most rider-minutes.',
      burdenCol,
      leaderboards.leastReliable ?? [],
      theme,
    ) +
    board(
      'Closest to schedule all week',
      'The stops that simply work, week in and week out — busiest first among equals.',
      depCol,
      leaderboards.mostPunctual ?? [],
      theme,
    )
  );
}
