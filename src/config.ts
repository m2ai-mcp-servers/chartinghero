/**
 * Configuration for the ChartingHero MCP server.
 *
 * Fails closed: an invalid value aborts startup instead of falling back silently.
 * Rules: docs/FHIR-PIVOT-PLAN.md section 3.2.
 */

import { isWriteHost, LOOPBACK_HOSTS, normalizeHost } from './config/hosts.js';
import { readLegacyEnv } from './legacy-env.js';

type Env = Record<string, string | undefined>;

export type BackendKind = 'mock' | 'fhir';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const MOCK_BANNER = '[MOCK DATA: fictional patients]';
export const DEFAULT_IDENTIFIER_SYSTEM = 'https://memyselfplusai.com/fhir/chartinghero';

export interface FhirConfig {
  baseUrl: string;
  host: string;
  environment: 'local' | 'sandbox';
  write: boolean;
  writeProfile: 'full' | 'note-only';
  bearerToken?: string;
  practitionerId: string;
  identifierSystem: string;
}

export interface ChartingHeroConfig {
  backend: BackendKind;
  /** True when BACKEND was unset and nothing else selected a backend. */
  backendDefaulted: boolean;
  fhir?: FhirConfig;
  visitTimezone?: string;

  // Demo dashboard projection (Supabase)
  dashboardSync: boolean;
  supabaseUrl?: string;
  supabaseKey?: string;
  supabaseEnabled: boolean;

  logLevel: LogLevel;
  requestTimeout: number;

  /** Deprecation warnings to log at startup. */
  warnings: string[];
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('; '));
    this.name = 'ConfigError';
  }
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function onOff(env: Env, name: string, problems: string[]): boolean {
  const v = env[name];
  if (v === undefined || v === '' || v === 'off') return false;
  if (v === 'on') return true;
  problems.push(`${name} must be on or off (got ${v})`);
  return false;
}

/**
 * Parse and validate configuration. Throws ConfigError listing every problem found.
 */
export function loadConfig(env: Env = process.env): ChartingHeroConfig {
  const problems: string[] = [];
  const legacy = readLegacyEnv(env);

  // LOG_LEVEL
  const rawLevel = env.LOG_LEVEL;
  let logLevel: LogLevel = 'info';
  if (rawLevel !== undefined && rawLevel !== '') {
    if ((LOG_LEVELS as readonly string[]).includes(rawLevel)) {
      logLevel = rawLevel as LogLevel;
    } else {
      problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got ${rawLevel})`);
    }
  }

  // BACKEND
  const fhirVarsSet = Object.keys(env).some((k) => k.startsWith('FHIR_') && env[k] !== undefined);
  const rawBackend = env.BACKEND;
  let backend: BackendKind = 'mock';
  let backendDefaulted = false;
  if (rawBackend !== undefined && rawBackend !== '') {
    if (rawBackend === 'mock' || rawBackend === 'fhir') {
      backend = rawBackend;
    } else {
      problems.push(`BACKEND must be mock or fhir (got ${rawBackend})`);
    }
  } else if (fhirVarsSet) {
    problems.push('BACKEND is required when FHIR_* vars are set');
  } else if (legacy.backend) {
    backend = legacy.backend;
  } else {
    backendDefaulted = true;
  }

  // VISIT_TIMEZONE
  const visitTimezone = env.VISIT_TIMEZONE || undefined;
  if (visitTimezone && !isValidTimeZone(visitTimezone)) {
    problems.push(`VISIT_TIMEZONE is not a valid IANA time zone (got ${visitTimezone})`);
  }

  // FHIR
  let fhir: FhirConfig | undefined;
  if (backend === 'fhir') {
    fhir = parseFhir(env, problems);
    if (!visitTimezone) problems.push('VISIT_TIMEZONE is required when BACKEND=fhir');
  }

  const dashboardSync = onOff(env, 'DASHBOARD_SYNC', problems);

  const timeoutRaw = env.REQUEST_TIMEOUT;
  const requestTimeout = timeoutRaw ? Number(timeoutRaw) : 30000;
  if (!Number.isInteger(requestTimeout) || requestTimeout <= 0) {
    problems.push(`REQUEST_TIMEOUT must be a positive integer of milliseconds (got ${timeoutRaw})`);
  }

  if (problems.length > 0) throw new ConfigError(problems);

  const supabaseUrl = env.SUPABASE_URL || undefined;
  const supabaseKey = env.SUPABASE_ANON_KEY || undefined;

  return {
    backend,
    backendDefaulted,
    fhir,
    visitTimezone,
    dashboardSync,
    supabaseUrl,
    supabaseKey,
    supabaseEnabled: !!(supabaseUrl && supabaseKey),
    logLevel,
    requestTimeout,
    warnings: legacy.warnings,
  };
}

function parseFhir(env: Env, problems: string[]): FhirConfig | undefined {
  const start = problems.length;

  const baseUrl = env.FHIR_BASE_URL;
  let host = '';
  // Read from the parsed URL: the raw string may say HTTP:// or start with a space.
  let plainHttp = false;
  if (!baseUrl) {
    problems.push('FHIR_BASE_URL is required when BACKEND=fhir');
  } else {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        problems.push(`FHIR_BASE_URL must be http or https (got ${url.protocol})`);
      }
      plainHttp = url.protocol === 'http:';
      host = normalizeHost(url.hostname);
    } catch {
      problems.push('FHIR_BASE_URL is not a valid URL');
    }
  }

  const rawEnv = env.FHIR_ENVIRONMENT;
  let environment: FhirConfig['environment'] = 'local';
  if (rawEnv === 'local' || rawEnv === 'sandbox') {
    environment = rawEnv;
  } else if (rawEnv === 'production') {
    problems.push('FHIR_ENVIRONMENT=production is not supported until SMART user auth (0.3.0)');
  } else if (!rawEnv) {
    problems.push('FHIR_ENVIRONMENT is required when BACKEND=fhir (local or sandbox)');
  } else {
    problems.push(`FHIR_ENVIRONMENT must be local or sandbox (got ${rawEnv})`);
  }

  const write = onOff(env, 'FHIR_WRITE', problems);
  if (write && host && !isWriteHost(host)) {
    problems.push(`FHIR_WRITE=on refused: host ${host} is not in WRITE_HOSTS`);
  }

  const rawProfile = env.FHIR_WRITE_PROFILE;
  let writeProfile: FhirConfig['writeProfile'] = 'full';
  if (rawProfile === 'full' || rawProfile === 'note-only') {
    writeProfile = rawProfile;
  } else if (rawProfile) {
    problems.push(`FHIR_WRITE_PROFILE must be full or note-only (got ${rawProfile})`);
  }

  const practitionerId = env.FHIR_PRACTITIONER_ID ?? '';
  if (!practitionerId) {
    problems.push('FHIR_PRACTITIONER_ID is required when BACKEND=fhir');
  } else if (!FHIR_ID.test(practitionerId)) {
    problems.push('FHIR_PRACTITIONER_ID is not a valid FHIR resource id');
  } else if (host && !isWriteHost(host)) {
    problems.push(`FHIR_PRACTITIONER_ID refused: host ${host} is not in WRITE_HOSTS`);
  }

  if (env.FHIR_BEARER_TOKEN && plainHttp && host && !LOOPBACK_HOSTS.includes(host)) {
    problems.push('FHIR_BEARER_TOKEN refused: FHIR_BASE_URL is plain http on a host that is not loopback; use https');
  }

  const identifierSystem = env.FHIR_IDENTIFIER_SYSTEM || DEFAULT_IDENTIFIER_SYSTEM;
  if (!/^(https?:\/\/\S+|urn:\S+)$/.test(identifierSystem)) {
    problems.push('FHIR_IDENTIFIER_SYSTEM must be an http(s) URL or a urn');
  }

  if (problems.length > start) return undefined;
  return {
    baseUrl: baseUrl!,
    host,
    environment,
    write,
    writeProfile,
    bearerToken: env.FHIR_BEARER_TOKEN || undefined,
    practitionerId,
    identifierSystem,
  };
}

// Singleton config instance
let configInstance: ChartingHeroConfig | null = null;

/** Returns the validated config. Throws ConfigError if the environment is invalid. */
export function getConfig(): ChartingHeroConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export function resetConfig(): void {
  configInstance = null;
}
