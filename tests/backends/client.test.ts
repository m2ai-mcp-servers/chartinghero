/**
 * FHIR client, capability parsing, cursors and query parsing. Synthetic data only.
 */

import { describe, test, expect } from '@jest/globals';

import { bearerAuth } from '../../src/auth/bearer.js';
import { noAuth } from '../../src/auth/none.js';
import { decodeCursor, encodeCursor } from '../../src/backends/cursor.js';
import { parseCapabilities } from '../../src/backends/fhir/capabilities.js';
import { escapeSearchValue, FhirClient } from '../../src/backends/fhir/client.js';
import { parseNameQuery } from '../../src/backends/query.js';
import { ApiError, ConfigurationError, UnsupportedServerError, ValidationError } from '../../src/utils/errors.js';
import { BASE, capabilityStatement } from '../support/fake-fhir.js';

type Call = { url: string; init: RequestInit };

function client(respond: (call: Call) => Response | Promise<Response>, auth = noAuth, timeoutMs = 1000) {
  const calls: Call[] = [];
  const fetchFn = (async (input: URL | string, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, client: new FhirClient({ baseUrl: `${BASE}/`, auth, timeoutMs, fetch: fetchFn }) };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const BUNDLE = { resourceType: 'Bundle', type: 'searchset' };

describe('FhirClient', () => {
  test('builds search URLs under the base and sends the FHIR accept header, GET, no redirects', async () => {
    const { calls, client: c } = client(() => json(200, BUNDLE));
    await c.search('Patient', [['name', 'Sample'], ['name', 'Tessa'], ['identifier', 'urn:x|PT 1&_count=99']]);
    expect(calls[0].url).toBe(`${BASE}/Patient?name=Sample&name=Tessa&identifier=urn%3Ax%7CPT+1%26_count%3D99`);
    expect(calls[0].init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(calls[0].init.headers).toEqual({ accept: 'application/fhir+json' });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  test('sends the bearer token when configured, and it cannot be replaced by a caller header', async () => {
    const { calls, client: c } = client(() => json(200, BUNDLE), bearerAuth('synthetic-token.123'));
    await c.search('Encounter', [], { prefer: 'handling=strict', authorization: 'Bearer other' });
    expect(calls[0].init.headers).toEqual({
      accept: 'application/fhir+json',
      prefer: 'handling=strict',
      authorization: 'Bearer synthetic-token.123',
    });
  });

  test.each(['two words', 'line\nbreak', '', 'tökén'])('rejects bearer token %j', (token) => {
    expect(() => bearerAuth(token)).toThrow(ConfigurationError);
  });

  test('an error response keeps the status and issue codes and drops every upstream string', async () => {
    const { client: c } = client(() =>
      json(422, {
        resourceType: 'OperationOutcome',
        issue: [
          { severity: 'error', code: 'processing', diagnostics: 'Tessa Sample 1940-01-02', details: { text: 'PT-90001' } },
          { severity: 'error', code: 'made-up-code' },
        ],
      })
    );
    const error = (await c.search('Patient', []).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.httpStatus).toBe(422);
    expect(error.issueCodes).toEqual(['processing']);
    const everything = `${error.message} ${JSON.stringify(error)} ${error.stack}`;
    for (const leak of ['Tessa', '1940-01-02', 'PT-90001', 'made-up-code', 'fhir.test']) expect(everything).not.toContain(leak);
  });

  test('a non-JSON error body still yields a sanitized ApiError', async () => {
    const { client: c } = client(() => new Response('<html>Tessa Sample</html>', { status: 502 }));
    const error = (await c.search('Patient', []).catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe('Upstream request failed (HTTP 502)');
  });

  test('a 200 that is not the expected resource is an error', async () => {
    for (const body of [{ resourceType: 'OperationOutcome', issue: [] }, 'login page', null, { resourceType: 'Patient' }]) {
      const { client: c } = client(() => json(200, body));
      await expect(c.search('Patient', [])).rejects.toMatchObject({ httpStatus: 200, issueCodes: ['structure'] });
    }
  });

  test('a timeout and a network failure are reported without the URL or cause', async () => {
    const slow = client(
      ({ init }) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
      noAuth,
      20
    );
    await expect(slow.client.search('Patient', [['name', 'Tessa']])).rejects.toMatchObject({
      message: 'Upstream request failed (timeout)',
      httpStatus: undefined,
    });
    const down = client(() => {
      throw new TypeError(`fetch failed: connect ECONNREFUSED ${BASE}/Patient?name=Tessa`);
    });
    const error = (await down.client.search('Patient', [['name', 'Tessa']]).catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe('Upstream request failed (transient)');
    expect(`${JSON.stringify(error)} ${error.stack}`).not.toContain('Tessa');
  });

  test('read refuses an id that is not a FHIR id without sending anything', async () => {
    const { calls, client: c } = client(() => json(200, { resourceType: 'Patient', id: 'x' }));
    for (const id of ['../metadata', 'a/b', 'a?b=1', '', 'x'.repeat(65), 'a b']) {
      expect(() => c.read('Patient', id)).toThrow(ApiError);
    }
    expect(calls).toHaveLength(0);
    await c.read('Patient', 'abc-1.2');
    expect(calls[0].url).toBe(`${BASE}/Patient/abc-1.2`);
  });

  test.each([
    [`${BASE}?_getpages=1`, true],
    [`${BASE}/Patient?_getpages=1`, true],
    ['https://fhir.test/r4x?_getpages=1', false],
    ['https://fhir.test/?_getpages=1', false],
    ['http://fhir.test/r4?_getpages=1', false],
    ['https://fhir.test:8443/r4?_getpages=1', false],
    ['https://fhir.test.evil.example/r4?_getpages=1', false],
    ['https://a:b@fhir.test/r4?_getpages=1', false],
    // A relative link resolves against the base, like any other request.
    ['?_getpages=1', true],
    ['Patient?_getpages=1', true],
    ['/r4/Patient?_getpages=1', true],
    ['/other?_getpages=1', false],
    ['//fhir.test.evil.example/r4?_getpages=1', false],
    // Segments a server or proxy may read differently from this check.
    [`${BASE}/..;/admin?_getpages=1`, false],
    [`${BASE}/Patient;x=1?_getpages=1`, false],
    [`${BASE}/%2e%2e%2fadmin?_getpages=1`, false],
    [`${BASE}/a%2Fb?_getpages=1`, false],
    [`${BASE}/a%5Cb?_getpages=1`, false],
    [`${BASE}/../admin?_getpages=1`, false],
    ['http://[', false],
  ])('follow(%s) allowed=%s', async (link, allowed) => {
    const { calls, client: c } = client(() => json(200, BUNDLE), bearerAuth('synthetic-token'));
    if (allowed) {
      await c.follow(link);
      expect(calls).toHaveLength(1);
    } else {
      expect(() => c.follow(link)).toThrow(UnsupportedServerError);
      expect(calls).toHaveLength(0);
    }
  });

  test('escapeSearchValue escapes the four FHIR search separators', () => {
    expect(escapeSearchValue('a,b|c$d\\e')).toBe('a\\,b\\|c\\$d\\\\e');
  });
});

describe('parseCapabilities', () => {
  test('reads a full server', () => {
    expect(parseCapabilities(capabilityStatement())).toEqual({
      fhirVersion: '4.0.1',
      patientPhoneSearch: true,
      encounterSearch: true,
      encounterClassSearch: true,
      encounterTypeSearch: true,
      encounterIdentifierSearch: true,
      encounterRevIncludes: true,
      writeProfile: 'full',
    });
  });

  test('each gate follows its own entry in /metadata', () => {
    const caps = (o: Parameters<typeof capabilityStatement>[0]) => parseCapabilities(capabilityStatement(o));
    expect(caps({ hide: ['Patient.phone'] }).patientPhoneSearch).toBe(false);
    expect(caps({ hide: ['Encounter.date'] }).encounterSearch).toBe(false);
    expect(caps({ hide: ['Encounter.class'] })).toMatchObject({ encounterClassSearch: false, encounterTypeSearch: true });
    expect(caps({ hide: ['Encounter.type'] })).toMatchObject({ encounterClassSearch: true, encounterTypeSearch: false });
    expect(caps({ hide: ['Encounter.identifier'] }).encounterIdentifierSearch).toBe(false);
    expect(caps({ noRevInclude: true }).encounterRevIncludes).toBe(false);
    expect(caps({ noInteraction: ['Observation.create'] }).writeProfile).toBe('note-only');
    expect(caps({ noInteraction: ['Encounter.create'] }).writeProfile).toBe('note-only');
    // A listed parameter on a type that cannot be searched is not usable.
    expect(caps({ noInteraction: ['Encounter.search-type'] })).toMatchObject({
      encounterSearch: false,
      encounterIdentifierSearch: false,
    });
  });

  test('a statement with no rest section turns every gate off', () => {
    expect(parseCapabilities({ ...capabilityStatement(), rest: undefined })).toMatchObject({
      patientPhoneSearch: false,
      encounterSearch: false,
      encounterIdentifierSearch: false,
      encounterRevIncludes: false,
      writeProfile: 'note-only',
    });
  });

  test('the version error does not repeat the server-supplied string', () => {
    const cs = capabilityStatement({ fhirVersion: '<script>5.0' });
    expect(() => parseCapabilities(cs)).toThrow(/^FHIR server is not R4: \/metadata fhirVersion must start with 4\.0$/);
  });
});

describe('cursor', () => {
  test('round-trips its payload', () => {
    const c = encodeCursor({ k: 'history', pid: 'p1', url: 'u' });
    expect(decodeCursor(c, 'history')).toEqual({ k: 'history', pid: 'p1', url: 'u' });
  });

  test('rejects another kind, a changed body, a changed signature and junk', () => {
    const c = encodeCursor({ k: 'history', pid: 'p1' });
    const [body, mac] = c.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ k: 'history', pid: 'p2' })).toString('base64url');
    for (const bad of [c.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')), `${forgedBody}.${mac}`, `${body}.`, body, `${c}.x`, '', '.', 'a.b']) {
      expect(() => decodeCursor(bad, 'history')).toThrow(ValidationError);
    }
    expect(() => decodeCursor(c, 'search')).toThrow('cursor is invalid or expired');
  });
});

describe('parseNameQuery', () => {
  test.each([
    ['Tessa Sample', { tokens: ['Tessa', 'Sample'] }],
    ['Sample, Tessa', { tokens: ['Sample', 'Tessa'] }],
    ['Sample 1940-01-02', { tokens: ['Sample'], birthDate: '1940-01-02' }],
    ['1940-01-02', { tokens: [], birthDate: '1940-01-02' }],
    ['Sample 1940-13-45', { tokens: ['Sample', '1940-13-45'] }],
    ['  ', { tokens: [] }],
  ])('%j', (query, want) => {
    expect(parseNameQuery(query)).toEqual(want);
  });
});
