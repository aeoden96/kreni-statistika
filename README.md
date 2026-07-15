# statistika.kreni.app

**How punctual is ZET?** A standalone, statically-generated map of typical
schedule deviation for every stop in Zagreb's transit network, by hour and day.

Sibling to [kreni.app](https://kreni.app) (live vehicle tracking). This site is
the opposite: nothing live, everything historical. It makes **zero API calls at
runtime** — every hour × day combination is baked into a file, so the hour
slider reclassifies client-side with no refetch.

## The finding

The data measures **schedule adherence**, and the headline is not the one you'd
expect. Weighted by scheduled departures:

| | share | typical |
|---|---|---|
| **Early** | **57.1%** | 3.1 min early |
| On time (±60 s) | 23.2% | — |
| **Late** | **19.8%** | 3.2 min late |

Network mean: **−25.8 s**. ZET leaves early roughly three times as often as it
runs late. "Riders lose hours to delays" would be a comfortable headline; it is
also backwards, so this site doesn't run it.

An early departure is not a bonus. Arrive on time and it has already gone — so
the rankings weight **|deviation|**, counting early and late alike.

## Caveats worth reading before quoting the numbers

- **The hour axis is observation time, not due time.** The upstream collector
  buckets by *when it sampled*, using GTFS-Realtime *predicted* delays. For
  near-term predictions that is close to "vehicles due at hour H", but it is not
  identical — and some of the early skew may be prediction artifact rather than
  operations. The most extreme outliers (>20 min early, at thin suburban stops)
  are more likely artifact than reality.
- **Means only.** The upstream aggregate is a lossy `[sum, count]` per cell, so
  there are no percentiles, no "worst case" and no distribution.
- **~55% of cells are below the sample threshold** and show as "too few
  samples", not as zero. The map defaults to the weekday/weekend × parent-station
  view because it carries ~5× the samples of a single day at a single platform —
  that lifts 08h coverage from 36% to 79%.
- **"No data" ≠ "no service".** A hollow ring means too few samples; a stop that
  vanishes has nothing scheduled. At 03h, 85% of stops have no service, so an
  empty night map is correct.

## Running it

Data is produced by `yarn bake` in **kreni-core** (private — it holds the
pipeline). This repo is UI only.

```bash
yarn install
# from kreni-core: yarn bake  →  dist/congestion/
cp ../kreni-core/dist/congestion/* public/data/
yarn dev
```

Expected in `public/data/`:

| file | what |
|---|---|
| `stations.geojson` | parent-station rollup — the default map layer |
| `stops.geojson` | per-platform detail — the drill-down |
| `city-summary.json` | headline, city curves, leaderboards |

In production, kreni-core's deploy workflow bakes and injects these, mirroring
how it feeds the kreni.app frontend.

## The basemap

A single Protomaps `.pmtiles` archive, read over HTTP range requests — no tile
server, which is what keeps this site static. `VITE_BASEMAP_URL` points at it,
defaulting to `/data/zagreb.pmtiles` for local work:

```bash
# from kreni-core: yarn basemap  →  dist/basemap/zagreb.pmtiles (~35 MB)
cp ../kreni-core/dist/basemap/zagreb.pmtiles public/data/
```

In production it is served from R2 at `data.kreni.app`, **not** from Pages —
Pages caps a single file at 25 MiB. The size is storage, not bandwidth: a
visitor downloads only the tiles they look at.

The local copy is required rather than a convenience: R2's CORS is an allowlist
over the `kreni.app` zone, so `localhost` is refused. Two consequences —
`yarn dev` reads `public/data/zagreb.pmtiles`, and **`yarn preview` shows no
basemap at all**, because it serves a production bundle (which resolves to R2)
from localhost (which R2 blocks).

The flavour is restyled from the site's ink tokens rather than used as shipped,
and the rule it follows is that **hue is spent only on data**. Water is a
neutral gray, never blue, because blue means *early* here and the Sava runs
straight through the city; Protomaps' POI palette — which includes a `blue` and
a `red` — is flattened to muted ink for the same reason. See `src/basemap.ts`.

## Stack

Vite + TypeScript + MapLibre GL + PMTiles. No framework, no runtime backend.

The map needs WebGL; where it is unavailable the rankings render as tables
instead, which are also the accessible path to the same numbers.

## Licence

PolyForm Noncommercial 1.0.0 — see [LICENSE](./LICENSE).

Schedule data: ZET GTFS. Punctuality observations: the kreni.app collector.
