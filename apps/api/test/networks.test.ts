import pg from 'pg';
import request from 'supertest';
import ExcelJS from 'exceljs';
import type * as OTPAuth from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { IngestionService } from '../src/ingestion/ingestion.service.js';
import { signWebhook } from '../src/webhooks/signature.js';
import { startTestApp } from './helpers.js';

/** A network on other software: members arrive by CSV/Excel upload or the signed push API, and the sync reads them. */
describe('networks on other software', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let db: pg.Client;
  let boss: { token: string; totp: OTPAuth.TOTP | null };
  let key = '';
  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
  async function code() {
    await db.query('update admin_user set totp_last_step = null');
    return boss.totp!.generate();
  }
  const upload = (kind: string, file: string, dryRun: boolean, format = 'csv') =>
    request(t.server)
      .post('/api/v1/networks/netz/upload')
      .set(as(boss.token))
      .send({ kind, format, file, dryRun, reason: 'first file from the network' });

  beforeAll(async () => {
    t = await startTestApp();
    db = new pg.Client({ connectionString: t.dbUrl });
    await db.connect();
    boss = await t.adminToken('super_admin', 'net-boss@example.invalid');
    await request(t.server)
      .post('/api/v1/panels')
      .set(as(boss.token))
      .send({
        code: 'netz',
        name: 'Demo Network Panel',
        shortName: 'NTZ',
        sourceType: 'inbox',
        origins: ['www.netz.example.invalid'],
        reason: 'a network on other software',
      })
      .expect(201);
    await request(t.server)
      .post('/api/v1/audience-segments/rules')
      .set(as(boss.token))
      .send({ panel: 'netz', sourceValue: 'b2c', segment: 'consumer', reason: 'network b2c members are consumers' })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await t?.stop();
  });

  it('refuses data until live sync is approved, and serves a template', async () => {
    await upload('members', b64('member_id,category\ndemo-1,b2c\n'), true).expect(409);
    const tpl = await request(t.server).get('/api/v1/networks/template/members').set(as(boss.token)).expect(200);
    expect(tpl.text.split('\n')[0]).toContain('member_id,category,email');
    expect(tpl.text).toContain('@example.invalid');
    await request(t.server)
      .put('/api/v1/panel-connections/netz')
      .set(as(boss.token))
      .send({ liveApproved: true, reason: 'Kunal approves the network data', code: await code() })
      .expect(200);
    expect(t.app.get(ConnectorRegistry).get('netz').dataMode).toBe('live');
    const list = await request(t.server).get('/api/v1/networks').set(as(boss.token)).expect(200);
    expect(list.body.networks).toHaveLength(1);
    expect(list.body.networks[0]).toMatchObject({ panel: 'netz', liveApproved: true, pushKey: { set: false } });
  });

  it('checks a CSV first, refuses one with bad rows, then imports it', async () => {
    const bad =
      'Member ID,Category,E-mail,Country,Marketing consent\n' +
      'demo-1,b2c,demo-1@example.invalid,IN,granted\n' +
      'demo-2,b2c,not-an-email,India,\n';
    const dry = await upload('members', b64(bad), true).expect(200);
    expect(dry.body).toMatchObject({ dryRun: true, rows: 2, accepted: 1, batch: null });
    expect(dry.body.problems.map((p: { row: number }) => p.row)).toEqual([3]);
    expect(JSON.stringify(dry.body.problems)).not.toContain('not-an-email');
    expect(dry.body.columns).toContainEqual({ column: 'E-mail', field: 'email' });
    await upload('members', b64(bad), false).expect(400);

    const good = bad.replace('not-an-email', 'demo-2@example.invalid').replace('India', 'IN');
    const r = await upload('members', b64(good), false).expect(200);
    expect(r.body).toMatchObject({ dryRun: false, accepted: 2 });
    expect(r.body.batch).toMatch(/^upload-/);
    const stored = await db.query(`select payload_enc from network_record where panel = 'netz'`);
    expect(stored.rows).toHaveLength(2);
    // Encrypted at rest: the e-mail address is not readable in the table.
    expect(JSON.stringify(stored.rows)).not.toContain('demo-1@example.invalid');
  });

  it('reads an Excel file of questions', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Questions');
    ws.addRow(['question_id', 'label', 'type', 'options']);
    ws.addRow(['household_size', 'How many people live in your household?', 'single', '1=One|2=Two|3=Three']);
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await upload('questions', b64(file), false, 'xlsx').expect(200);
    expect(r.body).toMatchObject({ rows: 1, accepted: 1 });
    await upload('questions', b64('not a workbook'), true, 'xlsx').expect(400);
  });

  it('accepts a signed push once, and rejects a bad signature', async () => {
    await request(t.server)
      .post('/api/v1/networks/netz/push')
      .send({})
      .expect(404); // no key yet: pushes are off
    const k = await request(t.server)
      .post('/api/v1/networks/netz/push-key')
      .set(as(boss.token))
      .send({ reason: 'the network starts pushing', code: await code() })
      .expect(201);
    key = k.body.key;
    expect(key).toMatch(/^madp_push_/);
    const body = JSON.stringify({
      members: [{ memberId: 'demo-3', category: 'b2c', email: 'demo-3@example.invalid', active: true }],
      answers: [{ memberId: 'demo-1', questionId: 'household_size', values: ['3'] }],
      deletions: [{ memberId: 'demo-2' }],
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const send = (batch: string, sig: string, raw = body) =>
      request(t.server)
        .post('/api/v1/networks/netz/push')
        .set('content-type', 'application/json')
        .set('x-madp-batch', batch)
        .set('x-madp-timestamp', ts)
        .set('x-madp-signature', sig)
        .send(raw);
    await send('batch-0001', 'v1=' + '0'.repeat(64)).expect(401);
    const ok = await send('batch-0001', signWebhook(key, ts, 'batch-0001', body)).expect(202);
    expect(ok.body).toMatchObject({ batch: 'batch-0001', records: 3, duplicate: false });
    const again = await send('batch-0001', signWebhook(key, ts, 'batch-0001', body)).expect(202);
    expect(again.body).toMatchObject({ duplicate: true, records: 0 });
    const bad = JSON.stringify({ members: [{ memberId: 'x' }] });
    const r = await send('batch-0002', signWebhook(key, ts, 'batch-0002', bad), bad).expect(400);
    expect(r.body.problems.join(' ')).toContain('category');
  });

  it('syncs the inbox into MADP like any other panel', async () => {
    const r = await t.app.get(IngestionService).runSync('netz');
    expect(r.status).toBe('succeeded');
    const members = await db.query(
      `select si.source_member_id as id, pm.status, si.email_enc is null as wiped
       from panel_membership pm join source_identity si on si.id = pm.source_identity_id
       where pm.panel = 'netz' order by 1`,
    );
    // demo-2 was deleted by the push: its membership is closed and its personal data wiped.
    expect(members.rows).toEqual([
      { id: 'demo-1', status: 'active', wiped: false },
      { id: 'demo-2', status: 'deleted', wiped: true },
      { id: 'demo-3', status: 'active', wiped: false },
    ]);
    expect(r.counts).toMatchObject({ respondentsSeen: 3, membersRemoved: 1 });
    const cats = await db.query(`select distinct category from category_membership where panel = 'netz'`);
    expect(cats.rows).toEqual([{ category: 'consumer' }]);
    const consent = await db.query(
      `select count(*)::int as n from consent_record where panel = 'netz' and purpose = 'email_marketing' and status = 'granted'`,
    );
    expect(consent.rows[0].n).toBe(1);
    const status = await request(t.server).get('/api/v1/networks').set(as(boss.token)).expect(200);
    expect(status.body.networks[0].inbox).toMatchObject({ members: 3, answers: 1, questions: 1, deletions: 1 });
    expect(status.body.networks[0].batches).toHaveLength(3);
  });
});
