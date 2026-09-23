import type { Metadata } from "next";

import { requireActiveUser } from "@/server/authorization/session";

export const metadata: Metadata = {
  title: "เช็คชื่อหน้างาน",
};

export default async function CheckInPage() {
  await requireActiveUser();
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-4 px-5 py-12">
      <p className="text-sm font-medium text-muted-foreground">Check-in App</p>
      <h1 className="text-3xl font-semibold tracking-tight">เช็คชื่อผู้เข้าร่วม</h1>
      <p className="leading-7 text-muted-foreground">
        พื้นที่นี้แยกจากข้อมูลส่วนตัวของผู้ลงทะเบียน เพื่อรองรับสิทธิ์ check-in only
        และจะเพิ่มกล้อง เครื่องยิงบาร์โค้ด การค้นหา และ offline queue ในระยะสุดท้าย
      </p>
    </main>
  );
}
