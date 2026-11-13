/**
 * Transport for the FHIR contract suite.
 *
 * - Default: replay tests/fixtures/recorded/hapi-r4.json. No network, runs anywhere.
 * - FHIR_IT_BASE_URL set: talk to that server (the local container, or the CI service).
 * - FHIR_IT_BASE_URL and FHIR_RECORD=1: also rewrite the fixture from what the server said.
 *
 * Recordings come from the local container only, seeded by scripts/seed-fhir.mjs with
 * fictional people. /metadata is cut down to the four resource types this client reads
 * (the full statement is about 2 MB), and paging ids are renamed so a new recording
 * changes as little as possible.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURE = path.join(process.cwd(), 'tests', 'fixtures', 'recorded', 'hapi-r4.json');
const TYPES = new Set(['Patient', 'Encounter', 'Observation', 'DocumentReference']);

interface Exchange {
  status: number;
  body: unknown;
}
interface Fixture {
  note: string;
  source: string;
  base: string;
  exchanges: Record<string, Exchange>;
}

export interface Transport {
  mode: 'replay' | 'live' | 'record';
  base: string;
  fetch: typeof fetch;
  /** Write the fixture (record mode only). */
  save(): void;
  /**
   * Replay: requests with no recording. The client reports a failed fetch as a transient
   * upstream error, so the suite checks this list to name the real cause.
   */
  misses: string[];
}

function trimMetadata(body: unknown): unknown {
  const cs = body as { fhirVersion?: string; rest?: Array<{ mode?: string; resource?: Array<Record<string, unknown>> }> };
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    kind: 'instance',
    fhirVersion: cs.fhirVersion,
    format: ['application/fhir+json'],
    rest: (cs.rest ?? []).map((r) => ({
      mode: r.mode,
      resource: (r.resource ?? [])
        .filter((x) => TYPES.has(String(x.type)))
        .map((x) => ({
          type: x.type,
          interaction: x.interaction,
          searchParam: ((x.searchParam as Array<{ name: string; type: string }>) ?? []).map((p) => ({ name: p.name, type: p.type })),
          searchRevInclude: x.searchRevInclude,
        })),
    })),
  };
}

export function fhirTransport(): Transport {
  const live = process.env.FHIR_IT_BASE_URL?.replace(/\/+$/, '');

  if (!live) {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
    const misses: string[] = [];
    const replay = (async (input: URL | string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input).slice(fixture.base.length)}`;
      const hit = fixture.exchanges[key];
      if (!hit) {
        misses.push(key);
        throw new Error(`no recording for "${key}"; record again with FHIR_RECORD=1 FHIR_IT_BASE_URL=... npx jest tests/contract/fhir`);
      }
      return new Response(JSON.stringify(hit.body), { status: hit.status });
    }) as typeof fetch;
    return { mode: 'replay', base: fixture.base, fetch: replay, save: () => undefined, misses };
  }

  const record = process.env.FHIR_RECORD === '1';
  if (!record) return { mode: 'live', base: live, fetch, save: () => undefined, misses: [] };

  const exchanges: Record<string, Exchange> = {};
  /** A request made twice must get the same answer, or replay would depend on test order. */
  const conflicts: string[] = [];
  const stable = (body: unknown) => JSON.stringify({ ...(body as object), id: undefined, meta: undefined });
  const pages = new Map<string, string>();
  const rename = (text: string) =>
    text.replace(/_getpages=([0-9a-f-]{36})/g, (_m, id: string) => {
      if (!pages.has(id)) pages.set(id, `recorded-page-${pages.size + 1}`);
      return `_getpages=${pages.get(id)}`;
    });
  const restore = (text: string) => {
    const ids = new Map([...pages].map(([id, alias]) => [alias, id]));
    return text.replace(/_getpages=(recorded-page-\d+)/g, (m, alias: string) => (ids.has(alias) ? `_getpages=${ids.get(alias)}` : m));
  };

  const recording = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    const res = await fetch(restore(url), init);
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(rename(text));
    } catch {
      body = null;
    }
    const rel = rename(url).slice(live.length);
    const key = `${init?.method ?? 'GET'} ${rel}`;
    const exchange = { status: res.status, body: rel === '/metadata' ? trimMetadata(body) : body };
    const earlier = exchanges[key];
    if (earlier && (earlier.status !== exchange.status || stable(earlier.body) !== stable(exchange.body))) conflicts.push(key);
    exchanges[key] = earlier ?? exchange;
    // The caller sees the renamed paging links too, so its next request matches a key.
    return new Response(rename(text), { status: res.status });
  }) as typeof fetch;

  return {
    mode: 'record',
    base: live,
    fetch: recording,
    misses: [],
    save() {
      if (conflicts.length > 0) {
        throw new Error(`recording is not repeatable; these requests got two different answers:\n${conflicts.join('\n')}`);
      }
      const fixture: Fixture = {
        note: 'Generated by FHIR_RECORD=1; do not edit. Fictional people only. /metadata is trimmed; paging ids are renamed.',
        source: 'hapiproject/hapi:v8.12.0-2 (docker/compose.fhir.yml) seeded by scripts/seed-fhir.mjs',
        base: live,
        exchanges: Object.fromEntries(Object.entries(exchanges).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      };
      writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
    },
  };
}
