# CLAUDE.md

Guidance for Claude Code in this repository.

## Project overview

**chartinghero** is an MCP server that lets Claude search patients, document home health visits and read visit history. Today it runs a mock backend only. The real backend is being built on standard FHIR R4 / US Core; the plan, decisions and PR sequence are in `docs/FHIR-PIVOT-PLAN.md`. Work PRs in that order.

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
```

Before a commit: `npx tsc --noEmit`, `npx jest`, `npx eslint "src/**/*.ts"`.

## Layout

```
src/
├── index.ts           # MCP server entry point; config and backend fail closed at startup
├── config.ts          # env config (section 3.2 of the plan); config/hosts.ts holds WRITE_HOSTS
├── legacy-env.ts      # the only reader of deprecated 0.1.0 env vars
├── backends/          # PatientBackend interface, mock backend, factory
├── mappers/           # DTO mappers shared by backends
├── tools/             # search-patient, create-visit-note, get-patient-history
├── services/          # patient-service (validation, delegation, projection hook), mock-data, supabase-service
├── types/             # patient and visit types
└── utils/             # logger, errors (ChartingHeroError base class)
tests/                 # jest suite; startup.test.ts spawns the server via tsx
docs/FHIR-PIVOT-PLAN.md
```

## Tools

| Tool | Status |
|------|--------|
| `search_patient` | Mock |
| `create_visit_note` | Mock |
| `get_patient_history` | Mock |

## Invariants

- Synthetic data only. No real patient data in tests, fixtures, logs or the demo Supabase table.
- No vendor product names in code, docs or the demo.
- Writes to a real EMR are out of scope until SMART user auth lands (0.3.0).
- Dashboard projection runs only with `DASHBOARD_SYNC=on` and the mock backend until the PR8 guard exists.
- Publishing to npm or the MCP Registry and Netlify changes need the owner's approval each time.

## Related

- `m2ai-mcp-servers/chartinghero-demo-emr`: demo dashboard fed by the Supabase sync.
- Historical (pre-pivot) docs: `BLUEPRINT.md`, `docs/API_REQUIREMENTS.md`, `prds/`.
