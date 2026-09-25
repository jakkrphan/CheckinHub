# Development progress

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

## ต้องทำต่อ (ตามลำดับ)

### 1. ยืนยัน flow หลังปรับ UI

- [x] ยืนยัน Docker/MySQL healthy, apply migrations และ seed ข้อมูล local แล้ว
- [x] รัน integration tests `schedule`, `registration`, `concurrency`, `cancellation` ซ้ำกับโค้ดล่าสุดแล้ว
- [x] เพิ่มและรันกรณี integration สำหรับเพิ่มวันจัดหลายวันพร้อมกัน: สำเร็จทั้งหมด, วันที่ซ้ำ และ rollback เมื่อรายการหนึ่งผิดพลาด
- [ ] ทดสอบผ่าน browser จริงตั้งแต่ผู้จัดสร้าง/เผยแพร่โครงการ → ผู้เข้าร่วมลงทะเบียนครบ 3 ขั้น → สถานะ/QR → อนุมัติ/คิวสำรอง → เช็คชื่อ/undo รวมทั้งฟิลด์แบบมีเงื่อนไข
- [ ] ทดสอบกล้อง, IndexedDB และ offline queue บนมือถือ/แท็บเล็ตจริง: ตัด/ต่อเน็ต, ซิงก์ซ้ำ, รายการขัดแย้ง และการเปลี่ยนบัญชีเจ้าหน้าที่; เพิ่มการทดสอบโหลดที่สูงกว่าชุด concurrency ปัจจุบัน

### 2. เก็บ UI ให้ตรง mockup แบบ B

- [x] จัด layout ขั้นตั้งค่าโครงการเป็นสองคอลัมน์ตาม mockup B; ที่นั่งรายวันแบบไม่จำกัด (เว้นว่าง), ปฏิทินหลายวัน และการเลือกรอบกลาง/ผูกวันจัดทำแล้ว
- [x] ทำตัวแก้ฟอร์มแบบลาก พร้อมปุ่มขึ้น/ลงที่เข้าถึงได้และตรวจลำดับฟิลด์เงื่อนไข
- [x] เพิ่มสรุปจำนวนลงทะเบียน, การใช้ที่นั่ง, ผู้รออนุมัติ และคิวสำรองบนรายการโครงการ
- [x] เพิ่มหน้า `/admin` ให้จัดการบัญชีผู้ใช้ครบวงจร (สร้าง/แก้ชื่อ อีเมล รหัสผ่าน role และสถานะ), ดูและจัดการทุกโครงการ, และดู system audit log; ป้องกันแก้บัญชีตัวเอง/ปิด admin คนสุดท้าย และบันทึก audit
- [x] เพิ่มหน้ารายละเอียดโครงการสำหรับ admin แสดงสถานะลงทะเบียน, วัน/รอบเช็คชื่อ, ผู้ร่วมจัด และ audit log; admin จัดการโครงการและลบโครงการได้ พร้อมบันทึก audit
- [ ] ไล่เทียบ public/check-in/admin และหน้าจอมือถือด้วยภาพเทียบ mockup ก่อนระบุว่า UI เสร็จ

### 3. เชื่อมบริการภายนอกเมื่อได้คีย์และข้อมูล

- [ ] ตั้งค่าอีเมล/LINE เพื่อส่งลิงก์สถานะ, QR และประกาศ broadcast อัตโนมัติ; ระหว่างนี้ผู้จัดส่งลิงก์หรือ QR เองได้
- [ ] เชื่อม LINE Login, Cloudflare Turnstile และที่เก็บรูปปก/ไฟล์; production ต้องไม่เปิดรับสมัครโดยไม่มี Turnstile
- [ ] ทดสอบการส่งจริง, กรณีส่งไม่สำเร็จ และการตั้งค่าความปลอดภัยก่อนใช้งานจริง

### 4. เปลี่ยนระบบล็อกอินเป็น LDAP ในอนาคต

- [ ] รับค่า server/TLS/bind/search base และกติกาแมปกลุ่มเป็น role จากผู้ดูแลระบบ แล้วออกแบบการเชื่อมบัญชีเดิมและทดสอบสิทธิ์; ปัจจุบันใช้ Auth.js Credentials สำหรับ local เท่านั้น

## วิธีเริ่ม

```powershell
npm.cmd run db:setup
npm.cmd run dev -- -p 3100
```

เข้าที่ `http://localhost:3100/login` ด้วยบัญชี seed ใน README แล้วเริ่มสร้างโครงการ/เผยแพร่/ลงทะเบียนผ่านลิงก์ public ปุ่มเช็คชื่ออยู่ในหน้าโครงการ สถานะผู้สมัครดูผ่านลิงก์ที่ได้หลังส่งฟอร์ม
