import { describe, expect, it } from 'vitest';
import { changed, maskPersonal } from './mask.js';

describe('maskPersonal', () => {
  it('masks personal fields and redacts secrets, keeps the rest', () => {
    expect(
      maskPersonal({
        email: 'asha@example.invalid',
        phone: '+919876543210',
        address: { street: '12 Long Road' },
        password: 'x',
        points: 500,
        status: 'active',
        nested: [{ upiId: 'asha@upi' }],
      }),
    ).toEqual({
      email: 'a***@example.invalid',
      phone: '+***10',
      address: { street: '1***ad' },
      password: '[redacted]',
      points: 500,
      status: 'active',
      nested: [{ upiId: 'a***@upi' }],
    });
  });

  it('reports only changed fields', () => {
    expect(changed({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ before: { b: 2 }, after: { b: 3 }, any: true });
  });
});
