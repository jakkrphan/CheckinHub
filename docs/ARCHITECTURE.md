# CheckInHub architecture

โครงนี้แบ่งตามขอบเขตการเข้าถึงที่ระบุในสเปก:

- `src/app/(public)` — หน้าไม่ต้องเข้าสู่ระบบ เช่น หน้าลงทะเบียนของโครงการ
- `src/app/(auth)` — หน้าเข้าสู่ระบบผู้จัดและเจ้าหน้าที่
- `src/app/(organizer)` — พอร์ทัลผู้จัด ต้องผ่าน auth และ event access guard
- `src/app/(check-in)` — งานหน้างาน รองรับผู้ร่วมจัดสิทธิ์ `checkin_only`
- `src/features` — domain types และ logic แยกตามความสามารถของระบบ
- `src/server/authorization` — policy กลางที่ endpoint และ Server Component ต้องใช้ร่วมกัน
- `prisma/schema.prisma` — MySQL schema สำหรับผู้ใช้ โครงการ วันจัด รอบ ผู้ลงทะเบียน และเช็คชื่อ

## Access-control invariants

1. Query รายการโครงการต้องกรองที่ backend จาก owner/collaborator เสมอ ยกเว้น system admin
2. ผู้ร่วมจัด `CHECKIN_ONLY` เข้าถึงได้เฉพาะ workflow เช็คชื่อ
3. การลบโครงการและจัดการผู้ร่วมจัดเป็นสิทธิ์ owner; admin ทำได้เพื่อดูแลระบบแต่ต้องเขียน `AuditLog`
4. ทุก mutation ของ event ต้องตรวจสิทธิ์อีกครั้งใน server action/route handler ห้ามพึ่งการซ่อนปุ่มใน UI

## Suggested implementation order

1. ติดตั้ง Prisma, สร้าง client และ validate schema กับ MySQL
2. เพิ่ม Auth.js Credentials และ session ที่มี `user.id`, `user.role`, `user.isActive`
3. ทำ guard ที่อ่าน membership จากฐานข้อมูล แล้วจึงเริ่ม Event CRUD
4. ทำ form builder, public registration, approval/dashboard และ check-in ตามลำดับในสเปก

## Authentication roadmap

ระหว่างพัฒนาใช้ Auth.js Credentials ตรวจอีเมล/รหัสผ่านกับ `User.passwordHash` ใน MySQL local เท่านั้น ระบบจริงในอนาคตจะตรวจตัวตนผ่าน LDAP (ต้องกำหนด server, TLS, search/bind, รหัสประจำตัวที่คงที่ และ group mapping ก่อน) โดยให้ `User` ในฐานข้อมูลแอปยังเก็บ role, `isActive` และ event membership ต่อไป ขั้นย้ายไป LDAP ต้องปรับ schema ให้บัญชี LDAP ไม่ต้องมี `passwordHash` และแมป LDAP identity เข้ากับ `User` อย่างชัดเจน โดยยังใช้กฎสิทธิ์ของโครงการและ session guard เดิม

## Session strategy (ตัดสินใจ 27 ก.ย. 2026 — รอผู้ใช้ยืนยัน)

สเปกแนะนำ database session เพื่อให้ปิดบัญชีแล้วตัด session ทันที ระบบนี้ **คง JWT session ของ Auth.js ไว้** เพราะได้ผลเท่ากันในทางปฏิบัติ:

- ทุกหน้า/server action/route handler ที่ต้อง login เรียก `requireActiveUser` / `requireAdminUser` / `requireEventAccess` (`src/server/authorization/`) ซึ่งอ่าน `User.isActive`, `role` และ membership จาก MySQL **ทุก request** — JWT ใช้บอกแค่ว่าเป็นใคร ไม่ได้เก็บสิทธิ์ ดังนั้นปิดบัญชี เปลี่ยน role หรือถอดออกจากโครงการ มีผลตั้งแต่ request ถัดไป (ตรวจแล้ว 27 ก.ย.: handler ที่ไม่เรียก guard มีแค่ login และตั้งรหัสผ่านจากลิงก์เชิญ ซึ่งเป็นขั้นก่อน login)
- ไม่ต้องมีตาราง Session และไม่ต้อง query เพิ่มตอนอ่าน session (เราอ่าน User อยู่แล้ว)
- ข้อจำกัดที่ยอมรับ: บังคับ logout "ทุกเครื่อง" ของบัญชีที่ยังเปิดอยู่ไม่ได้ (เช่น รหัสผ่านหลุด) ถ้าจำเป็นให้เพิ่ม `User.sessionVersion` ใส่ใน JWT แล้วให้ guard เทียบค่า — เพิ่มได้โดยไม่ต้องเปลี่ยนเป็น database session
- ข้อกำหนดต่อไป: handler ใหม่ที่ต้อง login ต้องเรียก guard ข้างต้นเสมอ ห้ามเชื่อ `session.user` จาก JWT อย่างเดียว

## Logging (PDPA)

- ห้ามเขียนอีเมล/ชื่อ/คำตอบลง server log ให้ใช้ id แทน — ตรวจแล้ว 27 ก.ย.: ในโค้ดไม่มี `console.*` ฝั่ง server, สคริปต์ maintenance พิมพ์แค่จำนวน
- Prisma ตั้ง `errorFormat: "minimal"` (`src/server/db.ts`) เพื่อไม่ให้ error message แนบ argument ของ query (อีเมล/answers) ลง log
- หน้า error ฝั่ง browser log แค่รหัสอ้างอิง (`digest`)
- ข้อมูลใน `AuditLog.metadata` เป็นหลักฐานในฐานข้อมูล ไม่ใช่ system log: เก็บ id/ชื่อฟิลด์ ไม่เก็บค่าคำตอบของผู้สมัคร (ยกเว้นการแก้บัญชีเจ้าหน้าที่ที่ต้องเก็บอีเมลเดิม/ใหม่ของบัญชีนั้น)
