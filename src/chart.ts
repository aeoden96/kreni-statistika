/**
 * The per-station drill-down: 24 hours of typical deviation.
 *
 * A "popular times"-style bar chart, but diverging about a zero baseline —
 * bars grow *down* for early and *up* for late, because the sign is the point.
 * A one-sided chart would hide that most bars go the same way (down).
 *
 * Bars are the right form: 24 discrete ordered buckets, magnitude per bucket.
 * Colour is redundant with direction here, which is deliberate — direction
 * carries the meaning for anyone who cannot separate the hues.
 */

import { readCell, type DayMode, type StopProperties } from './data';
import { DOMAIN_SECONDS, colorFor, describe, ink, type Mode } from './scale';

const H = 132;
const BAR_W = 11;
const GAP = 2;
const MID = H / 2;

/** Clamped so one −24 min outlier cannot flatten the other 23 bars. */
const y = (v: number) => (Math.max(-DOMAIN_SECONDS, Math.min(DOMAIN_SECONDS, v)) / DOMAIN_SECONDS) * (H / 2 - 8);

export function barChart(props: StopProperties, mode: DayMode, theme: Mode, activeHour: number): string {
  const c = ink(theme);
  const w = 24 * (BAR_W + GAP);
  const bars: string[] = [];

  for (let hour = 0; hour < 24; hour++) {
    const x = hour * (BAR_W + GAP);
    const { state, value } = readCell(props, mode, hour);
    if (state === 'no-service') continue;
    if (state === 'low-data' || value === null) {
      // A hairline on the baseline: we looked, we can't say. Not zero.
      bars.push(`<rect x="${x}" y="${MID - 0.5}" width="${BAR_W}" height="1" fill="${c.muted}" opacity="0.45"/>`);
      continue;
    }
    const dy = y(value);
    // Positive (late) grows up from the baseline; negative (early) grows down.
    const top = value > 0 ? MID - dy : MID;
    const h = Math.max(2, Math.abs(dy));
    bars.push(
      `<rect x="${x}" y="${top}" width="${BAR_W}" height="${h}" rx="2" fill="${colorFor(value, theme)}"` +
        `${hour === activeHour ? ` stroke="${c.primary}" stroke-width="1.5"` : ''}><title>${hour}:00 — ${describe(value)}</title></rect>`,
    );
  }

  return `
    <svg viewBox="0 0 ${w} ${H}" width="100%" height="${H}" role="img"
         aria-label="Typical deviation from schedule by hour. Bars below the line are early, above are late.">
      <line x1="0" y1="${MID}" x2="${w}" y2="${MID}" stroke="${c.grid}" stroke-width="1"/>
      ${bars.join('')}
      <text x="0" y="10" font-size="9" fill="${c.muted}">late</text>
      <text x="0" y="${H - 2}" font-size="9" fill="${c.muted}">early</text>
      ${[0, 6, 12, 18].map((h) => `<text x="${h * (BAR_W + GAP)}" y="${MID + 3}" font-size="8" fill="${c.muted}">${h}h</text>`).join('')}
    </svg>`;
}
