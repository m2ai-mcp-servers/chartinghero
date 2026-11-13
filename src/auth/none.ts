/**
 * Request auth for the FHIR client. 0.2.0 has two providers: none (local HAPI) and a
 * static bearer token. SMART user auth arrives in 0.3.0.
 */

export interface AuthProvider {
  /** Headers to add to every request. Never logged. */
  headers(): Record<string, string>;
}

export const noAuth: AuthProvider = { headers: () => ({}) };
