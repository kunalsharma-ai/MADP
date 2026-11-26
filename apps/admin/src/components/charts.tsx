'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { useTheme } from 'next-themes';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, SVGRenderer]);

const PANEL_COLORS: Record<string, string> = { t2o: '#2f6bff', mfr: '#ff8a00', mho: '#14b8a6' };

function useChart(option: (dark: boolean) => echarts.EChartsCoreOption) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' });
    chart.setOption(option(resolvedTheme === 'dark'));
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [option, resolvedTheme]);
  return ref;
}

const axis = (dark: boolean) => ({
  axisLine: { lineStyle: { color: dark ? '#1f2a45' : '#dde3ee' } },
  axisLabel: { color: dark ? '#6f7b96' : '#7a859c', fontSize: 11 },
  splitLine: { lineStyle: { color: dark ? '#131d35' : '#eef2f8' } },
});

export function RegistrationsChart({
  rows,
  label,
}: {
  rows: { month: string; panel: string; n: number }[];
  label: string;
}) {
  const months = [...new Set(rows.map((r) => r.month))].sort().slice(-18);
  // Every panel in the data, built-in ones first in their usual order.
  const order = ['t2o', 'mfr', 'mho'];
  const panels = [...new Set([...order, ...rows.map((r) => r.panel)])].filter((p) => order.includes(p) || rows.some((r) => r.panel === p));
  const ref = useChart((dark) => ({
    aria: { enabled: true, label: { description: label } },
    grid: { left: 36, right: 8, top: 28, bottom: 24 },
    tooltip: { trigger: 'axis' },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 6,
      textStyle: { color: dark ? '#a5b0c8' : '#4a5670', fontSize: 11 },
    },
    xAxis: { type: 'category', data: months, ...axis(dark) },
    yAxis: { type: 'value', ...axis(dark) },
    series: panels.map((p) => ({
      name: p.toUpperCase(),
      type: 'bar',
      stack: 'r',
      barMaxWidth: 18,
      itemStyle: { color: PANEL_COLORS[p] ?? '#8a94a8', borderRadius: p === panels[panels.length - 1] ? [3, 3, 0, 0] : 0 },
      data: months.map((m) => rows.find((r) => r.month === m && r.panel === p)?.n ?? 0),
    })),
  }));
  return <div ref={ref} className="h-64 w-full" role="img" aria-label={label} />;
}
