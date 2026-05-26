# Security Professionals Shift Trade Guidelines

## Objective
Use this workflow to post, request, review, and finalize shift trades in a consistent and policy-compliant way.

## A. Officer Workflow (Posting and Requesting)
1. Sign in and select your active user profile.
2. Open `My Shifts`.
3. Choose a shift with status `Assigned` and marked eligible for posting.
4. Select `Post to Trade Board`.
5. Confirm the shift appears in `Open Posted Shifts` with status `Posted`.
6. To pick up a shift, open `Open Posted Shifts`.
7. Select a posted shift that is not your own.
8. Select `Request Pickup`.
9. System creates a Trade Request in `PendingApproval` status.

## B. System Validation Workflow
1. On request creation, the system evaluates:
- Role qualification
- Armed qualification (if required by shift)
- Rest/overtime and overlap constraints
2. System blocks duplicate pending requests for the same shift.
3. Validation outcomes are stored for supervisor review and audit.

## C. Supervisor Workflow (Decision)
1. Sign in using supervisor profile.
2. Open `Approval Queue`.
3. Review the request details and validation status.
4. Select one decision:
- `Approve`: request status becomes `Approved`; shift is reassigned to requesting officer and shift status returns to `Assigned`.
- `Deny`: request status becomes `Denied`; shift remains available as posted unless otherwise updated by supervisor.
5. Confirm request status update is reflected in the queue.

## D. Notifications and Audit
1. After decision, notifications are generated for affected officers.
2. All key actions are written to audit logs, including posting, request creation, approval, and denial.

## E. Status Reference
- Shift statuses: `Assigned`, `Posted`
- Trade Request statuses: `PendingApproval`, `Approved`, `Denied`

## F. Practical Tips
1. Post only shifts you can no longer cover.
2. Submit requests early to allow supervisor review time.
3. Supervisors should prioritize requests with valid coverage and compliance outcomes.
