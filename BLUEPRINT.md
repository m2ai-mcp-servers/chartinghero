# Ratchet MCP - Blueprint

> **Historical (pre-pivot).** This document describes the original vendor-specific plan and is no longer current. The active plan is `docs/FHIR-PIVOT-PLAN.md`.

Phase tracking document for Ratchet MCP server development.

## Current Status

**Phase:** Mock Mode Complete - Ready for Claude Desktop Testing
**Next milestone:** Production EMR API integration (pending vendor API access)
**Last Updated:** 2024-12-22

---

## Phase 1: Requirements Gathering ✅

- [x] Define project structure
- [x] Create initial CLAUDE.md
- [x] Create README.md
- [x] Document M2AI NurseCall connection
- [ ] **Pending** - Acquire PointCare API documentation
- [ ] **Pending** - Obtain test/sandbox credentials
- [ ] **Pending** - Document authentication method

**Status:** Complete (mock mode allows development to continue)

---

## Phase 1.5: Mock Mode Implementation ✅ NEW

- [x] Create MCP server infrastructure
- [x] Define TypeScript types for EMR data
- [x] Implement mock data layer (5 test patients)
- [x] Build `search_patient` tool with mock backend
- [x] Build `create_visit_note` tool with mock backend
- [x] Build `get_patient_history` tool with mock backend
- [x] Write unit tests (20 tests passing)
- [x] Update documentation

**Status:** Complete - Ready for Claude Desktop integration testing

---

## Phase 2: PRD Completion (Pending Vendor API)

- [x] Define `search_patient` tool parameters (mock)
- [x] Define `create_visit_note` tool parameters (mock)
- [x] Define `get_patient_history` tool parameters (mock)
- [ ] **Pending** - Document real API endpoints and response schemas
- [x] Define acceptance criteria (functional) - skeleton
- [x] Define acceptance criteria (non-functional) - skeleton
- [x] Complete security section - skeleton
- [ ] **Pending** - Complete Grimlock handoff checklist

**Exit Criteria:** PRD ready for Grimlock sprint (needs API docs)

---

## Phase 3: Grimlock Build (Weekend Sprint)

> Note: Mock mode allows manual testing. Grimlock sprint deferred until API docs available.

- [ ] Grimlock validates PRD
- [x] Project scaffolding created (done manually)
- [x] `search_patient` tool implemented (mock mode)
- [x] `create_visit_note` tool implemented (mock mode)
- [x] `get_patient_history` tool implemented (mock mode)
- [x] Unit tests written
- [ ] **Pending** - Integration tests (need real API)
- [x] Documentation generated

**Status:** Partially complete - Real API integration pending

---

## Phase 4: Week 2 Refinement

- [ ] Human security review
- [ ] **Pending** - Manual integration testing with PointCare sandbox
- [x] Error handling review (mock mode)
- [ ] Performance testing
- [x] Documentation review
- [ ] Claude Desktop integration test (ready to test)
- [ ] n8n workflow integration (M2AI NurseCall update)

**Exit Criteria:** Production-ready MCP server

---

## Phase 5: Production Deployment

- [ ] Production credentials obtained
- [ ] Deployment documentation created
- [ ] Production deployment executed
- [ ] M2AI NurseCall workflow updated
- [ ] End-to-end testing complete
- [ ] Monitoring/alerting configured

**Exit Criteria:** Live integration with M2AI NurseCall

---

## Blockers

| Blocker | Required From | Status | Impact |
|---------|---------------|--------|--------|
| API Documentation | PointCare | Not requested | Blocks real API integration |
| Sandbox Credentials | PointCare | Not requested | Blocks integration testing |
| Auth Method Details | PointCare | Unknown | Blocks auth implementation |

**Workaround:** Mock mode allows development and Claude Desktop testing to continue.

---

## What Works Now (Mock Mode)

| Feature | Status | Notes |
|---------|--------|-------|
| MCP Server | ✅ Working | Starts and responds to tool calls |
| search_patient | ✅ Working | Searches 5 mock patients by name/ID/phone |
| create_visit_note | ✅ Working | Creates and stores visit notes in memory |
| get_patient_history | ✅ Working | Returns visit history for patients |
| Unit Tests | ✅ 20/20 | All passing |
| Claude Desktop | ✅ Ready | Can be configured and tested |
| Logging | ✅ Working | PHI-safe logging to stderr |

---

## Dependencies

```
M2AI NurseCall (n8n)
        │
        ▼
    Ratchet MCP ──> PointCare EMR
        ▲               │
        │               └── Pending (no API docs)
        │
    Grimlock (builder) ── deferred until API ready
```

---

## Next Actions

1. **Test with Claude Desktop** - Configure and test mock mode
2. **Request PointCare API access** - Contact vendor or employer
3. **Update PRD** - Fill in real API details when available
4. **Implement real API** - Replace mock with real calls
5. **Run Grimlock sprint** - Or continue manual development

---

## Notes

- SDK: TypeScript (@modelcontextprotocol/sdk)
- Aligns with Anthropic MCP patterns for portfolio purposes
- Origin: M2AI NurseCall workflow for nursing admin documentation
- Mock mode provides full development experience without API cost
