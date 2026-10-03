# Telegram Attendance 22-Scenario Progress

Source of truth: `telegram_attendance_22_scenarios_master_flow.md`.

Status meanings: `DONE` is verified in tests, `IN PROGRESS` is being implemented, and `TODO` is not yet verified end to end.

| Scenario | Status | Verification target |
| --- | --- | --- |
| 01 — Create first project group | DONE | Tested: Chat ID creates one active project and bot posts Set as Current Project |
| 02 — New worker connects | DONE | Tested: pending group selection survives private phone registration and approval; organization scope is never guessed |
| 03 — First attendance open | DONE | Mini App resolves and prominently displays saved Current Project, clears stale cache, and offers connected-project recovery |
| 04 — Morning check-in | DONE | Camera with native fallback, compressed proof, GPS, server timestamp, mandatory photo and Current Project routing are implemented and tested |
| 05 — Evidence in project group | DONE | Photo and localized caption use a transactional, idempotent, retrying outbox routed to the attendance project chat |
| 06 — Already checked in | DONE | Tested: daily duplicate and concurrent check-ins are rejected; Mini App shows the open attendance state |
| 07 — Construction checkout | DONE | Tested: GPS/no-photo checkout closes the original session and queues a localized notification to its original group |
| 08 — Same project tomorrow | DONE | Tested: a later-day worker lookup reuses the saved Current Project without another switch |
| 09 — Project B group | DONE | Tested: each new Telegram Chat ID creates its own active Project identity |
| 10 — Existing worker switches to B | DONE | Tested: Set Current Project changes only the pointer and does not re-register |
| 11 — Project A remains untouched | DONE | Tested: attendance is not mutated and assignment site/schedule changes are blocked after attendance |
| 12 — Next attendance routes to B | DONE | Stateful lifecycle test proves the next attendance and evidence route to Project B |
| 13 — Forgot to switch | DONE | Mini App allows a pre-check-in correction using only the worker's connected projects |
| 14 — Return to A for maintenance | DONE | Tested: an existing Project A connection can become current again without history changes |
| 15 — Return to B | DONE | Tested: repeated A/B pointer changes preserve both connections and attendance history |
| 16 — Many old groups | DONE | Tested: many WorkerProject links expose exactly one current pointer |
| 17 — Open private bot directly | DONE | Bot opens the Mini App and worker API resolves the saved pointer without Telegram group context |
| 18 — Registered without project | DONE | Tested: attendance is blocked with NO_CURRENT_PROJECT before assignment lookup; Mini App offers connected-project recovery |
| 19 — Unauthorized project | DONE | Tested: organization mismatch and failed Telegram getChatMember validation cannot change the pointer |
| 20 — Group renamed | DONE | Tested: the same chat ID updates the project display name without creating a new project |
| 21 — Sales visits | DONE | Tested: each visit requires an open attendance and stores independent photo, GPS, project, customer/note and idempotency evidence |
| 22 — Complete lifecycle | IN PROGRESS | Stateful A → checkout → B → maintenance A test passes with all prior records unchanged; live Telegram/device acceptance remains |
