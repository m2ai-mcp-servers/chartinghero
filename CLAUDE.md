# CLAUDE.md

Guidance for Claude Code in this repository.

## Project overview

**chartinghero** is an MCP server that lets Claude search patients, document home health visits and read visit history. It runs a mock backend, and a FHIR R4 / US Core backend that reads (search, history) but does not write yet; the plan, decisions and PR sequence are in `docs/FHIR-PIVOT-PLAN.md`. Work PRs in that order.

## Technical stack

- TypeScript, `@modelcontextprotocol/sdk`, stdio transport
- Node.js 18+
- Jest (ts-jest ESM preset), ESLint 8 (`.eslintrc.cjs`)

## Commands

```bash
npm install          # install dependencies
npm run build        # compile TypeScript to dist/
npm run dev          # run with tsx
npm test             # jest
npm run lint         # eslint
npm run golden       # regenerate tests/fixtures/golden{,-negative} (CI fails on a diff)
npm run validate:golden  # HL7 validator_cli 7.0.5 + US Core 9.0.0 on the fixtures (Java 17, network)
docker compose -f docker/compose.fhir.yml up -d && node scripts/seed-fhir.mjs   # local HAPI R4 on 127.0.0.1:8080, in memory
FHIR_IT_BASE_URL=http://127.0.0.1:8080/fhir npx jest tests/contract            # contract against the live server
FHIR_RECORD=1 FHIR_IT_BASE_URL=http://127.0.0.1:8080/fhir npx jest tests/contract/fhir   # rewrite tests/fixtures/recorded/
```

Before a commit: `npx tsc --noEmit`, `npx tsc --noEmit -p tests/tsconfig.json`, `npx jest`, `npx eslint "src/**/*.ts"`. After any change under `src/fhir/`, run `npm run golden` and commit the fixture diff.

## Layout

```
src/
├── index.ts           # entry point; config and backend fail closed at startup
├── server.ts          # McpServer + registerTool; the SDK validates every call against its zod schema
├── schemas/           # zod input schemas (plausibility bounds, dates, times, overnight)
├── config.ts          # env config (section 3.2 of the plan); config/hosts.ts holds WRITE_HOSTS
├── legacy-env.ts      # the only reader of deprecated 0.1.0 env vars
├── backends/          # PatientBackend interface, mock backend, factory, cursor.ts (signed paging cursors)
├── backends/fhir/     # client (GET only), capabilities (/metadata gates), read path, preflight (duplicate-visit gate)
├── auth/              # none, static bearer
├── mappers/           # DTO mappers shared by backends
├── fhir/              # pure FHIR R4 / US Core mappers: visit to transaction Bundle, FHIR Patient to domain
├── tools/             # search-patient, create-visit-note, get-patient-history
├── services/          # patient-service (validation, delegation, projection hook), mock-data, supabase-service
├── types/             # patient and visit types
└── utils/             # logger, errors (ChartingHeroError base class)
tests/                 # jest suite; startup.test.ts spawns the server via tsx; tools.test.ts checks paged tool output
tests/fhir/            # mapper tests; golden-cases.ts is the one case list for tests and npm run golden
tests/fixtures/        # golden transaction Bundles and negative fixtures (generated, never hand-edited)
tests/backends/        # FHIR backend against tests/support/fake-fhir.ts (in-memory server that can hide or ignore params)
tests/contract/        # backend.contract.ts runs on mock and FHIR; FHIR replays tests/fixtures/recorded/ unless FHIR_IT_BASE_URL is set
docker/compose.fhir.yml, scripts/seed-fhir.mjs   # local FHIR server and its fictional seed (loopback only)
scripts/               # golden.ts, validate-golden.sh (pinned jar), validation-summary.mjs
.github/workflows/     # fhir-validate.yml: BASE, golden diff, HL7 validator; contract suite against a HAPI service container
docs/FHIR-PIVOT-PLAN.md
```

## Tools

| Tool | Status |
|------|--------|
| `search_patient` | Mock, FHIR |
| `create_visit_note` | Mock; FHIR refuses (write lands in PR7) |
| `get_patient_history` | Mock, FHIR |

## Invariants

- FHIR answers are checked, not trusted: every filter is applied again on the client, an identifier hit must carry the identifier, paging links are followed only under `FHIR_BASE_URL`, and upstream text never reaches a log or tool result (`ApiError` keeps status and issue codes only).
- No FHIR write without the pre-flight in `backends/fhir/preflight.ts` passing. Never skip it. A note-only write has no pre-flight yet, so it is refused.
- A paging cursor carries its own filters, patient and page size; a request cannot change them.
- Recorded fixtures come from the local container only.
- Synthetic data only. No real patient data in tests, fixtures, logs or the demo Supabase table.
- No vendor product names in code, docs or the demo.
- Writes to a real EMR are out of scope until SMART user auth lands (0.3.0).
- Dashboard projection runs only with `DASHBOARD_SYNC=on` and the mock backend until the PR8 guard exists.
- Publishing to npm or the MCP Registry and Netlify changes need the owner's approval each time.

## Related

- `m2ai-mcp-servers/chartinghero-demo-emr`: demo dashboard fed by the Supabase sync.
- Historical (pre-pivot) docs: `BLUEPRINT.md`, `docs/API_REQUIREMENTS.md`, `prds/`.
