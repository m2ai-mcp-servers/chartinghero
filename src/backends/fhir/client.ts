/**
 * Minimal FHIR REST client over Node fetch. Read-only in PR6 (GET); writes land in PR7.
 *
 * - Every failure becomes a sanitized error: ApiError keeps the HTTP status and the
 *   OperationOutcome issue codes only, never upstream text.
 * - A paging link is followed only when it stays under FHIR_BASE_URL, so the bearer token
 *   and the patient query can never be sent to another origin.
 * - Redirects are refused for the same reason.
 * - Request URLs are never logged: search parameters carry names and identifiers.
 */

import type { Bundle, FhirResource } from 'fhir/r4.js';

import type { AuthProvider } from '../../auth/none.js';
import { ApiError, UnsupportedServerError } from '../../utils/errors.js';

export type SearchParams = ReadonlyArray<readonly [name: string, value: string]>;

export interface FhirClientOptions {
  baseUrl: string;
  auth: AuthProvider;
  timeoutMs: number;
  /** Test seam. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** FHIR id syntax (R4 `id` datatype). Checked before an id is placed in a URL path. */
export const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

/**
 * Escape a search parameter value: `,` means OR, `|` splits system and code, `$` splits
 * composites and `\` is the escape character (R4 search, "Escaping Search Parameters").
 */
export function escapeSearchValue(value: string): string {
  return value.replace(/[\\,|$]/g, (c) => `\\${c}`);
}

export class FhirClient {
  readonly base: URL;
  private readonly auth: AuthProvider;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: FhirClientOptions) {
    this.base = new URL(opts.baseUrl.replace(/\/+$/, ''));
    this.auth = opts.auth;
    this.timeoutMs = opts.timeoutMs;
    this.fetchFn = opts.fetch ?? fetch;
  }

  private url(path: string, params?: SearchParams): URL {
    const url = new URL(`${this.base.href.replace(/\/+$/, '')}/${path}`);
    for (const [name, value] of params ?? []) url.searchParams.append(name, value);
    return url;
  }

  /** The absolute URL of a search, so a cursor can ask for the same page again. */
  searchUrl(type: string, params: SearchParams): string {
    return this.url(type, params).href;
  }

  /** GET [base]/metadata. */
  metadata(): Promise<FhirResource> {
    return this.get(this.url('metadata'), 'CapabilityStatement');
  }

  /** GET [base]/[type]/[id]. The caller checks the id against FHIR_ID first. */
  read<T extends FhirResource>(type: T['resourceType'], id: string): Promise<T> {
    if (!FHIR_ID.test(id)) throw new ApiError(404, ['not-found']);
    return this.get(this.url(`${type}/${id}`), type) as Promise<T>;
  }

  /** GET [base]/[type]?params. */
  search(type: string, params: SearchParams, headers?: Record<string, string>): Promise<Bundle> {
    return this.get(this.url(type, params), 'Bundle', headers) as Promise<Bundle>;
  }

  /** Follow a paging link from a previous Bundle. Refused unless it stays under the base URL. */
  follow(link: string): Promise<Bundle> {
    let url: URL;
    try {
      // R4 allows a relative link; it resolves against the base like any other request.
      url = new URL(link, `${this.base.href.replace(/\/+$/, '')}/`);
    } catch {
      throw new UnsupportedServerError('FHIR server returned a paging link that is not a URL');
    }
    const basePath = this.base.pathname.replace(/\/+$/, '');
    const under = url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
    // Below the base only plain segments pass: servers and proxies disagree on `..;`, `%2F`
    // and `%2e`, so a link carrying one could leave the base after the check.
    const plain = under && /^(\/[A-Za-z0-9\-._~$]*)*$/.test(url.pathname.slice(basePath.length));
    if (url.origin !== this.base.origin || !plain || url.username || url.password) {
      throw new UnsupportedServerError('FHIR server returned a paging link outside FHIR_BASE_URL; refusing to follow it');
    }
    return this.get(url, 'Bundle') as Promise<Bundle>;
  }

  private async get(url: URL, expect: string, headers?: Record<string, string>): Promise<FhirResource> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'GET',
        headers: { accept: 'application/fhir+json', ...headers, ...this.auth.headers() },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // Read `name` without instanceof: an abort reason is a DOMException, which is not
      // always an Error of this realm.
      const name = String((error as { name?: unknown } | null)?.name ?? '');
      throw new ApiError(undefined, [name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'transient']);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }

    if (!res.ok) throw ApiError.fromOperationOutcome(res.status, body);
    if (!body || typeof body !== 'object' || (body as { resourceType?: unknown }).resourceType !== expect) {
      // A 200 that is not the resource we asked for (an HTML login page, an OperationOutcome).
      throw new ApiError(res.status, ['structure']);
    }
    return body as FhirResource;
  }
}
