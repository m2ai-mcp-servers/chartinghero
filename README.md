# chartinghero

**MCP server for clinical charting with Claude.** Lets Claude search patients, document home health visits (SOAP note, vitals, interventions, education) and read visit history.

> **Status:** mock backend only. The real backend is moving to standard FHIR R4 (US Core); see [docs/FHIR-PIVOT-PLAN.md](docs/FHIR-PIVOT-PLAN.md). Do not use with real patient data.

## Status

| Component | Status |
|-----------|--------|
| MCP server (stdio) | Working, mock backend |
| Unit tests | `npm test` |
| FHIR R4 backend | Planned for 0.2.0 |
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

Mock mode is the only working backend today. It:
- uses 5 fictional test patients
- stores visit notes in memory (lost on restart)
- saves new notes as `pending_review`, unsigned, authored by a fictional nurse
- prefixes every tool result with `[MOCK DATA: fictional patients]`

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
| `FHIR_BASE_URL`, `FHIR_ENVIRONMENT`, `FHIR_PRACTITIONER_ID`, `VISIT_TIMEZONE` | When `BACKEND=fhir` | FHIR server, `local` or `sandbox`, authoring Practitioner id, IANA time zone. The fhir backend itself is not in this build yet. |
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
│   ├── backends/             # PatientBackend seam, mock backend, factory
│   ├── mappers/              # DTO mappers
│   ├── tools/                # search-patient, create-visit-note, get-patient-history
│   ├── services/             # patient-service (validation + projection hook), mock-data, supabase-service
│   ├── types/                # Patient and visit types
│   └── utils/                # Logger, errors
├── tests/                    # service, config, legacy-env, startup
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

## Related projects

- **[chartinghero-demo-emr](https://github.com/m2ai-mcp-servers/chartinghero-demo-emr)**: demo EMR dashboard that displays visits written by this server.

## License

MIT
