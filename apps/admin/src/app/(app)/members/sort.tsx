import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { MemberRow } from './shared';

export const SORT_COLUMNS = [
  'name',
  'memberId',
  'email',
  'phone',
  'segment',
  'country',
  'born',
  'gender',
  'age',
  'quality',
  'status',
  'marketing',
  'signedUp',
  'lastActivity',
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDir = 'asc' | 'desc';

/** Dates and numbers start with the biggest (newest) first, age with the youngest; text starts at A. */
const FIRST_DIR: Record<SortColumn, SortDir> = {
  name: 'asc',
  memberId: 'asc',
  email: 'asc',
  phone: 'asc',
  segment: 'asc',
  country: 'asc',
  born: 'desc',
  gender: 'asc',
  age: 'asc',
  quality: 'desc',
  status: 'asc',
  marketing: 'desc',
  signedUp: 'desc',
  lastActivity: 'desc',
};

const value = (m: MemberRow, c: SortColumn): string | number | null => {
  switch (c) {
    case 'name':
      return m.name?.toLowerCase() || null;
    case 'memberId':
      return m.memberId ?? m.id;
    case 'email':
      return m.email?.toLowerCase() ?? null;
    case 'phone':
      return m.phone ?? null;
    case 'segment':
      return m.category;
    case 'country':
      return m.country;
    case 'born':
      return m.birthYear;
    case 'gender':
      return m.gender ?? null;
    case 'age':
      return m.age ?? null;
    case 'quality':
      return m.qualityScore;
    case 'status':
      return m.status;
    case 'marketing':
      return !m.marketingOptIn?.asked ? 0 : m.marketingOptIn.granted ? 2 : 1;
    case 'signedUp':
      return m.signedUpAt ? Date.parse(m.signedUpAt) : null;
    case 'lastActivity':
      return m.lastActivityAt ? Date.parse(m.lastActivityAt) : null;
  }
};

/** Sorts the rows on screen. Used while the panel does not sort the whole list itself. Empty values go last. */
export function sortPage(rows: MemberRow[], c: SortColumn, dir: SortDir): MemberRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, c);
    const y = value(b, c);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x).localeCompare(String(y)) * sign;
  });
}

/** A column heading that sorts by that column; a second click flips the order. Filters stay as they are. */
export function SortHead({
  col,
  label,
  active,
  dir,
  keep,
}: {
  col: SortColumn;
  label: string;
  active?: SortColumn;
  dir: SortDir;
  keep: Record<string, string>;
}) {
  const on = active === col;
  const next: SortDir = on ? (dir === 'asc' ? 'desc' : 'asc') : FIRST_DIR[col];
  const href = `/members?${new URLSearchParams({ ...keep, sort: col, dir: next })}`;
  const Icon = on ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th scope="col" aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-5 py-3 font-semibold">
      <Link
        href={href}
        title={`Sort by ${label.toLowerCase()}`}
        className={`group inline-flex items-center gap-1 whitespace-nowrap rounded-md transition hover:text-fg ${on ? 'text-accent' : ''}`}
      >
        {label}
        <Icon className={`size-3.5 transition ${on ? '' : 'opacity-40 group-hover:opacity-100'}`} aria-hidden />
      </Link>
    </th>
  );
}
