# Schedule Calendar Expansion Plan

## Goal
Expand the current Shift Trade Board into a live schedule management experience so supervisors can create schedules, officers can view their assigned work hours in a calendar, and any approved swap or shift change updates the schedule automatically.

## Current State
- Officers can view their shifts and post them to the trade board.
- Officers can request pickup of posted shifts.
- Supervisors can approve or deny requests.
- Shift ownership is updated after approval.
- Audit logs and notifications already exist.

## Desired Outcome
1. Show a calendar-style schedule view for officers and supervisors.
2. Show officer work hours across time in a readable schedule format.
3. Allow supervisors to create and edit schedules for officers.
4. Keep the calendar in sync automatically when a trade is approved or denied.
5. Preserve the current trade board workflow and add schedule management on top of it.

## Proposed Design

### 1. Schedule as the source of truth
The shift schedule should be the canonical source for work assignments. The trade board becomes a workflow on top of scheduled work, not a separate manual schedule.

### 2. Calendar-based schedule UI
Add a schedule page that supports:
- Month/week/day calendar views
- Officer filter or officer list
- Shift blocks with time, location, and status
- Supervisor-only create/edit actions
- Live refresh after trade approval, denial, or schedule edits

### 3. Officer and supervisor views
- Officer view: see only their own schedule and any posted shifts they may request.
- Supervisor view: see all officers and all schedules, create shifts, edit shifts, and review trade activity.

### 4. Live update behavior
When an approval or schedule edit occurs:
- The affected shift record changes in the database.
- The calendar reloads the new schedule state.
- The trade board and schedule view remain consistent.

## Data Model Changes

### Existing models that will continue to be used
- `Shift`
- `TradeRequest`
- `ValidationResult`
- `AuditLog`
- `Notification`

### Recommended model expansion

#### Shift
Add fields to support richer scheduling:
- `scheduledById` - supervisor or system user that created the shift
- `sourceType` - indicates whether the shift came from a supervisor-created schedule or an imported/default assignment
- `notes` - optional shift notes for supervisors
- `lastSyncedAt` - optional timestamp for client sync/live updates

#### OfficerProfile or Officer directory
Add display-friendly data for calendar filtering:
- `displayName`
- `department` or `team` if needed later
- `isActive`

#### Optional new model: `ScheduleTemplate` or `ScheduleEvent`
If you want a more explicit calendar layer than `Shift`, add:
- `ScheduleEvent`
  - `id`
  - `officerId`
  - `startAt`
  - `endAt`
  - `location`
  - `status`
  - `createdById`
  - `updatedById`
  - `linkedShiftId` (optional)

This is useful if you want to separate a planned schedule from an operational shift record.

### Relationship rules
- One officer can have many shifts.
- One shift belongs to one officer at a time.
- Trade approval updates the owner of the shift.
- Any schedule edit must be audited.

## API Changes

### New or expanded endpoints
1. `GET /api/schedule`
- Returns calendar-ready schedule data.
- Supports filtering by officer, date range, and role.

2. `POST /api/schedule`
- Supervisor creates a new schedule item or assigned shift.

3. `PATCH /api/schedule/:id`
- Supervisor updates shift time, officer, location, or status.

4. `GET /api/officers`
- Returns officer list for schedule filtering and supervisor assignment.

5. `GET /api/schedule/live`
- Optional later enhancement if you want server-sent events or polling.

### Existing endpoints that must stay consistent
- `POST /api/trade-board/posts`
- `POST /api/trade-requests`
- `POST /api/trade-requests/:id/approve`
- `POST /api/trade-requests/:id/deny`

## UI Changes

### New pages / sections
1. Schedule Calendar page
- Calendar grid or timeline view
- Officer selector
- Shift details drawer or modal
- Supervisor create/edit shift controls

2. Schedule Detail page or side panel
- Shows officer schedule block details
- Shows linked trade request history
- Shows approval and audit history

### Existing pages that will be enhanced
- Trade Board page remains available
- My Shifts view can link into the schedule calendar
- Approval Queue can link to schedule details for the affected officer

## Live Update Strategy
Use one of these approaches:
1. Polling every 10–30 seconds for the schedule page
2. Manual refresh after approval and schedule edits
3. Later enhancement: WebSocket or server-sent events for instant updates

For the next iteration, polling is the simplest and lowest-risk option.

## Suggested Implementation Phases

### Phase 1 - Data and schedule read model
- Extend `Shift` or add `ScheduleEvent`
- Add schedule query endpoint
- Add officer list endpoint
- Seed or create supervisor schedule creation support

### Phase 2 - Calendar UI
- Add schedule page with calendar view
- Add officer filters and shift cards/blocks
- Add supervisor create/edit form

### Phase 3 - Integration with trade workflow
- On approval, update the schedule automatically
- On denial, keep schedule unchanged and persist audit history
- Ensure trade board and schedule stay synchronized

### Phase 4 - Live refresh
- Add polling or real-time updates
- Refresh schedule after approval and supervisor edits

### Phase 5 - Hardening
- Add authorization checks for schedule creation/editing
- Add integration tests for schedule creation and live update behavior
- Add timeline/audit view for schedule changes

## Key Rules
- Supervisors can create and modify schedules.
- Officers can only view their own schedule and request valid shift trades.
- Approved trades must update the schedule automatically.
- Every schedule mutation must be audit logged.
- Validation rules still govern trade eligibility.

## Acceptance Criteria
1. A supervisor can create a schedule for an officer.
2. An officer can view their work hours in a calendar.
3. Approved trades immediately reflect in the schedule.
4. The schedule and trade board remain consistent after updates.
5. Audit logs capture schedule creation and schedule changes.

## Recommendation
Approve this plan before implementation. The lowest-risk path is to extend the existing `Shift` model and build a schedule calendar page on top of it, rather than introducing a separate scheduling engine immediately.
