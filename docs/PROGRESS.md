# Development progress

อัปเดตล่าสุด: 23 กันยายน 2026

## Checkpoint ปัจจุบัน

พักงานไว้ระหว่างรอสร้าง MySQL database และบัญชีสำหรับแอป ฝั่งโค้ดมี schema, migration แรก, Auth.js Credentials, guard ตรวจผู้ใช้ และหน้า `/organizer` ที่ query ข้อมูลจริงแล้ว แต่ยังไม่ได้ apply migration หรือทดสอบล็อกอินกับฐานข้อมูลจริง Event CRUD ยังไม่เริ่ม

ตรวจล่าสุด: MySQL service (`MySQL95`) ทำงานอยู่, `AUTH_SECRET` และ `AUTH_TRUST_HOST` อยู่ใน `.env.local` แล้ว แต่ `DATABASE_URL` ยังว่าง ไฟล์ `.env.local` ถูก ignore และไม่ควรส่งรหัสผ่านผ่านแชต โฟลเดอร์ workspace นี้ไม่มี `.git` จึงยังไม่มี commit สำหรับ checkpoint นี้

## ทำเสร็จแล้ว

- Scaffold Next.js 16.3.6 แบบ App Router + TypeScript + Tailwind CSS v4
- ตั้งค่า shadcn/ui เป็น `radix-nova` และเพิ่ม Button component
- แบ่ง route groups ตามขอบเขตระบบ:
  - `(public)` — `/` และ `/events/[slug]`
  - `(auth)` — `/login`
  - `(organizer)` — `/organizer`
  - `(check-in)` — `/check-in`
- เพิ่ม domain types เริ่มต้นสำหรับ event, registration field, registrant status และ notification channel
- เพิ่ม access-control policy แบบ pure functions สำหรับ owner, collaborator, `checkin_only` และ admin audit
- ร่าง MySQL Prisma schema ครอบคลุม User, Event, EventDay, EventOrganizer, Session, Registrant, RegistrantEventDay, CheckIn และ AuditLog
- เพิ่ม `.env.example`, README และเอกสาร architecture
- ตรวจแล้วว่า `npm run lint` ผ่าน
- ตรวจแล้วว่า `npm run build` ผ่าน และ routes ทั้งหมด compile สำเร็จ
- ติดตั้ง Prisma 6.19.3, Prisma Client, Zod, Auth.js Credentials และ bcryptjs
- ตรวจ Prisma schema ผ่าน, generate client และสร้าง migration แรกจาก schema
- ตั้ง `prisma.config.ts` ให้ Prisma CLI อ่าน `.env.local` และเพิ่ม `db:*` scripts
- เพิ่มฟอร์มล็อกอิน Auth.js, route handler, guard ตรวจผู้ใช้ที่ยัง active จากฐานข้อมูล และ bootstrap admin script
- แก้ policy ให้ `checkin_only` เช็คชื่อได้แต่ดูข้อมูลพอร์ทัลผู้จัดไม่ได้ พร้อม unit tests 4 กรณี
- แมปสีและฟอนต์จาก `checkin-mockup-b/assets/tokens.css` เข้า theme หลัก
- หน้า `/organizer` เริ่มใช้ layout ตาม mockup แบบ B และ query โครงการจริงโดยกรอง owner / ผู้ร่วมจัด `FULL` / admin ที่ backend
- หน้า `/login` ใช้ฟอร์มจริง และเพิ่มปุ่มออกจากระบบบนพอร์ทัลผู้จัด
- แก้ชื่อใน lockfile และกำหนด `turbopack.root`
- ตรวจ `npm run lint`, `npm test` และ `npm run build` ผ่านหลังการเปลี่ยนแปลง
- ปรับ `deepmerge-ts` ใต้ Prisma CLI เป็น 8.0.2 ผ่าน npm override; `npm install` รายงาน 0 vulnerabilities และ Prisma validate/generate ยังผ่าน

## ยังไม่เสร็จ / ต้องทำต่อ

1. สร้าง MySQL database และบัญชีแอปที่มีสิทธิ์สร้าง/แก้ตาราง จากนั้นเติม `DATABASE_URL` ใน `.env.local` เป็น `mysql://USER:PASSWORD@HOST:PORT/DATABASE` (ถ้ารหัสผ่านมีอักขระพิเศษ ให้ URL-encode)
2. รัน migration แรก แล้วตรวจว่าตารางจริงตรงกับ `prisma/schema.prisma`
3. สร้าง admin คนแรกด้วย `npm run admin:create` แล้วทดสอบล็อกอิน/ล็อกเอาต์จริง รวมถึงการปฏิเสธบัญชีที่ถูกปิดใช้งาน
4. ทำ event membership guard ที่อ่านฐานข้อมูลสำหรับแต่ละ event และบันทึก audit เมื่อ admin เข้าถึงโครงการผู้อื่น
5. เริ่ม Event CRUD และเติมหน้าจอ organizer/public/check-in ให้ครบตาม `checkin-mockup-b/`

## จุดเริ่มงานครั้งถัดไป

เมื่อสร้าง database และเติม `DATABASE_URL` แล้ว ให้เริ่มด้วย:

```powershell
npm.cmd run db:validate
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

จากนั้นตั้ง `CHECKIN_ADMIN_NAME`, `CHECKIN_ADMIN_EMAIL`, `CHECKIN_ADMIN_PASSWORD` ใน environment ของคำสั่ง และรัน `npm.cmd run admin:create` ตาม README เมื่อ migration และล็อกอินกับ MySQL จริงผ่าน จึงถือว่าฐานข้อมูลและ Auth พื้นฐานพร้อมใช้
