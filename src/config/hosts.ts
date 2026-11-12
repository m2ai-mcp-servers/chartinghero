/**
 * Hosts allowed to receive FHIR writes (and a configured Practitioner) in 0.2.0.
 *
 * Hard-coded on purpose: there is no env override. FHIR_ENVIRONMENT is operator-typed,
 * so it is not the only gate. Loopback, the project's LAN HAPI, and two public sandboxes.
 */
export const WRITE_HOSTS: readonly string[] = [
  '127.0.0.1',
  'localhost',
  '::1',
  '10.0.0.46',
  'hapi.fhir.org',
  'server.fire.ly',
];

/** URL.hostname wraps IPv6 in brackets; strip them before comparing. */
export function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

export function isWriteHost(hostname: string): boolean {
  return WRITE_HOSTS.includes(normalizeHost(hostname));
}
