/**
 * Supabase Service - Writes visit data to the ChartingHero demo dashboard
 *
 * This service syncs visit notes to Supabase so the dashboard can
 * display real-time updates when nurses document visits via ChartingHero.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import type { VisitNote, VitalSigns } from '../types/index.js';

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create Supabase client
 */
function getSupabaseClient(): SupabaseClient | null {
  const config = getConfig();

  if (!config.supabaseEnabled) {
    return null;
  }

  if (!supabaseClient && config.supabaseUrl && config.supabaseKey) {
    supabaseClient = createClient(config.supabaseUrl, config.supabaseKey);
    logger.info('Supabase client initialized');
  }

  return supabaseClient;
}

/**
 * Transform ChartingHero VitalSigns to Supabase format
 */
function transformVitals(vitals?: VitalSigns): Record<string, unknown> {
  if (!vitals) return {};

  return {
    bloodPressureSystolic: vitals.bloodPressureSystolic ?? null,
    bloodPressureDiastolic: vitals.bloodPressureDiastolic ?? null,
    heartRate: vitals.heartRate ?? null,
    oxygenSaturation: vitals.oxygenSaturation ?? null,
    temperature: vitals.temperature ?? null,
    temperatureUnit: vitals.temperatureUnit ?? 'F',
    respiratoryRate: vitals.respiratoryRate ?? null,
    painLevel: vitals.painLevel ?? null,
    weight: vitals.weight ?? null,
    weightUnit: vitals.weightUnit ?? 'lbs',
    bloodGlucose: null, // ChartingHero doesn't have this field yet
    glucoseUnit: 'mg/dL',
    glucoseTiming: null,
  };
}

/**
 * Transform interventions array to Supabase format
 * ChartingHero uses string[], Supabase expects [{code, description, completed}]
 */
function transformInterventions(interventions?: string[]): Array<{
  code: string;
  description: string;
  completed: boolean;
}> {
  if (!interventions || interventions.length === 0) return [];

  return interventions.map((desc, index) => ({
    code: `INT-${String(index + 1).padStart(3, '0')}`,
    description: desc,
    completed: true, // Assume completed if listed
  }));
}

/**
 * Transform education array to Supabase format
 */
function transformEducation(education?: string[]): Array<{
  code: string;
  description: string;
  completed: boolean;
}> {
  if (!education || education.length === 0) return [];

  return education.map((desc, index) => ({
    code: `EDU-${String(index + 1).padStart(3, '0')}`,
    description: desc,
    completed: true, // Assume completed if listed
  }));
}

/**
 * Transform ChartingHero VisitNote to Supabase schema
 */
function transformVisitToSupabase(visit: VisitNote): Record<string, unknown> {
  return {
    id: visit.id,
    patient_id: visit.patientId,
    visit_type: visit.visitType,
    visit_date: visit.visitDate,
    time_in: visit.timeIn,
    time_out: visit.timeOut,
    nurse_name: visit.nurseName,
    vital_signs: transformVitals(visit.vitalSigns),
    subjective: visit.subjective ?? null,
    objective: visit.objective ?? null,
    assessment: visit.assessment ?? null,
    plan: visit.plan ?? null,
    interventions: transformInterventions(visit.interventions),
    education: transformEducation(visit.education),
    next_visit_date: visit.nextVisitDate ?? null,
    status: visit.status,
  };
}

/**
 * Sync a visit note to Supabase (upsert)
 */
export async function syncVisitToSupabase(visit: VisitNote): Promise<boolean> {
  const client = getSupabaseClient();

  if (!client) {
    logger.debug('Supabase not configured, skipping sync');
    return false;
  }

  const startTime = Date.now();

  try {
    const supabaseData = transformVisitToSupabase(visit);

    logger.info('Syncing visit to Supabase', {
      visitId: visit.id,
      patientId: visit.patientId,
    });

    const { error } = await client
      .from('visits')
      .upsert(supabaseData, { onConflict: 'id' })
      .select();

    if (error) {
      logger.error('Supabase sync failed', {
        error: error.message,
        code: error.code,
        visitId: visit.id,
      });
      return false;
    }

    logger.info('Supabase sync successful', {
      visitId: visit.id,
      duration: Date.now() - startTime,
    });

    return true;
  } catch (err) {
    logger.error('Supabase sync error', {
      error: err instanceof Error ? err.message : 'Unknown error',
      visitId: visit.id,
    });
    return false;
  }
}

/**
 * Update specific fields of a visit in Supabase
 */
export async function updateVisitInSupabase(
  visitId: string,
  updates: Partial<VisitNote>
): Promise<boolean> {
  const client = getSupabaseClient();

  if (!client) {
    logger.debug('Supabase not configured, skipping update');
    return false;
  }

  try {
    const supabaseUpdates: Record<string, unknown> = {};

    // Map fields to snake_case
    if (updates.vitalSigns !== undefined) {
      supabaseUpdates.vital_signs = transformVitals(updates.vitalSigns);
    }
    if (updates.subjective !== undefined) {
      supabaseUpdates.subjective = updates.subjective;
    }
    if (updates.objective !== undefined) {
      supabaseUpdates.objective = updates.objective;
    }
    if (updates.assessment !== undefined) {
      supabaseUpdates.assessment = updates.assessment;
    }
    if (updates.plan !== undefined) {
      supabaseUpdates.plan = updates.plan;
    }
    if (updates.interventions !== undefined) {
      supabaseUpdates.interventions = transformInterventions(updates.interventions);
    }
    if (updates.education !== undefined) {
      supabaseUpdates.education = transformEducation(updates.education);
    }
    if (updates.timeIn !== undefined) {
      supabaseUpdates.time_in = updates.timeIn;
    }
    if (updates.timeOut !== undefined) {
      supabaseUpdates.time_out = updates.timeOut;
    }
    if (updates.nextVisitDate !== undefined) {
      supabaseUpdates.next_visit_date = updates.nextVisitDate;
    }
    if (updates.status !== undefined) {
      supabaseUpdates.status = updates.status;
    }

    const { error } = await client
      .from('visits')
      .update(supabaseUpdates)
      .eq('id', visitId);

    if (error) {
      logger.error('Supabase update failed', {
        error: error.message,
        visitId,
      });
      return false;
    }

    logger.info('Supabase update successful', { visitId });
    return true;
  } catch (err) {
    logger.error('Supabase update error', {
      error: err instanceof Error ? err.message : 'Unknown error',
      visitId,
    });
    return false;
  }
}
