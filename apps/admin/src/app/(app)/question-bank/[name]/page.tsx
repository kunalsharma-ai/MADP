import type { Metadata } from 'next';
import { api, ApiError } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';
import { QuestionEditor, type QuestionData } from './question-editor';

export const metadata: Metadata = { title: 'Question' };

export default async function QuestionPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const isNew = name === 'new';
  return (
    <>
      <PageHeader
        eyebrow="Panel · Question bank"
        title={isNew ? 'New question' : name}
        description="The key never changes once members have answered; wording, options and rules can. Saving a teen question with a tobacco, nicotine, alcohol, health, cosmetic or vehicle subject is refused."
      />
      {await withPanel(async () => {
        let q: QuestionData | null = null;
        if (!isNew) {
          try {
            q = await api<QuestionData>(`/panel/questions/${encodeURIComponent(name)}`);
          } catch (e) {
            if (e instanceof ApiError && e.status === 404)
              return (
                <Card>
                  <CardHeader title="No such question on this brand" />
                </Card>
              );
            throw e;
          }
        }
        return (
          <div className="grid gap-4">
            {q?.profiles?.length ? (
              <Card>
                <CardHeader
                  title="Used in profiles"
                  action={
                    <div className="flex flex-wrap gap-1">
                      {q.profiles.map((p) => (
                        <Badge
                          key={`${p.slug}-${p.category}`}
                          tone={p.category.includes('minor') ? 'accent' : 'neutral'}
                        >
                          {p.slug} ({p.category})
                        </Badge>
                      ))}
                    </div>
                  }
                />
              </Card>
            ) : null}
            <QuestionEditor question={q} />
          </div>
        );
      })}
    </>
  );
}
