'use client';

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, CustomChart, LineChart, PieChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, PolarComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { CustomSeriesRenderItemAPI } from 'echarts';
import { useTheme } from 'next-themes';
import { BarChart3, Box, PieChart as PieIcon, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PANEL_TONES } from '@/lib/panel-tones';

echarts.use([
  BarChart,
  CustomChart,
  LineChart,
  PieChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  PolarComponent,
  TooltipComponent,
  SVGRenderer,
]);

const EXTRA: [string, string][] = [
  ['#f9a8d4', '#db2777'],
  ['#c4b5fd', '#7c3aed'],
  ['#fde047', '#ca8a04'],
];
const tone = (p: string, i: number) => PANEL_TONES[p] ?? EXTRA[i % EXTRA.length]!;
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useChart(option: (dark: boolean) => echarts.EChartsCoreOption, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' });
    const opt = option(resolvedTheme === 'dark');
    chart.setOption(reducedMotion() ? { ...opt, animation: false } : opt);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the option builder is rebuilt from deps
  }, [resolvedTheme, ...deps]);
  return ref;
}

const axis = (dark: boolean) => ({
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: dark ? '#7d89a6' : '#8a93ab', fontSize: 11 },
  splitLine: { lineStyle: { color: dark ? '#17213b' : '#edf0f8', type: 'dashed' as const } },
});
const tooltip = (dark: boolean) => ({
  backgroundColor: dark ? 'rgba(14,22,41,0.95)' : 'rgba(255,255,255,0.97)',
  borderColor: dark ? '#26314f' : '#e6eaf5',
  textStyle: { color: dark ? '#e8edf8' : '#1f2937', fontSize: 12 },
  extraCssText: 'border-radius:12px;box-shadow:0 12px 32px -12px rgba(30,41,90,.35);',
});

type Row = { month: string; panel: string; n: number };
type View = 'cubes' | 'trend' | 'mix';
const VIEWS: { key: View; label: string; Icon: typeof Box }[] = [
  { key: 'cubes', label: '3D columns', Icon: Box },
  { key: 'trend', label: 'Trend waves', Icon: TrendingUp },
  { key: 'mix', label: 'Panel mix', Icon: PieIcon },
];

/** Registrations per month, shown three ways: stacked 3D columns, flowing trend lines, or a rose of the panel mix. */
export function RegistrationsStudio({ rows, label }: { rows: Row[]; label: string }) {
  const [view, setView] = useState<View>('cubes');
  const months = [...new Set(rows.map((r) => r.month))].sort().slice(-18);
  const order = ['t2o', 'mfr', 'mho'];
  const panels = [
    ...order.filter((p) => rows.some((r) => r.panel === p)),
    ...[...new Set(rows.map((r) => r.panel))].filter((p) => !order.includes(p)),
  ];
  const val = (m: string, p: string) => rows.find((r) => r.month === m && r.panel === p)?.n ?? 0;
  const key = `${view}|${months.join()}|${rows.length}`;
  const ref = useChart(
    (dark) => {
      const base = {
        aria: { enabled: true, label: { description: label } },
        tooltip: { ...tooltip(dark), trigger: view === 'mix' ? 'item' : 'axis' },
        legend: {
          top: 0,
          right: 4,
          icon: 'roundRect',
          itemWidth: 12,
          itemHeight: 8,
          textStyle: { color: dark ? '#a5b0c8' : '#4a5670', fontSize: 12 },
          data: panels.map((p) => p.toUpperCase()),
        },
      };
      if (view === 'mix') {
        const totals = panels.map((p, i) => ({
          name: p.toUpperCase(),
          value: months.reduce((a, m) => a + val(m, p), 0),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
              { offset: 0, color: tone(p, i)[0] },
              { offset: 1, color: tone(p, i)[1] },
            ]),
            shadowBlur: 18,
            shadowOffsetY: 8,
            shadowColor: `${tone(p, i)[1]}66`,
            borderColor: dark ? '#0e1629' : '#fff',
            borderWidth: 3,
            borderRadius: 10,
          },
        }));
        return {
          ...base,
          series: [
            {
              type: 'pie',
              roseType: 'radius',
              radius: ['22%', '78%'],
              center: ['50%', '55%'],
              data: totals,
              label: { color: dark ? '#c7d0e4' : '#374151', fontSize: 12, formatter: '{b}\n{d}%' },
              labelLine: { length: 8, length2: 10, smooth: true },
              animationType: 'scale',
              animationEasing: 'elasticOut',
              animationDuration: 1600,
              animationDelay: (i: number) => i * 180,
            },
          ],
        };
      }
      if (view === 'trend') {
        return {
          ...base,
          grid: { left: 40, right: 12, top: 36, bottom: 26 },
          xAxis: { type: 'category', boundaryGap: false, data: months, ...axis(dark) },
          yAxis: { type: 'value', ...axis(dark) },
          series: panels.map((p, i) => ({
            name: p.toUpperCase(),
            type: 'line',
            smooth: 0.45,
            symbol: 'circle',
            symbolSize: 7,
            showSymbol: false,
            emphasis: { focus: 'series' },
            lineStyle: { width: 3, color: tone(p, i)[1], shadowBlur: 12, shadowColor: `${tone(p, i)[1]}88`, shadowOffsetY: 6 },
            itemStyle: { color: tone(p, i)[1], borderColor: '#fff', borderWidth: 2 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: `${tone(p, i)[0]}66` },
                { offset: 1, color: `${tone(p, i)[0]}00` },
              ]),
            },
            data: months.map((m) => val(m, p)),
            animationDuration: 1800,
            animationEasing: 'cubicOut',
            animationDelay: i * 250,
          })),
        };
      }
      // 3D columns: each month is a stack of cuboids, drawn as a front face, a shaded side and a lit top.
      const stacks = months.map((m) => {
        let acc = 0;
        return panels.map((p) => {
          const from = acc;
          acc += val(m, p);
          return [from, acc] as const;
        });
      });
      const max = Math.max(1, ...stacks.map((s) => s[s.length - 1]?.[1] ?? 0));
      return {
        ...base,
        grid: { left: 40, right: 22, top: 40, bottom: 26 },
        xAxis: { type: 'category', data: months, ...axis(dark) },
        yAxis: { type: 'value', max: Math.ceil((max * 1.12) / 10) * 10, ...axis(dark) },
        series: panels.map((p, si) => {
          const [light, deep] = tone(p, si);
          const top = si === panels.length - 1;
          return {
            name: p.toUpperCase(),
            type: 'custom',
            encode: { x: 0, y: 2, tooltip: 3 },
            dimensions: ['month', 'from', 'to', p.toUpperCase()],
            data: months.map((m, mi) => [mi, stacks[mi]![si]![0], stacks[mi]![si]![1], val(m, p)]),
            animationDuration: 1100,
            animationEasing: 'cubicOut',
            animationDelay: (i: number) => i * 45 + si * 160,
            renderItem: (_params: unknown, api: CustomSeriesRenderItemAPI) => {
              const x = api.value(0) as number;
              const [cx, y0] = api.coord([x, api.value(1)]) as [number, number];
              const [, y1] = api.coord([x, api.value(2)]) as [number, number];
              const zero = (api.coord([x, 0]) as [number, number])[1];
              const band = (api.size!([1, 0]) as number[])[0]!;
              const w = Math.min(26, band * 0.5);
              const d = w * 0.42; // depth of the side face
              const l = cx - w / 2 - d / 4;
              const r = l + w;
              if (y0 - y1 < 0.5) return { type: 'group', children: [] };
              return {
                type: 'group',
                originX: cx,
                originY: zero,
                enterFrom: { scaleY: 0, style: { opacity: 0 } },
                children: [
                  {
                    type: 'polygon',
                    shape: { points: [[l, y1], [r, y1], [r, y0], [l, y0]] },
                    style: {
                      fill: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: light },
                        { offset: 1, color: deep },
                      ]),
                    },
                  },
                  {
                    type: 'polygon',
                    shape: { points: [[r, y1], [r + d, y1 - d * 0.6], [r + d, y0 - d * 0.6], [r, y0]] },
                    style: { fill: deep, opacity: 0.78 },
                  },
                  {
                    type: 'polygon',
                    shape: { points: [[l, y1], [l + d, y1 - d * 0.6], [r + d, y1 - d * 0.6], [r, y1]] },
                    style: { fill: light, opacity: top ? 1 : 0.9 },
                  },
                ],
              };
            },
            itemStyle: { color: deep },
          };
        }),
      };
    },
    [key],
  );
  return (
    <div>
      <div role="tablist" aria-label="Chart view" className="mb-2 inline-flex gap-1 rounded-xl bg-surface-2 p-1">
        {VIEWS.map(({ key: k, label: l, Icon }) => (
          <button
            key={k}
            role="tab"
            aria-selected={view === k}
            onClick={() => setView(k)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
              view === k
                ? 'bg-gradient-to-r from-[#4f5bd5] to-[#a855f7] text-white shadow-[0_6px_14px_-6px_rgba(99,102,241,0.8)]'
                : 'text-fg-2 hover:bg-surface hover:text-fg',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {l}
          </button>
        ))}
      </div>
      <div ref={ref} className="h-[300px] w-full" role="img" aria-label={label} />
    </div>
  );
}

const CAT_TONES: [string, string][] = [
  ['#818cf8', '#4f46e5'],
  ['#f9a8d4', '#db2777'],
  ['#fdba74', '#ea580c'],
  ['#6ee7b7', '#059669'],
  ['#7dd3fc', '#0284c7'],
  ['#d8b4fe', '#9333ea'],
  ['#fde047', '#ca8a04'],
];

/** Audience segments as a radial bar swirl. Suppressed cells draw as zero and say so in the tooltip. */
export function SegmentSwirl({ rows }: { rows: { label: string; value: number | null; suppressed: boolean }[] }) {
  const key = rows.map((r) => `${r.label}:${r.value}`).join();
  const ref = useChart(
    (dark) => ({
      aria: { enabled: true },
      tooltip: {
        ...tooltip(dark),
        formatter: (p: { name: string; dataIndex: number }) => {
          const r = rows[p.dataIndex]!;
          return `${p.name}: <b>${r.suppressed ? 'below the minimum cell' : new Intl.NumberFormat('en-IN').format(r.value ?? 0)}</b>`;
        },
      },
      polar: { radius: ['18%', '92%'], center: ['50%', '52%'] },
      angleAxis: { max: Math.max(1, ...rows.map((r) => r.value ?? 0)) * 1.25, show: false, startAngle: 90 },
      radiusAxis: { type: 'category', data: rows.map((r) => r.label), show: false },
      series: [
        {
          type: 'bar',
          coordinateSystem: 'polar',
          roundCap: true,
          barWidth: 11,
          showBackground: true,
          backgroundStyle: { color: dark ? '#131d35' : '#f0f3fb' },
          data: rows.map((r, i) => ({
            value: r.value ?? 0,
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                { offset: 0, color: CAT_TONES[i % CAT_TONES.length]![0] },
                { offset: 1, color: CAT_TONES[i % CAT_TONES.length]![1] },
              ]),
              shadowBlur: 10,
              shadowColor: `${CAT_TONES[i % CAT_TONES.length]![1]}55`,
            },
          })),
          animationDuration: 1800,
          animationEasing: 'cubicOut',
          animationDelay: (i: number) => i * 140,
        },
      ],
    }),
    [key],
  );
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[1fr_1fr]">
      <div ref={ref} className="h-[230px] w-full" role="img" aria-label="Radial bars of people per audience segment" />
      <ul className="space-y-2 pr-2 text-[13px]">
        {rows.map((r, i) => (
          <li key={r.label} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: `linear-gradient(135deg, ${CAT_TONES[i % CAT_TONES.length]![0]}, ${CAT_TONES[i % CAT_TONES.length]![1]})` }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-fg-2">{r.label}</span>
            <span className="num font-semibold text-fg">
              {r.suppressed ? '< min' : new Intl.NumberFormat('en-IN').format(r.value ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
