/**
 * Static bearer token (FHIR_BEARER_TOKEN).
 */

import { ConfigurationError } from '../utils/errors.js';
import type { AuthProvider } from './none.js';

/** RFC 6750 b64token. Anything else could smuggle a second header. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

export function bearerAuth(token: string): AuthProvider {
  if (!B64TOKEN.test(token)) throw new ConfigurationError('FHIR_BEARER_TOKEN is not a valid bearer token');
  const headers = { authorization: `Bearer ${token}` };
  return { headers: () => ({ ...headers }) };
}
