# PointCare API Requirements

> **Historical (pre-pivot).** This document describes the original vendor-specific plan and is no longer current. The active plan is `docs/FHIR-PIVOT-PLAN.md`.

This document outlines what information is needed from PointCare to complete the Ratchet MCP server.

## Status

**Current Status:** Pending — EMR vendor API documentation required for production integration

## Required Information

### 1. API Documentation

| Requirement | Status | Notes |
|-------------|--------|-------|
| API Documentation URL/PDF | NOT ACQUIRED | Primary blocker |
| API Version | Unknown | |
| OpenAPI/Swagger spec | Unknown | Preferred if available |
| Developer portal access | Unknown | |

### 2. Authentication Method

We need to know how PointCare authenticates API requests:

| Method | Required Information |
|--------|---------------------|
| **API Key** | Header name, key format, how to obtain |
| **OAuth 2.0** | Auth URL, token URL, scopes, client credentials |
| **Basic Auth** | Username/password or service account details |
| **Other** | Full authentication flow documentation |

### 3. Endpoints Required

For the Ratchet MCP server, we need API endpoints for:

#### Patient Search
- Endpoint to search patients by name
- Endpoint to search patients by ID
- Endpoint to search patients by phone number
- Response schema (patient record structure)
- Pagination handling (if applicable)

#### Visit Note Creation
- Endpoint to create a new visit note
- Required fields for visit notes
- Optional fields for visit notes
- Response schema (confirmation structure)
- Any validation rules

#### Patient History
- Endpoint to retrieve visit history
- Query parameters (date range, limit, etc.)
- Response schema (visit note list structure)
- Pagination handling

### 4. Test Environment

| Requirement | Status | Notes |
|-------------|--------|-------|
| Sandbox/test API URL | NOT ACQUIRED | |
| Test credentials | NOT ACQUIRED | |
| Test patient data | NOT ACQUIRED | |
| Rate limits (sandbox) | Unknown | |

### 5. Sample Data

For developing and testing, we need:

- [ ] Sample patient search response (JSON)
- [ ] Sample visit note creation request/response
- [ ] Sample patient history response
- [ ] Error response examples
- [ ] Rate limit error examples

### 6. Technical Details

| Detail | Status | Notes |
|--------|--------|-------|
| Base API URL | Unknown | |
| API version | Unknown | |
| Request content type | Likely JSON | |
| Response content type | Likely JSON | |
| Rate limits | Unknown | |
| Timeout requirements | Unknown | |

## How to Acquire

### Option 1: Direct Request to PointCare
Contact PointCare directly for developer/API access:
- Website: https://www.pointcare.com
- Look for "Developers", "API", or "Integration Partners" section

### Option 2: Through Employer
If Stacey's company already uses PointCare:
- Check if they have API documentation
- Ask IT department about integration capabilities
- Request developer access through company account

### Option 3: Partner Program
Some EMR systems have partner programs:
- Check for PointCare partner/integration program
- May require application and approval process

## Impact on Development

Without API documentation:

| Component | Status |
|-----------|--------|
| Tool parameter definitions | Skeleton only |
| Response type definitions | Blocked |
| Integration tests | Blocked |
| Error handling | Generic only |
| PRD completion | Blocked |
| Grimlock sprint | Cannot start |

## Next Steps

1. **Identify contact path** - Determine best way to request API access
2. **Submit request** - Contact PointCare for API documentation
3. **Obtain sandbox access** - Request test environment credentials
4. **Update PRD** - Complete tool specifications with real API details
5. **Resume development** - Unblock Grimlock sprint

## Notes

- HIPAA considerations may affect API access approval process
- May need to sign Business Associate Agreement (BAA)
- Company may already have API access we don't know about
- Some EMR systems require partnership agreements for API access
