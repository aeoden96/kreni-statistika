/**
 * The basemap: Protomaps PMTiles, restyled to get out of the way.
 *
 * A single `.pmtiles` archive read straight over HTTP range requests — no tile
 * server, which is the whole reason this pairs with a static site. The client
 * pulls only the tiles it looks at, so the archive's 35 MB is storage, not
 * bandwidth.
 *
 * The flavour is derived from the site's own ink tokens rather than used as
 * shipped, for two reasons:
 *
 *   - **Recessive by construction.** The basemap is chrome, not data. Protomaps'
 *     GRAYSCALE puts a #cccccc slab under the marks, which both fights the page
 *     surface and drags contrast off every circle on top of it. Here earth *is*
 *     the page surface, and the map reads as a faint line drawing.
 *   - **Water is never blue.** This is the one that matters. Blue means *early*
 *     on this map, and the Sava runs straight through Zagreb — a blue river
 *     would plant a 10 km early-coloured stripe across the middle of the
 *     evidence. Water is the darkest *neutral* instead, so it still reads as
 *     water by shape without borrowing the scale's meaning.
 *
 * Hue is spent only on data. Everything here is on the neutral axis.
 */

import { DARK, type Flavor, layers, WHITE } from '@protomaps/basemaps';
import type { LayerSpecification } from 'maplibre-gl';

import type { Mode } from './scale';

/**
 * Where the archive lives.
 *
 * Production reads it from R2, never from Pages: Pages caps a single file at
 * 25 MiB and this is ~35 MB. R2 is already public at data.kreni.app, already
 * answers range requests, and already reflects CORS — verified 2026-07-15.
 *
 * Dev prefers a local copy so `yarn dev` works offline and doesn't hammer
 * production. That copy lives in `public/data/`, which is gitignored — and
 * vite.config.ts deletes any `.pmtiles` from `dist/`, so a stray local copy can
 * never ride along into a Pages deploy and break it.
 */
const R2_BASEMAP = 'https://data.kreni.app/basemap/zagreb.pmtiles';

export const basemapUrl = (): string =>
  import.meta.env.VITE_BASEMAP_URL || (import.meta.env.DEV ? '/data/zagreb.pmtiles' : R2_BASEMAP);

/** Required by OSM's licence, and by Protomaps'. Not optional. */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>';

export const SOURCE = 'basemap';

/**
 * Neutral ramps, lightest → darkest, spanning surface to water. Ordering is the
 * point: earth is the page, buildings lift slightly, roads draw the network, and
 * water anchors the bottom so rivers and lakes stay legible as shapes.
 */
const LIGHT_BASE = { building: '#f4f3ee', earth: '#fcfcfb', road: '#e6e4dd', water: '#dedcd4' };
const DARK_BASE = { building: '#232322', earth: '#1a1a19', road: '#2c2c2a', water: '#333331' };

/** Ink for the basemap's own labels — muted, never competing with the marks. */
const LIGHT_TEXT = { halo: '#fcfcfb', major: '#52514e', minor: '#898781' };
const DARK_TEXT = { halo: '#1a1a19', major: '#c3c2b7', minor: '#898781' };

function flavor(mode: Mode): Flavor {
  const base = mode === 'dark' ? DARK_BASE : LIGHT_BASE;
  const text = mode === 'dark' ? DARK_TEXT : LIGHT_TEXT;
  const { building, earth, road, water } = base;

  // Landuse polygons collapse into earth. Parks and schools tinted apart from
  // one another is detail this map never asks a question about, and each extra
  // shade is one more thing competing with a circle for attention.
  const landuse = {
    aerodrome: earth,
    beach: earth,
    glacier: earth,
    hospital: earth,
    industrial: earth,
    military: earth,
    park_a: earth,
    park_b: earth,
    pedestrian: earth,
    sand: earth,
    school: earth,
    scrub_a: earth,
    scrub_b: earth,
    wood_a: earth,
    wood_b: earth,
    zoo: earth,
  };

  // Casings are the outline a road is drawn with. Set to earth they vanish,
  // leaving a single flat stroke instead of the usual road-atlas double line.
  const casings = {
    bridges_highway_casing: earth,
    bridges_link_casing: earth,
    bridges_major_casing: earth,
    bridges_minor_casing: earth,
    bridges_other_casing: earth,
    highway_casing_early: earth,
    highway_casing_late: earth,
    link_casing: earth,
    major_casing_early: earth,
    major_casing_late: earth,
    minor_casing: earth,
    minor_service_casing: earth,
    tunnel_highway_casing: earth,
    tunnel_link_casing: earth,
    tunnel_major_casing: earth,
    tunnel_minor_casing: earth,
    tunnel_other_casing: earth,
  };

  const roads = {
    bridges_highway: road,
    bridges_link: road,
    bridges_major: road,
    bridges_minor: road,
    bridges_other: road,
    highway: road,
    link: road,
    major: road,
    minor_a: road,
    minor_b: road,
    minor_service: road,
    other: road,
    pier: road,
    // Rail sits with the roads: this is a transit map, and the tram network
    // running along it is the one piece of basemap that earns its ink.
    railway: road,
    runway: road,
    tunnel_highway: road,
    tunnel_link: road,
    tunnel_major: road,
    tunnel_minor: road,
    tunnel_other: road,
  };

  const labels = {
    address_label: text.minor,
    address_label_halo: text.halo,
    city_label: text.major,
    city_label_halo: text.halo,
    country_label: text.minor,
    ocean_label: text.minor,
    roads_label_major: text.minor,
    roads_label_major_halo: text.halo,
    roads_label_minor: text.minor,
    roads_label_minor_halo: text.halo,
    state_label: text.minor,
    state_label_halo: text.halo,
    subplace_label: text.minor,
    subplace_label_halo: text.halo,
  };

  // POI labels ship as a small categorical palette — and two of its entries are
  // `blue` and `red`. On this map those are not decoration, they are the claim:
  // a red pharmacy pin or a blue park label is a stop-coloured mark that encodes
  // nothing. Every POI collapses to muted ink, so the only blue and the only red
  // on screen are data.
  const pois = {
    blue: text.minor,
    green: text.minor,
    lapis: text.minor,
    pink: text.minor,
    red: text.minor,
    slategray: text.minor,
    tangerine: text.minor,
    turquoise: text.minor,
  };

  // Natural Earth landcover, drawn at low zoom. Flattened to earth for the same
  // reason as landuse — and it is mostly out of range below minZoom anyway.
  const landcover = {
    barren: earth,
    farmland: earth,
    forest: earth,
    glacier: earth,
    grassland: earth,
    scrub: earth,
    urban_area: earth,
  };

  return {
    ...(mode === 'dark' ? DARK : WHITE),
    ...landuse,
    ...casings,
    ...roads,
    ...labels,
    background: earth,
    boundaries: text.minor,
    buildings: building,
    earth,
    landcover,
    pois,
    water,
  };
}

/**
 * Layers dropped outright. Both scatter numbers across the map that no one
 * riding a tram is looking for — road-reference shields ("1024", "10070") and
 * house numbers. They cost attention at exactly the zooms where the marks are
 * densest, and every one of them is a small thing competing with a circle.
 */
const OMIT = new Set(['address_label', 'roads_shields']);

/**
 * Basemap layers, in draw order, to sit beneath the data layers.
 *
 * `lang: 'hr'` so Zagreb's own place names render — this is a map of Zagreb for
 * the people who ride it.
 */
export const basemapLayers = (mode: Mode): LayerSpecification[] =>
  (layers(SOURCE, flavor(mode), { lang: 'hr' }) as LayerSpecification[]).filter((l) => !OMIT.has(l.id));
