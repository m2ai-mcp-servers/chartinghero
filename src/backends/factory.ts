/**
 * Builds the backend selected by config. The FHIR backend lands in PR6.
 */

import type { ChartingHeroConfig } from '../config.js';
import { MockBackend } from './mock-backend.js';
import type { PatientBackend } from './types.js';

export class BackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

export function createBackend(config: ChartingHeroConfig): PatientBackend {
  switch (config.backend) {
    case 'mock':
      return new MockBackend();
    case 'fhir':
      throw new BackendUnavailableError('fhir backend not implemented in this build');
  }
}
