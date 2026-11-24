import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { SourceRespondent } from '@madp/contracts';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { Database } from '../src/db/database.js';
import { FieldCrypto } from '../src/crypto/field-crypto.js';
import { KeyRotationService } from '../src/crypto/key-rotation.service.js';
import { AuditService } from '../src/audit/audit.service.js';
import { signWebhook } from '../src/webhooks/signature.js';
import { startTestApp } from './helpers.js';

/**
 * Signed webhook intake (each event starts a sync of its panel) and field-key rotation, on DEMO data.
 */
const OLD = 'o'.repeat(40);
const NEW = 'n'.repeat(40);
let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '20', WEBHOOK_SECRETS_MFR: `${OLD},${NEW}` });
  token = (await t.adminToken('super_admin')).token;
});
afterAll(async () => t?.stop());

const send = (
  panel: string,
  body: string,
  o: { id?: string; secret?: string; ts?: number; sig?: string } = {},
) => {
  const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
  const id = o.id ?? `evt-${Math.random().toString(36).slice(2)}`;
  return request(t.server)
    .post(`/api/v1/webhooks/${panel}`)
    .set('content-type', 'application/json')
    .set('x-madp-event-id', id)
    .set('x-madp-timestamp', ts)
    .set('x-madp-signature', o.sig ?? signWebhook(o.secret ?? NEW, ts, id, body))
    .send(body);
};

async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('signed webhooks', () => {
  it('starts a sync of the panel for a signed event, once per event id', async () => {
    await request(t.server)
      .post('/api/v1/connectors/mfr/import')
      .set('authorization', `Bearer ${token}`)
      .send({ dryRun: false })
      .expect(200);
    const c = t.app.get(ConnectorRegistry).get('mfr').connector;
    const [first] = (await c.listRespondents(null, 1)).items;
    const changed: SourceRespondent = { ...first!, qualityScore: 77 };
    let served = false;
    c.memberChanges = async () => {
      const items = served ? [] : [changed];
      served = true;
      return { items, cursor: 'wh-1', more: false };
    };
    c.answerChanges = async () => ({ items: [], cursor: 'wh-1', more: false });
    c.deletions = async () => ({ items: [], cursor: 'wh-1', more: false });

    const body = JSON.stringify({ type: 'member.changed', occurredAt: new Date().toISOString() });
    const r = await send('mfr', body, { id: 'evt-member-1' });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'accepted' });
    const row = await until(async () => {
      const [x] = await q<{ processed_at: Date | null; payload_ref: string }>(
        sql`select processed_at, payload_ref from webhook_inbox where idempotency_key = 'evt-member-1'`,
      );
      return x?.processed_at ? x : null;
    });
    // Only a hash of the body is kept.
    expect(row.payload_ref).toMatch(/^sha256:[0-9a-f]{64}$/);
    const [m] = await q<{ quality_score: number }>(
      sql`select quality_score from source_identity where panel = 'mfr' and source_member_id = ${first!.sourceMemberId}`,
    );
    expect(m!.quality_score).toBe(77);

    // The same event again is acknowledged and ignored.
    const again = await send('mfr', body, { id: 'evt-member-1' });
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ status: 'duplicate' });
    expect(await q(sql`select 1 from webhook_inbox where idempotency_key = 'evt-member-1'`)).toHaveLength(1);
  });

  it('accepts the old secret during rotation', async () => {
    const r = await send('mfr', JSON.stringify({ type: 'answers.changed' }), { secret: OLD });
    expect(r.status).toBe(202);
  });

  it('rejects bad signatures, replays and changed bodies, and audits them', async () => {
    const body = JSON.stringify({ type: 'member.deleted' });
    expect((await send('mfr', body, { secret: 'x'.repeat(40) })).status).toBe(401);
    expect((await send('mfr', body, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signWebhook(NEW, ts, 'evt-tamper', body);
    const tampered = await request(t.server)
      .post('/api/v1/webhooks/mfr')
      .set('content-type', 'application/json')
      .set('x-madp-event-id', 'evt-tamper')
      .set('x-madp-timestamp', ts)
      .set('x-madp-signature', sig)
      .send(JSON.stringify({ type: 'member.changed' }));
    expect(tampered.status).toBe(401);
    expect((await send('mfr', body, { id: 'bad id with spaces' })).status).toBe(401);
    const reasons = await q<{ reason: string }>(
      sql`select metadata->>'reason' as reason from audit_event where action = 'webhook.rejected' order by at`,
    );
    expect(reasons.map((r) => r.reason)).toEqual(['bad_signature', 'stale_timestamp', 'bad_signature', 'bad_event_id']);
    expect(await q(sql`select 1 from webhook_inbox where idempotency_key = 'evt-tamper'`)).toHaveLength(0);
  });

  it('refuses events that carry anything but a type and time', async () => {
    const r = await send('mfr', JSON.stringify({ type: 'member.changed', email: 'someone@example.invalid' }));
    expect(r.status).toBe(400);
    expect((await send('mfr', JSON.stringify({ type: 'something.else' }))).status).toBe(400);
  });

  it('answers 404 for a panel with no webhook secret', async () => {
    expect((await send('t2o', JSON.stringify({ type: 'member.changed' }))).status).toBe(404);
  });

  it('shows the inbox to connector readers only', async () => {
    await request(t.server).get('/api/v1/webhooks/inbox').expect(401);
    const r = await request(t.server)
      .get('/api/v1/webhooks/inbox?panel=mfr')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(r.body.configured).toEqual({ t2o: false, mfr: true, mho: false });
    expect(r.body.totals.mfr.received).toBe(2);
    expect(JSON.stringify(r.body)).not.toContain('payload');
  });
});

describe('field-key rotation', () => {
  it('re-encrypts every value to the new key, keeps it readable, and can be repeated', async () => {
    const before = t.app.get(FieldCrypto);
    const [row] = await q<{ id: string; email_enc: string }>(
      sql`select id, email_enc from source_identity where email_enc is not null limit 1`,
    );
    const plain = before.decrypt(row!.email_enc);
    const k2 = Buffer.alloc(32, 5).toString('base64');
    const next = new FieldCrypto({ ...t.env, FIELD_ENCRYPTION_KEYS: { k2 }, FIELD_ENCRYPTION_ACTIVE_KEY: 'k2' });
    const svc = new KeyRotationService(t.app.get(Database), next, t.app.get(AuditService));
    expect(Object.keys((await svc.status()).source_identity!)).toEqual(['k1']);
    const r = await svc.rotate({ batchSize: 7 });
    expect(r.rowsRewritten).toBeGreaterThan(0);
    expect(r.remaining).toBe(0);
    const status = await svc.status();
    expect(Object.keys(status.source_identity!)).toEqual(['k2']);
    const [after] = await q<{ email_enc: string }>(sql`select email_enc from source_identity where id = ${row!.id}`);
    expect(after!.email_enc.startsWith('k2.')).toBe(true);
    expect(next.decrypt(after!.email_enc)).toBe(plain);
    expect((await svc.rotate()).rowsRewritten).toBe(0);
    const [audit] = await q<{ n: string }>(
      sql`select count(*) as n from audit_event where action = 'crypto.field_keys_rotated'`,
    );
    expect(Number(audit!.n)).toBe(2);
  });
});
