# Mockup HTML — ระบบลงทะเบียน + เช็คชื่ออบรม (แบบ B)

Static mockup ของแบบ B ทั้ง 24 หน้า สำหรับใช้เป็นต้นแบบตอนพัฒนาจริง
เปิด `index.html` เพื่อไล่ดูทุกหน้า ลิงก์ระหว่างหน้าใช้งานได้ (เช่น หน้าสแกน → หน้าผลเช็คชื่อ)

## โครงสร้าง

```
checkin-mockup-b/
├── index.html                  หน้ารวมลิงก์ทุกหน้า
├── assets/tokens.css           ตัวแปรสี/ฟอนต์/รัศมี + base style (ไฟล์เดียวที่ต้องแก้เวลาเปลี่ยนธีม)
├── organizer-*.html            ฝั่งผู้จัด (desktop 1280)
├── admin-*.html                ฝั่งผู้ดูแลระบบ (desktop 1280)
├── public-*.html               หน้าลงทะเบียนสาธารณะ (มือถือ กว้างสุด 480)
└── checkin-*.html              หน้าเช็คชื่อหน้างาน (มือถือ กว้างสุด 480)
```

## หน้าทั้งหมดแมปกับ spec อย่างไร

| ไฟล์ | ตรงกับข้อไหนใน md |
| --- | --- |
| `organizer-projects.html` | รายการโครงการ (filter ตามสิทธิ์), สถานะ draft/published/closed, clone, รูปปก |
| `organizer-create-1-info.html` | ข้อมูลโครงการ, ประเภท internal/external/mixed, รูปปก 16:9, toggle autoApprove |
| `organizer-create-2-days.html` | EventDay หลายวัน + maxSeats แยกต่อวัน |
| `organizer-create-3-form.html` | Dynamic form builder, conditional fields, field type `file` |
| `organizer-create-4-sessions.html` | Session ผูกกับ eventDayId, รอบไม่ผูกวัน |
| `organizer-create-5-collaborators.html` | EventOrganizer.role = full / checkin_only + ปุ่มเผยแพร่ |
| `organizer-registrants.html` | อนุมัติ/ปฏิเสธ, waitlist, กรองตามคำตอบ, ไฟล์แนบ, resend, revoke |
| `organizer-registrant-add.html` | manual add (walk-in) |
| `organizer-broadcast.html` | broadcast ถึง approved ทั้งหมด/เฉพาะบางวัน |
| `organizer-dashboard.html` | ยอด pending/approved/rejected/waitlisted/cancelled + เช็คชื่อแยกรอบ |
| `admin-users.html` | User.role = admin: จัดการบัญชี/สิทธิ์ + audit log |
| `admin-event.html` | admin เปิดโครงการที่ไม่ได้เป็นเจ้าของ (แบนเนอร์ audit) |
| `public-1-days.html` | รูปปก + เลือกวันหลายวัน + ที่นั่งคงเหลือต่อวัน |
| `public-2-form.html` | ฟอร์ม dynamic + conditional fields + อัปโหลดไฟล์ |
| `public-3-consent.html` | ช่องทางแจ้งเตือน (อีเมล/LINE) + PDPA consent + CAPTCHA |
| `public-result-waitlist.html` | ที่นั่งเต็ม → waitlisted พร้อมลำดับคิว |
| `public-ticket.html` | บัตร QR หลัง approved (รหัสสุ่ม UUID v4) |
| `public-status.html` | หน้าเช็คสถานะ/ดู QR ซ้ำ/ยกเลิกเอง |
| `public-not-open.html` | โครงการยังเป็น draft |
| `checkin-scan.html` | กล้อง + เครื่องยิง + ค้นหา, undo, offline queue |
| `checkin-result-*.html` | ผลเช็คชื่อ 4 กรณี: สำเร็จ / ซ้ำ / ผิดวัน / ไม่มีสิทธิ์ |

## เอาไปต่อใน Next.js + shadcn/ui

1. **ธีม** — ก๊อปค่าใน `assets/tokens.css` ไปไว้ใน `globals.css` แล้วชี้ Tailwind มาที่ตัวแปรเดียวกัน:

```js
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      bg: 'var(--bg)',
      surface: 'var(--surface)',
      ink: 'var(--ink)',
      muted: 'var(--muted)',
      line: 'var(--line)',
      accent: { DEFAULT: 'var(--accent)', strong: 'var(--accent-strong)', soft: 'var(--accent-soft)' },
      warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
      danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
    },
    fontFamily: { display: ['Anuphan', 'sans-serif'], body: ['Sarabun', 'sans-serif'] },
  },
}
```

2. **คอมโพเนนต์ที่ซ้ำบ่อย** (แนะนำทำเป็น component ก่อนเริ่มหน้าอื่น): `TopNav`, `EventHeader` (breadcrumb + ชื่อโครงการ + tabs), `WizardStepper`, `StatusChip`, `DayGroup`, `SessionRow`, `SeatBar`, `ResultSheet` (การ์ดผลเช็คชื่อ 4 สถานะ)

3. **สถานะที่ต้องมีจริง** — ทุกหน้าที่เป็น mockup แสดงสถานะเดียว ตอนทำจริงต้องมีเพิ่ม: loading / empty / error ของแต่ละลิสต์, ปุ่ม disabled ตอน submit, และ toast ตอน resend/revoke สำเร็จ

4. **สิ่งที่ mockup ยังไม่ครอบคลุม** — หน้า login, หน้า error 403 (เช็คชื่ออย่างเดียวเข้าหน้าอื่น), rate-limit ของหน้าสาธารณะ, เสียง beep หลังสแกน

## หมายเหตุ

- ไฟล์ทั้งหมดไม่มี JavaScript — ปุ่ม/ฟอร์มเป็นหน้าตาอย่างเดียว
- สไตล์เป็น inline style ที่อ้าง `var(--token)` เพื่อให้ย้ายไป Tailwind ทีละหน้าได้โดยสีไม่เพี้ยน
- หน้าฝั่งผู้จัด/admin ออกแบบที่ความกว้าง 1440 (sidebar 236 + เนื้อหา) จอแคบกว่า 1260 จะเลื่อนแนวนอน — ตอนทำจริงควรให้ sidebar ยุบเป็นไอคอน (มีตัวอย่างในหน้า wizard) หรือซ่อนเป็น drawer
- ฟอนต์โหลดจาก Google Fonts (Anuphan + Sarabun) ถ้า deploy ใน intranet ที่ไม่มีเน็ต ให้ self-host ฟอนต์แล้วแก้ `@import` ใน tokens.css
- รูปปกโครงการและ QR ในหน้า mockup เป็น placeholder ที่วาดด้วย CSS ไม่ใช่รูปจริง
