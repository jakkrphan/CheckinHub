# CheckInHub

เว็บแอประบบลงทะเบียนและเช็คชื่อเข้าร่วมอบรม สร้างด้วย Next.js App Router, TypeScript, Tailwind CSS และ shadcn/ui (Radix)

## เริ่มต้น

```powershell
npm install
npm run db:validate
npm run db:generate
npm run db:migrate
npm run dev
```

เปิด `http://localhost:3000`

ก่อนรันคำสั่งฐานข้อมูล ให้ตั้งค่า `DATABASE_URL` ใน `.env.local` เป็น MySQL URL ของบัญชีที่สร้างตารางได้ และกำหนด `AUTH_SECRET` เป็นค่าสุ่มยาวอย่างน้อย 32 ไบต์ รวมถึง `AUTH_TRUST_HOST="true"` สำหรับการรันบนเครื่องนี้ ตัวอย่างตัวแปรอยู่ใน `.env.example` โดย Prisma CLI จะอ่าน `.env.local` ผ่าน `prisma.config.ts`

หลัง migration สำเร็จ สามารถสร้างบัญชี admin คนแรกด้วย `npm run admin:create` โดยตั้ง `CHECKIN_ADMIN_NAME`, `CHECKIN_ADMIN_EMAIL` และ `CHECKIN_ADMIN_PASSWORD` (อย่างน้อย 12 ตัวอักษร) ใน environment ของคำสั่งนั้น บัญชีที่มีอีเมลซ้ำจะไม่ถูกเขียนทับ

## Routes ที่เตรียมไว้

- `/` — หน้าหลัก
- `/events/[slug]` — หน้าลงทะเบียนสาธารณะ
- `/login` — เข้าสู่ระบบผู้จัด/เจ้าหน้าที่
- `/organizer` — พอร์ทัลผู้จัด
- `/check-in` — แอปเช็คชื่อหน้างาน

รายละเอียดขอบเขตระบบอยู่ใน `ระบบเช็คชื่ออบรม.md` และแนวทางจัดวางโค้ดอยู่ใน `docs/ARCHITECTURE.md`

## สถานะฐานข้อมูล

ติดตั้ง Prisma 6 แล้ว schema ผ่าน `prisma validate`, generate client ได้ และมี migration แรกใน `prisma/migrations` การ apply migration ลง MySQL ต้องตั้ง `DATABASE_URL` จริงก่อน

หน้าจอและธีมอ้างอิง `checkin-mockup-b/` โดยสีและฟอนต์หลักแมปไว้ใน `src/app/globals.css`
