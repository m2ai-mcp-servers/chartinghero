/**
 * Opaque paging cursors. A cursor round-trips through the model, so it is signed: a
 * cursor that was not issued by this process is rejected. Without that, a crafted cursor
 * could point a patient's history at another patient's page.
 *
 * The key lives for the process only. After a restart, old cursors are refused and the
 * caller repeats the search.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { ValidationError } from '../utils/errors.js';

const KEY = randomBytes(32);
const sign = (body: string) => createHmac('sha256', KEY).update(body).digest('base64url');

export function encodeCursor(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

/** Returns the payload when the signature and `kind` match; throws ValidationError otherwise. */
export function decodeCursor<T extends { k: string }>(cursor: string, kind: T['k']): T {
  const bad = () => new ValidationError('cursor is invalid or expired; repeat the request without it', 'cursor');
  const [body, mac, ...rest] = cursor.split('.');
  if (!body || !mac || rest.length > 0) throw bad();
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw bad();
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!payload || typeof payload !== 'object' || (payload as { k?: unknown }).k !== kind) throw bad();
  return payload as T;
}
