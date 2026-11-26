'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const nf = new Intl.NumberFormat('en-IN');

/** A number that counts up from zero when it first appears. Without motion it shows the final value. */
export function CountUp({ value, duration = 1400, className }: { value: number; duration?: number; className?: string }) {
  const [n, setN] = useState(value);
  useLayoutEffect(() => {
    if (reduced() || value === 0) return setN(value);
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      // ease-out expo, so the last digits settle gently
      setN(Math.round(value * (p === 1 ? 1 : 1 - 2 ** (-10 * p))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    setN(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={cn('num', className)}>{nf.format(n)}</span>;
}

/** A card that leans toward the pointer in 3D, with a soft glare. Children with class "pop" float above it. */
export function TiltCard({ className, children, style }: { className?: string; children: ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || reduced() || e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(x - 0.5) * 14}deg`);
    el.style.setProperty('--rx', `${(0.5 - y) * 12}deg`);
    el.style.setProperty('--gx', `${x * 100}%`);
    el.style.setProperty('--gy', `${y * 100}%`);
  };
  const onLeave = () => {
    ref.current?.style.setProperty('--rx', '0deg');
    ref.current?.style.setProperty('--ry', '0deg');
  };
  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={cn('tilt relative', className)} style={style}>
      <div className="glare pointer-events-none absolute inset-0 rounded-[inherit]" aria-hidden />
      {children}
    </div>
  );
}

/** Animated progress ring. value and max are plain numbers; the centre holds any content. */
export function Ring({
  value,
  max,
  size = 112,
  stroke = 11,
  from,
  to,
  children,
  label,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  from: string;
  to: string;
  children?: ReactNode;
  label: string;
}) {
  const id = `ring${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          className="ring-in"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - share)}
          style={{ ['--ring-len' as string]: len, filter: `drop-shadow(0 4px 8px ${from}55)` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Greeting by the viewer's own clock, filled in after load so the server and browser agree. */
export function Greeting({ name }: { name: string }) {
  const [hello, setHello] = useState('Welcome back');
  useEffect(() => {
    const h = new Date().getHours();
    setHello(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);
  return (
    <>
      {hello}, <span className="shimmer-text">{name}</span>
    </>
  );
}
