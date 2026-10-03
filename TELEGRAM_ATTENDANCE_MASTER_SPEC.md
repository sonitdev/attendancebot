**TELEGRAM ATTENDANCE PORTAL**

**Master Product, Worker, Admin & Security Specification**

Implementation handoff for Codex

**Core principle**

*Worker registers once. Telegram group identifies the project. Group
membership authorizes project access. Current Project determines where
the next attendance goes. Historical attendance never moves.*

# 1. Executive Summary

This document defines the complete target behavior for a Telegram-first
attendance platform for construction/site workers and sales staff. The
worker experience is intentionally minimal; the admin portal is
primarily for monitoring, evidence review, corrections, reporting,
security visibility, and audit.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>WORKER<br />
Telegram Project Group<br />
↓<br />
Set Current Project<br />
↓<br />
Private Bot / Mini App<br />
↓<br />
Photo + GPS + Server Time<br />
↓<br />
Attendance<br />
<br />
ADMIN<br />
Dashboard<br />
↓<br />
Monitor Projects / Workers / Attendance<br />
↓<br />
Review Exceptions / Evidence<br />
↓<br />
Correct with Audit Trail<br />
↓<br />
Reports</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 2. Non-Negotiable Domain Model

| **Concept**           | **Authoritative Identity**     | **Meaning**                                                     |
|-----------------------|--------------------------------|-----------------------------------------------------------------|
| Worker                | Telegram User ID               | Permanent worker identity                                       |
| Project               | Telegram Chat ID               | Permanent project/group identity                                |
| Project authorization | Live Telegram group membership | Whether worker is currently allowed to use that project         |
| Current Project       | worker.current_project_id      | Default project for the worker's next attendance                |
| Attendance history    | attendance.project_id          | Frozen historical project reference                             |
| Project button/token  | Signed/opaque project context  | Identifies requested project; never grants permission by itself |

# 3. Core Product Rules

- A worker registers once only; changing projects never creates another
  worker account.

- Telegram group/chat ID identifies the project. Group names are display
  labels and may change.

- A worker can remain in multiple project groups, but only one Current
  Project is the default for the next attendance.

- Changing Current Project never closes, completes, deletes, or archives
  the previous project.

- Attendance records permanently store the project used at check-in;
  later project switching cannot rewrite them.

- Construction projects may receive future maintenance, warranty,
  repair, inspection, or service attendance.

- Daily construction check-in requires live proof photo, GPS, and server
  timestamp; normal check-out requires GPS and server timestamp.

- The server, not the client UI, is responsible for authorization and
  authoritative attendance timestamps.

- Telegram notifications are operational evidence/visibility; the
  backend database is the source of truth.

- Admin corrections must be explicit and auditable; never silently
  rewrite evidence.

# 4. Worker End-to-End Scenarios

## W01. Create first project group

Manager creates a private Telegram project group, adds workers and the
Attendance Bot. The bot links the Telegram Chat ID to a project and
posts Set as Current Project.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>Create Telegram Group<br />
→ Add Attendance Bot<br />
→ Resolve Telegram Chat ID<br />
→ Create/link Project<br />
→ Post [Set as Current Project]</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## W02. New worker connects

A new worker taps the project button. The system identifies the Telegram
user, performs one-time phone/contact registration, revalidates project
access, then sets Current Project.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>Tap Project Button<br />
→ Telegram identity<br />
→ Not registered<br />
→ Share phone/contact<br />
→ Create Worker<br />
→ Verify group membership<br />
→ Set current_project_id</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## W03. First attendance home

The private Mini App shows the worker name, Current Project, date and
one prominent Check-In action. No project configuration is required.

## W04. Morning check-in

Worker captures a live proof photo, GPS is collected, the worker
previews and submits, and the server creates the authoritative
timestamp.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>CHECK IN<br />
→ Live Camera<br />
→ GPS<br />
→ Preview<br />
→ Submit<br />
→ Server Timestamp<br />
→ Save Attendance</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## W05. Project-group evidence

After successful check-in, the backend sends the proof to the Telegram
group belonging to the attendance project.

## W06. Already checked in

The worker sees Checked In status and Check-Out rather than another
normal Check-In action. Duplicate accidental check-ins are blocked.

## W07. Construction check-out

Check-Out captures GPS and server time. A second photo is not required
for the normal construction workflow.

## W08. Continue same project tomorrow

The worker opens the shortcut the next day and the saved Current Project
remains the default. No repeated registration or project selection.

## W09. Company starts Project B

A new Telegram group plus bot becomes another project. Project A remains
untouched.

## W10. Existing worker moves to Project B

The worker taps Set as Current Project in Project B. Existing identity
is reused and only current_project_id changes.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>Project A<br />
→ Tap Project B button<br />
→ Verify membership<br />
→ current_project_id = Project B<br />
→ No re-registration</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## W11. Old project remains available

Project A stays connected, searchable and historically intact for future
service or maintenance.

## W12. Next check-in goes to Project B

The private Mini App resolves Project B as Current Project and new
attendance is stored and notified there.

## W13. Worker forgot to switch

Current Project is shown prominently. A secondary Change Project action
may list only previously connected/authorized projects.

## W14. Return to old project for maintenance

Worker returns to Project A group, sets it Current again and submits
maintenance attendance without reopening or recreating the project.

## W15. Return to Project B

After maintenance the worker can set Project B Current again. History
remains unchanged.

## W16. Worker belongs to many groups

Multiple group membership is normal. Only current_project_id determines
the default project for the next attendance.

## W17. Open private bot directly

Daily attendance can begin from the private bot/Mini App. The project
group is mainly for establishing or changing project context.

## W18. Registered worker with no project

Attendance is blocked until an authorized project is set. Do not expose
global project search.

## W19. Unauthorized project attempt

A project link/button does not grant access. The server validates
Telegram identity, worker status, live group membership and project
context.

## W20. Telegram group renamed

Same Telegram Chat ID means same project. Only the display name changes.

## W21. Sales worker visits

The first check-in starts official attendance. Additional customer/site
visits are separate photo+GPS visit records, not new attendance starts.

## W22. Complete lifecycle

The system must support registration, Project A attendance, Project B
switching, and return to Project A maintenance while preserving all
history.

# 5. Admin End-to-End Scenarios

## A01. First admin login

Admin lands on an operational dashboard showing today's attendance,
project activity and exceptions rather than a large setup wizard.

## A02. Telegram group becomes a project

When an authorized project group adds the bot, the project appears in
Admin automatically. Admin should not recreate the same project
manually.

## A03. New group connection verification

If the system cannot establish that a trusted manager/company context
initiated the bot connection, show the project connection as Pending for
admin approval.

## A04. Project security state

Project detail shows Telegram connection, authorized managers, connected
workers, pending/rejected access attempts and today's attendance.

## A05. Worker appears automatically

One-time Telegram registration creates the worker profile in Admin.
Admin does not manually recreate the worker.

## A06. Legitimate project switch

Admin can observe worker Current Project changes and retain a
project-switch audit event without approving every normal switch.

## A07. Forwarded project link attempt

An outsider with a forwarded project URL is denied if they fail live
Telegram group membership or worker validation.

## A08. Unknown Telegram user

Unknown users cannot gain project access merely by opening a link.
Registration and project authorization remain separate.

## A09. Registered worker, wrong project

A registered company worker who is not a member of that project's
Telegram group is denied.

## A10. Forwarded link, not a group member

The access attempt is rejected server-side even if the project token
itself is valid.

## A11. Outsider somehow joins group

Use private manager-controlled groups and also require a valid
registered worker/company identity; group membership alone should not
create a worker silently.

## A12. Security/access log

Admin can inspect successful switches and denied attempts with reason,
user, project and timestamp.

## A13. Worker detail

Admin sees worker identity, phone, Current Project, connected-project
history, today's attendance and recent security/project-switch activity.

## A14. Monitor today's attendance

Admin filters today's workers by present, not checked in, checked out
and issues.

## A15. Review proof

Admin can inspect photo, GPS/map context, server times, project and
total duration.

## A16. Location exception

If geofencing is configured, out-of-radius check-ins are flagged for
review rather than silently deleted.

## A17. Wrong-project correction

Authorized admin can correct a submitted project's classification only
through an explicit audited correction with reason.

## A18. Missing check-out

Authorized admin can add/correct check-out according to company policy,
preserving original value and audit metadata.

## A19. Reports

Reports support date, project, worker and exception perspectives, with
export added as needed.

## A20. Project history and maintenance

Project detail combines original construction attendance and later
maintenance/service activity without fake close/reopen cycles.

## A21. Telegram connection health

Admin sees connected, bot removed and permission-problem states.
Disconnecting Telegram never deletes project history.

## A22. Admin permissions

Owner, HR/Admin, Project Manager and Viewer roles receive scoped access
appropriate to their responsibilities.

## A23. Audit log

Important worker, project, attendance, correction, access and Telegram
events are immutable/auditable.

## A24. Daily admin routine

Normal admin work is: open dashboard, review exceptions, inspect
evidence, correct only when needed, then report.

# 6. Authorization & Anti-Fraud Model

The project URL/button is project context, not permission. A forwarded
link must be harmless unless the person also satisfies server-side
authorization.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>WHO? Telegram User ID<br />
WHICH? Signed/opaque Project Context → Telegram Chat ID<br />
WORKER? Registered worker/company identity<br />
ALLOWED? Live membership in that private Telegram project group<br />
RESULT Allow or deny server-side</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 6.1 Project Connection Validation

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>User taps [Set as Current Project]<br />
↓<br />
Verify Telegram identity<br />
↓<br />
Resolve signed/opaque project context<br />
↓<br />
Find project by Telegram Chat ID<br />
↓<br />
Find registered worker<br />
↓<br />
Verify worker/company validity<br />
↓<br />
Verify CURRENT Telegram group membership<br />
↓<br />
PASS?<br />
├─ NO → DENY + audit<br />
└─ YES<br />
↓<br />
Create/update WorkerProject connection history<br />
↓<br />
Set worker.current_project_id<br />
↓<br />
Audit successful switch</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 6.2 Attendance Submission Validation

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>CHECK IN<br />
↓<br />
Verify Telegram Mini App identity<br />
↓<br />
Find registered worker<br />
↓<br />
Read current_project_id<br />
↓<br />
Find project + Telegram Chat ID<br />
↓<br />
Re-check live Telegram group membership<br />
↓<br />
Validate live photo + GPS<br />
↓<br />
Optional geofence evaluation<br />
↓<br />
Use SERVER timestamp<br />
↓<br />
Create attendance with frozen project_id<br />
↓<br />
Send evidence to that project's Telegram group</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Authorization should be rechecked at Check-In because a worker may have
set Project A earlier and later been removed from the Project A Telegram
group. A stale current_project_id must not grant permanent access.

## 6.3 Forwarded Link Example

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>Dara forwards Project A button → John<br />
John taps<br />
↓<br />
Token says: Project A<br />
Telegram says: User = John<br />
↓<br />
Is John a valid registered worker?<br />
↓<br />
Is John currently a member of Project A Telegram group?<br />
↓<br />
NO<br />
↓<br />
ACCESS DENIED</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 6.4 Security Measures

- Use private, manager-controlled Telegram project groups rather than
  public/open groups.

- Never trust a project URL or query parameter as authorization.

- Use a signed or opaque project context so users cannot simply edit
  project_id values.

- Verify Telegram identity server-side using the supported Telegram Mini
  App/Bot mechanisms.

- Check live project-group membership when setting Current Project and
  again when starting attendance.

- Keep worker registration separate from project authorization.

- Use live camera capture for check-in proof; avoid treating arbitrary
  gallery uploads as equivalent proof if the product requires live
  evidence.

- Capture GPS and optionally evaluate a configured site geofence/radius.

- Use server timestamps for authoritative attendance times.

- Keep immutable/auditable original attendance data and explicit admin
  corrections.

- Record denied access attempts and significant project-switch events.

- Do not introduce face recognition in the MVP unless there is a later
  justified requirement and privacy review.

# 7. Admin Information Architecture

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>Dashboard<br />
Attendance<br />
Projects<br />
Workers<br />
Reports<br />
Settings</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

The admin portal is a monitoring and control center, not a duplicate
assignment system.

**Dashboard:** Today's attendance, project activity, Telegram health and
exceptions.

**Attendance:** Daily records, evidence, missing checkout, location
issues and corrections.

**Projects:** Telegram-linked projects, workers, attendance history,
maintenance activity and connection health.

**Workers:** Identity, Current Project, connected project history,
attendance and security activity.

**Reports:** Daily/weekly/monthly, project, worker and exception
reporting.

**Settings:** Company, Telegram integration, attendance rules, language,
optional geofence policy and permissions.

# 8. Recommended Data Model

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>Worker<br />
- id<br />
- telegram_user_id UNIQUE<br />
- phone<br />
- name<br />
- company_id<br />
- current_project_id<br />
- status<br />
<br />
Project<br />
- id<br />
- company_id<br />
- telegram_chat_id UNIQUE<br />
- name<br />
- telegram_connection_status<br />
- optional site_lat/site_lng/geofence_radius<br />
- archived_at (manual only, if used)<br />
<br />
WorkerProject<br />
- worker_id<br />
- project_id<br />
- first_connected_at<br />
- last_selected_at<br />
- last_verified_at<br />
- connection metadata/history<br />
<br />
Attendance<br />
- id<br />
- worker_id<br />
- project_id (FROZEN)<br />
- telegram_chat_id snapshot/reference<br />
- check_in_time (server)<br />
- check_in_photo<br />
- check_in_lat/lng<br />
- check_out_time (server)<br />
- check_out_lat/lng<br />
- status<br />
<br />
AttendanceCorrection<br />
- attendance_id<br />
- field/action<br />
- original_value<br />
- corrected_value<br />
- reason<br />
- corrected_by<br />
- corrected_at<br />
<br />
AuditEvent<br />
- actor<br />
- action<br />
- target<br />
- project<br />
- before/after metadata<br />
- reason<br />
- timestamp</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 9. Key State Rules

| **Event**                             | **Required behavior**                                                                             |
|---------------------------------------|---------------------------------------------------------------------------------------------------|
| **Current Project switch**            | Changes worker.current_project_id only. Does not rewrite an open or historical attendance record. |
| **Open attendance**                   | Remains attached to the project captured at Check-In even if Current Project later changes.       |
| **Worker removed from project group** | Future authorization/check-in to that project fails; old attendance remains.                      |
| **Worker added back later**           | Can set the project Current again and create new maintenance/service attendance.                  |
| **Bot removed from Telegram group**   | Mark Telegram connection unhealthy/disconnected; preserve project and history.                    |
| **Project renamed**                   | Update display name; same Telegram Chat ID means same project.                                    |
| **Admin correction**                  | Preserve original evidence/value and store correction, reason, actor and time.                    |

# 10. MVP Implementation Order

**Phase 1.** Telegram identity verification and one-time worker
registration

**Phase 2.** Telegram group/project linking by Chat ID

**Phase 3.** Signed/opaque project context and live membership
authorization

**Phase 4.** Set as Current Project + WorkerProject connection history

**Phase 5.** Worker Mini App home with prominent Current Project

**Phase 6.** Live photo + GPS + server-timestamp Check-In

**Phase 7.** Frozen attendance.project_id and Telegram evidence delivery

**Phase 8.** Construction Check-Out

**Phase 9.** Project switching and return-to-old-project maintenance

**Phase 10.** Admin Dashboard, Attendance, Projects and Workers views

**Phase 11.** Admin exceptions, audited corrections and access/security
log

**Phase 12.** Reports, Telegram health, roles/permissions

**Phase 13.** Sales visit extension and optional geofence policies

# 11. Acceptance Tests

1.  New legitimate worker in Project A group can register once, set
    Project A Current, check in with photo/GPS/server time, notify
    Project A, and check out.

2.  The same worker moves to Project B by group button without
    re-registering; Project A remains unchanged.

3.  The worker returns to Project A months later for maintenance and
    creates new Project A attendance without reopening the project.

4.  Historical Project A and B attendance never changes when Current
    Project changes.

5.  A forwarded Project A link opened by a registered user who is not in
    Project A group is denied.

6.  A forwarded Project A link opened by an unknown user does not grant
    Project A access.

7.  A worker removed from Project A group cannot create a new Project A
    check-in even if current_project_id is stale.

8.  A Telegram group rename does not create a duplicate project.

9.  Bot removal/disconnection does not delete project or attendance
    history.

10. Wrong-project and missing-checkout admin corrections require reason
    and produce audit records.

11. Admin can inspect proof, GPS, timestamps, worker/project history and
    security/access events.

12. Sales visit records do not create duplicate official attendance
    starts.

# 12. Definition of Done

The portal is complete only when the worker and admin journeys work
together end-to-end, authorization is enforced server-side, forwarded
project links do not grant access, project switching never destroys
history, maintenance returns work naturally, and all administrative
corrections are auditable.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>REGISTER ONCE<br />
+ TELEGRAM IDENTITY<br />
+ PRIVATE PROJECT GROUP<br />
+ LIVE GROUP MEMBERSHIP<br />
+ CURRENT PROJECT<br />
+ LIVE PHOTO<br />
+ GPS<br />
+ SERVER TIME<br />
+ FROZEN ATTENDANCE PROJECT<br />
+ ADMIN AUDIT<br />
= TRUSTED ATTENDANCE FLOW</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 13. Codex Implementation Instruction

Treat this document as the product and workflow source of truth. Inspect
the existing repository first, reuse working infrastructure, and
implement the system phase-by-phase without redesigning the business
flow. Validate current Telegram Bot/Mini App API capabilities before
choosing the exact mechanism for membership checks, deep links, web-app
launch context, and bot permissions. Do not stop after planning:
implement, test, fix, and verify the acceptance tests.
