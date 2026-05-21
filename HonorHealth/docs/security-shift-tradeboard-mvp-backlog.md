# Security Shift Trade Board MVP Backlog

## 1) Delivery model
- Framework: Scrum-style 2-week sprints
- MVP timeline: 3 sprints (6 weeks)
- Tracking: Epic -> Feature -> Story -> Task
- Priority scale: P0 (must), P1 (should), P2 (nice)

## 2) Epics and backlog items

### EPIC A: Platform Foundation (Sprint 1)
Goal: establish project baseline, security, and core data structures.

#### A1. Project scaffolding and environments
- Priority: P0
- Story points: 5
- Description: Create backend and frontend project skeletons, environment configs, CI checks.
- Implementation:
  - Backend service scaffold (REST API, layered architecture)
  - Frontend scaffold (role-aware web app)
  - Shared config for dev/test/prod
  - Lint, formatting, unit-test runners in CI
- Acceptance criteria:
  - Repository builds and runs locally in one command for API + UI
  - CI runs lint + tests on pull request

#### A2. Authentication and RBAC
- Priority: P0
- Story points: 8
- Description: Implement login integration and role-based access control for Officer and Supervisor.
- Implementation:
  - Define roles: Officer, Supervisor, System
  - Add auth middleware and route guards
  - Add role checks on sensitive endpoints
- Acceptance criteria:
  - Officers cannot access approval endpoints
  - Supervisors can access approval queue and decision actions

#### A3. Data model and migrations
- Priority: P0
- Story points: 8
- Description: Implement initial schema and migration scripts.
- Implementation:
  - Tables/entities: Shift, TradeRequest, ValidationResult, AuditLog, Notification
  - Indexes on status, shiftId, reviewedAt
  - Migration + rollback scripts
- Acceptance criteria:
  - Fresh environment can create schema via migrations
  - Seed data script produces testable dataset

### EPIC B: Shift Posting and Trade Board (Sprint 1)
Goal: let posting officers publish shifts and let officers browse posted shifts.

#### B1. My Shifts endpoint and UI list
- Priority: P0
- Story points: 5
- Description: Display officer-owned shifts eligible for posting.
- Implementation:
  - API endpoint for current user shifts
  - UI list with shift details and eligibility tags
- Acceptance criteria:
  - Officer sees only own shifts
  - Ineligible shifts show reason and no post action

#### B2. Post shift to trade board
- Priority: P0
- Story points: 5
- Description: Convert eligible shift into Posted state and expose on board.
- Implementation:
  - Endpoint: create posted shift record
  - Idempotency guard to avoid duplicate postings
  - Audit event for posting action
- Acceptance criteria:
  - Shift appears in trade board with Posted status
  - Duplicate posts are blocked with clear error

#### B3. Trade board listing and filters
- Priority: P0
- Story points: 5
- Description: Show posted shifts with date/location/role filters.
- Implementation:
  - Endpoint with pagination and filter params
  - UI filters and sorting
- Acceptance criteria:
  - Filtering by date and role works
  - Pagination supports high volume list

### EPIC C: Pickup Request and Validation (Sprint 2)
Goal: enable request flow and enforce eligibility checks.

#### C1. Create TradeRequest from posted shift
- Priority: P0
- Story points: 8
- Description: Officer requests pickup of posted shift.
- Implementation:
  - Endpoint: POST trade request
  - Status transition Posted -> PendingApproval
  - Constraint: requester cannot be posting officer
- Acceptance criteria:
  - Valid request enters PendingApproval
  - Invalid self-request is blocked

#### C2. Validation service (armed, role, rest/OT)
- Priority: P0
- Story points: 13
- Description: Evaluate policy checks at request time and again before approval.
- Implementation:
  - Rule engine module with pluggable validators
  - Persist ValidationResult with pass/fail details
  - Re-validation hook in approval transaction
- Acceptance criteria:
  - All three validations recorded with explainable outcomes
  - Approval cannot proceed on failed overall validation

#### C3. Concurrency and request locking
- Priority: P0
- Story points: 8
- Description: Prevent race conditions when multiple officers request same shift.
- Implementation:
  - Database row lock or optimistic concurrency token
  - Single active PendingApproval per shift constraint
- Acceptance criteria:
  - Simultaneous requests produce one success, others rejected cleanly

### EPIC D: Supervisor Approval Workflow (Sprint 2)
Goal: complete decisioning and shift reassignment.

#### D1. Approval queue
- Priority: P0
- Story points: 5
- Description: Supervisor sees pending requests with validation summaries.
- Implementation:
  - Queue endpoint with request metadata and validation flags
  - UI queue page with quick filter and details drawer
- Acceptance criteria:
  - Queue shows all PendingApproval items
  - Validation summary visible before decision

#### D2. Approve request transaction
- Priority: P0
- Story points: 13
- Description: Atomic approval updates shift ownership and request state.
- Implementation:
  - Endpoint: approve request
  - Transaction steps:
    - Re-run validation
    - Reassign shift to requesting officer
    - Set TradeRequest status Approved
    - Write audit event
    - Enqueue notifications
- Acceptance criteria:
  - On success, shift owner changes and status is Approved
  - Partial updates do not occur on failure

#### D3. Deny request path
- Priority: P0
- Story points: 5
- Description: Supervisor denies request with optional reason.
- Implementation:
  - Endpoint: deny request
  - Status transition PendingApproval -> Denied
  - Audit event and notification enqueue
- Acceptance criteria:
  - Denied request remains visible in history
  - Shift assignment remains unchanged

### EPIC E: Audit, Notifications, and History (Sprint 3)
Goal: ensure accountability and communication.

#### E1. Audit logging framework
- Priority: P0
- Story points: 8
- Description: Capture immutable event trail for all state transitions.
- Implementation:
  - Structured audit schema (actor, action, before/after, metadata)
  - Helper library to standardize event writes
- Acceptance criteria:
  - Every post/request/approve/deny action emits an audit event
  - Audit entries are queryable by request ID

#### E2. Notification service integration
- Priority: P1
- Story points: 8
- Description: Notify posting and requesting officers of outcomes.
- Implementation:
  - Async queue-based notification dispatch
  - Templates: RequestSubmitted, RequestApproved, RequestDenied
  - Retry and dead-letter strategy
- Acceptance criteria:
  - Approval and denial both notify Officer A + Officer B
  - Failed sends are retried and logged

#### E3. Request detail timeline
- Priority: P1
- Story points: 5
- Description: UI timeline for request lifecycle and events.
- Implementation:
  - Endpoint returning request + audit timeline
  - Timeline UI with state chips and timestamps
- Acceptance criteria:
  - User can trace full request lifecycle in one screen

### EPIC F: Quality, Security, and Release Readiness (Sprint 3)
Goal: launch safely with predictable behavior.

#### F1. Test automation suite
- Priority: P0
- Story points: 13
- Description: Add unit, integration, and E2E test coverage for all critical paths.
- Implementation:
  - Unit tests for validation rules and state transitions
  - Integration tests for APIs and DB constraints
  - E2E tests for post/request/approve/deny flows
- Acceptance criteria:
  - Critical flows pass in CI
  - Minimum agreed test coverage threshold met

#### F2. Security and compliance checks
- Priority: P0
- Story points: 5
- Description: Validate authZ, audit completeness, and sensitive data handling.
- Implementation:
  - RBAC penetration tests for privileged endpoints
  - PII masking rules in logs
  - API input validation and anti-forgery controls
- Acceptance criteria:
  - No critical/high vulnerabilities in release report

#### F3. Observability and runbook
- Priority: P1
- Story points: 5
- Description: Metrics, alerts, and operational runbook for support team.
- Implementation:
  - Metrics: pending queue size, approval latency, notification failures
  - Alert thresholds and escalation map
  - Runbook for common incidents
- Acceptance criteria:
  - On-call can detect and triage common failures within SLA

## 3) Sequence and dependency map
1. A1 -> A2 -> A3 must complete before core business features.
2. B1/B2/B3 can proceed once A2/A3 are ready.
3. C1 depends on B2/B3.
4. C2 and C3 must be complete before D2 go-live.
5. D1 depends on C1/C2.
6. D2 and D3 depend on D1 and C2/C3.
7. E1 should begin in Sprint 1 as cross-cutting; E2/E3 in Sprint 3.
8. F1/F2/F3 run throughout but finalize in Sprint 3.

## 4) Definition of done (MVP)
- All P0 stories complete and accepted.
- End-to-end workflow passes:
  - Post shift
  - Request pickup
  - Supervisor approve/deny
  - Reassign or keep original assignment accordingly
  - Audit + notifications emitted
- Production readiness checklist signed by engineering + operations.

## 5) Technical implementation approach

### Backend architecture
- Pattern: modular monolith (MVP) with clear boundaries:
  - auth module
  - shift module
  - trade-request module
  - validation module
  - audit module
  - notification module
- Why: fast MVP delivery without distributed-system overhead.

### Data and transactions
- Use ACID transactions for approve/deny decisions.
- Add unique constraint to enforce one active PendingApproval request per shift.
- Use status enum and transition guard function to prevent illegal transitions.

### API conventions
- RESTful endpoints with role checks at controller and service layers.
- Standard error contract:
  - code
  - message
  - details
- Idempotency keys for post/request creation endpoints.

### Frontend approach
- Role-based routing and guarded pages.
- Shared status component for Posted/PendingApproval/Approved/Denied.
- Optimistic UI avoided for approval actions (use server-confirmed updates).

### Validation engine
- Validator interface with separate classes:
  - ArmedQualificationValidator
  - RoleMatchValidator
  - RestOtValidator
- Aggregate to overallPass with explainable failures for supervisor review.

### Notifications
- Event-driven: business action writes outbox event.
- Worker reads outbox and sends notifications.
- Retries with backoff; dead-letter queue for unresolved failures.

### Auditability
- Immutable append-only audit records.
- Include correlation IDs to tie request, decision, and notification events.

## 6) Suggested sprint board initialization
- Create 6 epics (A-F).
- Create all listed stories under each epic.
- Add technical tasks under each story from the Implementation sections.
- Tag labels:
  - mvp
  - security-trade-board
  - backend
  - frontend
  - validation
  - audit
  - notifications

## 7) Immediate next actions (this week)
1. Confirm stack choices (frontend, backend, DB, auth provider).
2. Finalize validation policy matrix with operations/supervisor stakeholders.
3. Build A1/A2/A3 and B1 skeleton in parallel.
4. Demo trade board posting by end of week.
