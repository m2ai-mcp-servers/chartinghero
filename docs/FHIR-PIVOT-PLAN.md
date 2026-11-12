# chartinghero FHIR R4 pivot: final implementation plan

Base: Draft 1 (standards and safety first). Two of three judges picked it. Grafted in: Draft 0's scope cuts (fetch-based client, deprecation shim, the 0.2.0/0.3.0 split, golden Bundles, DST test) and Draft 2's product findings (vendor-name exposure, the n8n transport gap, one shared patient set). Every flaw the judges named is fixed, and the fix is noted inline as **[fix]**.

## 0. Owner decisions (2026-11-12)

These override anything below that conflicts.

| # | Decision |
|---|---|
| Scope | **n8n is dropped.** chartinghero does not depend on NurseCall or any n8n workflow. It is used from Claude over stdio. PR11 becomes an optional, generic HTTP transport with no n8n framing, deferred past 0.3.0's core; PR12 (smart-backend for n8n) is dropped. Q9 is moot. |
| Q1 | New Netlify site `chartinghero-demo` with a 301 redirect from the old site. PR1 already points robots.txt, sitemap.xml, index.html and docs at `https://chartinghero-demo.netlify.app`. Creating the site and the redirect is a reserved action, approved per attempt. |
| Q2 | `FHIR_IDENTIFIER_SYSTEM` base: `https://memyselfplusai.com/fhir/chartinghero` (patient ids `/patient-id`, visit keys `/visit`, visit-type CodeSystem `/visit-type`). |
| Q3 | Plausibility bounds in PR4 approved as proposed. |
| Q4 | PR4 adds both optional fields: `oxygenFlowRate` (LOINC 3151-8, L/min, pulse-ox component) and `bloodGlucose` (LOINC 41653-7, mg/dL, own Observation). The dashboard glucose panel stays. |
| Q5 | Explicit `sign_visit_note` tool (0.3.0). Notes stay `docStatus=preliminary` until signed; no auto-sign. |
| Q6 | Pain: category `vital-signs`, no `meta.profile`. |
| Q7 | `nextVisitDate`: note text only. No Appointment. |
| Q8 | Overnight visits accepted only with `overnight: true`; otherwise `timeOut < timeIn` is rejected. |
| Q10 | Deferred to PR10 kickoff. |
| Q11 | `npm deprecate mcp-ratchet-clinical-charting "renamed to chartinghero"` at the 0.2.0 release (reserved action). |
| Q12 | Integration tests run in GitHub Actions with `hapiproject/hapi` as a service container (`FHIR_IT_BASE_URL=http://localhost:8080/fhir`). The ProBook-only fallback in PR6/PR7 no longer applies. |

**PR1 status:** implemented on branch `chore/rename-chartinghero` in both repos. Beyond the PR1 list it also removed 4 pre-existing ESLint errors (unused imports/vars, `prefer-const`) so the new lint gate passes, and marked `BLUEPRINT.md` and `prds/` as historical.

---

## 1. Verdict

1. Pivot. The backend swap is one seam: four `if (config.mockMode)` branches in `src/services/patient-service.ts` (47, 122, 153, 234), and each real branch throws (106, 135, 200, 299).
2. Ship 0.2.0 in 8 PRs. Rename first (the public demo runs as `pointcare-emr-demo.netlify.app`). Then the safety fixes, then FHIR reads, then an idempotent transaction write. Integration tests run against a local `hapiproject/hapi:v8.12.0-2`.
3. Production use is blocked in code until SMART user auth lands in 0.3.0. 0.2.0 means "works against writable FHIR servers". It does not mean "charts into an EMR". **[fix]** The block does not rest on the operator-typed `FHIR_ENVIRONMENT` alone: in 0.2.0, `FHIR_WRITE=on` and `FHIR_PRACTITIONER_ID` are accepted only when the `FHIR_BASE_URL` host is on a hard-coded write-host allowlist (section 3.2). Any other host is refused at startup, whatever `FHIR_ENVIRONMENT` says.

**Findings that drive the plan:**
- **Vendor-name exposure.** `PointCare` / `pointcare-emr-demo` / `Vivian AI` appear in demo-emr `index.html`, `README.md`, `public/robots.txt`, `public/sitemap.xml`, `docs/CHARTINGHERO-INTEGRATION.md`, `CLAUDE.md`, `supabase/schema.sql`, `supabase/seed.sql`, `scripts/test-update.sh` and `documents/mock-emr-spc.md` **[fix]**. I grepped these this run. PointCare appears to be HCHB's point-of-care app (this rests on a search snippet).
- **Package name is free.** `npm view chartinghero` returned E404 on 2026-11-12 (run this session).
- **No production write path.** ONC (g)(10) excludes write. HCHB, Axxess and WellSky publish no FHIR write.
- **Wrong validation bounds.** The demo's `VITAL_RANGES` (`constants.js:16-24`) are normal and critical display ranges, for example SpO2 `critical_low: 90` and SBP `critical_high: 180`. If used as rejection bounds, they would block charting exactly the readings that matter most. **[fix]** The plan uses separate plausibility bounds.
- **Duplicate writes on retry.** Conditional create on the Encounter does not dedupe the sibling entries in the Bundle, so a retried transaction duplicates the vitals and the note. **[fix]** A pre-flight identifier search short-circuits the whole Bundle, and the acceptance checks count every resource type. **[fix]** The pre-flight runs only when the server provably honors Encounter `identifier` search (US Core 9.0.0 makes it SHOULD, not SHALL); otherwise the write is refused (section 3.3).
- ~~**n8n cannot reach the MCP.**~~ Moot: n8n and NurseCall are out of scope (section 0).

---

## 2. Goal and non-goals

### Goal (0.2.0)
- With `BACKEND=fhir` and `FHIR_BASE_URL` set, all 3 tools work against FHIR R4 4.0.1. Generated resources conform to **US Core 9.0.0** (`hl7.fhir.us.core#9.0.0`, current per package-list.json).
- `BACKEND=mock` keeps working and is clearly labeled as mock.
- Every write has these properties:
  - It is attributed to a real Practitioner reference.
  - It is idempotent on retry: zero new resources of any type.
  - It is atomic.
  - It is validated in CI by the HL7 validator.
  - It never leaks PHI to logs or to the demo projection.
- One name everywhere: `chartinghero`.

### Non-goals (0.2.0)
- Production EMR charting. (g)(10) "specifically exclude[s] write". `FHIR_ENVIRONMENT=production` is refused at startup.
- SMART App Launch user auth and Backend Services. Planned for 0.3.0 (section 5).
- MCP SDK v2 migration. Planned for 0.3.0, with a deadline: v1 fixes continue until at least about 2027-01-27.
- HTTP transport for n8n (0.3.0). Appointment writes. Composition, CarePlan, ServiceRequest.
- Glucose (the MCP has no such field) and an amend or supersede flow.
- A direct FHIR read path in the dashboard (0.3.0, section 7).

---

## 3. Target architecture

```
 Claude Desktop ── stdio ──► tools (zod-validated, SDK 1.32.2 registerTool)
                                   │
                                   ▼
                    patient-service (validation, gates, projection hook)
                                   │
                         PatientBackend interface
                     ┌─────────────┴──────────────┐
                MockBackend                  FhirBackend
            (fixtures, UUIDs)        client.ts (fetch) + capabilities.ts
                                     mappers/ (pure)  + auth/ (none|bearer)
                                             │
                     local hapiproject/hapi:v8.12.0-2 (dev, CI, LAN demo)
                     hapi.fhir.org / server.fire.ly (manual smoke only)
```

### 3.1 Backend interface

```ts
// src/backends/types.ts
export interface PatientBackend {
  readonly kind: 'mock' | 'fhir';
  searchPatients(p: PatientSearchParams, ctx: RequestContext): Promise<PatientSearchResponse>;
  getPatient(ref: PatientRef, ctx: RequestContext): Promise<ResolvedPatient>;
  getPatientHistory(p: PatientHistoryParams, ctx: RequestContext): Promise<PatientHistoryResponse>;
  createVisitNote(p: ValidatedVisitNote, ctx: WriteContext): Promise<CreateVisitNoteResponse>;
}
export type PatientRef = { serverId: string } | { identifier: string }; // PT-10001 or a server id
export interface ResolvedPatient extends Patient { reference: `Patient/${string}` }
export interface RequestContext { requestId: string; timezone: string } // IANA
export interface WriteContext extends RequestContext {
  practitioner: { reference: `Practitioner/${string}`; display: string;
                  source: 'configured-sandbox' | 'smart-fhirUser' }; // smart-fhirUser in 0.3.0
  idempotencyKey: string;   // client-supplied clientVisitId, else derived (see 3.3)
  dryRun: boolean;
}
```

- `MockBackend` takes today's branch bodies and adds `reset()` for tests. `toSearchResult` and `toVisitSummary` move to `src/mappers/dto.ts`, because both backends need them.
- `FhirBackend` uses Node `fetch` and `@types/fhir@0.0.44`. It adds no FHIR client dependency: `fhirclient` has no backend flow, and `fhir-kit-client` adds nothing at this surface size.
- **[fix] patientId resolution.** The tool accepts a server id or a `PT-xxxxx` identifier. `getPatient` resolves it to `Patient/{serverId}` before any write (`Patient?identifier={sys}|PT-10001`, which must return exactly 1). Every `subject` uses that server reference.

### 3.2 Config: fail closed, with a migration shim
**[fix]** Draft 1 broke 0.1.0 users. Draft 0 kept the silent mock fallback. This plan avoids both.

| Env | Rule |
|---|---|
| `BACKEND` | Accepts `mock` or `fhir`. Required if any `FHIR_*` var is set. If unset with no `FHIR_*` vars, it falls back to `mock`, prints a stderr banner, and prefixes every tool result with `[MOCK DATA: fictional patients]`. Any other value aborts startup. |
| `FHIR_BASE_URL` | Required when `fhir`. No default. Delete `https://api.pointcare.com` (`config.ts:42`) and the dead check (`config.ts:67-70`). |
| `FHIR_ENVIRONMENT` | `local` or `sandbox` in 0.2.0. `production` aborts startup until 0.3.0 auth exists. This value is operator-typed, so it is not the only gate (see `FHIR_WRITE`). |
| `FHIR_WRITE` | Default `off`. With `off`, `create_visit_note` errors before any HTTP call. **[fix]** `on` is accepted only when the `FHIR_BASE_URL` host is in `WRITE_HOSTS`, a hard-coded list in `src/config/hosts.ts` with no env override in 0.2.0: loopback (`127.0.0.1`, `localhost`, `::1`), the project's LAN HAPI (`10.0.0.46`), and the named public sandboxes `hapi.fhir.org` and `server.fire.ly`. Any other host aborts startup with `FHIR_WRITE=on refused: host <h> is not in WRITE_HOSTS`, regardless of `FHIR_ENVIRONMENT`. |
| `FHIR_WRITE_PROFILE` | `full` (default) or `note-only`. Set explicitly, or auto-selected by the capability probe. **[fix]** It never switches on a 4xx. |
| `FHIR_BEARER_TOKEN` | Optional static token. `isSecret` in server.json. |
| `FHIR_PRACTITIONER_ID` | Required when `fhir`. Resolved at startup with `GET Practitioner/{id}`, which aborts on 404 (implemented in PR7; PR2 validates presence and format only). The display name comes from `Practitioner.name`. Accepted only when `FHIR_ENVIRONMENT` is `local` or `sandbox` **and** the `FHIR_BASE_URL` host is in `WRITE_HOSTS` **[fix]**. |
| `VISIT_TIMEZONE` | Required IANA zone when `fhir`, validated with `Intl`. A per-call `timezone` argument overrides it. |
| `FHIR_IDENTIFIER_SYSTEM` | Namespace URI for PT ids, visit identifiers and the visitType CodeSystem. See Q2. |
| `DASHBOARD_SYNC` | Default off. **[fix]** Replaces `isSupabaseEnabled()` as the projection trigger in PR2: setting `SUPABASE_*` alone no longer syncs. From PR2 until PR8, the hook runs only with `DASHBOARD_SYNC=on` **and** `BACKEND=mock`. From PR8, it is allowed for `fhir` only when the projection guard passes (section 7). |
| `LOG_LEVEL` | Enum. An invalid value aborts startup, which fixes the silent suppression at `logger.ts:81`. |
| `RATCHET_MOCK_MODE`, `POINTCARE_*` | Still read for one release, with a deprecation warning. `POINTCARE_API_URL` no longer flips the mode. **[fix]** All legacy reads live in one file, `src/legacy-env.ts`, so the vendor-name grep can exclude that file instead of relying on a per-line `DEPRECATED` token. |

### 3.3 Write shape: one transaction Bundle
1. Validate the input with zod. Resolve the Patient (404 means NotFoundError, before any write).
2. **Idempotency key.** Use the client-supplied `clientVisitId` (UUID) when given. Otherwise derive `sha256(patientServerId|visitDate|timeIn|practitionerId)`.
3. **[fix] Pre-flight first.** Run `GET Encounter?identifier={sys}/visit|{key}`. If there is 1 hit, write nothing and return the existing visit with `alreadyCharted: true` and a message: "same visit already charted; amend is not supported in 0.2.0". If there are 2 or more hits, return an error.
   - **[fix] Pre-flight gate.** US Core 9.0.0 lists Encounter `identifier` search as SHOULD, not SHALL, and R4 search says servers SHOULD ignore unknown or unsupported parameters by default. A server that drops `identifier` would return an unfiltered Encounter list, so 1 Encounter on the server would mark every new visit `alreadyCharted`, and 2 or more would fail every write. So:
     - The write is allowed only if `/metadata` advertises `identifier` for Encounter (`capabilities.ts`).
     - The pre-flight request sends `Prefer: handling=strict`.
     - The Bundle `self` link must contain the `identifier` parameter (R4: the server SHALL return the parameters actually used in the self link).
     - Every returned Encounter must carry exactly `{sys}/visit|{key}` in `Encounter.identifier` before it counts as a hit.
     - If any check fails, refuse the write with "server cannot prove identifier search; refusing write to avoid duplicates". Never skip dedupe.
4. Build the Bundle:
   - `type=transaction`. Each entry has `fullUrl=urn:uuid:<uuid>`, `request.method=POST` and `request.url=<Type>`.
   - The Encounter entry also sets `request.ifNoneExist=identifier=<sys>/visit|<key>` as the second line of defense.
   - A **412** maps to the error "duplicate visit key". It is never retried silently.
5. `dryRun: true` returns the human-readable summary and the validated Bundle, and makes no HTTP write. **[fix]** This replaces Draft 1's previewHash protocol: hashing the Bundle is non-deterministic because the urn:uuids are random, and the two-call friction was unproven.
6. POST to `[base]`. Parse each `entry.response.location` to get the server ids.
7. Non-production writes get `meta.tag {system: FHIR_IDENTIFIER_SYSTEM, code: chartinghero-dev}` so the data can be purged.
8. `note-only` profile: one DocumentReference POST that carries all of the content. Use it when configured, or when the CapabilityStatement lacks `create` on Encounter or Observation.

**[fix] Status semantics.**
- Encounter `status=finished`: the visit happened, and timeOut is given.
- Signing is a property of the document: `DocumentReference.docStatus=preliminary` until signed.
- History status maps `preliminary` to `pending_review` and `final` to `completed`. No auto-sign.
- A `sign_visit_note` tool is in 0.3.0 (Q5).

### 3.4 Read shape
- **search_patient** uses the US Core SHALL parameters: `_id`, `identifier`, `name` and `birthdate+name`.
  - Searching by name plus DOB is the recommended default for voice.
  - `phone` is used only if `GET /metadata` lists it for Patient. Otherwise the tool returns "phone search unsupported by this server".
  - `searchType=all` runs the supported searches in parallel and dedupes by `Patient.id`.
  - Status `discharged` and `pending` have no equivalent on Patient, so the FHIR backend returns a validation error for them.
- **get_patient_history**, primary query:
  `GET Encounter?patient={id}&class=http://terminology.hl7.org/CodeSystem/v3-ActCode|HH&date=ge{start}&date=le{end}[&type={sys}|{visitType}]&_sort=-date&_count={limit}&_revinclude=Observation:encounter&_revinclude=DocumentReference:encounter`
  - **[fix] hasVitals fallback.** When the revinclude returns no Observations for an Encounter, query `Observation?patient={id}&category=...|vital-signs&date=ge{period.start}&date=le{period.end}`. This is needed because `Observation.encounter` is not Must Support.
  - **[fix] Strict-server fallback.** When `_revinclude` or Encounter search is not advertised, use `DocumentReference?patient={id}&category=clinical-note&date=ge..` (US Core SHALL), and take the visit fields from `context.period`. US Core 9.0.0 lists only `Provenance:target` as a searchRevInclude for Encounter, Observation and DocumentReference, so `_revinclude=Observation:encounter` is a server extra and must be gated per server.
  - **[fix] class/type gate.** US Core 9.0.0 makes only `date+patient` a SHALL combination for Encounter; `class+patient` and `patient+type` are SHOULD. `capabilities.ts` also gates `class` and `type`. When either is not advertised, or is absent from the response Bundle `self` link, the query drops it, runs `patient+date` only, and filters `Encounter.class` (`HH`) and `Encounter.type` client-side.
  - Paging uses an opaque cursor that wraps the Bundle `next` link. This replaces `offset: 0` in `search-patient.ts:66` and `get-patient-history.ts:94`.
  - Only `search.mode=match` entries count toward totals, because `_count` excludes includes.

---

## 4. Mapping table

Units use system `http://unitsofmeasure.org`. Observation category is `http://terminology.hl7.org/CodeSystem/observation-category`. Profile canonicals are `http://hl7.org/fhir/us/core/StructureDefinition/<id>`. All constants live in `src/fhir/codes.ts`, each with a source-URL comment. The unit map is an exhaustive typed record with no string fallthrough.

| chartinghero field | FHIR resource.element | Code system / code / unit |
|---|---|---|
| patientId (server id or PT-xxxxx) | `*.subject = Patient/{serverId}`; PT id lives in `Patient.identifier` | `{FHIR_IDENTIFIER_SYSTEM}\|PT-10001` |
| (setting) | `Encounter.class` | v3-ActCode `HH` "home health" |
| (visit) | `Encounter`, profile `us-core-encounter`, `status=finished` | R4 Encounter status |
| visitType (10 values) | `Encounter.type[0].coding` = [local, SNOMED], `text` = label | local CodeSystem `{sys}/visit-type#<value>`; SNOMED `439708006` "Home visit" (validates true against the extensible-bound US Core Encounter Type VS `2.16.840.1.113762.1.4.1267.23`, tx.fhir.org) |
| visitDate + timeIn/timeOut | `Encounter.period.start/end` | `YYYY-MM-DDTHH:MM:00±hh:mm`, offset from the timezone for that date |
| duration | derived from `period`, not stored | minutes |
| clientVisitId / derived key | `Encounter.identifier` | `{sys}/visit\|{key}` |
| nurse | `Encounter.participant[0].individual`, `Observation.performer`, `Procedure.performer.actor`, `DocumentReference.author` | `Practitioner/{id}` from WriteContext |
| bloodPressureSystolic + Diastolic | 1 Observation, `us-core-blood-pressure`, no root value | LOINC `85354-9`; components `8480-6`, `8462-4`; `mm[Hg]`. Both or neither (zod) |
| heartRate | Observation `us-core-heart-rate` | LOINC `8867-4`, `/min` |
| respiratoryRate | Observation `us-core-respiratory-rate` | LOINC `9279-1`, `/min` |
| temperature + unit | Observation `us-core-body-temperature` | LOINC `8310-5`; `F`→`[degF]`, `C`→`Cel` (required binding `ucum-bodytemp`) |
| oxygenSaturation | Observation `us-core-pulse-oximetry`, `code.coding` = both | LOINC `59408-5` **and** `2708-6`; `%` |
| oxygenFlowRate (new, optional, Q4) | component of the pulse-ox Observation | LOINC `3151-8`, `L/min` |
| weight + unit | Observation `us-core-body-weight` | LOINC `29463-7`; `lbs`→`[lb_av]`, `kg`→`kg` (required binding `ucum-bodyweight`) |
| painLevel 0-10 | Observation, `valueInteger`, **no** `meta.profile`, category per Q6 (default `vital-signs`) | LOINC `72514-3` (not in the vital-sign result VS) |
| every vital | `status=final`, `category` vital-signs, `effectiveDateTime` = period.start, `encounter` = enc urn | `meta.profile` = specific US Core URL |
| subjective, objective, assessment, plan, interventions text, patientResponse, education, nextVisitDate, notes | 1 DocumentReference, `us-core-documentreference`, `status=current`, `docStatus=preliminary`, `date`, `context.encounter`, `context.period`, `content[0].attachment {contentType: text/plain, data: base64}` | type LOINC `34746-8` Nurse Note (SCALE_TYP `LP32888-7`, so it is in the required-bound `us-core-documentreference-type` VS); category hard-coded in `codes.ts` as `{system: http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category, code: clinical-note}` for the required-bound `category:uscore` slice |
| interventions[] | 1 Procedure each (`full` profile only), `us-core-procedure`, `status=completed`, `code.text` = free text, `performedPeriod` = Encounter.period | SNOMED only via an explicit lookup table: `225358003` wound care, `385949008` dressing change mgmt, `409063005` counseling |
| education[] | 1 Procedure, topics in `note` | SNOMED `311401005` "Patient education" (subsumed by `71388002` Procedure, the is-a filter of `us-core-procedure-code`, tx.fhir.org) |
| nextVisitDate | note text only in 0.2.0 (proposed Appointment is Q7, 0.3.0) | |
| visit id (VN-3xxxx counter) | server ids from `entry.response.location` | |

**Vitals count (fixed for acceptance).** A full-vitals note produces **6** Observations with `category=vital-signs` and a profile: BP panel, HR, RR, temp, SpO2 and weight. It also produces **1** pain Observation, which is counted separately by `code=http://loinc.org|72514-3`. **[fix]** This resolves Draft 2's self-contradicting count of 7.

---

## 5. Phased PRs

**BASE** for every PR: `npx tsc --noEmit && npx jest && npx eslint "src/**/*.ts"`, plus `npm run build` before any check that execs `dist/`. **[fix]** chartinghero has no ESLint config today (no `.eslintrc*`, no `eslint.config.*`, no `eslintConfig` key) and pins `eslint ^8.55.0`, which aborts without one. PR1 adds `.eslintrc.cjs` using `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` (both already in devDeps), so the eslint step is meaningful from PR1 on. Publishing to npm or the MCP Registry, Netlify domain changes, and n8n activation are reserved actions that need the owner's approval for each attempt.

### 0.2.0

**PR1. One name, no vendor name (chartinghero + demo-emr)**
- Files in chartinghero:
  - `package.json`: name `chartinghero`, `mcpName io.github.m2ai-mcp-servers/chartinghero`, repository and homepage URLs.
  - `server.json`: keep `$schema` 2025-12-11 and fix the repo URL.
  - `src/index.ts`: comments 4, 6, 10; server name (44); log lines 120, 139; read the version from package.json (replaces 44-45 and 121).
  - `src/utils/logger.ts`: comment 2, log prefix `[RATCHET]` (66).
  - Tool descriptions: `search-patient.ts:18`, `create-visit-note.ts:18`, `get-patient-history.ts:18`. Mock banners: `search-patient.ts:75`, `create-visit-note.ts:151`, `get-patient-history.ts:106`. File comments: `search-patient.ts:4`, `create-visit-note.ts:4`, `get-patient-history.ts:4`.
  - **[fix] Identifier renames:** `RatchetError` becomes `ChartingHeroError` (`errors.ts`, including the `this.name` string, every subclass `extends`, and the `instanceof` check, plus the import at `search-patient.ts:10`). `RatchetConfig` becomes `ChartingHeroConfig` (`config.ts:8,31,54,64,80,82`).
  - **[fix] Comments:** `errors.ts:2,8,82` (the PointCare comment is at 82; 43 is `export class AuthenticationError` and has no vendor text), `config.ts:2,15`, `types/patient.ts:5`, `types/visit.ts:5`, `patient-service.ts:5`, `mock-data.ts:2,5`, `supabase-service.ts:2,5,34,50,58,92`.
  - `.eslintrc.cjs` (new, see BASE).
  - `README.md`, `CLAUDE.md`. Mark `docs/API_REQUIREMENTS.md` as historical.
  - Out of PR1 scope: the env reads in `config.ts` (`RATCHET_MOCK_MODE`, `POINTCARE_*` at 32-33, 42-45, 69, 72) and the `server.json` env entries (`POINTCARE_API_URL/KEY`). They move into `src/legacy-env.ts` and the new server.json env list in PR2.
- Files in demo-emr: `index.html` meta, `README.md`, `CLAUDE.md`, `public/robots.txt`, `public/sitemap.xml`, `supabase/seed.sql:2`, `supabase/schema.sql:2` **[fix]**, `scripts/test-update.sh`, `docs/CHARTINGHERO-INTEGRATION.md`, `documents/mock-emr-spc.md` **[fix]**. The integration doc is rewritten as a one-shot upsert, with no PATCH flow and no `update_visit_vitals`.
- Acceptance:
  - In chartinghero, `grep -rniI "pointcare\|ratchet" src tests package.json README.md CLAUDE.md | grep -v "process\.env\.\(RATCHET_\|POINTCARE_\)\|POINTCARE_API_\(URL\|KEY\) is required" | wc -l` returns `0`. The excluded env-read lines and `server.json` are cleared by the PR2 check.
  - In demo-emr, `grep -rniI "pointcare\|vivian" --exclude-dir=node_modules --exclude-dir=.git . | wc -l` returns `0` (covers `CLAUDE.md`, `documents`, `scripts`, `docs`, `supabase`, `public`, `src`).
  - `npx eslint "src/**/*.ts"` runs against the new config and exits `0`.
  - `node -e "const p=require('./package.json'),s=require('./server.json');process.exit(p.name==='chartinghero'&&s.name===p.mcpName?0:1)"` exits `0`.
- The domain move off `pointcare-emr-demo.netlify.app` is reserved (Q1).

**PR2. Backend seam, fail-closed config, mock hardening**
- Files:
  - New: `src/backends/{types,factory,mock-backend}.ts`, `src/mappers/dto.ts`, `src/legacy-env.ts`, `src/config/hosts.ts`, `tests/config.test.ts`, `tests/legacy-env.test.ts`.
  - Changed: `src/services/patient-service.ts` (reduced to validation, delegation and the projection hook), `src/services/mock-data.ts`, `src/services/index.ts`, `src/config.ts`, `src/index.ts`, `server.json` (env list: `BACKEND`, `FHIR_*`, `VISIT_TIMEZONE`; drop `POINTCARE_*`), `tests/patient-service.test.ts`.
- Changes:
  - Config per section 3.2, with the shim confined to `src/legacy-env.ts`.
  - **[fix] fhir config is validated statically in PR2:** required vars present, `FHIR_ENVIRONMENT` value, `VISIT_TIMEZONE` via `Intl`, `FHIR_BASE_URL` parse, and the `WRITE_HOSTS` gate. The `GET Practitioner/{id}` check and the `/metadata` probe need the FHIR client, so they and their acceptance move to PR6 (`capabilities.ts`) and PR7 (`practitioner.ts`). Until PR6, `BACKEND=fhir` with a valid config exits with "fhir backend not implemented in this build".
  - Visit ids switch to `crypto.randomUUID()`. This stops overwriting seeded VN-30000 through VN-30002 **[fix]** (`seed.sql:78,96,114`; the mock counter starts at 30000, `mock-data.ts:366-368`) through the `onConflict:'id'` upsert (`supabase-service.ts:136-139`).
  - The projection moves out of the mock branch into a post-write hook, and the message reports the real `synced` value (`patient-service.ts:293`). **[fix]** The hook trigger changes from `isSupabaseEnabled()` (`patient-service.ts:278-280`) to `DASHBOARD_SYNC=on` (default off) **and** `BACKEND=mock`. It stays mock-only until the PR8 guard exists.
  - Nurse identity comes from WriteContext. Mock uses a fixed fictional Practitioner. Delete `Current User, RN` and `RN-CURRENT` (267-270).
  - Notes become `pending_review`, with no `signedAt`.
  - Inject the backend into tests and call `reset()` in `beforeEach`.
- Acceptance:
  - BASE passes, and all 20 existing tests pass. Only id literals change.
  - `POINTCARE_API_URL=x npx jest` passes, which proves env independence.
  - **[fix] Startup gate matrix.** Each negative case supplies every other required var, so only the gate under test can fail, and asserts on stderr text, not just the exit code. Let `V="FHIR_BASE_URL=http://127.0.0.1:8080/fhir FHIR_ENVIRONMENT=local FHIR_PRACTITIONER_ID=p1 VISIT_TIMEZONE=America/New_York FHIR_IDENTIFIER_SYSTEM=urn:test"`:
    - `env BACKEND=bogus node dist/index.js </dev/null 2>&1 | grep -q "BACKEND must be mock or fhir"`
    - `env $V node dist/index.js </dev/null 2>&1 | grep -q "BACKEND is required when FHIR_\* vars are set"` (BACKEND unset).
    - `env $V BACKEND=fhir FHIR_ENVIRONMENT=production node dist/index.js </dev/null 2>&1 | grep -q "FHIR_ENVIRONMENT=production is not supported"`
    - `env $V BACKEND=fhir FHIR_ENVIRONMENT=sandbox FHIR_WRITE=on FHIR_BASE_URL=https://unknown.example/fhir node dist/index.js </dev/null 2>&1 | grep -q "not in WRITE_HOSTS"`, and the exit code is non-zero.
    - `env BACKEND=mock LOG_LEVEL=verbose node dist/index.js </dev/null 2>&1 | grep -q "LOG_LEVEL"`
    - Each case also asserts a non-zero exit.
  - **Positive control.** `BACKEND=mock` with a valid env starts, and a minimal SDK client (`tests/startup.test.ts`) gets 3 tools from `tools/list`.
  - **[fix] Projection gate.** A test with `SUPABASE_URL` and `SUPABASE_ANON_KEY` set and `DASHBOARD_SYNC` unset asserts 0 calls to `syncVisitToSupabase`. With `BACKEND=fhir` (stub backend) and `DASHBOARD_SYNC=on`, it also asserts 0 calls.
  - **[fix] Vendor-name zero check** (moved here from PR1, after the shim lands): `grep -rniI "pointcare\|ratchet" src tests server.json package.json README.md CLAUDE.md --exclude=legacy-env.ts --exclude=legacy-env.test.ts | wc -l` returns `0`.
  - `grep -rn "Current User, RN\|RN-CURRENT\|VN-3000\|api.pointcare.com" src | wc -l` returns `0`.
  - A test creates two notes across a simulated restart and asserts distinct ids, neither matching `^VN-3000[0-2]$`.

**PR3. PHI-safe logging and error surface** (lands before any new network path)
- Files: `src/utils/logger.ts`, `src/utils/errors.ts`, `src/index.ts:102-105`, the catch blocks in `src/tools/*.ts`, `src/services/supabase-service.ts:131-160`, new `tests/logger.test.ts`.
- Changes:
  - Replace the denylist with an allowlist of emitted keys: `tool`, `requestId`, `durationMs`, `status`, `httpStatus`, `resourceType`, `count`, `visitIdHash`. This fixes the camelCase bug class at `logger.ts:40-47`.
  - `message` is sanitized as well.
  - Upstream and HTTP errors become `ApiError`, which carries the HTTP status and the OperationOutcome `issue.code` only. `diagnostics` is never passed through.
- Acceptance:
  - BASE passes.
  - The test logs `{firstName:'Eleanor', dateOfBirth:'1940-01-01', subjective:'pain', patientId:'12345', id:'0b6f4c1e-uuid'}` and a message containing `Patient/12345`. It asserts that none of those values appear in the captured stderr.
  - `formatErrorForMcp` on an OperationOutcome whose diagnostics contain "Marple" returns text without "Marple".
  - Mutation proof: switching the allowlist back to pass-through turns the test red.

**PR4. Input validation at the tool boundary (SDK 1.32.2 + zod)**
- Files:
  - `package.json`: `@modelcontextprotocol/sdk@1.32.2`, plus a direct `zod@^4.2.0`. The lockfile already resolves 4.2.1 transitively.
  - `src/index.ts`: `McpServer.registerTool`, which exists in 1.32.2.
  - `src/tools/*.ts`: replace the `args as X` casts with zod `inputSchema`, and set annotations.
  - New `src/schemas/*.ts`, new `tests/validation.test.ts`.
- Rules:
  - `visitType` is a `z.enum` of the 10 values.
  - Dates are `YYYY-MM-DD` and must be real dates. Times are `HH:MM` 24-hour.
  - `timeOut > timeIn` unless `overnight: true`, in which case the period end is the next day (Q8).
  - `nextVisitDate > visitDate`.
  - BP is both-or-neither. A unit is required whenever its value is present.
  - `painLevel` is an integer 0..10. `limit` is an integer 1..50.
  - Optional `clientVisitId` (UUID), `timezone` (IANA), `dryRun`.
- **[fix] Plausibility bounds, not `VITAL_RANGES`:**

| Vital | Reject outside |
|---|---|
| SBP | 50..300 mm[Hg] |
| DBP | 20..200 mm[Hg] |
| HR | 20..300 /min |
| RR | 4..80 /min |
| Temp | F 85..115, C 29..46 |
| SpO2 | 50..100 % |
| O2 flow | 0..15 L/min |
| Weight | lbs 1..1500, kg 0.5..700 |

  These values are proposed, not sourced (Q3). `VITAL_RANGES` stays as display-only flagging, and readings like SBP 190 or SpO2 88 must be accepted.
- Annotations:
  - Reads: `{readOnlyHint: true, openWorldHint: true}`.
  - `create_visit_note`: `{readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true}`. It flips to `idempotentHint: true` only after the PR7 idempotency test passes.
- Display uses `!== undefined`, so a recorded 0 shows (`create-visit-note.ts:169-183`).
- Acceptance:
  - BASE passes.
  - Each of these is rejected with no backend call (spy asserts 0 calls): `oxygenSaturation:101`, `heartRate:-1`, `timeIn:'10am'`, `visitType:'bogus'`, a lone systolic, `limit:-3`, `nextVisitDate` before `visitDate`.
  - Each of these is **accepted**: `bloodPressureSystolic:190, bloodPressureDiastolic:110` and `oxygenSaturation:88`.
  - `grep -rn "as VitalSigns\|as VisitType" src | wc -l` returns `0`.

**PR5. Pure FHIR mappers plus conformance gate (no network)**
- Files:
  - New: `src/fhir/{codes,units,time,encounter,vitals,note,procedures,bundle,patient}.ts`, `tests/fhir/*.test.ts`, `tests/fixtures/golden/*.json`, `scripts/validate-golden.sh`, `.github/workflows/fhir-validate.yml`.
  - devDeps: `@types/fhir@0.0.44`, `@medplum/core@5.2.17`, `@medplum/definitions@5.2.17`. These are dev only. `@medplum/core` needs Node ^22.18 or >=24.2, and definitions is about 97 MB.
- `time.ts` uses `Intl.DateTimeFormat` with `timeZoneName:'longOffset'`.
- Golden files are regenerated by `npm run golden`, and CI fails on a diff.
- Validation has two tiers:
  - In-process `validateResource` (terminology coverage unverified).
  - `validator_cli.jar` 7.0.5, pinned by sha256, run as `-version 4.0.1 -ig hl7.fhir.us.core#9.0.0`.
- Acceptance:
  - BASE passes.
  - `time.test.ts`: `America/New_York` 2026-03-08 09:00 gives `-04:00`, and 2026-03-07 09:00 gives `-05:00`. Overnight 23:30 to 00:15 ends on the next date.
  - Mapper asserts:
    - `85354-9` with `8480-6`/`8462-4` in `mm[Hg]`, and no root `valueQuantity`.
    - Both SpO2 codings.
    - Units `[degF]`, `Cel`, `[lb_av]`, `/min`, `%`.
    - class `HH`.
    - Pain has no `meta.profile`.
    - Every `subject` is `Patient/{serverId}`.
  - `bash scripts/validate-golden.sh` exits 0 with zero `error` issues. Fixtures cover:
    - full vitals;
    - BP only;
    - F and C temperature;
    - lbs and kg weight;
    - pain only;
    - no vitals;
    - 3 interventions;
    - education only;
    - note-only.
  - Negative fixtures (`lbs` and `F` as UCUM codes) **fail** the validator, which proves the gate is live.
  - `npm pack --dry-run` lists no jar, no fixtures and no `@medplum/definitions`.

**PR6. Local FHIR stack and the read path**
- Files:
  - `docker/compose.fhir.yml`: `hapiproject/hapi:v8.12.0-2`, default H2 in-memory (`jdbc:h2:mem:test_mem` in the starter `application.yaml`), port 8080 bound to `127.0.0.1` only **[fix]**. An unauthenticated write endpoint on the LAN would let any LAN host write to or wipe the server mid-test. The LAN address is exposed only for the 0.3.0 dashboard demo, behind the proxy.
  - `scripts/seed-fhir.mjs`: **one shared synthetic patient set** for both repos. It holds the demo's PT-10001..10003 (Christie names) plus PT-10004..10005 from the MCP mock, 1 Practitioner (with a phone telecom, for 0.3.0 NurseCall mapping), and 2 Encounters with vitals.
  - `src/backends/fhir/{client,capabilities,read,fhir-backend}.ts`, `src/auth/{none,bearer}.ts`.
  - `tests/contract/backend.contract.ts`, `tests/contract/{mock,fhir}.test.ts`.
  - `tests/fixtures/recorded/*.json`: captured from the local container only.
- Changes:
  - `capabilities.ts` caches `/metadata`. Startup fails unless `fhirVersion` starts with `4.0`.
  - It gates phone search, `_revinclude` and the write profile. **[fix]** It also gates Encounter `identifier` (required for any write, section 3.3) and Encounter `class` and `type` (client-side filter fallback, section 3.4).
  - Startup with `BACKEND=fhir` now runs the `/metadata` probe (moved from PR2).
  - The contract suite asserts intent (exact identifier hit, name match, newest first, hasVitals), not the mock's substring quirks (`patient-service.ts:60-78`). The mock-only `'PT-'` match test moves to the mock suite.
  - `createVisitNote` still throws NotImplemented.
- Acceptance:
  - BASE passes. `npx jest tests/contract` passes on recorded Bundles for both backends.
  - **[fix]** Every command uses `B=${FHIR_IT_BASE_URL:-http://127.0.0.1:8080/fhir}`, so the same commands run on ProBook and in a CI service container. Until Q12 is answered, integration acceptance is ProBook-only and is labeled that way in the PR.
  - `docker compose -f docker/compose.fhir.yml up -d && curl -sf "$B/metadata" | jq -r .fhirVersion` prints `4.0.1`.
  - `node scripts/seed-fhir.mjs`, then `curl -sf "$B/Patient?identifier=<sys>|PT-10001" | jq '[.entry[]? | select(.search.mode=="match")] | length'` prints `1` **[fix]** (counts entries; `Bundle.total` is optional in search Bundles).
  - `FHIR_IT_BASE_URL=$B npx jest tests/contract` passes.
  - The fallback tests pass:
    - With a capability stub that hides `_revinclude`, history uses the DocumentReference query.
    - With a seeded Observation that has no `encounter`, hasVitals is still true.
    - **[fix]** With a stub that hides Encounter `class` and `type`, the query omits them and a seeded non-`HH` Encounter is filtered out client-side.
    - **[fix]** With a stub server that ignores `identifier` (self link lacks it) and holds 1 unrelated Encounter, `createVisitNote` is refused and makes 0 POSTs. The same holds when `/metadata` does not advertise Encounter `identifier`.
  - `docker compose -f docker/compose.fhir.yml restart`, then `curl -sf "$B/Patient?_count=1" | jq '[.entry[]? | select(.search.mode=="match")] | length'` prints `0`. This proves the reset.

**PR7. Transaction write: idempotent, atomic, write-gated**
- Files: `src/backends/fhir/write.ts`, `src/backends/fhir/practitioner.ts`, `src/backends/fhir/fhir-backend.ts`, `tests/integration/write.int.test.ts`, `scripts/smoke-mcp.mjs` (SDK `Client` plus `StdioClientTransport` against `dist/index.js`).
- Changes: implement section 3.3 end to end.
- Acceptance (local HAPI):
  - **Idempotency, all types.**
    1. Commit a full note with `clientVisitId=K`.
    2. Record the counts of Encounter (by identifier), Observation, DocumentReference and Procedure for that patient.
    3. Commit again with `K`. All four counts are unchanged, and the response has `alreadyCharted: true`.
    4. Repeat the check without `clientVisitId`, so the derived key is used.
  - **Vitals count.** `Observation?patient=..&category=...|vital-signs` returns 6 new entries. `Observation?patient=..&code=http://loinc.org|72514-3` returns 1. The BP Observation has 2 components.
  - **Atomicity.** Inject an invalid entry mid-Bundle. The resource count before equals the count after.
  - **Write gate.** With `FHIR_WRITE=off`, commit fails, and an injected fetch stub records 0 requests. `dryRun:true` makes 0 POSTs.
  - **No silent degrade.** A 4xx on `full` returns an error. It does not fall back to note-only.
  - **Conformance after the round trip.** Read the resources back from the server and run `scripts/validate-golden.sh` on the server copies: 0 errors.
  - **Smoke.** `BACKEND=fhir FHIR_BASE_URL=... FHIR_WRITE=on FHIR_PRACTITIONER_ID=<seeded> VISIT_TIMEZONE=America/New_York node scripts/smoke-mcp.mjs` exits 0 after calling all 3 tools. `BACKEND=mock node scripts/smoke-mcp.mjs` also exits 0.
  - `grep -rn "Current User, RN" src | wc -l` returns `0`.
  - **[fix] Write-host gate.** `FHIR_ENVIRONMENT=sandbox FHIR_WRITE=on FHIR_BASE_URL=https://unknown.example/fhir` (all other vars valid) exits non-zero with a stderr message naming the `WRITE_HOSTS` gate. `FHIR_PRACTITIONER_ID` on that host is refused the same way.
  - **[fix] No projection from FHIR writes.** With `SUPABASE_*` set and `BACKEND=fhir`, a committed note makes 0 Supabase calls (fetch stub on the Supabase URL).
  - **[fix] Practitioner check.** `FHIR_PRACTITIONER_ID=does-not-exist` aborts startup with a 404 message naming the Practitioner (moved from PR2).
  - If `ifNoneExist` inside a transaction is rejected by HAPI 8.x, record that in `docs/server-matrix.md`. The pre-flight check stays primary either way.

**PR8. Projection lockdown, docs, release 0.2.0**
- Files:
  - `src/projection/guard.ts`, `src/services/supabase-service.ts`.
  - `README.md`, `CHANGELOG.md`, `docs/server-matrix.md`.
  - `server.json` env: `BACKEND`, `FHIR_BASE_URL`, `FHIR_ENVIRONMENT`, `FHIR_WRITE`, `FHIR_WRITE_PROFILE`, `FHIR_BEARER_TOKEN` (isSecret), `FHIR_PRACTITIONER_ID`, `VISIT_TIMEZONE`, `FHIR_IDENTIFIER_SYSTEM`.
  - Version `0.2.0`, engines `>=20`.
- Projection guard, per section 7:
  - The projection runs only when `DASHBOARD_SYNC=on`, `FHIR_ENVIRONMENT` is `local` or `sandbox`, and the base URL host is on `SYNTHETIC_HOSTS`.
  - **[fix]** `SYNTHETIC_HOSTS` holds only the loopback and LAN HAPI that the project seeds. `hapi.fhir.org` and `server.fire.ly` are not on it: they hold data uploaded by anyone. On a public sandbox, projection is allowed only for a Patient that carries the `chartinghero-dev` `meta.tag` or the project's `FHIR_IDENTIFIER_SYSTEM` identifier; any other Patient is refused.
  - **[fix]** RLS on with no anon write is a precondition of `DASHBOARD_SYNC`, not a later demo PR. The demo-repo RLS PR lands before PR8, and PR8 documents the check.
  - Rows carry no `subjective|objective|assessment|plan`.
  - Before the visit row, it upserts the patient row.
- README line: "Reads from FHIR R4 servers. Writes need a server that accepts them (tested on HAPI 8.12). Production EMR writes need a vendor write agreement."
- Acceptance:
  - BASE passes.
  - Guard matrix tests **[fix]**: `local` + `127.0.0.1` with sync passes. `sandbox` + `hapi.fhir.org` with a Patient tagged `chartinghero-dev` passes. `sandbox` + `hapi.fhir.org` with an untagged Patient is refused. An unknown host with sync is refused.
  - A projected row has no SOAP keys.
  - `npx gitleaks detect` is clean.
  - server.json validates against the 2025-12-11 schema.
  - `node -p "require('./package.json').version"` prints `0.2.0`.
- Publishing, `npm deprecate mcp-ratchet-clinical-charting`, and registry publish are reserved actions.

### 0.3.0 (sequenced, each its own PR; detail at kickoff)
- **PR9: SDK v2.** `@modelcontextprotocol/server@2.4.0`, `registerTool`, `serveStdio(() => createServer())`. Never `server.connect(new StdioServerTransport())`, which serves only 2025-era clients. This must land before about 2027-01-27.
  - Acceptance: a `tools/list` smoke works with both protocol revisions.
- **PR10: SMART user auth.** Authorization code with PKCE, loopback redirect, `fhirUser`, refresh token in the OS keychain (library choice is Q10). `FHIR_ENVIRONMENT=production` is unlocked only with `smart-user`, and only if the `fhirUser` is a Practitioner or PractitionerRole.
  - Acceptance: run against `smartonfhir/smart-launcher-2` in front of local HAPI. `Encounter.participant.individual.reference` equals the `fhirUser` claim. Headless launcher login is unverified, so the fallback is a manual-dispatch job.
- **PR11: HTTP transport for n8n NurseCall.** Bearer auth, TLS or LAN-only binding, phone-to-Practitioner mapping, retry with the same `clientVisitId`. Includes a plain `POST /v1/visit-notes` fallback that calls the same handler.
  - Acceptance: `initialize` and then `tools/list` returns 3 tools. Without the token it returns 401. Two posts with the same `clientVisitId` create 1 Encounter and unchanged counts of the other types.
- **PR12: smart-backend for n8n.** jose@6.2.17, RS384/ES384 (configurable), explicit `scope`, plus a Provenance resource. Disabled in production until the attribution review (Q9).
- **PR13: dashboard FHIR proxy.** See section 7. Retire the Supabase write path afterwards.
- **PR14: `sign_visit_note`.** Sets docStatus `final`. Optional Appointment for `nextVisitDate`.

---

## 6. Test strategy

| Tier | What | Runs |
|---|---|---|
| Schema | zod ranges, formats, enums, BP pairing, overnight, accepted abnormal values | every PR |
| Mapper | pure domain-to-FHIR and FHIR-to-DTO, time and DST, note text, codes and units | every PR |
| In-process conformance | `@medplum/core validateResource` on every mapper output | every PR |
| Authoritative conformance | `validator_cli.jar` 7.0.5 (sha256-pinned) with `hl7.fhir.us.core#9.0.0` on golden Bundles, plus negative fixtures that must fail, plus server read-back copies | CI job with JVM |
| Client | fetch stub: OperationOutcome becomes a sanitized ApiError, timeout, bearer present or absent, 0 requests when the write is off | every PR |
| Contract | one intent suite over MockBackend and FhirBackend, using recorded Bundles from the local container | every PR |
| Integration | local `hapiproject/hapi:v8.12.0-2`, H2, seeded, and restarted for a clean slate: idempotency across all types, atomicity, fallbacks, write gate | ProBook-only until Q12 is answered; CI service container after. Compose binds `127.0.0.1`; `FHIR_IT_BASE_URL` defaults to `http://127.0.0.1:8080/fhir` |
| Safety | logger allowlist, startup gate matrix (including `WRITE_HOSTS`), projection guard, pre-flight identifier gate | every PR |
| E2E | `scripts/smoke-mcp.mjs` over stdio against `dist/`, in both modes | CI after build |
| Public sandbox | hapi.fhir.org, server.fire.ly; synthetic data tagged `chartinghero-dev` | manual only, never a gate |

- Every safety test has a mutation proof: break the guard on a throwaway branch and confirm the test goes red.
- The mock store resets per test, which removes today's order dependence.

---

## 7. Demo dashboard path

| Stage | Data path | Notes |
|---|---|---|
| Now (0.1.0) | MCP mock → Supabase anon upsert → React polls every 2 s | Anon key in the Vite bundle, RLS off (`schema.sql:90-102`), SOAP text public. Synthetic only. |
| 0.2.0 | MCP (mock or FHIR against local HAPI) → guarded projection → Supabase → React | Projection runs only with `DASHBOARD_SYNC=on`, for `local`/`sandbox` plus `SYNTHETIC_HOSTS` (seeded loopback/LAN HAPI only; public sandboxes only for tagged Patients), and only once RLS is on. Mock-only from PR2 to PR8. No SOAP keys. Patient row upserted first, which fixes the `visits.patient_id` FK. One shared patient set, which fixes the PT-10001 identity split. UUID ids end the VN-30000 overwrite. |
| 0.3.0 (LAN demo) | MCP → local HAPI ← demo-emr server-side `/api/fhir/*` read-only proxy on ProBook (`http://10.0.0.46:<port>`) | `VITE_DATA_SOURCE=fhir\|supabase\|fixtures`. `fhirToVisit` produces the `transformVisit` shape (`dataService.js:124-146`). A "View FHIR" drawer shows the `meta.profile` badges and the validator result. Local-tz "today" replaces the UTC split (`dataService.js:189,205`). Visit status comes from Encounter and DocumentReference. Then delete `supabase-service.ts`, including the uncalled `updateVisitInSupabase` (168-239). |
| Public Netlify | static fixtures only, under the new name | It cannot reach a LAN HAPI (Q1). |

Demo-repo changes ship as separate PRs in `chartinghero-demo-emr`:
- RLS on, with no anon write. **[fix]** Sequenced before chartinghero PR8; it is a precondition of `DASHBOARD_SYNC`.
- Seed aligned to the shared set.
- Integration doc rewritten (PR1).

Planned demo sequence for 0.3.0:
1. Voice: NurseCall dictates the visit.
2. n8n posts to the HTTP transport.
3. An out-of-range value is rejected and the agent re-asks.
4. The dashboard row appears within one poll.
5. "View FHIR" shows US Core badges and 0 validator errors.
6. Switch `FHIR_BASE_URL` to `server.fire.ly` (sandbox).
7. Honest-limits slide.

The dictated "sat 95 on 2 liters" needs `oxygenFlowRate` (Q4).

**Acceptance for the 0.3.0 proxy PR:**
- `npm run lint && npm run build` in demo-emr.
- A Playwright run on the LAN build creates a note through the MCP and sees the row with `142/88` within 5 s.
- With `VITE_DATA_SOURCE=fhir`, `grep -rn VITE_SUPABASE_ANON_KEY dist | wc -l` returns `0`.

---

## 8. Risks

1. **No production write.** (g)(10) excludes write, and HCHB, Axxess and WellSky publish no FHIR write. Mitigation: the note-only profile, honest docs, and production blocked in code.
2. **Attribution.** `FHIR_PRACTITIONER_ID` is client-asserted. Mitigation: it is allowed only in local and sandbox environments, and only when the `FHIR_BASE_URL` host is in the hard-coded `WRITE_HOSTS` list, so mislabeling a real EMR as `sandbox` does not unlock writes. SMART `fhirUser` is required for production (0.3.0). Backend Services through n8n relies on trusted mapping plus Provenance and needs a compliance review.
3. **Idempotency mechanism.** `ifNoneExist` inside a transaction is unverified, and the pre-flight check has a TOCTOU window under concurrent retries. Mitigation: pre-flight is primary, conditional create is secondary, a 412 surfaces as an error, and `idempotentHint` stays false until the PR7 test passes. A server that ignores Encounter `identifier` (SHOULD in US Core 9.0.0) would make the pre-flight lie, so writes are refused unless `/metadata`, the self link and the returned identifiers all confirm the search was applied.
4. **Corrections.** A same-key resubmission returns the existing visit and does not overwrite it. There is no amend flow in 0.2.0, so a nurse correcting vitals is told to wait for amend support. The alternative was silent pile-up, which is worse.
5. **Timezone.** A wrong `VISIT_TIMEZONE` mislabels visits. Mitigation: `Intl` validation, a per-call override, the DST test, and the resolved offset echoed in the tool output.
6. **Encounter link on vitals is not Must Support.** Mitigation: the category/date fallback query.
7. **US Core version skew.** Servers on 3.1.1 or 6.1.0 may reject 9.0.0 profile claims. Mitigation: a `US_CORE_PROFILES=off` switch (0.3.0) and the per-server matrix.
8. **Pain placement varies by server.** Mitigation: query history by LOINC code, not by category alone (Q6).
9. **PHI surfaces.** The Supabase anon projection, stderr logs, and later tokens at rest. Mitigation: PR3 before any transport, the PR8 guard, the 0.3.0 retirement, and the keychain.
10. **Public sandboxes** are shared and reset without notice. HAPI says it "provides no privacy". Mitigation: never used in CI, synthetic data only, tagged. Not on `SYNTHETIC_HOSTS`: projection from a public sandbox is limited to Patients tagged `chartinghero-dev`.
11. **SDK clock.** v1 fixes end no earlier than about 2027-01-27. PR9 must land before then.
12. **Dependency floors.** `@medplum/*` needs Node ^22.18 and stays dev-only. The jar (~205 MB) and definitions (~97 MB) never ship.
13. **Vendor name.** The public demo uses another vendor's product name. PR1 fixes the repo text. The domain move needs approval (Q1).

---

## 9. Open questions for the owner

1. **Q1. Demo domain.** Move off `pointcare-emr-demo.netlify.app` (reserved Netlify action), with a redirect or a hard kill? Is the live demo the ProBook LAN build, with Netlify as a static showcase?
2. **Q2. Identifier namespace.** Which URI should `FHIR_IDENTIFIER_SYSTEM` and the visit-type CodeSystem use? A domain you control is better than a GitHub URL.
3. **Q3. Plausibility bounds.** Approve or replace the PR4 table. These values are proposed, not sourced.
4. **Q4. Home O2.** Add `oxygenFlowRate` (3151-8, L/min) in PR4? The demo script needs it. Also: add glucose (41653-7, US Core lab) or remove the dashboard panel?
5. **Q5. Signing.** Is a `sign_visit_note` tool (docStatus `final`) required, or is confirmation on the voice call enough attestation? The plan's default: preliminary until an explicit sign.
6. **Q6. Pain category.** `vital-signs` with no profile (default), or `survey` with US Core Simple Observation?
7. **Q7. Next visit.** Note text only (default), or a proposed Appointment in 0.3.0?
8. **Q8. Overnight visits.** Accept with an explicit `overnight: true` (default), or reject?
9. **Q9. n8n write path.** Is a static bearer on the LAN acceptable for the demo, with smart-backend later? Who reviews attribution for real use, and who would hold the BAA and vendor write agreement?
10. **Q10. Keychain.** Pick a maintained OS-keychain library for PR10. No candidate was evaluated in this run.
11. **Q11. Old npm package.** `npm deprecate mcp-ratchet-clinical-charting "renamed to chartinghero"` (recommended), or leave it?
12. **Q12. CI host.** GitHub Actions with a HAPI service container and a JVM, or ProBook-only integration runs? Answer before PR6 starts. Until then, PR6 and PR7 integration acceptance is ProBook-only.

### Unverified (prove or drop during implementation)
- `Bundle.entry.request.ifNoneExist` inside a transaction on HAPI 8.x (PR7).
- A UCUM unit for `72514-3`, and the category for pain. `mg/dL` for glucose.
- Whether `@medplum/core validateResource` checks terminology.
- Whether the `hapiproject/hapi` default image has auth or interceptors.
- `Bundle.total` on HAPI searches (acceptance no longer depends on it; checks count `search.mode=match` entries). `longOffset` in the Node ICU build (PR5 test).
- Whether HAPI 8.12 advertises Encounter `identifier`, `class` and `type` in `/metadata` and honors `Prefer: handling=strict` (PR6 probes it; writes are refused if not).
- Headless auth-code login against smart-launcher-2. The `@modelcontextprotocol/node@2.1.2` HTTP API. n8n MCP-client support for Streamable HTTP.
- That PointCare is HCHB's app (search snippet plus package id `com.hchb.pc.ui`).
- The live Supabase RLS state. Only `schema.sql` was read.
- No code in either clone was built, run or tested. The "20 tests" count comes from reading the file.

---

## 10. Sources

Spec and standards:
- https://hl7.org/fhir/us/core/package-list.json
- https://hl7.org/fhir/us/core/
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-patient.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-encounter.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-vital-signs.html (and .json)
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-blood-pressure.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-heart-rate.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-respiratory-rate.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-body-temperature.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-pulse-oximetry.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-body-weight.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-observation-lab.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-documentreference.html
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-procedure.html
- https://hl7.org/fhir/us/core/clinical-notes.html
- https://hl7.org/fhir/us/core/profiles-and-extensions.html
- https://www.hl7.org/fhir/us/core/vitals-write.html
- https://hl7.org/fhir/R4/patient.html
- https://hl7.org/fhir/R4/encounter.html
- https://hl7.org/fhir/R4/documentreference.html
- https://hl7.org/fhir/R4/composition.html
- https://hl7.org/fhir/R4/appointment.html
- https://hl7.org/fhir/R4/datatypes.html
- https://hl7.org/fhir/R4/http.html
- https://hl7.org/fhir/R4/search.html
- https://hl7.org/fhir/R4/observation-vitalsigns.html
- https://hl7.org/fhir/R4/bp.html
- https://hl7.org/fhir/R4/valueset-ucum-bodytemp.html
- https://hl7.org/fhir/R4/valueset-ucum-bodyweight.html
- https://hl7.org/fhir/R4/valueset-observation-vitalsignresult.html
- https://hl7.org/fhir/R4/v3/ActEncounterCode/vs.html

- https://hl7.org/fhir/us/core/CapabilityStatement-us-core-server.json (Encounter `identifier` SHOULD; combos; searchRevInclude)
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-documentreference.json
- https://hl7.org/fhir/us/core/CodeSystem-us-core-documentreference-category.json
- https://hl7.org/fhir/us/core/ValueSet-us-core-procedure-code.json
- https://hl7.org/fhir/us/core/StructureDefinition-us-core-encounter.json

Terminology:
- https://tx.fhir.org/r4/CodeSystem/$lookup?system=http://snomed.info/sct&code=439708006
- https://tx.fhir.org/r4/ValueSet/$validate-code?url=http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1267.23&system=http://snomed.info/sct&code=439708006
- https://tx.fhir.org/r4/CodeSystem/$subsumes?system=http://snomed.info/sct&codeA=71388002&codeB=311401005
- https://tx.fhir.org/r4/CodeSystem/$lookup?system=http://loinc.org&code=34746-8
- https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search

Auth:
- https://hl7.org/fhir/smart-app-launch/
- https://hl7.org/fhir/smart-app-launch/backend-services.html
- https://hl7.org/fhir/smart-app-launch/client-confidential-asymmetric.html
- https://hl7.org/fhir/smart-app-launch/scopes-and-launch-context.html

Regulatory and vendors:
- https://onc-healthit.github.io/api-resource-guide/g10-criterion
- https://mediwareinc.github.io/consolo.interop-api-docs
- https://engage.axxess.com/api.html
- https://www.hchb.com/

Servers:
- https://hapi.fhir.org/about
- https://hapi.fhir.org/baseR4/metadata
- https://r4.smarthealthit.org/metadata
- https://launch.smarthealthit.org/v/r4/fhir/.well-known/smart-configuration
- https://server.fire.ly/metadata
- https://hub.docker.com/v2/repositories/hapiproject/hapi/tags
- https://raw.githubusercontent.com/hapifhir/hapi-fhir-jpaserver-starter/master/src/main/resources/application.yaml
- https://raw.githubusercontent.com/smart-on-fhir/smart-launcher-v2/main/README.md
- https://www.medplum.com/docs/auth/client-credentials

Tooling:
- https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2
- https://ts.sdk.modelcontextprotocol.io/v2/servers/tools
- https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/CHANGELOG.md
- https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
- https://github.com/hapifhir/org.hl7.fhir.core/releases/download/7.0.5/validator_cli.jar
- npm view: @modelcontextprotocol/sdk, @modelcontextprotocol/server, zod, jose, @types/fhir, @medplum/core, fhir-kit-client, fhirclient, chartinghero (E404, 2026-11-12)

Repo facts (read-only clones):
- `/tmp/claude-1000/-home-apexaipc/d5cf80c9-8ad4-49bd-8ca9-726b79696ca0/scratchpad/chartinghero`
- `/tmp/claude-1000/-home-apexaipc/d5cf80c9-8ad4-49bd-8ca9-726b79696ca0/scratchpad/demo-emr` (VITAL_RANGES at `src/utils/constants.js:16-24` re-read this run)

---

## 11. Review log

All repo facts below were re-checked against the clones this run, and all spec facts against the fetched sources listed in section 10.

1. **Pre-flight gate (3.3, PR6, Risk 3).** US Core 9.0.0 has Encounter `identifier` as SHOULD, and R4 servers SHOULD ignore unsupported params. Writes now require `/metadata` support, `Prefer: handling=strict`, `identifier` in the self link, and a matching identifier on every hit. Otherwise the write is refused. Added stub tests.
2. **class/type gate (3.4, PR6).** Only `date+patient` is SHALL; `class+patient` and `patient+type` are SHOULD; the only US Core searchRevInclude is `Provenance:target`. Added the capabilities gate and a client-side filter fallback.
3. **Terminology (section 4, Unverified).** The DocumentReference category is hard-coded as `http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category|clinical-note`. `439708006` validates in the Encounter Type VS, `311401005` is subsumed by `71388002`, and `34746-8` has SCALE_TYP `LP32888-7`. All three were removed from Unverified.
4. **PR1 chartinghero list (issues 4 and 9, merged).** Added the `RatchetError`/`RatchetConfig` renames and every comment and banner hit. Corrected errors.ts 43 to 82. The PR1 grep now excludes only env-read lines. The full zero-grep moved to PR2, with the shim isolated in `src/legacy-env.ts` and excluded by filename instead of a `DEPRECATED` token. The server.json env list moved to PR2.
5. **PR1 demo-emr list.** Added `supabase/schema.sql`, `CLAUDE.md` and `documents/mock-emr-spc.md`. The grep now covers the whole repo minus `node_modules` and `.git`.
6. **ESLint config.** None exists and eslint 8 aborts without one. PR1 now adds `.eslintrc.cjs`.
7. **VN overwrite text.** Now VN-30000 through VN-30002 (seed.sql:78,96,114), matching the test regex.
8. **Write-host allowlist (1, 3.2, PR2, PR7, Risk 2).** `FHIR_WRITE=on` and `FHIR_PRACTITIONER_ID` require a hard-coded `WRITE_HOSTS` host, regardless of `FHIR_ENVIRONMENT`. Added the unknown-host acceptance to PR2 and PR7.
9. **PR2 gate matrix.** Each negative case now supplies all other vars and asserts on stderr text. Added a positive mock control. Practitioner and `/metadata` startup checks moved to PR7 and PR6, and PR2 validates fhir config statically.
10. **Projection trigger.** PR2 replaces `isSupabaseEnabled()` with `DASHBOARD_SYNC=on` plus `BACKEND=mock` until the PR8 guard. Added tests for 0 Supabase calls in PR2 and PR7.
11. **Public sandbox projection.** `SYNTHETIC_HOSTS` is now the seeded loopback/LAN HAPI only. Public sandboxes project only Patients tagged `chartinghero-dev`. RLS-on is a precondition of `DASHBOARD_SYNC`, sequenced before PR8.
12. **Integration host.** Compose binds `127.0.0.1`, commands use `FHIR_IT_BASE_URL` (default `http://127.0.0.1:8080/fhir`), and integration acceptance is ProBook-only until Q12 is answered, which must happen before PR6.
13. **Bundle.total.** Seed and reset checks count `search.mode=match` entries. The H2 in-memory default (`jdbc:h2:mem:test_mem`) was confirmed, so restart-as-reset stands.

No issues conflicted. Issues 4 and 9 overlapped and were merged as described in item 4.
