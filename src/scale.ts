/**
 * The diverging colour scale: early ← on-time → late.
 *
 * Diverging, not sequential, because the data has polarity: a value's sign is
 * the whole story. Blue = early, neutral gray = on time, red = late — warm/cool
 * poles that read as opposite, with a gray (never a hue) midpoint so "on time"
 * reads as *nothing*.
 *
 * The arms are matched **step-for-step in both lightness and chroma** (derived
 * in OKLab: max ΔL 0.001, chroma equal to 3dp). That symmetry is not decoration.
 * 57% of this network's departures are early and 19% are late, so an arm that
 * shouted louder than the other would put a thumb on the scale of the one claim
 * the site exists to make. Neither arm is allowed to dominate by styling; the
 * data does that on its own.
 *
 * Blue arm steps are the design system's documented sequential blue ramp, used
 * unchanged. The red arm is derived at the red pole's hue to match those steps.
 * Both modes are *selected*, not an automatic flip: dark mode holds a lighter
 * band so the darkest steps stay ≥2:1 on the dark surface.
 */

export type Mode = 'light' | 'dark';

/** value (seconds) → colour. Negative is early. */
type Stop = [number, string];

/**
 * ±300 s covers the bulk of the distribution (early mean −185 s, late mean
 * +194 s) and clamps the long tail, which reaches −1462 s. Without the clamp a
 * handful of outliers would flatten every real difference into the midpoint.
 */
export const DOMAIN_SECONDS = 300;

/** Matches city-summary.json's headline deadband, so map and stat agree. */
export const ON_TIME_DEADBAND_S = 60;

const LIGHT: Stop[] = [
  [-300, '#104281'],
  [-200, '#256abf'],
  [-120, '#3987e5'],
  [-60, '#86b6ef'],
  [0, '#f0efec'],
  [60, '#ea9a93'],
  [120, '#d75853'],
  [200, '#b13f3c'],
  [300, '#762221'],
];

const DARK: Stop[] = [
  [-300, '#1c5cab'],
  [-200, '#256abf'],
  [-120, '#3987e5'],
  [-60, '#86b6ef'],
  [0, '#383835'],
  [60, '#ea9a93'],
  [120, '#d75853'],
  [200, '#b13f3c'],
  [300, '#9e3432'],
];

export const stops = (mode: Mode): Stop[] => (mode === 'dark' ? DARK : LIGHT);

/** Chrome that is not the data: recessive by design. */
export const ink = (mode: Mode) =>
  mode === 'dark'
    ? { grid: '#2c2c2a', muted: '#898781', noService: '#2c2c2a', primary: '#ffffff', secondary: '#c3c2b7', surface: '#1a1a19' }
    : { grid: '#e1e0d9', muted: '#898781', noService: '#e1e0d9', primary: '#0b0b0b', secondary: '#52514e', surface: '#fcfcfb' };

/** A MapLibre `interpolate` expression over a numeric feature property. */
export const colorExpression = (mode: Mode, property: string): unknown[] => [
  'interpolate',
  ['linear'],
  ['get', property],
  ...stops(mode).flat(),
];

const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Same ramp, evaluated in JS — for the legend and the bar chart. */
export function colorFor(value: number, mode: Mode): string {
  const table = stops(mode);
  const v = Math.max(-DOMAIN_SECONDS, Math.min(DOMAIN_SECONDS, value));
  let lo = table[0];
  let hi = table[table.length - 1];
  for (let i = 0; i < table.length - 1; i++) {
    if (v >= table[i][0] && v <= table[i + 1][0]) {
      lo = table[i];
      hi = table[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const t = span === 0 ? 0 : (v - lo[0]) / span;
  const a = hexToRgb(lo[1]);
  const b = hexToRgb(hi[1]);
  const mix = a.map((c, i) => Math.round(c + (b[i] - c) * t));
  return `rgb(${mix.join(', ')})`;
}

/**
 * Plain-language label. Says "early"/"late" in words so colour is never the only
 * channel carrying the meaning.
 *
 * Inside the deadband it keeps one decimal: a punctuality ranking rendered as
 * ten identical rows of "on time (0 s)" tells the reader nothing, and hides
 * that the rows are genuinely ordered.
 */
export function describe(value: number): string {
  const abs = Math.abs(value);
  if (abs <= ON_TIME_DEADBAND_S) {
    const shown = abs < 10 ? value.toFixed(1) : value.toFixed(0);
    return `on time (${value > 0 ? '+' : ''}${shown} s)`;
  }
  const mins = abs >= 90 ? `${(abs / 60).toFixed(1)} min` : `${Math.round(abs)} s`;
  return value < 0 ? `${mins} early` : `${mins} late`;
}
