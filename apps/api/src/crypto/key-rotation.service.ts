import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Database } from '../db/database.js';
import { AuditService } from '../audit/audit.service.js';
import { FieldCrypto } from './field-crypto.js';

/** Every column that holds field-encrypted values, by table. Keep in step with the schema. */
export const ENCRYPTED_COLUMNS: Record<string, string[]> = {
  source_identity: ['email_enc', 'phone_enc', 'first_name_enc', 'last_name_enc', 'date_of_birth_enc'],
  admin_user: ['totp_secret_enc'],
  service_client: ['secret_enc'],
  panel_connection: ['sync_token_enc', 'admin_secret_enc', 'pending_enc'],
};

/** Primary key column of each table above, when it isn't `id`. */
const KEY_COLUMN: Record<string, string> = { panel_connection: 'panel' };

export interface RotationReport {
  activeKeyId: string;
  /** Values still on another key, by table and key id, before this run. */
  before: Record<string, Record<string, number>>;
  rowsRewritten: number;
  remaining: number;
}

/**
 * Re-encrypts every field-encrypted value that is not on the active key, in batches, so an old key can be retired.
 * Safe to stop and run again: each row is rewritten in its own small transaction, and rows already on the active
 * key are skipped. The e-mail keyed hash (PII_HASH_KEY) is a different key and is not touched here.
 */
@Injectable()
export class KeyRotationService {
  constructor(
    private readonly database: Database,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
  ) {}

  async status(): Promise<Record<string, Record<string, number>>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [table, cols] of Object.entries(ENCRYPTED_COLUMNS)) {
      out[table] = {};
      for (const col of cols) {
        const rows = await this.database.db.execute<{ kid: string; n: string }>(
          sql`select split_part(${sql.identifier(col)}, '.', 1) as kid, count(*) as n from ${sql.identifier(table)}
              where ${sql.identifier(col)} is not null group by 1`,
        );
        for (const r of rows.rows) out[table][r.kid] = (out[table][r.kid] ?? 0) + Number(r.n);
      }
    }
    return out;
  }

  async rotate(opts: { batchSize?: number; actorId?: string | null } = {}): Promise<RotationReport> {
    const batch = opts.batchSize ?? 500;
    const active = this.crypto.activeKeyId;
    const before = await this.status();
    let rowsRewritten = 0;
    for (const [table, cols] of Object.entries(ENCRYPTED_COLUMNS)) {
      const stale = sql.join(
        cols.map((c) => sql`(${sql.identifier(c)} is not null and split_part(${sql.identifier(c)}, '.', 1) <> ${active})`),
        sql` or `,
      );
      const key = sql.identifier(KEY_COLUMN[table] ?? 'id');
      for (;;) {
        const rows = await this.database.db.execute<Record<string, string | null> & { id: string }>(
          sql`select ${key} as id, ${sql.join(cols.map((c) => sql.identifier(c)), sql`, `)} from ${sql.identifier(table)}
              where ${stale} order by ${key} limit ${batch}`,
        );
        if (!rows.rows.length) break;
        for (const r of rows.rows) {
          const sets = cols.map((c) => sql`${sql.identifier(c)} = ${this.crypto.reencrypt(r[c])}`);
          // Only rewrite if the row has not changed since it was read (a sync may have re-encrypted it already).
          const same = sql.join(
            cols.map((c) => (r[c] === null ? sql`${sql.identifier(c)} is null` : sql`${sql.identifier(c)} = ${r[c]}`)),
            sql` and `,
          );
          await this.database.db.execute(
            sql`update ${sql.identifier(table)} set ${sql.join(sets, sql`, `)} where ${key} = ${r.id} and ${same}`,
          );
          rowsRewritten++;
        }
      }
    }
    const after = await this.status();
    const remaining = Object.values(after)
      .flatMap((byKey) => Object.entries(byKey))
      .filter(([kid]) => kid !== active)
      .reduce((n, [, v]) => n + v, 0);
    await this.audit.record({
      actorId: opts.actorId ?? null,
      actorType: opts.actorId ? 'admin' : 'system',
      action: 'crypto.field_keys_rotated',
      targetType: 'field_key',
      targetId: active,
      metadata: { before, rowsRewritten, remaining },
    });
    return { activeKeyId: active, before, rowsRewritten, remaining };
  }
}
