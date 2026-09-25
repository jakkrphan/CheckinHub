import type { Metadata } from "next";
import Link from "next/link";
import { ShieldXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";

export const metadata: Metadata = { title: "ไม่มีสิทธิ์เข้าถึง" };

export default function Forbidden() {
  return <StatusPage fullPage icon={ShieldXIcon} code="403" tone="warning" title="ไม่มีสิทธิ์เข้าถึงหน้านี้"
    description="บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้ ถ้าคิดว่าควรมีสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ"
    actions={<><Button asChild><Link href="/organizer">ไปหน้าโครงการของฉัน</Link></Button><Button asChild variant="outline"><Link href="/check-in">ไปหน้าเช็คชื่อ</Link></Button></>} />;
}
