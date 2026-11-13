/**
 * Builds the backend selected by config.
 */

import type { ChartingHeroConfig } from '../config.js';
import { FhirBackend } from './fhir/fhir-backend.js';
import { MockBackend } from './mock-backend.js';
import type { PatientBackend } from './types.js';

export function createBackend(config: ChartingHeroConfig): PatientBackend {
  switch (config.backend) {
    case 'mock':
      return new MockBackend();
    case 'fhir':
      // loadConfig guarantees config.fhir when backend is fhir.
      return new FhirBackend({ config: config.fhir!, timeoutMs: config.requestTimeout });
  }
}
