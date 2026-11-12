/**
 * Configuration management for ChartingHero MCP server
 *
 * Loads configuration from environment variables.
 * In mock mode, API credentials are not required.
 */

export interface ChartingHeroConfig {
  // API Configuration
  apiUrl: string;
  apiKey: string;
  clientId?: string;
  clientSecret?: string;

  // Supabase Configuration (for the ChartingHero demo dashboard)
  supabaseUrl?: string;
  supabaseKey?: string;
  supabaseEnabled: boolean;

  // Runtime Configuration
  mockMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // Timeouts (ms)
  requestTimeout: number;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): ChartingHeroConfig {
  const mockMode = process.env.RATCHET_MOCK_MODE === 'true' ||
                   !process.env.POINTCARE_API_URL;

  // Supabase is enabled if both URL and key are provided
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const supabaseEnabled = !!(supabaseUrl && supabaseKey);

  return {
    // API settings - only required when not in mock mode
    apiUrl: process.env.POINTCARE_API_URL || 'https://api.pointcare.com',
    apiKey: process.env.POINTCARE_API_KEY || '',
    clientId: process.env.POINTCARE_CLIENT_ID,
    clientSecret: process.env.POINTCARE_CLIENT_SECRET,

    // Supabase settings
    supabaseUrl,
    supabaseKey,
    supabaseEnabled,

    // Runtime settings
    mockMode,
    logLevel: (process.env.LOG_LEVEL as ChartingHeroConfig['logLevel']) || 'info',

    // Timeouts
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
  };
}

/**
 * Validate configuration for production use
 */
export function validateConfig(config: ChartingHeroConfig): string[] {
  const errors: string[] = [];

  if (!config.mockMode) {
    if (!config.apiUrl) {
      errors.push('POINTCARE_API_URL is required when not in mock mode');
    }
    if (!config.apiKey) {
      errors.push('POINTCARE_API_KEY is required when not in mock mode');
    }
  }

  return errors;
}

// Singleton config instance
let configInstance: ChartingHeroConfig | null = null;

export function getConfig(): ChartingHeroConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export function resetConfig(): void {
  configInstance = null;
}
