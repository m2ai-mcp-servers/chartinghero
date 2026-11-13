# chartinghero

**MCP server for clinical charting with Claude.** Lets Claude search patients, document home health visits (SOAP note, vitals, interventions, education) and read visit history.

> **Status:** the mock backend is complete. The FHIR R4 (US Core) backend can search patients and read visit history; it cannot write yet. See [docs/FHIR-PIVOT-PLAN.md](docs/FHIR-PIVOT-PLAN.md). Do not use with real patient data.

## Status

| Component | Status |
|-----------|--------|
| MCP server (stdio) | Working, mock backend |
| Unit tests | `npm test` |
| FHIR R4 backend, read (`search_patient`, `get_patient_history`) | Working against a local or sandbox FHIR R4 server |
| FHIR R4 backend, write (`create_visit_note`) | Not in this build; the call is refused |
| Production EMR writes | Out of scope until SMART user auth (0.3.0) |

## Quick start

### From npm

The 0.1.0 npm release was published under an earlier package name, which will be deprecated. Until `chartinghero` is published, install from source.

### From source

```bash
git clone https://github.com/m2ai-mcp-servers/chartinghero.git
cd chartinghero
npm install
npm run build
npm test
```

## Mock mode

Mock mode is the default backend. It:
- uses 5 fictional test patients
- stores visit notes in memory (lost on restart)
- saves new notes as `pending_review`, unsigned, authored by a fictional nurse
- prefixes every tool result with `[MOCK DATA: fictional patients]`

## FHIR mode (read only)

With `BACKEND=fhir` the server reads from a FHIR R4 server:

- At startup it reads `/metadata` and stops unless `fhirVersion` starts with `4.0`.
- `search_patient` looks up the `PT-xxxxx` identifier, the server id, the name (every word must match; add a `YYYY-MM-DD` date of birth to narrow it) and the phone number when the server supports phone search. A phone number matches as the server stores it; the digits-only spelling is tried as well.
- `get_patient_history` lists home health Encounters newest first. A visit with an unsigned note is `pending_review`, and so is one whose status the server reports as unknown; with a signed note it is `completed`. A visit with no note takes the Encounter's own status, and a cancelled visit stays cancelled. Encounters entered in error are left out. Vitals count when they are linked to the visit or were taken during it.
- When the server cannot return notes and vitals with the Encounters, history is built from the nurse notes instead: one row per visit, with no visit type.
- Results come one page at a time; a result with more pages includes a `cursor` to pass back. A cursor keeps the filters and page size it was issued with. A total shown as `3+` counts only the pages read so far. The order across pages is the server's (`_sort=-date`).
- `create_visit_note` is refused. With `FHIR_WRITE=on` it still resolves the patient and runs the duplicate-visit search, then stops. A note-only write (no Encounter) is refused outright until it has a duplicate check of its own.
- A bearer token is only sent over https, or over http to a loopback address.

The server only trusts what it can check: it filters results again itself, follows paging links only under `FHIR_BASE_URL`, refuses redirects, and reports upstream errors by HTTP status and issue code only.

### Local FHIR server

```bash
docker compose -f docker/compose.fhir.yml up -d   # HAPI FHIR R4 on 127.0.0.1:8080, data in memory
node scripts/seed-fhir.mjs                        # fictional patients, visits, vitals and notes (waits for the server to come up)
```

Then run with `BACKEND=fhir FHIR_BASE_URL=http://127.0.0.1:8080/fhir FHIR_ENVIRONMENT=local FHIR_PRACTITIONER_ID=<Practitioner id> VISIT_TIMEZONE=America/New_York`. Restarting the container wipes its data.

## Tools

| Tool | Description |
|------|-------------|
| `search_patient` | Find a patient by name, ID, or phone |
| `create_visit_note` | Document a visit with vitals and a SOAP note |
| `get_patient_history` | List a patient's previous visits |

### Example usage (in Claude)

```
"Search for patient Eleanor Thompson"
→ Returns patient PT-10001 with demographics and status

"Create a visit note for PT-10001 with blood pressure 120/80"
→ Creates and stores the visit note with vitals

"Get visit history for PT-10001"
→ Returns the list of previous visits
```

## Claude Desktop

Add to the Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "chartinghero": {
      "command": "node",
      "args": ["/absolute/path/to/chartinghero/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop, then check that `search_patient`, `create_visit_note` and `get_patient_history` are listed. Try: "Search for patient Eleanor".

## Test patients (mock mode)

| ID | Name | Status | Primary diagnosis |
|----|------|--------|-------------------|
| PT-10001 | Eleanor Thompson | Active | Type 2 Diabetes, CHF |
| PT-10002 | Robert Martinez | Active | COPD, Post-surgical |
| PT-10003 | Margaret Wilson | Active | Parkinson's Disease |
| PT-10004 | James Thompson | Active | Post-stroke rehab |
| PT-10005 | Dorothy Anderson | Discharged | Hip replacement |

## Configuration

Config fails closed: an invalid value stops the server at startup with a message naming the variable.

| Variable | Required | Description |
|----------|----------|-------------|
| `BACKEND` | When any `FHIR_*` var is set | `mock` or `fhir`. Unset with no `FHIR_*` vars means mock, with a stderr banner. |
| `FHIR_BASE_URL`, `FHIR_ENVIRONMENT`, `FHIR_PRACTITIONER_ID`, `VISIT_TIMEZONE` | When `BACKEND=fhir` | FHIR server, `local` or `sandbox`, authoring Practitioner id, IANA time zone. |
| `FHIR_WRITE` | No | `off` (default) or `on`. `on` is refused unless the host is in `WRITE_HOSTS` (`src/config/hosts.ts`). |
| `FHIR_WRITE_PROFILE`, `FHIR_BEARER_TOKEN`, `FHIR_IDENTIFIER_SYSTEM` | No | `full` or `note-only`; static token; identifier namespace. |
| `DASHBOARD_SYNC` | No | `off` (default) or `on`. With `on` and the mock backend, new notes are copied to the [demo dashboard](https://github.com/m2ai-mcp-servers/chartinghero-demo-emr) via `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Synthetic data only. |
| `LOG_LEVEL` | No | `debug`, `info`, `warn` or `error` |

Variables from the 0.1.0 release are still read for one release with a deprecation warning, but no longer select a backend.

## Project structure

```
chartinghero/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── config.ts             # Fail-closed configuration
│   ├── config/hosts.ts       # WRITE_HOSTS allowlist
│   ├── legacy-env.ts         # Deprecated 0.1.0 env vars (one release)
│   ├── backends/             # PatientBackend seam, mock backend, factory, signed paging cursors
│   ├── backends/fhir/        # FHIR client, /metadata capabilities, read path, write pre-flight
│   ├── auth/                 # none, static bearer token
│   ├── mappers/              # DTO mappers
│   ├── tools/                # search-patient, create-visit-note, get-patient-history
│   ├── services/             # patient-service (validation + projection hook), mock-data, supabase-service
│   ├── types/                # Patient and visit types
│   └── utils/                # Logger, errors
├── tests/                    # service, config, startup, backends/ (in-memory FHIR server), contract/ (both backends)
├── docker/compose.fhir.yml   # local FHIR R4 server
├── scripts/seed-fhir.mjs     # fictional seed data for it
├── docs/
│   └── FHIR-PIVOT-PLAN.md    # Backend pivot plan
├── package.json
├── tsconfig.json
└── jest.config.js
```

## Development

```bash
npm run dev    # run with tsx
npm test       # jest
npm run lint   # eslint
```

`npx jest tests/contract` runs one contract against both backends. The FHIR side replays recorded responses by default. To run it against the local server, seed it and set `FHIR_IT_BASE_URL=http://127.0.0.1:8080/fhir`; add `FHIR_RECORD=1` to rewrite the recordings in `tests/fixtures/recorded/`.

## Related projects

- **[chartinghero-demo-emr](https://github.com/m2ai-mcp-servers/chartinghero-demo-emr)**: demo EMR dashboard that displays visits written by this server.

## License

MIT
