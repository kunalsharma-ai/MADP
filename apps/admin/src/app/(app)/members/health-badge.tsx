import { HEALTH_BANDS, memberHealth, type MemberHealthInput } from '@madp/contracts';

/** The member health score as a small ring with its band; the tooltip lists where every point came from. */
export function HealthBadge({ member, size = 'sm' }: { member: MemberHealthInput; size?: 'sm' | 'lg' }) {
  const h = memberHealth(member);
  const band = HEALTH_BANDS[h.band];
  const title = `${band.label} (${h.score}/100)\n${h.parts.map((p) => `${p.label}: ${p.points}/${p.max} (${p.why})`).join('\n')}`;
  const r = size === 'lg' ? 26 : 11;
  const w = size === 'lg' ? 6 : 3.5;
  const c = 2 * Math.PI * r;
  const box = (r + w) * 2;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={title}>
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} className="-rotate-90" aria-hidden>
        <circle cx={box / 2} cy={box / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={w} />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={r}
          fill="none"
          stroke={band.color}
          strokeWidth={w}
          strokeLinecap="round"
          strokeDasharray={`${(h.score / 100) * c} ${c}`}
        />
      </svg>
      <span className={size === 'lg' ? 'text-[15px] font-bold' : 'text-[12px] font-semibold'} style={{ color: band.color }}>
        {h.score}
        <span className="ml-1 font-medium text-fg-3">{band.label}</span>
      </span>
    </span>
  );
}

/** Where each point of the health score came from, as small bars (member page). */
export function HealthBreakdown({ member }: { member: MemberHealthInput }) {
  const h = memberHealth(member);
  return (
    <div className="grid gap-1.5">
      <HealthBadge member={member} size="lg" />
      <ul className="grid gap-1 text-[11.5px]">
        {h.parts.map((p) => (
          <li key={p.key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2">
            <span className="text-fg-2">{p.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full" style={{ width: `${(p.points / p.max) * 100}%`, background: HEALTH_BANDS[h.band].color }} />
            </span>
            <span className="tabular-nums text-fg-3" title={p.why}>
              {p.points}/{p.max}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
