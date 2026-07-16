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

import { readCell, type CityCurve, type DayMode, type StopProperties, type TrendWeek } from './data';
import { DOMAIN_SECONDS, colorFor, describe, ink, type Mode } from './scale';
import type { RouteEntry } from './routes';

const BAR_W = 11;
const GAP = 2;

/**
 * Labels get their own bands; the plot keeps the rest.
 *
 * A diverging chart has no spare corner. Every label used to be placed inside
 * the plot and collide with something: the hour ticks sat on the zero line at
 * exactly the x of their own hour, so "0h" was drawn *through* the midnight bar,
 * and the range captions sat in corners that late-evening bars reach. Reserving
 * CAP above and AXIS below makes overlap impossible by construction rather than
 * by hoping the data stays out of the way.
 */
const CAP = 12;
const AXIS = 14;
const PLOT = 114;
const H = CAP + PLOT + AXIS;
const MID = CAP + PLOT / 2;
/**
 * Right margin for the range captions, which are anchored to the viewBox edge.
 *
 * Measured, not guessed: "−3.6 min early" is 67.8 units wide and the "18h" tick
 * ends at 249.3, leaving 62.7 in a 312-unit box — a 5-unit overlap. Widening the
 * box keeps the wording intact; the alternative was truncating the label to fit.
 */
const PAD_R = 16;
/** Bars stop just short of the bands, so a clamped value still reads as clamped. */
const REACH = PLOT / 2 - 4;

/** Clamped so one −24 min outlier cannot flatten the other 23 bars. */
const y = (v: number) => (Math.max(-DOMAIN_SECONDS, Math.min(DOMAIN_SECONDS, v)) / DOMAIN_SECONDS) * REACH;

/** The hour ruler, in the bottom band. */
const hourTicks = (c: { muted: string }) =>
  [0, 6, 12, 18].map((h) => `<text x="${h * (BAR_W + GAP)}" y="${H - 3}" font-size="8" fill="${c.muted}">${h}h</text>`).join('');

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
    <svg viewBox="0 0 ${w + PAD_R} ${H}" width="100%" height="${H}" role="img"
         aria-label="Typical deviation from schedule by hour. Bars below the line are early, above are late.">
      <line x1="0" y1="${MID}" x2="${w + PAD_R}" y2="${MID}" stroke="${c.grid}" stroke-width="1"/>
      ${bars.join('')}
      <text x="${w + PAD_R}" y="9" font-size="9" fill="${c.muted}" text-anchor="end">late</text>
      <text x="${w + PAD_R}" y="${H - 3}" font-size="9" fill="${c.muted}" text-anchor="end">early</text>
      ${hourTicks(c)}
    </svg>`;
}

/**
 * The city's day: one bar per hour, departure-weighted.
 *
 * This is the site's actual argument, and until it existed the page could not
 * make it. The network is ~2 min ahead of schedule overnight and ~2 min late at
 * 16:00; averaging those gives "26 s early", which is true of the week and
 * describes no journey anyone takes. One glance at this shape and the headline
 * is unnecessary.
 *
 * Clickable: the chart is also the hour control, because having read "16:00 is
 * the worst" the obvious next move is to go there.
 */
export function cityCurve(curve: CityCurve, theme: Mode, activeHour: number): string {
  const c = ink(theme);
  const w = 24 * (BAR_W + GAP);
  const values = curve.mean.filter((v): v is number => v !== null);
  // Its own scale, like the route profile: the city curve peaks near +2 min and
  // the map's ±5 min clamp would squash the whole day into a flat smear.
  const span = Math.max(60, ...values.map(Math.abs));
  const scale = (v: number) => (v / span) * REACH;

  const bars = curve.mean.map((v, hour) => {
    const x = hour * (BAR_W + GAP);
    if (v === null) return `<rect x="${x}" y="${MID - 0.5}" width="${BAR_W}" height="1" fill="${c.muted}" opacity="0.45"/>`;
    const dy = scale(v);
    const top = v > 0 ? MID - dy : MID;
    const h = Math.max(2, Math.abs(dy));
    return (
      `<rect class="hbar" data-hour="${hour}" x="${x}" y="${top}" width="${BAR_W}" height="${h}" rx="2"` +
      ` fill="${colorFor(v, theme)}"${hour === activeHour ? ` stroke="${c.primary}" stroke-width="1.5"` : ''}>` +
      `<title>${String(hour).padStart(2, '0')}:00 — ${describe(v)} · ${curve.late[hour]}% of departures late</title></rect>`
    );
  });

  const cap = `${(span / 60).toFixed(1)} min`;
  return `
    <svg viewBox="0 0 ${w + PAD_R} ${H}" width="100%" height="${H}" role="img"
         aria-label="Typical deviation across the whole network by hour. Bars below the line are early, above are late.">
      <line x1="0" y1="${MID}" x2="${w + PAD_R}" y2="${MID}" stroke="${c.grid}" stroke-width="1"/>
      ${bars.join('')}
      <text x="${w + PAD_R}" y="9" font-size="9" fill="${c.muted}" text-anchor="end">+${cap} late</text>
      <text x="${w + PAD_R}" y="${H - 3}" font-size="9" fill="${c.muted}" text-anchor="end">−${cap} early</text>
      ${hourTicks(c)}
    </svg>`;
}

/**
 * The network over time: one bar per week, net deviation.
 *
 * The time-axis counterpart to `cityCurve` — same diverging form (below = early,
 * above = late), but the x-axis is weeks, not hours. Weekly and not daily on
 * purpose: a raw day-to-day line on this network mostly shows that Monday isn't
 * Sunday, which is seasonality, not a trend. Its own scale, because the net
 * weekly mean lives near ±1 min and the map's ±5 min clamp would flatten it.
 *
 * Bars are variable-width to fill the frame regardless of how many weeks exist,
 * so a young series (a handful of weeks) and a mature one both read cleanly.
 */
const monthDay = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
};

export function trendChart(weeks: TrendWeek[], theme: Mode): string {
  const c = ink(theme);
  const values = weeks.map((w) => w.netMeanSeconds).filter((v): v is number => v !== null);
  if (values.length === 0) return '';
  const span = Math.max(60, ...values.map(Math.abs));
  const scale = (v: number) => (v / span) * REACH;

  const n = weeks.length;
  // Fill a fixed frame: bar+gap sized to the count, capped so a 2-week series
  // doesn't render one absurdly wide bar.
  const W = 24 * (BAR_W + GAP); // same frame width as the city curve
  const slot = Math.min(28, W / n);
  const bw = Math.max(4, slot * 0.72);

  const bars = weeks.map((wk, i) => {
    const x = i * slot + (slot - bw) / 2;
    const v = wk.netMeanSeconds;
    if (v === null) return `<rect x="${x.toFixed(1)}" y="${MID - 0.5}" width="${bw.toFixed(1)}" height="1" fill="${c.muted}" opacity="0.45"/>`;
    const dy = scale(v);
    const top = v > 0 ? MID - dy : MID;
    const h = Math.max(2, Math.abs(dy));
    return (
      `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${colorFor(v, theme)}">` +
      `<title>Week of ${wk.weekStart} — ${describe(v)} · ${wk.samples.toLocaleString('en')} samples${wk.decayCrossing ? ' · spans a decay pass' : ''}</title></rect>`
    );
  });

  const cap = `${(span / 60).toFixed(1)} min`;
  // Scale captions live on the right; the "since" date sits bottom-left, where
  // it can't collide with them. Direction (older → newer) reads left to right.
  const since = `<text x="0" y="${H - 3}" font-size="8" fill="${c.muted}">since ${monthDay(weeks[0].weekStart)}</text>`;

  return `
    <svg viewBox="0 0 ${W + PAD_R} ${H}" width="100%" height="${H}" role="img"
         aria-label="Network net deviation from schedule by week, oldest on the left. Bars below the line are early, above are late.">
      <line x1="0" y1="${MID}" x2="${W + PAD_R}" y2="${MID}" stroke="${c.grid}" stroke-width="1"/>
      ${bars.join('')}
      <text x="${W + PAD_R}" y="9" font-size="9" fill="${c.muted}" text-anchor="end">+${cap} late</text>
      <text x="${W + PAD_R}" y="${H - 3}" font-size="9" fill="${c.muted}" text-anchor="end">−${cap} early</text>
      ${since}
    </svg>`;
}

/**
 * Deviation along a path, origin → terminus. The chart the map cannot draw.
 *
 * Dots, not bars, and a fitted line through them: position along the route is a
 * *continuum*, and the question is whether the trend is real — which is a shape
 * you read, not a number you're told. Where the fit is noise, the scatter shows
 * it and the reader can overrule the label.
 *
 * Stops with no data are simply absent. Drawing them at zero would invent an
 * on-time vehicle, which is the one lie this chart could tell.
 */
export function routeProfile(
  route: RouteEntry,
  byStop: Map<string, StopProperties>,
  mode: DayMode,
  theme: Mode,
  hour: number,
  highlight?: string,
): string {
  const c = ink(theme);
  const w = 320;
  const n = route.stops.length;
  const px = (i: number) => 4 + (i / Math.max(1, n - 1)) * (w - 8);

  const points: { i: number; name: string; shared: boolean; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    const props = byStop.get(route.stops[i]);
    const v = props?.[mode]?.[hour];
    if (v === null || v === undefined) continue;
    points.push({ i, name: props?.name ?? route.stops[i], shared: !route.exclusive[i], v });
  }

  /**
   * This chart sets its own scale, and must.
   *
   * The map clamps at ±5 min so a −24 min outlier cannot flatten the city. Reuse
   * that here and route 268 at 16:00 — every stop between +7 and +21 min late —
   * pins every dot to the ceiling and draws a flat line under a verdict reading
   * "builds up 13.4 min". The chart would contradict its own caption, and the
   * chart is the part people believe.
   *
   * The floor keeps a route that never leaves ±2 min from being magnified into a
   * drama by autoscaling.
   */
  const span = Math.max(120, ...points.map((p) => Math.abs(p.v)));
  const scale = (v: number) => (v / span) * REACH;

  const dots = points.map((p) => {
    const isHere = route.stops[p.i] === highlight;
    return (
      `<circle cx="${px(p.i).toFixed(1)}" cy="${(MID - scale(p.v)).toFixed(1)}" r="${isHere ? 5 : 3}"` +
      ` fill="${colorFor(p.v, theme)}" stroke="${isHere ? c.primary : c.surface}" stroke-width="${isHere ? 2 : 1}">` +
      `<title>${p.name} — ${describe(p.v)}${p.shared ? ' (shared with other lines)' : ''}</title></circle>`
    );
  });

  // The fitted line, drawn only where it is trustworthy. A trend line over
  // scatter is an assertion the data does not support.
  const slope = route[mode].slope[hour];
  const offset = route[mode].offset[hour];
  const r2 = route[mode].r2[hour];
  let trend = '';
  if (slope !== null && offset !== null && r2 !== null && r2 >= 0.5) {
    const y0 = MID - scale(offset);
    const y1 = MID - scale(offset + slope * (n - 1));
    trend = `<line x1="${px(0)}" y1="${y0.toFixed(1)}" x2="${px(n - 1)}" y2="${y1.toFixed(1)}"
      stroke="${c.secondary}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.8"/>`;
  }

  // Say what the scale is. Without it "the dots go up" has no magnitude, and the
  // axis silently changes between routes and hours.
  const cap = `${(span / 60).toFixed(span >= 120 ? 0 : 1)} min`;

  return `
    <svg viewBox="0 0 ${w} ${H}" width="100%" height="${H}" role="img"
         aria-label="Typical deviation along the route, origin on the left. Dots below the line are early, above are late.">
      <line x1="0" y1="${MID}" x2="${w}" y2="${MID}" stroke="${c.grid}" stroke-width="1"/>
      ${trend}
      ${dots.join('')}
      <text x="0" y="9" font-size="9" fill="${c.muted}">+${cap} late</text>
      <text x="0" y="${H - 3}" font-size="9" fill="${c.muted}">−${cap} early</text>
      <text x="${w}" y="${H - 3}" font-size="9" fill="${c.muted}" text-anchor="end">terminus →</text>
    </svg>`;
}
