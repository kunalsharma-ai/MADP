'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, apiPublic, SESSION_COOKIE } from '@/lib/api';
import { attempt } from '@/lib/attempt';

const cookieOpts = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60,
};

export async function signIn(_: unknown, form: FormData): Promise<{ error?: string }> {
  const totp = String(form.get('totp') ?? '').trim();
  const r = await apiPublic<{ token?: string; mfaSetupRequired?: boolean; message?: string }>('/auth/login', {
    email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''),
    ...(totp ? { totp } : {}),
  });
  if (!r.ok || !r.body.token)
    return {
      error:
        r.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'Those details did not match. Check your e-mail, password and authenticator code.',
    };
  (await cookies()).set(SESSION_COOKIE, r.body.token, cookieOpts);
  redirect(r.body.mfaSetupRequired ? '/mfa' : '/');
}

export async function confirmMfa(_: unknown, form: FormData): Promise<{ error?: string }> {
  try {
    const r = await api<{ token: string }>('/auth/mfa/confirm', {
      method: 'POST',
      json: { code: String(form.get('code') ?? '').trim() },
    });
    (await cookies()).set(SESSION_COOKIE, r.token, cookieOpts);
  } catch {
    return { error: 'That code did not work. Codes change every 30 seconds — try the current one.' };
  }
  redirect('/');
}

export async function signOut() {
  // End the server-side session too, so the token cannot be reused.
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function runImport(panel: string, dryRun: boolean) {
  const r = await api<{ status: string; jobId: string; error?: string; counts: Record<string, unknown> }>(
    `/connectors/${panel}/import`,
    { method: 'POST', json: { dryRun } },
  );
  revalidatePath('/connectors');
  return r;
}

export async function runSync(panel: string) {
  const r = await api<{
    status: string;
    jobId: string | null;
    error?: string;
    counts?: Record<string, unknown>;
  }>(`/connectors/${encodeURIComponent(panel)}/sync`, { method: 'POST', json: {} });
  revalidatePath('/connectors');
  return r;
}

export async function decideMapping(
  id: string,
  decision: 'approve' | 'reject' | 'needs_info',
  attributeKey?: string,
  notes?: string,
  valueMap?: Record<string, string>,
) {
  return attempt(async () => {
    const map = valueMap && Object.keys(valueMap).length ? valueMap : undefined;
    await api(`/mappings/${id}/decision`, {
      method: 'POST',
      json: {
        decision,
        ...(attributeKey ? { attributeKey } : {}),
        ...(notes ? { notes } : {}),
        ...(map ? { valueMap: map } : {}),
      },
    });
    revalidatePath('/mappings');
  });
}

/** All options of one question version, for the value map editor. */
export async function questionOptions(panel: string, sourceQuestionId: string, version: number) {
  return attempt(async () => {
    const r = await api<{ versions: { version: number; options: { value: string; label: string }[] }[] }>(
      `/questions/${encodeURIComponent(panel)}/${encodeURIComponent(sourceQuestionId)}`,
    );
    // Options repeat once per parent value (cascading questions); the value map needs each value once.
    const seen = new Set<string>();
    return (r.versions.find((v) => v.version === version)?.options ?? []).filter(
      (o) => !seen.has(o.value) && seen.add(o.value),
    );
  });
}

export async function retryDeadLetters(panel: string) {
  const r = await api<{ attempted: number; resolved: number; stillOpen: number }>(
    `/connectors/${encodeURIComponent(panel)}/dead-letters/retry`,
    { method: 'POST', json: {} },
  );
  revalidatePath('/connectors');
  return r;
}

export async function decideIdentityMatch(id: string, decision: 'approve' | 'reject', reason?: string) {
  const r = await api<{ status: string; personId?: string; answersMoved?: number }>(
    `/identity/candidates/${encodeURIComponent(id)}/decision`,
    { method: 'POST', json: { decision, ...(reason ? { reason } : {}) } },
  );
  revalidatePath('/identity');
  return r;
}

export async function unlinkIdentity(identityId: string, reason: string, personId?: string) {
  const r = await api<{ personId: string; fromPersonId: string; answersMoved: number }>(
    `/identity/source-identities/${encodeURIComponent(identityId)}/unlink`,
    { method: 'POST', json: { reason } },
  );
  revalidatePath('/identity');
  if (personId) revalidatePath(`/panellists/${personId}`);
  return r;
}

// --- Engagement studio ----------------------------------------------------------------------------------------

export async function createTemplateAction(panel: string, key: string, name: string, kind: string) {
  await api('/communications/templates', { method: 'POST', json: { panel, key, name, kind } });
  revalidatePath('/communications');
}

/** A campaign mailer becomes a draft studio version, in the mailer's own panel. The API checks that brand's grants. */
export async function mailerToStudioAction(pack: string, id: string, panel: string, subject: number) {
  const r = await api<{ created: boolean; version: { version: number; problems: string[] }; added: string[] }>(
    `/communications/mailers/${encodeURIComponent(pack)}/${encodeURIComponent(id)}/studio`,
    { method: 'POST', json: { subject }, headers: { 'x-madp-brand': panel } },
  );
  revalidatePath('/communications');
  return r.created ? `Studio template created, draft version ${r.version.version}` : `Draft version ${r.version.version} added`;
}

export async function addTemplateVersion(templateId: string, subject: string, bodyHtml: string, bodyText: string) {
  const r = await api<{ id: string; problems: string[] }>(
    `/communications/templates/${encodeURIComponent(templateId)}/versions`,
    { method: 'POST', json: { subject, bodyHtml, bodyText } },
  );
  revalidatePath('/communications');
  return r;
}

export async function versionAction(versionId: string, action: 'submit' | 'approve' | 'reject') {
  const id = encodeURIComponent(versionId);
  if (action === 'submit') await api(`/communications/template-versions/${id}/submit`, { method: 'POST', json: {} });
  else await api(`/communications/template-versions/${id}/review`, { method: 'POST', json: { decision: action } });
  revalidatePath('/communications');
}

export async function createCampaignAction(name: string, templateVersionId: string) {
  await api('/communications/campaigns', { method: 'POST', json: { name, templateVersionId } });
  revalidatePath('/communications');
}

export async function campaignAction(id: string, action: 'approve' | 'pause' | 'resume' | 'archive' | 'dry_run') {
  const cid = encodeURIComponent(id);
  const r =
    action === 'dry_run'
      ? await api<Record<string, unknown>>(`/communications/campaigns/${cid}/run`, { method: 'POST', json: { dryRun: true } })
      : await api<Record<string, unknown>>(`/communications/campaigns/${cid}/decision`, { method: 'POST', json: { decision: action } });
  revalidatePath('/communications');
  return r;
}

export async function createCelebrationAction(panel: string, name: string, observance: string, onDate: string, countries: string[]) {
  await api('/communications/calendar', { method: 'POST', json: { panel, name, observance, onDate, countries } });
  revalidatePath('/communications/automations');
}

export async function reviewCelebrationAction(id: string, decision: 'approve' | 'reject') {
  await api(`/communications/calendar/${encodeURIComponent(id)}/review`, { method: 'POST', json: { decision } });
  revalidatePath('/communications/automations');
}

export async function createAutomationAction(body: Record<string, unknown>) {
  await api('/communications/automations', { method: 'POST', json: body });
  revalidatePath('/communications/automations');
}

export async function automationVersionAction(versionId: string, action: 'submit' | 'approve' | 'reject' | 'restore') {
  const id = encodeURIComponent(versionId);
  if (action === 'submit') await api(`/communications/automation-versions/${id}/submit`, { method: 'POST', json: {} });
  else if (action === 'restore') await api(`/communications/automation-versions/${id}/restore`, { method: 'POST', json: {} });
  else await api(`/communications/automation-versions/${id}/review`, { method: 'POST', json: { decision: action } });
  revalidatePath('/communications/automations');
}

export async function automationAction(id: string, action: 'pause' | 'resume' | 'archive' | 'dry_run', asOf?: string) {
  const aid = encodeURIComponent(id);
  const r =
    action === 'dry_run'
      ? await api<{ planned: number; due: number }>(`/communications/automations/${aid}/run`, {
          method: 'POST',
          json: { dryRun: true, ...(asOf ? { asOf } : {}) },
        })
      : await api(`/communications/automations/${aid}/decision`, { method: 'POST', json: { decision: action } });
  revalidatePath('/communications/automations');
  return action === 'dry_run' ? `Dry run: ${(r as { planned: number }).planned} of ${(r as { due: number }).due} due would get it` : r;
}

export async function approveSurveyAction(panel: string, surveySlug: string, note: string) {
  const r = await api<{ completes: number; points: number }>(`/loyalty/${encodeURIComponent(panel)}/survey-approvals`, {
    method: 'POST',
    json: { surveySlug, note },
  });
  revalidatePath('/loyalty');
  return `Approved ${r.completes} completes (${r.points} points)`;
}

export async function loyaltyAction(panel: string, action: 'sync' | 'reconcile' | 'repair') {
  const p = encodeURIComponent(panel);
  if (action === 'sync') {
    const r = await api<{ status: string; linesWritten: number }>(`/loyalty/${p}/sync`, { method: 'POST', json: {} });
    revalidatePath('/loyalty');
    return r.status === 'succeeded' ? `Mirror updated: ${r.linesWritten} new ledger lines` : `Not available: ${r.status}`;
  }
  const r = await api<{ matches: boolean; missing: number; different: number; onlyInMadp: number; unmatched: number }>(
    `/loyalty/${p}/reconcile`,
    { method: 'POST', json: { repair: action === 'repair' } },
  );
  revalidatePath('/loyalty');
  return r.matches
    ? `Matches the panel${r.unmatched ? ` (${r.unmatched} rows of members MADP does not know)` : ''}`
    : `Differences: ${r.missing} missing, ${r.different} different, ${r.onlyInMadp} only in MADP`;
}

export async function createServiceClientAction(input: { name: string; scopes: string[]; panels: string[]; rateLimitPerMinute: number }) {
  const r = await api<{ clientId: string; secret: string }>('/service-clients', { method: 'POST', json: input });
  revalidatePath('/supply360');
  return { clientId: r.clientId, secret: r.secret };
}

export async function revokeServiceClientAction(id: string) {
  await api(`/service-clients/${encodeURIComponent(id)}/revoke`, { method: 'POST', json: {} });
  revalidatePath('/supply360');
  return 'Client revoked. Its requests are refused from now on.';
}

export async function recordPreferenceAction(personId: string, input: { panel: string; channel: string; status: string; source: string; reason: string }) {
  await api(`/consent/persons/${encodeURIComponent(personId)}/preferences`, { method: 'POST', json: input });
  revalidatePath('/consent');
  return input.status === 'opted_out' ? 'Opt-out recorded. MADP will not contact this member on that channel.' : 'Opt-out lifted.';
}

export async function createPrivacyRequestAction(input: { personId: string; kind: string; reference: string; jurisdiction?: string; dueInDays: number }) {
  await api('/privacy/requests', { method: 'POST', json: input });
  revalidatePath('/privacy');
  return 'Request logged. A second person must verify and carry it out.';
}

export async function privacyStepAction(id: string, step: 'verify' | 'execute' | 'reject' | 'complete', note: string) {
  const r = await api<{ status: string }>(`/privacy/requests/${encodeURIComponent(id)}/${step}`, { method: 'POST', json: { note } });
  revalidatePath('/privacy');
  return `Request is now ${r.status.replace('_', ' ')}`;
}

export async function purgeRetentionAction(key: string) {
  const r = await api<{ removed: number }>(`/privacy/retention/${encodeURIComponent(key)}/purge`, { method: 'POST', json: {} });
  revalidatePath('/privacy');
  return `${r.removed} rows removed`;
}

export async function recordEvidenceAction(input: { personId: string; panel: string; claim: string; method: string; reference: string; expiresOn?: string }) {
  await api('/verification/evidence', { method: 'POST', json: input });
  revalidatePath('/verification');
  return 'Recorded. A second reviewer must verify or reject it.';
}

export async function evidenceStepAction(id: string, step: 'verified' | 'rejected' | 'revoke', note: string) {
  const path = step === 'revoke' ? 'revoke' : 'decision';
  const json = step === 'revoke' ? { note } : { decision: step, note };
  const r = await api<{ status: string }>(`/verification/evidence/${encodeURIComponent(id)}/${path}`, { method: 'POST', json });
  revalidatePath('/verification');
  return `Evidence is now ${r.status}`;
}

export async function refreshInsightsAction() {
  return attempt(async () => {
    const r = await api<{ raised: number; updated: number; resolved: number }>('/insights/refresh', { method: 'POST', json: {} });
    revalidatePath('/insights');
    return `Checked again: ${r.raised} new, ${r.updated} still open, ${r.resolved} solved`;
  });
}

export async function decideInsightAction(id: string, decision: 'accepted' | 'dismissed', note: string) {
  return attempt(async () => {
    await api(`/insights/${encodeURIComponent(id)}/decision`, { method: 'POST', json: { decision, note } });
    revalidatePath('/insights');
    return decision === 'accepted' ? 'Marked as being handled.' : 'Hidden for at least 7 days.';
  });
}

/** Drafts a panel's three win-back mailers (30, 60 and 90 days quiet) for review on Messages. */
export async function draftWinBackAction(panel: string) {
  return attempt(async () => {
    const r = await api<{ panel: string; created: string[] }>('/communications/automations/win-back/drafts', {
      method: 'POST',
      json: { panel },
    });
    revalidatePath('/communications/automations');
    revalidatePath('/communications');
    return r;
  });
}

/** Sets up a panel's win-back journey from its approved mailers and sends it to a second admin for approval. */
export async function startWinBackAction(panel: string) {
  return attempt(async () => {
    await api('/communications/automations/win-back', { method: 'POST', json: { panel } });
    revalidatePath('/communications/automations');
    return null;
  });
}

/** Sets up a panel's ready-made welcome journey (day 1, 3 and 7) and sends it to a second admin for approval. */
export async function startWelcomeJourneyAction(panel: string) {
  return attempt(async () => {
    await api('/communications/automations/welcome-journey', { method: 'POST', json: { panel } });
    revalidatePath('/communications/automations');
    return null;
  });
}
