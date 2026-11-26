'use client';

import { useEffect, useRef } from 'react';
import { geoCentroid, geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import countries from 'i18n-iso-countries';
import world from 'world-atlas/countries-110m.json';
import { useTheme } from 'next-themes';

const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const shapes = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>;
const graticule = geoGraticule10();

/**
 * A slowly spinning 3D globe. Countries with people glow from indigo to pink by count, each with a pulsing beacon.
 * Drag to turn it. Suppressed countries are tinted lightly, without a beacon. Stops spinning under reduced motion.
 */
export function SpinningGlobe({ values, size = 300 }: { values: { key: string; value: number | null }[]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  const valueKey = values.map((v) => `${v.key}:${v.value}`).join();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dark = resolvedTheme === 'dark';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const byNum = new Map<string, number | null>();
    for (const v of values) {
      const n = countries.alpha2ToNumeric(v.key.toUpperCase());
      if (n) byNum.set(n.padStart(3, '0'), v.value);
    }
    const shown = [...byNum.values()].filter((v): v is number => v !== null);
    const max = Math.max(1, ...shown);
    const lit = shapes.features
      .filter((f) => byNum.has(String(f.id)))
      .map((f) => ({ f, v: byNum.get(String(f.id)) ?? null, c: geoCentroid(f as Feature) }));

    const r = size / 2 - 6;
    const proj = geoOrthographic().scale(r).translate([size / 2, size / 2]).clipAngle(90).precision(0.5);
    const path = geoPath(proj, ctx);
    let lambda = -20;
    let phi = -18;
    let dragging = false;
    let last: [number, number] | null = null;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const mix = (t: number) => {
      // indigo → violet → pink
      const a = [99, 102, 241];
      const b = [168, 85, 247];
      const c = [236, 72, 153];
      const [p, q, u] = t < 0.5 ? [a, b, t * 2] : [b, c, (t - 0.5) * 2];
      return `rgb(${p.map((x, i) => Math.round(x + (q[i]! - x) * u)).join(',')})`;
    };

    let raf = 0;
    const draw = (time: number) => {
      ctx.clearRect(0, 0, size, size);
      proj.rotate([lambda, phi]);
      // ocean sphere with a lit edge
      const g = ctx.createRadialGradient(size * 0.38, size * 0.32, r * 0.1, size / 2, size / 2, r);
      g.addColorStop(0, dark ? '#1e2a52' : '#ffffff');
      g.addColorStop(1, dark ? '#0b1330' : '#dfe6ff');
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      path(graticule);
      ctx.strokeStyle = dark ? 'rgba(148,163,255,0.12)' : 'rgba(79,91,213,0.1)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      // land
      ctx.beginPath();
      for (const f of shapes.features) path(f);
      ctx.fillStyle = dark ? '#26335c' : '#c9d3f5';
      ctx.fill();
      for (const { f, v } of lit) {
        ctx.beginPath();
        path(f);
        ctx.fillStyle = v === null ? (dark ? '#3b3f7a' : '#ddd6fe') : mix(Math.sqrt(v / max));
        ctx.fill();
      }
      ctx.beginPath();
      for (const f of shapes.features) path(f);
      ctx.strokeStyle = dark ? 'rgba(8,13,26,0.6)' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // beacons on the visible side
      const rot = proj.rotate();
      for (const { c, v } of lit) {
        if (v === null) continue;
        const dot = proj(c);
        if (!dot) continue;
        // hide points on the far side of the globe
        if (geoDistance(c, [-rot[0], -rot[1]]) > Math.PI / 2 - 0.05) continue;
        const base = 2.5 + 4 * Math.sqrt(v / max);
        const pulse = still ? 0 : (time / 1400 + c[0] / 90) % 1;
        ctx.beginPath();
        ctx.arc(dot[0], dot[1], base + pulse * 10, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(236,72,153,${0.35 * (1 - pulse)})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dot[0], dot[1], base, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dot[0], dot[1], base - 1.3, 0, Math.PI * 2);
        ctx.fillStyle = mix(Math.sqrt(v / max));
        ctx.fill();
      }
      // specular highlight
      const h = ctx.createRadialGradient(size * 0.34, size * 0.28, 0, size * 0.34, size * 0.28, r * 0.9);
      h.addColorStop(0, dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.45)');
      h.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.fillStyle = h;
      ctx.fill();
      if (!dragging && !still) lambda += 0.12;
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const down = (e: PointerEvent) => {
      dragging = true;
      last = [e.clientX, e.clientY];
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging || !last) return;
      lambda += (e.clientX - last[0]) * 0.4;
      phi = Math.max(-60, Math.min(60, phi - (e.clientY - last[1]) * 0.4));
      last = [e.clientX, e.clientY];
      if (still) draw(0);
    };
    const up = () => {
      dragging = false;
      last = null;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- values are captured through valueKey
  }, [valueKey, resolvedTheme, size]);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <div
        className="absolute inset-[-8%] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.28),rgba(99,102,241,0.12)_45%,transparent_70%)] blur-xl"
        aria-hidden
      />
      <canvas
        ref={ref}
        style={{ width: size, height: size }}
        className="relative cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label="Globe of unique people by country. Drag to turn it."
      />
    </div>
  );
}
