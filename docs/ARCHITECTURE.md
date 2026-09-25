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
