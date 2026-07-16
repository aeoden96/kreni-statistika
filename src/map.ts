/**
 * The map layer.
 *
 * Graduated circles, not a heat layer: the data is point data (stops), and the
 * interesting answer is *which stop* — a blur destroys exactly that.
 *
 * Three cell states render as three different things, because conflating them
 * is what makes a data map lie:
 *   value       — a coloured circle on the diverging scale
 *   low-data    — a hollow ring: we looked, we don't have enough to say
 *   no-service  — nothing scheduled. At 03h that is 85% of stops, so an empty
 *                 night map is the truth, not a bug.
 */

import maplibregl, { type Map as MLMap, type MapGeoJSONFeature } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import { basemapLayers, basemapUrl, BASEMAP_ATTRIBUTION, SOURCE as BASEMAP } from './basemap';
import { readCell, type DayMode, type StopCollection, type StopFeature } from './data';
import { colorExpression, ink, type Mode } from './scale';

const SOURCE = 'stations';
const ZAGREB: [number, number] = [15.9819, 45.815];

/**
 * Bounds of the baked basemap extract, padded around every ZET stop — including
 * the suburban ones 27 km out. Panning past this shows blank tiles, so the map
 * is fenced to what actually exists.
 */
const BOUNDS: [number, number, number, number] = [15.743, 45.547, 16.259, 45.966];

/**
 * `pmtiles://` teaches MapLibre to range-request a single archive instead of
 * hitting a tile server. Registered once per page, not per map.
 */
let protocolRegistered = false;
function registerProtocol(): void {
  if (protocolRegistered) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  protocolRegistered = true;
}

/** Values the map reads per feature, recomputed when hour/day changes. */
interface RenderProps {
  deviation: number;
  name: string;
  routeTypes: number[];
  state: string;
  v: number;
}

export type FilterMode = 'all' | 'tram' | 'bus';

export class DelayMap {
  private map: MLMap;
  private data: StopCollection | null = null;
  private mode: Mode;
  private onSelect: (id: string) => void;

  constructor(container: HTMLElement, mode: Mode, onSelect: (id: string) => void) {
    this.mode = mode;
    this.onSelect = onSelect;
    const c = ink(mode);
    registerProtocol();
    this.map = new maplibregl.Map({
      style: {
        glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
        layers: [{ id: 'bg', paint: { 'background-color': c.surface }, type: 'background' }, ...basemapLayers(mode)],
        sources: {
          [BASEMAP]: {
            attribution: BASEMAP_ATTRIBUTION,
            type: 'vector',
            url: `pmtiles://${basemapUrl()}`,
          },
        },
        version: 8,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      container,
      center: ZAGREB,
      zoom: 11,
      // The archive stops at z15; MapLibre overzooms past it, so street-level
      // detail still resolves rather than hitting a wall.
      maxZoom: 17,
      minZoom: 9,
      maxBounds: [
        [BOUNDS[0], BOUNDS[1]],
        [BOUNDS[2], BOUNDS[3]],
      ],
      attributionControl: false,
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(
      new maplibregl.AttributionControl({
        customAttribution: 'Schedule: ZET GTFS · Punctuality: kreni.app collector',
      }),
    );
  }

  async ready(): Promise<void> {
    if (this.map.loaded()) return;
    await new Promise<void>((resolve) => this.map.on('load', () => resolve()));
  }

  setData(data: StopCollection): void {
    this.data = data;
    const c = ink(this.mode);
    this.map.addSource(SOURCE, { data: { features: [], type: 'FeatureCollection' }, type: 'geojson' });

    // Painted bottom-up: no-service is omitted entirely, low-data recedes,
    // values sit on top — the reading order the eye should follow.
    this.map.addLayer({
      filter: ['==', ['get', 'state'], 'low-data'],
      id: 'low-data',
      paint: {
        'circle-color': 'transparent',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
        'circle-stroke-color': c.muted,
        'circle-stroke-opacity': 0.5,
        'circle-stroke-width': 1,
      },
      source: SOURCE,
      type: 'circle',
    });
    this.map.addLayer({
      filter: ['==', ['get', 'state'], 'value'],
      id: 'value',
      paint: {
        'circle-color': colorExpression(this.mode, 'v') as never,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 13, 7, 16, 12],
        // A 2px surface ring keeps overlapping marks legible.
        'circle-stroke-color': c.surface,
        'circle-stroke-width': 1.5,
      },
      source: SOURCE,
      type: 'circle',
    });

    this.map.on('click', 'value', (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (f?.id != null) this.onSelect(String(f.id));
    });
    for (const layer of ['value', 'low-data']) {
      this.map.on('mouseenter', layer, () => (this.map.getCanvas().style.cursor = 'pointer'));
      this.map.on('mouseleave', layer, () => (this.map.getCanvas().style.cursor = ''));
    }
  }

  /**
   * Recompute each feature for the current hour/day and push it.
   *
   * Deliberately re-serialising rather than driving a MapLibre expression off
   * the raw arrays: `delay[]` contains nulls, and expression arithmetic on null
   * is a type error waiting to happen. 1,276 points is nothing to re-send.
   */
  render(mode: DayMode, hour: number, filter: FilterMode): void {
    if (!this.data) return;
    const features: GeoJSON.Feature<GeoJSON.Point, RenderProps>[] = [];
    for (const f of this.data.features as StopFeature[]) {
      if (!matchesFilter(f.properties.routeTypes, filter)) continue;
      const { state, value } = readCell(f.properties, mode, hour);
      if (state === 'no-service') continue;
      features.push({
        geometry: f.geometry,
        id: f.id as string,
        properties: {
          deviation: f.properties.deviation,
          name: f.properties.name,
          routeTypes: f.properties.routeTypes,
          state,
          v: value ?? 0,
        },
        type: 'Feature',
      });
    }
    const source = this.map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData({ features, type: 'FeatureCollection' });
  }

  /** Count of what is actually on screen — surfaced so sparse hours are honest. */
  counts(mode: DayMode, hour: number, filter: FilterMode) {
    const out = { lowData: 0, noService: 0, value: 0 };
    for (const f of (this.data?.features ?? []) as StopFeature[]) {
      if (!matchesFilter(f.properties.routeTypes, filter)) continue;
      const { state } = readCell(f.properties, mode, hour);
      if (state === 'value') out.value++;
      else if (state === 'low-data') out.lowData++;
      else out.noService++;
    }
    return out;
  }

  flyTo(feature: StopFeature): void {
    this.map.flyTo({ center: feature.geometry.coordinates as [number, number], zoom: 15 });
  }
}

/**
 * Exported so the boards filter exactly as the map does. Two copies of this rule
 * would eventually disagree, and a table contradicting the dots beside it is
 * worse than either alone.
 */
export const matchesFilter = (routeTypes: number[], filter: FilterMode): boolean =>
  filter === 'all' ? true : filter === 'tram' ? routeTypes.includes(0) : !routeTypes.includes(0);
