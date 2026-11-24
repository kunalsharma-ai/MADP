import { cn } from '@/lib/cn';

/**
 * The brand logos Kunal supplied (24 Nov 2026), one shared set for every screen and e-mail preview:
 * /brands/{t2o,mfr,mho}.png, 256×256 with transparent padding. The originals are in the project's brand kit.
 */
export const BRAND_LOGO: Record<'t2o' | 'mfr' | 'mho', string> = {
  t2o: '/brands/t2o.png',
  mfr: '/brands/mfr.png',
  mho: '/brands/mho.png',
};
const NAME = { t2o: 'Turn2Opinion', mfr: 'MyFrequentRewards', mho: 'MyHealthOpinions' } as const;

export function BrandLogo({
  panel,
  size = 24,
  className,
}: {
  panel: 't2o' | 'mfr' | 'mho';
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static files, no optimisation needed
    <img
      src={BRAND_LOGO[panel]}
      alt={`${NAME[panel]} logo`}
      width={size}
      height={size}
      className={cn('shrink-0 object-contain', className)}
    />
  );
}
