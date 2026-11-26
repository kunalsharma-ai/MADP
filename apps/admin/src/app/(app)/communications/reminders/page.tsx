import type { Metadata } from 'next';
import type { ChannelsView, RemindersView } from '@madp/contracts';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { PageHeader } from '@/components/ui';
import { RemindersForm } from './reminders-form';
import { ChannelsForm } from './channels-form';

export const metadata: Metadata = { title: 'Auto reminders' };

type View = RemindersView & { canEdit: boolean; canSetUpChannels: boolean; canFlip: boolean };

export default async function RemindersPage() {
  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Auto reminders"
        description="The panel checks every member on its own and sends a gentle, branded reminder when something is left: a password not set, terms not accepted, a profile not started or half done, surveys waiting, a first survey, points ready to redeem, a streak about to break. You only choose which reminders are on, every how many days and at most how many times. Teens are never included. Every reminder lands on the member's dashboard and in their registered e-mail, and also on WhatsApp, SMS or push when the member chose those."
      />
      {await withPanel(async (brand) => {
        const [view, channels] = await Promise.all([
          api<View>('/panel/reminders'),
          api<ChannelsView>('/panel/channels'),
        ]);
        return (
          <>
            <RemindersForm brand={brand} view={view} />
            <ChannelsForm
              brand={brand}
              view={channels}
              cases={view.cases.map(({ key, label }) => ({ key, label }))}
              canEdit={view.canSetUpChannels}
            />
          </>
        );
      })}
    </>
  );
}
