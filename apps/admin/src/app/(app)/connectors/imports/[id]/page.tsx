import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { DataMode, PanelCode } from '@madp/contracts';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Card,
  CardHeader,
  DataModeBadge,
  DemoBanner,
  PageHeader,
  PanelChip,
  Stat,
  Table,
  fmt,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Import reconciliation' };

interface Reconciliation {
  job: { id: string; panel: PanelCode; dataMode: DataMode; dryRun: boolean; status: string };
  source: { questionnaires: number; questions: number; respondents: number; answers: number };
  madp: {
    identitiesWrittenByJob: number;
    identitiesTotal: number;
    panelMemberships: number;
    questionsInRegistry: number;
    currentAnswers: number;
    pendingMappings: number;
    openDeadLetters: number;
  };
  checks: { check: string; expected: number; actual: number; ok: boolean }[];
  status: 'reconciled' | 'discrepancies' | 'failed';
}

const tone = { reconciled: 'teal', discrepancies: 'warn', failed: 'danger' } as const;

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let r: Reconciliation;
  try {
    r = await api<Reconciliation>(`/imports/${encodeURIComponent(id)}/reconciliation`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  return (
    <>
      <PageHeader
        eyebrow="Connectors & sync"
        title="Import reconciliation"
        description="What the source returned in this run, compared with what MADP holds now. Counts only; no personal data."
        actions={
          <div className="flex items-center gap-2">
            <PanelChip panel={r.job.panel} />
            <DataModeBadge mode={r.job.dataMode} />
            {r.job.dryRun ? <Badge>dry run</Badge> : null}
            <Badge tone={tone[r.status]}>{r.status}</Badge>
          </div>
        }
      />
      <DemoBanner mode={r.job.dataMode} />
      <p className="mb-4 text-sm">
        <a className="text-accent underline-offset-2 hover:underline" href="/connectors">
          ← Back to connectors
        </a>
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Respondents read from source" value={fmt(r.source.respondents)} />
        <Stat label="Identities written by this run" value={fmt(r.madp.identitiesWrittenByJob)} />
        <Stat label="Answers read from source" value={fmt(r.source.answers)} />
        <Stat label="Answer batches in dead-letter queue" value={fmt(r.madp.openDeadLetters)} />
      </div>
      <Card className="mt-4">
        <CardHeader title="Checks" hint="A run is reconciled only when every check passes" />
        <Table head={['Check', 'Expected', 'Actual', 'Result']}>
          {r.checks.map((c) => (
            <tr key={c.check}>
              <td className="px-5 py-2.5">{c.check}</td>
              <td className="num px-5 py-2.5">{fmt(c.expected)}</td>
              <td className="num px-5 py-2.5">{fmt(c.actual)}</td>
              <td className="px-5 py-2.5">
                <Badge tone={c.ok ? 'teal' : 'warn'}>{c.ok ? 'pass' : 'check'}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card className="mt-4">
        <CardHeader title="MADP now (this panel)" />
        <Table head={['Measure', 'Count']}>
          {[
            ['Source identities', r.madp.identitiesTotal],
            ['Panel memberships', r.madp.panelMemberships],
            ['Questions in registry', r.madp.questionsInRegistry],
            ['Current answers', r.madp.currentAnswers],
            ['Mappings waiting for review', r.madp.pendingMappings],
          ].map(([k, v]) => (
            <tr key={k as string}>
              <td className="px-5 py-2.5">{k}</td>
              <td className="num px-5 py-2.5">{fmt(v as number)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
