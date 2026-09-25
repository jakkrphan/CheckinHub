# Development progress

## สิ่งที่ต้องทำ (อัปเดต 26 กันยายน 2026)

รายการเรียงตามลำดับที่แนะนำ · ติ๊ก `[x]` เมื่อเสร็จ

### A. บันทึกงานปัจจุบัน

- [ ] commit และ push งานรอบล่าสุด (layout หน้าฟอร์มลงทะเบียน, แก้คำตอบเอง, แก้ข้อมูลหน้างาน, .xlsx, ระยะเก็บข้อมูล, ลำดับรอบ, ETag polling, kiosk)

### B. ทำต่อได้ทันที (ไม่ต้องรอข้อมูลภายนอก)

- [ ] ผู้ลงทะเบียนเปลี่ยนวันที่เลือกเองจากหน้าสถานะ (เพิ่ม/สลับวันในโหมด `per_day` ถ้าที่นั่งพอ ใช้ตรรกะที่นั่ง/คิวเดียวกับตอนสมัคร และบันทึก audit)
- [ ] ไล่เทียบ UI กับ mockup แบบ B หน้าที่เหลือ:
  - [ ] หน้าลงทะเบียนสาธารณะ 3 ขั้น + หน้าสถานะ/QR
  - [ ] หน้าเช็คชื่อหน้างาน + โหมด kiosk
  - [x] หน้า admin (ผู้ใช้ / โครงการ / audit log) — 26 ก.ย.
  - [x] หน้ารายชื่อผู้ลงทะเบียน (master-detail) + แดชบอร์ด — 26 ก.ย.
  - [ ] ตรวจทุกหน้าที่ความกว้างมือถือ (ไม่มี scroll แนวนอน, ปุ่มกดง่าย)
- [ ] ตรวจสถานะ UI ให้ครบทุกหน้าตามสเปก: loading, empty, error, 403, 404, 429 (ฝั่ง admin/organizer/login ทำแล้ว 26 ก.ย. · เหลือหน้า public/เช็คชื่อ และ loading state ของหน้าที่โหลดช้า)
- [ ] ตรวจ accessibility ขั้นต่ำ: label ครบ, โฟกัสมองเห็นได้, contrast WCAG AA, ใช้คีย์บอร์ดได้ทั้งหมด
- [ ] รัน seed ใหม่กับฐาน local (200 ผู้ลงทะเบียน 2 โหมด) แล้วดูความเร็วหน้ารายชื่อ/แดชบอร์ด

### C. ทดสอบกับคน/อุปกรณ์จริง

- [ ] ให้ผู้ใช้ลองทั้ง flow ใน browser: สร้าง/เผยแพร่โครงการ → สมัคร 3 ขั้น (มีฟิลด์เงื่อนไข) → สถานะ/QR/แก้ข้อมูล → อนุมัติ/ปฏิเสธ/คิวสำรอง → เช็คชื่อ/undo/อนุญาตพิเศษ → kiosk → export
- [ ] ทดสอบบนมือถือ/แท็บเล็ตที่ใช้หน้างานจริง: สิทธิ์กล้อง, เสียง beep/สั่น, เครื่องยิงบาร์โค้ด
- [ ] ทดสอบเน็ตหลุด: ตัด/ต่อเน็ต, ซิงก์ซ้ำ, เช็คจากหลายเครื่องพร้อมกัน, คนถูกยกเลิกระหว่างออฟไลน์, รอบถูกลบ, สลับบัญชีเจ้าหน้าที่
- [ ] ทดสอบโหลดสูงกว่าเดิม (สมัครหลักร้อย–พันคน, หลายเครื่องเช็คชื่อพร้อมกัน)

### D. รอคีย์/ข้อมูลบริการภายนอก

- [ ] อีเมล (Resend หรือ SMTP) ผ่าน background queue: ส่ง QR/ผลอนุมัติ/ปฏิเสธ/เลื่อนคิว, resend (rate limit), broadcast + ประวัติการส่ง, ลืมรหัสผ่าน (ลิงก์ 30 นาที), magic link/OTP หน้าสถานะ, เตือนก่อนวันงาน
- [ ] LINE Login + Messaging API (ยืนยันข้อจำกัดต้องเป็นเพื่อน OA และ provider เดียวกันก่อน) พร้อม fallback ไปอีเมล
- [ ] Cloudflare Turnstile (production ต้องมีก่อนเปิดรับสมัคร)
- [ ] Object storage แบบ private + signed URL สำหรับไฟล์แนบ และที่เก็บรูปปก (+ resize/crop ด้วย sharp)
- [ ] ตัวตั้งเวลาเรียก `maintenance:pending-holds` (ทุก ~15 นาที) และ `maintenance:retention` (วันละครั้ง) ด้วย `CRON_SECRET`
- [ ] ทดสอบการส่งจริง, กรณีส่งไม่สำเร็จ และค่าความปลอดภัยก่อนขึ้น production

### E. ต้องได้ข้อมูลจากหน่วยงาน

- [ ] LDAP: server/TLS/bind/search base + กติกาแมปกลุ่มเป็น role แล้วออกแบบการเชื่อมบัญชีเดิมและทดสอบสิทธิ์
- [ ] ข้อความ PDPA/ประกาศความเป็นส่วนตัวฉบับจริง (รวมรายชื่อผู้ประมวลผลข้อมูลภายนอก) แล้วเพิ่มเป็น consent เวอร์ชันใหม่
- [ ] แผนสำรองข้อมูล MySQL + object storage และรายการ env สำหรับ production

### F. เฟส 2 (ไม่บังคับ)

- [ ] วุฒิบัตร PDF ตามเกณฑ์การเข้าร่วม พร้อม QR ตรวจสอบ
- [ ] รายงานสรุปโครงการ (PDF/xlsx) แยกตามวัน รอบ หน่วยงาน
- [ ] แบบประเมินหลังอบรม

## Staff area UX pass (2026-09-26)

- **Login:**
  - Split layout with a brand panel.
  - Errors show without a page reload and the email field keeps its value.
  - Show/hide password toggle and a loading state on the button.
  - An expired session returns to the page it came from (`/login?next=`). `next` must be a staff path, so off-site redirects are blocked.
  - Signed-in users visiting `/login` go straight to their home (staff → `/check-in`), and deactivated accounts get a clear message.
- **Error pages:**
  - A Thai-language 404 at the app root and inside the organizer/admin/check-in areas (the sidebar stays visible).
  - A real 403 via `forbidden()` (`experimental.authInterrupts`) when non-admins open `/admin`.
  - Error boundaries for every area with retry, plus `global-error`.
  - A `proxy.ts` only forwards the requested path for the `next=` redirect.
  - No `loading.tsx`: streaming would turn `notFound()` into HTTP 200, which weakens permission checks.
- **Fonts:** Sarabun/Anuphan now load through `next/font`. The Google Fonts `@import` had been blocked by the CSP, so pages fell back to system fonts.
- **Admin users (mockup B):**
  - Search with a role filter.
  - Avatar, role dropdown that saves on change, status pills, and project counts.
  - One open/close-account button per row; edit and link actions live in a native popover (never clipped by the table).
  - A "create account" popover.
  - A recent audit log card with Thai action labels (`src/features/audit/labels.ts`).
  - The audit log table uses the same labels, with details collapsed.
- **Admin event (mockup B):**
  - An "opened with admin rights" banner linking to this project's audit log; viewing is audited only when the admin is not a member.
  - Status strip, day cards with seat bars and per-session progress, collaborators, and recent audit.
  - Session times now show in Asia/Bangkok; they were UTC before.
  - Seats count approved people. Before, every status was counted against the seat limit.
- **Organizer:**
  - The dashboard uses the shared `getEventOverview` and `EventOverviewPanels`, polls every 5 s, and shows an attendance-continuity block for whole-course events.
  - The event header shows a status chip with the deadline, compact day list, and location.
  - Project list status badges are colored.
- **Registrants page (mockup B master-detail):**
  - Left: status tabs, search, day and answer filters, compact rows with per-day chips, and bulk approve with a live count.
  - Right: selected person's details (answers, sensitive/file links, per-day actions, queue position, check-ins) and an action footer (approve/override, reject with reason, cancel, QR, new status link).
  - After every action the page returns to the same filters and person.
  - On mobile it switches between list and detail. Before, the page was ~30,000px tall.
- **Settings step 4 (check-in sessions, mockup B):**
  - Day cards with "+ เพิ่มรอบ", compact session rows (time, "เช็คแล้ว N" badge, edit/delete), an empty-day hint, and a dashed every-day group.
  - Right panel: add/edit a session (name, day binding or "every day"/"one per day", start/end time in Bangkok, reorder, and delete that asks for confirmation when check-ins exist).
  - Quick add of เช้า/บ่าย/เต็มวัน to all days, and copying day N's sessions to the other days.
  - New actions `saveSession`, `addPresetSessions` and `copyDaySessions`. A session with check-ins cannot change day. `?session=new` opens the add form.
- **Settings step 5 (collaborators & publish, mockup B):**
  - Collaborator card: add by email with a role, owner row, role dropdown that saves on change, remove button, and the check-in-only note. Full collaborators see the list read-only.
  - Publish card: status chip, readiness checklist with "ไปแก้" links, copyable public link, and publish / close / reopen buttons.
  - "Other actions" card: clone, shortcuts, and delete with confirmation.
  - The sidebar shows the project name, and a step is ticked only when its data is actually ready.
- **Project list (mockup B):**
  - "ทำสำเนาจากโครงการเดิม" picker next to "สร้างโครงการ".
  - A ⋯ menu per row (native popover): overview, registrants, edit, clone, registration link (copy/open, or go to publish step), and owner-only delete with confirmation.
  - "ต้องจัดการ" shows a draft's next missing setup step (ตั้งวันจัด / เพิ่มฟอร์ม / เพิ่มรอบเช็คชื่อ / ตั้งวันปิดรับ / พร้อมเผยแพร่) linking to that step; published projects link their pending/waitlist counts to the filtered registrant list.
  - Stacked date chips, a "ทำสำเนาจาก …" chip, and dimmed closed rows. Draft titles open the next setup step.
- **Clone follows spec 1.2:** days, seats, deadline, registrants and collaborators are no longer copied. Sessions come across unbound, keeping the first of each label and their clock times. The cover is copied to a new file, and the new `Event.clonedFromId` (migration `20260926020000_event_cloned_from`) records the source.
- **Registration QR:** step 5 shows a QR of the public link, with **Print QR** and **PNG** buttons.
  - `/organizer/[eventId]/poster` is an A4 poster: title, dates, location, a large QR, the link and the deadline. Print CSS hides the sidebar and header.
  - `/organizer/[eventId]/qr` serves a 1024px PNG with error-correction level H.
  - Both routes require `manage`, so check-in-only staff cannot open them.
- **Permission fix:** publishing and closing are now owner/admin only (`changeEventStatus` uses `administer`, as the spec requires). Before, full collaborators could publish.
- **Tests:** `registration`, `whole-course` and `admin` were updated for the new UI. `admin` now also covers the 403, `next=` and the off-site `next` block. All nine MySQL suites, lint and build pass.

## Remaining local items (2026-09-26)

Migrations `20260926000000_retention_edit_session_order` and `20260926010000_checkin_synced_at` are applied to local MySQL.

- **Registration form builder (step 3):** redesigned to mockup B.
  - Left: a field list with badges; conditional children are indented.
  - Right: an edit panel with the option list, the condition section, and file settings.
  - Fixed a regression where non-select fields could not be added.
- **Self-service edit:** registrants can change their answers from the status link until the deadline, as long as they are not cancelled or rejected.
  - Validation is the same as registration, including conditions.
  - Email, days and uploaded files stay fixed.
  - The audit entry (actor = registrant) lists the changed field keys only, never values.
- **On-site corrections:** check-in staff can fix answers from the search results. Only fields marked "show on check-in" that are not sensitive can change, and each correction is audited.
- **`.xlsx` export:** Thai headers, Buddhist-era dates in Bangkok time, frozen header row and filters. It is audited as `EXPORT_XLSX`; CSV is unchanged.
- **Retention:**
  - Each event has `retentionDays` (default 365 after the last event day).
  - `/api/jobs/retention` (`CRON_SECRET`, `npm run maintenance:retention`) anonymizes registrants: answers, email, dedupe key, consent IP, reject reason, QR and status link.
  - Uploads are deleted. Statuses, day rows and check-ins remain as statistics. The run is audited.
- **Session order:** sessions have `sortOrder` with up/down controls in step 4. Everywhere sorts by day, then `sortOrder`, so whole-course "session X of N" stays chronological.
- **Check-in polling:** `/check-in/[eventId]/state` returns an ETag (304 when unchanged) and a PII-free delta since a timestamp. The check-in page polls every 4 s and re-renders only on change. `CheckIn.syncedAt` records the server-side time for offline syncs.
- **Check-in method:** each check-in records `method` (camera, scanner, manual, kiosk, override).
- **Kiosk mode:** `/check-in/[eventId]/kiosk?session=`.
  - Staff set a PIN (hashed in sessionStorage) before handing the device over.
  - Attendees only scan: no search, no override, and the result clears after 5 s.
  - Exiting or changing session requires the PIN, and the back button is held.
  - The device stays signed in as the staff account, so use the browser's own kiosk/fullscreen mode on shared tablets.
- **Check-in colors:** result colors on the dark check-in screen now use light tones for contrast.
- **Audit log:** `AuditLog.actorId` is nullable (registrant or system actions) with `onDelete: Restrict`, so staff audit history cannot be orphaned.
- **Tests:** new `test:integration:local-features`; `schedule` was updated for the new form builder. Verified `npm test`, lint, build and all nine MySQL suites. Browser checks (Chrome via Playwright) covered the form builder, kiosk flow, polling (200 then 304), and the self-edit page.
- **Still pending:**
  - Changing selected days from the status page.
  - A visual pass on the remaining public/check-in/admin screens.
  - Tests on real phones and cameras.
  - External delivery: email, LINE, Turnstile, object storage.
  - LDAP login.

## Local rules pass (2026-09-25, cont.)

Scope: remaining rev.2/rev.3 items that do not need external services. Migration `20260925050000_accounts_consent_dedupe_override` is applied to local MySQL.

- **Re-registration:** duplicates are now guarded by `Registrant.dedupeKey` (normalized email) instead of `@@unique([eventId, email])`. The key is cleared when a person becomes cancelled or rejected, so they can register again. The migration backfills active rows.
- **Registration evidence:** each registration stores `consentVersion`, `consentIp` and `fieldsVersion`. Consent wording is versioned in `src/features/registrations/consent.ts`, and every form-schema change increments `Event.fieldsVersion`.
- **Bot checks:** the public form carries an HMAC-signed render timestamp and a hidden honeypot. The server refuses submissions made less than 3 seconds or more than 12 hours after rendering, as well as forged tickets and a filled honeypot.
- **Staff accounts:**
  - Login is rate-limited to 5 failures per account and 20 per IP in 15 minutes.
  - An admin can create a user without a password, which produces a one-time 7-day invitation link. An admin can also issue a one-time 30-minute reset link.
  - Links are shown to the admin to copy; nothing is emailed yet.
  - Users can change their own password at `/account/password`.
  - Invite, reset and change events are audited.
- **Admin audit log:** now filterable by actor, event or system scope, and Bangkok date range.
- **Reject reason:** an organizer can enter an optional reason when rejecting a whole registrant. It is shown in the list and on the registrant's status page.
- **Manual add:** "approve over capacity" admits a person when seats are full and is recorded in the audit log.
- **Sessions:**
  - The same label may repeat across days, but not within one day, and an every-day session must not share a label with any other session.
  - Removing a session with check-ins requires an explicit confirmation, deletes its history, and is always audited.
  - The settings form warns that changing the project type after registrations does not affect people already registered.
- **Check-in:**
  - Owner, full collaborators and admins can "allow as special case" for a wrong-day or waitlisted-day scan. A reason is required, and the record sets `CheckIn.isOverride` and `overrideNote` with an audit entry. Check-in-only staff are refused.
  - Wrong-day messages distinguish "not registered today", "waitlisted today" and whole-course data gaps.
  - Duplicate scans show the time of the earlier check-in.
  - The selected session is remembered per event in localStorage and shown in a large sticky header.
  - Results have distinct beep and vibration patterns plus green/yellow/red states.
  - Leaving the page with unsynced scans triggers a `beforeunload` warning.
- **Offline sync:**
  - Scans for a deleted session no longer block the queue; they go to an on-screen "needs review" list with time and session.
  - Scans already recorded from another device are reported as such.
- **Tests:**
  - New `test:integration:whole-course`: 50 concurrent submits for 10 course seats; reject with reason, revoke, and self-cancel moving every day row together; auto promotion in queue order; re-registration after cancellation.
  - New `test:integration:rules`: bot checks, consent evidence, override permissions and audit, session label and removal rules, manual capacity override, and the project-type warning.
  - `test:integration:concurrency` now runs 50 concurrent submits for 5 per-day seats.
  - `admin` covers invite and reset links, login throttling, audit filters and soft delete.
  - Updated stale assertions in `registration` and `admin` for soft-deleted check-ins and soft-deleted events.
- **Verified:** `npm test`, lint, production build, and all eight MySQL integration suites (`schedule`, `registration`, `concurrency`, `cancellation`, `admin`, `pending-holds`, `whole-course`, `rules`).
- **Still pending (local):**
  - Self-service answer editing before the deadline.
  - Retention and anonymization job.
  - `.xlsx` export.
  - Delta/ETag polling for check-in.
  - Check-in staff editing `showOnCheckin` fields.
  - `Session.sortOrder`.
  - Kiosk mode.
  - Real-browser and device walkthroughs.
- **Still pending (external):** email, LINE, Turnstile and object storage delivery. The forgot-password email flow is replaced by admin-issued reset links until email exists.

## Spec rev.3 (2026-09-25)

`docs/ระบบเช็คชื่ออบรม rev.3.md` is the current source of truth. Earlier specs are historical references.

- Added `Event.seatMode` (`per_day` default, `whole_course`), course capacity, and attendance threshold with a database migration. Existing projects retain `per_day`.
- Added mode selection to event creation and draft settings; published projects cannot switch modes, and capacity cannot be reduced below occupied seats. Cloning copies the new settings.
- Public and manual registration for `whole_course` automatically attach every event day, count one seat per registrant, and put the whole person on one waitlist. Organizer decisions, self-cancellation, pending expiry, and automatic waitlist promotion change all day rows together. Per-day actions are hidden and rejected server-side.
- Added a shared seat-availability function used by registration and public/manual seat displays. The public form shows the whole course as a read-only day list with one capacity count and the attendance threshold.
- The organizer calendar hides per-day capacity in whole-course mode. Adding a day to a published whole course attaches existing registrants and records a broadcast-required audit entry. The dashboard shows course capacity and attendance continuity.
- Successful whole-course QR scans report the current session's position in the course and the participant's completed session count.
- Applied the migration to local MySQL and generated the Prisma client; production build passes.
- Expanded the idempotent local seed script to include a 3-day/4-session per-day demo, a 5-day/10-session whole-course demo, and 200 registrants with mixed statuses. The seed has not been rerun against the existing local database.
- A whole-course day can be removed only with an explicit organizer confirmation and at least one other day. The server blocks removal when a session on that day has check-in history; otherwise it removes the day, its daily registration rows and sessions together, and logs the affected count for broadcast follow-up.
- Dedicated `whole_course` concurrency and status-transition coverage is now in `test:integration:whole-course` (see the section above). External broadcast delivery remains deferred as requested.

## Spec rev.2 follow-up (2026-09-25)

- Added a private, token-protected `.ics` download to the registration status page. It contains only approved event dates.
- Added `/api/health`, which checks MySQL and returns no personal data; verified the local response reports both app and database healthy.
- Added CSP, anti-sniffing, referrer, frame, and permissions headers. HSTS is enabled only in production; CSP allows the Cloudflare Turnstile endpoints used by the public registration flow.
- Implemented approval/waitlist status per event day with a migration that backfills existing registrations. Public and manual registration reserve each day independently; daily approval, cancellation, check-in guards, seat counts, queue positions, and calendar downloads use the day status. The organizer can close an individual day without closing the event.
- Added configurable waitlist promotion (manual by default for new events) and pending-seat expiry. An authenticated maintenance endpoint performs expiry and promotes the next eligible row when the event uses automatic promotion. A scheduler must invoke this endpoint with `CRON_SECRET`; no external scheduler is connected yet.
- Added `showOnCheckin` and `sensitive` field settings. Check-in search renders only explicitly allowed non-sensitive answers; the registrant list hides sensitive answers behind an audited detail view. CSV export omits sensitive fields until the organizer checks the inclusion option, and every export or private attachment download records an audit entry.
- Verified the updated registration, schedule, concurrency, cancellation, and pending-hold flows with MySQL. Existing events keep automatic queue promotion through the migration.
- Still pending from rev.2 local work: staff invitation and self-service password reset, retention/anonymization, and the remaining check-in and administrative rules. External delivery, storage, and identity providers remain deferred.

## Local-flow update (2026-09-24)

- Completed dynamic registration file fields for local development: allow PDF/JPG/PNG/WebP, enforce per-file and total 5 MB caps, validate file signatures, and store uploads under the ignored private `.local-uploads/` directory.
- Added authenticated organizer-only download route; check-in-only accounts are denied. CSV exports include the original filename, not an object serialization.
- Updated the organizer's final publish step to show itemized readiness for event days, sessions, registration form, deadline, file storage, and production Turnstile; the checks mirror the server-side publish gate.
- Added local-only cover image upload (JPG/PNG/WebP, 3 MB maximum) with signature checking, authenticated draft preview, and public serving only after publication; invalid replacement uploads leave the prior cover intact.
- File fields are publishable/testable in development. Production publish/registration remains blocked until a persistent private object-storage provider is configured; Server Actions have a 6 MB request cap to accommodate multipart overhead.
- Added MySQL integration coverage for a PDF attachment and PNG cover, private draft preview, public published cover, invalid-image rejection, and role denial. Verified `npm run lint`, `npm run build`, `npm run test:integration:registration`, and `npm run test:integration:schedule`.
- Verified after the latest changes: `npm test`, all five MySQL integration suites (`schedule`, `registration`, `concurrency`, `cancellation`, `admin`), lint, and production build pass. The admin suite covers account creation, editing, role and activation changes, event deletion cascades, and retained audit history.
- Still pending: visual comparison against the mockup in a real browser, end-user browser walkthrough, and real mobile/camera/offline tests; production email/LINE/Turnstile and persistent object storage; LDAP configuration with the organization's directory team.

## Remaining after this local pass

- The organizer's settings form now uses a two-column details and cover layout aligned to mockup B. Public/check-in/admin screens still need a visual pass against the mockup; automated HTTP integration is not a pixel/layout review.
- Run the full user journey in a browser, then test camera permission, IndexedDB/offline queue and reconnect/conflict behavior on the actual phones/tablets used at the venue.
- Local registration attachments and cover images use `.local-uploads/` only. Configure persistent private object storage before production; production publishing with file fields is blocked until then. Cover image uploads are also disabled in production without a provider.
- Configure and verify email, LINE messaging/login, and Turnstile with valid account credentials and callback/domain settings; test delivery failure paths.
- Obtain LDAP server/TLS/bind/search-base and group-to-role mapping from the organization before replacing the local Credentials login.

อัปเดต: 24 กันยายน 2026

สถานะภาพรวม: flow หลักใช้งานทดสอบบนเครื่องได้แล้ว แต่ยังไม่ถือว่าพร้อมใช้งานจริง เพราะ UI ยังไม่ตรง mockup ทุกจุด, ยังไม่ทดสอบบนอุปกรณ์จริง และยังไม่มีบริการภายนอกที่สเปกต้องใช้ ผู้ใช้เลือกให้ทำ local flow ก่อนระหว่างรอคีย์/ข้อมูลบริการเหล่านั้น

## เสร็จแล้ว (local)

- UI หน้ารายการโครงการเริ่มตรง mockup แบบ B: แถบสถานะพร้อมจำนวน, ค้นหาชื่อ, รูปปก placeholder, ประเภท/โหมดอนุมัติ และวันจัดหลายวัน; หน้าเริ่มสร้างโครงการใช้ layout ขั้นที่ 1 ตาม mockup และบันทึกประเภทโครงการ วันปิดรับ และโหมดอนุมัติจริง
- รายการโครงการแสดงยอดลงทะเบียน/จำนวนวัน, แถบที่นั่งที่ถูกจอง และ badge จำนวนรออนุมัติ/รอคิวจากสถานะจริง; วันที่ไม่จำกัดไม่แสดงเปอร์เซ็นต์ที่อาจทำให้เข้าใจผิด
- หน้าตั้งค่าโครงการแยกการแสดงผลเป็นขั้นที่ 1–5 ด้วย sidebar และปุ่มก่อนหน้า/ถัดไป: ข้อมูล, วัน/ที่นั่ง, ฟอร์ม, รอบเช็คชื่อ, ผู้ร่วมจัด/เผยแพร่; action ที่บันทึกแต่ละส่วนกลับมาขั้นเดิม และแถบที่นั่งใช้ยอดผู้ได้รับอนุมัติจริง
- ขั้นที่ 2 มีปฏิทินเลื่อนเดือนและเลือกวันใหม่ได้หลายวันข้ามเดือน โดยกำหนดจำนวนที่นั่งเริ่มต้นต่อวันแล้วเพิ่มพร้อมกันแบบ transaction; วันเดิมกดจากปฏิทินเพื่อไปแถวแก้ไข/ลบ และรายการวันจัดวางข้างปฏิทินตาม mockup
- หน้า public ลงทะเบียนแยกเป็น 3 ขั้นตาม mockup (เลือกหลายวัน, ตอบฟิลด์และเงื่อนไข, อีเมล/PDPA/ยืนยัน) โดยวันที่เต็มยังเลือกเพื่อเข้าคิวสำรองได้; หน้า draft แสดงสถานะทั่วไปโดยไม่เปิดรายละเอียดนอกจากชื่อโครงการ; หน้าสถานะและ QR ปรับเป็น mobile card ตามสถานะจริง และแจ้งให้เก็บลิงก์ส่วนตัวระหว่างไม่มีระบบส่งอีเมล/LINE
- หน้าเช็คชื่อหน้างานใช้ธีมมืดเฉพาะหน้า พื้นที่กล้อง/กรอบสแกน และแสดงรอบ/สถานะคิวออฟไลน์ โดยยังใช้ server action และคิวออฟไลน์เดิม
- MySQL 8.4 บน Docker ที่ `localhost:3307`, migrations และ seed; Auth.js Credentials สำหรับทดสอบก่อนเปลี่ยนเป็น LDAP
- ผู้จัดสร้าง/แก้โครงการ draft, วันจัด/ที่นั่ง/รอบเช็คชื่อ, ฟิลด์พื้นฐาน, ผู้ร่วมจัดสิทธิ์ `FULL` หรือ `CHECKIN_ONLY`, ทำสำเนา, เผยแพร่และปิดรับ
- ขั้นรอบเช็คชื่อรองรับรอบกลางที่ใช้ได้ทุกวัน, สร้างรอบแยกให้ทุกวัน หรือผูกวันจัดเฉพาะ; ตรวจความพร้อมเผยแพร่ตามรอบที่ครอบคลุมทุกวัน และทำสำเนารอบกลางไปกับโครงการ
- ตัวสร้างฟิลด์เพิ่มเงื่อนไข แก้ชื่อ/ตัวเลือก/ความบังคับ และลากเรียงลำดับได้ใน draft พร้อมปุ่มขึ้น/ลงสำหรับคีย์บอร์ด; ปฏิเสธการย้ายที่ทำให้ฟิลด์ลูกอยู่ก่อนฟิลด์แม่
- ผู้เข้าร่วมลงทะเบียนจากหน้า public ด้วยอีเมล เลือกได้หลายวัน กรอกฟิลด์/เงื่อนไข ยินยอม PDPA; ฝั่ง server ตรวจข้อมูล, rate limit, ที่นั่ง และกันสมัครซ้ำ
- ที่นั่งเต็มเข้าคิวสำรอง; โหมด manual รออนุมัติ, auto-approve ได้ QR ทันที; ปฏิเสธ/ยกเลิกคืนที่นั่งและเลื่อนคิวตามลำดับ
- ลิงก์สถานะส่วนตัวหลังสมัครไว้ดู QR หรือยกเลิกเอง (ขณะยังไม่มีอีเมล/LINE ต้องบันทึกลิงก์นี้ไว้)
- ผู้จัดเพิ่มผู้สมัครด้วยมือโดยยืนยันความยินยอม (มี audit), ค้นหาด้วยอีเมล/คำตอบข้อความ, กรองสถานะ/วันที่/ค่าฟิลด์ select-checkbox-date และแบ่งหน้า 100 รายการ; ดูคำตอบ อนุมัติรายคน/หลายคน ปฏิเสธ/ถอนอนุมัติ ออกลิงก์สถานะใหม่ ดาวน์โหลด QR เพื่อส่งเอง และ export CSV
- แดชบอร์ดแสดงจำนวนตามสถานะ ที่นั่งรายวัน ยอดเช็คชื่อแต่ละรอบและรายการล่าสุด; แดชบอร์ด/รายชื่อ/หน้าเช็คชื่อ refresh ทุก 5 วินาที
- เช็คชื่อเลือกรอบ ใช้กล้อง QR, เครื่องยิง/พิมพ์รหัส, ค้นหาอีเมลแล้วเช็คมือ, กันเช็คซ้ำและผิดวัน, undo; check-in only เห็นแค่อีเมลแบบปกปิด ไม่เห็นคำตอบฟอร์ม
- เมื่อมีรอบเช็คชื่อแบบไม่ผูกวัน หน้าเลือก session, dashboard, รายชื่อผู้ลงทะเบียน และหัวคอลัมน์ CSV ระบุชัดว่าใช้ได้ทุกวัน เพื่อแยกจากรอบชื่อซ้ำที่ผูกวันต่างกัน
- เมื่อเน็ตหลุด คิวสแกนถูกเข้ารหัสด้วย AES-GCM เก็บใน IndexedDB แยกตามบัญชีเจ้าหน้าที่, แสดงจำนวนรอซิงก์และซิงก์เมื่อกลับมาออนไลน์ขณะหน้าเช็คชื่อเปิดอยู่; การสแกนที่ยังรอไม่ถูกแสดงว่าเช็คชื่อสำเร็จ รายการที่ตรวจไม่ผ่านจะยังอยู่ในเครื่องเพื่อให้ตรวจสอบ/ลองซิงก์ใหม่หรือลบหลังยืนยัน

## ผลการตรวจสอบ

ตรวจซ้ำกับโค้ดล่าสุดแล้ว: `npm.cmd run build`, `npm.cmd run lint`, `npm.cmd test` และ integration tests ทั้ง `schedule`, `registration`, `concurrency`, `cancellation` ผ่าน โดยใช้ MySQL จริงบน Docker และ dev server ที่ port 3100

ชุด integration ครอบคลุมการตั้งค่าโครงการ/ฟิลด์, เพิ่มวันจัดหลายวันใน transaction, rollback เมื่อวันที่ซ้ำหรือไม่ถูกต้อง, audit, public status gate, ลงทะเบียน/คิวสำรอง/อนุมัติ/QR, เช็คชื่อพร้อมกัน/กันซ้ำ/undo/ผิดวัน, เพิ่มด้วยมือ, export/ดาวน์โหลด QR, หมุนลิงก์สถานะ และสิทธิ์ `CHECKIN_ONLY`/`FULL`/บัญชีถูกปิดใช้งาน นอกจากนี้ stress test สมัคร 6 คนพร้อมกันแย่งที่นั่ง 1 ที่ และยกเลิก 2 คนพร้อมกันให้เลื่อนคิว 2 คนตามลำดับผ่าน โดยไม่เกินที่นั่งหรือได้ HTTP 500; test ลบข้อมูลชั่วคราวเมื่อจบ

หมายเหตุ: Docker ใช้งานได้ปกติเมื่อรันด้วยบัญชี Windows; ข้อความ `Access is denied` ก่อนหน้านี้มาจากบัญชี sandbox ของ Codex ไม่ใช่ Docker/MySQL เสีย หาก `prisma generate` แจ้ง `EPERM` ให้หยุด dev server ที่กำลังล็อก Prisma engine ก่อนแล้วรันใหม่

## ต้องทำต่อ

ย้ายไปอยู่ที่หัวข้อ “สิ่งที่ต้องทำ” ด้านบนสุดของไฟล์ (อัปเดต 26 กันยายน 2026)

## วิธีเริ่ม

```powershell
npm.cmd run db:setup
npm.cmd run dev -- -p 3100
```

เข้าที่ `http://localhost:3100/login` ด้วยบัญชี seed ใน README แล้วเริ่มสร้างโครงการ/เผยแพร่/ลงทะเบียนผ่านลิงก์ public ปุ่มเช็คชื่ออยู่ในหน้าโครงการ สถานะผู้สมัครดูผ่านลิงก์ที่ได้หลังส่งฟอร์ม
