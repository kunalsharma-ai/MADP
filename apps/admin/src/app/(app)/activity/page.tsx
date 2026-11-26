import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { LiveFeed } from './live-feed';

export const metadata: Metadata = { title: 'Live activity' };

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Live activity"
        description="Sign-ups, survey completes, redemptions and new support tickets on T2O, MFR and MHO, newest first, with a sound for each new line."
      />
      <LiveFeed />
    </>
  );
}
