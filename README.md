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

Mock mode is the default and the only working backend today. It:
- uses 5 fictional test patients
- stores visit notes in memory
- prefixes every tool result with a mock-mode banner

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

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | No | Sync mock visits to the [demo dashboard](https://github.com/m2ai-mcp-servers/chartinghero-demo-emr). Synthetic data only. |
| `LOG_LEVEL` | No | `debug`, `info`, `warn` or `error` |

Backend selection (`BACKEND`, `FHIR_*`) arrives with the FHIR backend; the earlier vendor-specific variables are being retired.

## Project structure

```
chartinghero/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── config.ts             # Configuration
│   ├── tools/                # search-patient, create-visit-note, get-patient-history
│   ├── services/             # patient-service, mock-data, supabase-service
│   ├── types/                # Patient and visit types
│   └── utils/                # Logger, errors
├── tests/
│   └── patient-service.test.ts
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
