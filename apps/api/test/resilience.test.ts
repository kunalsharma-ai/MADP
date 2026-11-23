import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorError } from '@madp/connectors';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { startTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
const bearer = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  t = await startTestApp();
  token = (await t.adminToken('super_admin')).token;
});
afterAll(async () => t?.stop());

describe('dead-letter queue and reconciliation', () => {
  it('parks an answer batch that keeps failing, finishes the import, and reports the discrepancy', async () => {
    const slot = t.app.get(ConnectorRegistry).get('mfr');
    const original = slot.connector.listAnswers.bind(slot.connector);
    let failures = 1;
    slot.connector.listAnswers = async (...args) => {
      if (failures-- > 0) throw new ConnectorError('Source error 503: unavailable', 'mfr', 'source_error');
      return original(...args);
    };
    try {
      const run = await request(t.server)
        .post('/api/v1/connectors/mfr/import')
        .set(bearer())
        .send({ dryRun: false })
        .expect(200);
      expect(run.body.status).toBe('succeeded');
      expect(run.body.counts.deadLettered).toBe(1);
      expect(run.body.counts.deadLetteredMembers).toBeGreaterThan(0);

      const dl = await request(t.server).get('/api/v1/dead-letters?panel=mfr').set(bearer()).expect(200);
      expect(dl.body).toHaveLength(1);
      expect(dl.body[0]).toMatchObject({
        panel: 'mfr',
        stream: 'answers',
        errorKind: 'source_error',
        status: 'open',
      });
      expect(dl.body[0].sourceMemberIds).toBeUndefined();

      const rec = await request(t.server)
        .get(`/api/v1/imports/${run.body.jobId}/reconciliation`)
        .set(bearer())
        .expect(200);
      expect(rec.body.status).toBe('discrepancies');
      expect(rec.body.source.respondents).toBe(rec.body.madp.identitiesWrittenByJob);
      expect(rec.body.checks.find((c: { check: string }) => c.check.includes('dead-letter')).ok).toBe(false);

      const before = rec.body.madp.currentAnswers;
      const retry = await request(t.server)
        .post('/api/v1/connectors/mfr/dead-letters/retry')
        .set(bearer())
        .expect(200);
      expect(retry.body).toMatchObject({ attempted: 1, resolved: 1, stillOpen: 0 });
      expect(retry.body.answersChanged).toBeGreaterThan(0);

      const after = await request(t.server)
        .get(`/api/v1/imports/${run.body.jobId}/reconciliation`)
        .set(bearer())
        .expect(200);
      expect(after.body.status).toBe('reconciled');
      expect(after.body.madp.currentAnswers).toBeGreaterThan(before);
    } finally {
      slot.connector.listAnswers = original;
    }
  });

  it('fails the job, without dead-lettering, when the source refuses access', async () => {
    const slot = t.app.get(ConnectorRegistry).get('t2o');
    const original = slot.connector.listAnswers.bind(slot.connector);
    slot.connector.listAnswers = async () => {
      throw new ConnectorError('Source refused access (403)', 't2o', 'not_authorised');
    };
    try {
      const run = await request(t.server)
        .post('/api/v1/connectors/t2o/import')
        .set(bearer())
        .send({ dryRun: false })
        .expect(200);
      expect(run.body.status).toBe('failed');
      const dl = await request(t.server).get('/api/v1/dead-letters?panel=t2o').set(bearer()).expect(200);
      expect(dl.body).toHaveLength(0);
      const rec = await request(t.server)
        .get(`/api/v1/imports/${run.body.jobId}/reconciliation`)
        .set(bearer())
        .expect(200);
      expect(rec.body.status).toBe('failed');
    } finally {
      slot.connector.listAnswers = original;
    }
  });

  it('only operators can retry dead letters', async () => {
    const analyst = (await t.adminToken('analyst')).token;
    await request(t.server)
      .post('/api/v1/connectors/mfr/dead-letters/retry')
      .set({ authorization: `Bearer ${analyst}` })
      .expect(403);
  });
});

describe('direct identifiers', () => {
  it('never stores contact details as profile answers, even when the source returns them', async () => {
    const slot = t.app.get(ConnectorRegistry).get('mho');
    const original = slot.connector.listAnswers.bind(slot.connector);
    const asked: string[][] = [];
    slot.connector.listAnswers = async (members, questions) => {
      asked.push(questions);
      const real = await original(members, questions);
      return [
        ...real,
        ...members.map((m) => ({
          panel: 'mho' as const,
          sourceMemberId: m,
          sourceQuestionId: 'mail',
          values: [`${m}@example.invalid`],
          sourceUpdatedAt: null,
        })),
      ];
    };
    try {
      const run = await request(t.server)
        .post('/api/v1/connectors/mho/import')
        .set(bearer())
        .send({ dryRun: false })
        .expect(200);
      expect(run.body.status).toBe('succeeded');
      expect(asked.flat()).not.toContain('mail');
      expect(asked.flat()).not.toContain('phone');
      const { Mongo } = await import('../src/mongo/mongo.js');
      const mongo = t.app.get(Mongo);
      expect(
        await mongo.profileAnswers.countDocuments({
          sourceQuestionId: { $in: ['mail', 'phone', 'firstname'] },
        }),
      ).toBe(0);
      expect(await mongo.profileAnswers.countDocuments({ panel: 'mho' })).toBeGreaterThan(0);
    } finally {
      slot.connector.listAnswers = original;
    }
  });
});
