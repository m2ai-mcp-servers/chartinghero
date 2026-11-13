#!/usr/bin/env node
/**
 * Reads validator_cli `-output` (a Bundle of OperationOutcomes, or one OperationOutcome
 * for a single source) and prints per-file error/warning counts plus every error.
 * The jar's exit code does not reflect issues when -output is set, so this is the gate.
 *
 * Usage: node scripts/validation-summary.mjs <outcome.json> --expect pass|fail [--show-warnings]
 * Exit 0 when every file meets the expectation (pass: 0 errors; fail: >=1 error).
 */

import { readFileSync } from 'node:fs';

const [file, ...rest] = process.argv.slice(2);
const expect = rest[rest.indexOf('--expect') + 1];
const showWarnings = rest.includes('--show-warnings');
if (!file || (expect !== 'pass' && expect !== 'fail')) {
  console.error('usage: validation-summary.mjs <outcome.json> --expect pass|fail [--show-warnings]');
  process.exit(2);
}

const doc = JSON.parse(readFileSync(file, 'utf8'));
const outcomes =
  doc.resourceType === 'Bundle' ? (doc.entry ?? []).map((e) => e.resource) : [doc];

const SOURCE_EXT = 'http://hl7.org/fhir/StructureDefinition/operationoutcome-file';
let ok = true;

if (outcomes.length === 0) {
  console.error('no OperationOutcomes in validator output');
  process.exit(1);
}

for (const oo of outcomes) {
  const source = oo.extension?.find((x) => x.url === SOURCE_EXT)?.valueString ?? '(unknown source)';
  const issues = oo.issue ?? [];
  const errors = issues.filter((i) => i.severity === 'error' || i.severity === 'fatal');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const meets = expect === 'pass' ? errors.length === 0 : errors.length > 0;
  if (!meets) ok = false;
  console.log(`${meets ? 'ok  ' : 'FAIL'} ${source}: ${errors.length} errors, ${warnings.length} warnings`);
  const shown = expect === 'pass' || !meets ? errors : errors.slice(0, 3);
  for (const i of [...shown, ...(showWarnings ? warnings : [])]) {
    const where = i.expression?.[0] ?? i.location?.[0] ?? '';
    console.log(`     ${i.severity} ${where}: ${i.details?.text ?? i.diagnostics ?? ''}`);
  }
}

process.exit(ok ? 0 : 1);
