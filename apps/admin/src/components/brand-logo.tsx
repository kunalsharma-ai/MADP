import { cn } from '@/lib/cn';

/**
 * The brand logos Kunal supplied (24 Nov 2026), one shared set for every screen and e-mail preview:
 * /brands/{t2o,mfr,mho}.png, 256×256 with transparent padding. The originals are in the project's brand kit.
 * A panel added in the console has no logo file yet, so it gets a tile with its short name.
 */
export const BRAND_LOGO: Record<string, string> = {
  t2o: '/brands/t2o.png',
  mfr: '/brands/mfr.png',
  mho: '/brands/mho.png',
};
const NAME: Record<string, string> = { t2o: 'Turn2Opinion', mfr: 'MyFrequentRewards', mho: 'MyHealthOpinions' };

export function BrandLogo({
  panel,
  size = 24,
  className,
  label,
}: {
  panel: string;
  size?: number;
  className?: string;
  /** Short name shown on the tile of a panel without a logo file. */
  label?: string;
}) {
  const src = BRAND_LOGO[panel];
  if (!src)
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size / 3.2)) }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md bg-surface-2 font-semibold uppercase text-fg-2',
          className,
        )}
      >
        {(label ?? panel).slice(0, 3)}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static files, no optimisation needed
    <img
      src={src}
      alt={`${NAME[panel] ?? panel} logo`}
      width={size}
      height={size}
      className={cn('shrink-0 object-contain', className)}
    />
  );
}
