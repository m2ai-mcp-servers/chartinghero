/**
 * Legacy environment shim, kept for one release (removed in 0.3.0).
 *
 * The only file that reads the pre-pivot vendor variables. They no longer select a
 * backend: RATCHET_MOCK_MODE=true is treated as BACKEND=mock when BACKEND is unset,
 * and POINTCARE_* values are ignored. Each one present yields a deprecation warning.
 */

type Env = Record<string, string | undefined>;

const IGNORED_VENDOR_VARS = [
  'POINTCARE_API_URL',
  'POINTCARE_API_KEY',
  'POINTCARE_CLIENT_ID',
  'POINTCARE_CLIENT_SECRET',
] as const;

export interface LegacyEnv {
  /** 'mock' when RATCHET_MOCK_MODE=true, else undefined. */
  backend?: 'mock';
  warnings: string[];
}

export function readLegacyEnv(env: Env): LegacyEnv {
  const warnings: string[] = [];
  let backend: 'mock' | undefined;

  if (env.RATCHET_MOCK_MODE !== undefined) {
    if (env.RATCHET_MOCK_MODE === 'true') backend = 'mock';
    warnings.push('RATCHET_MOCK_MODE is deprecated and will be removed in 0.3.0; use BACKEND=mock');
  }

  for (const name of IGNORED_VENDOR_VARS) {
    if (env[name] !== undefined) {
      warnings.push(`${name} is deprecated and ignored; configure BACKEND and FHIR_* instead`);
    }
  }

  return { backend, warnings };
}
