import Link from 'next/link';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology, GeometryCollection } from 'topojson-specification';
import countries from 'i18n-iso-countries';
import world from 'world-atlas/countries-110m.json';

const W = 960;
const H = 470;
const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const shapes = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>;
const projection = geoEqualEarth().fitSize([W, H], shapes);
const path = geoPath(projection);
const PATHS = shapes.features.map((f) => ({ id: String(f.id ?? ''), name: f.properties.name, d: path(f) ?? '' }));

/** Server-rendered choropleth: shade by unique people, each country links to its drill-down. No client script. */
export function WorldMap({ values, selected, hrefFor }: { values: Record<string, number | null>; selected: string | null; hrefFor: (alpha2: string) => string }) {
  const byNumeric = new Map<string, { alpha2: string; v: number | null }>();
  for (const [alpha2, v] of Object.entries(values)) {
    const num = countries.alpha2ToNumeric(alpha2.toUpperCase());
    if (num) byNumeric.set(num.padStart(3, '0'), { alpha2, v });
  }
  const shown = [...byNumeric.values()].map((x) => x.v).filter((v): v is number => v !== null);
  const max = Math.max(1, ...shown);
  const min = Math.min(max, ...shown);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Unique people by country" className="h-auto w-full">
      {PATHS.map((p) => {
        const hit = byNumeric.get(p.id);
        const label = hit ? `${p.name} (${hit.alpha2.toUpperCase()}): ${hit.v === null ? 'fewer than the minimum shown' : `${hit.v} people`}` : p.name;
        const shade = hit ? (hit.v === null ? 0.18 : 0.3 + 0.7 * (max === min ? 1 : ((hit.v ?? 0) - min) / (max - min))) : 0;
        const shape = (
          <path
            d={p.d}
            className={hit ? 'fill-accent' : 'fill-surface-2'}
            fillOpacity={hit ? shade : 1}
            stroke="var(--color-border, #cbd5e1)"
            strokeWidth={hit && hit.alpha2 === selected ? 2 : 0.5}
          >
            <title>{label}</title>
          </path>
        );
        return hit ? (
          <Link key={p.id + p.name} href={hrefFor(hit.alpha2)} aria-label={label}>
            {shape}
          </Link>
        ) : (
          <g key={p.id + p.name}>{shape}</g>
        );
      })}
    </svg>
  );
}
