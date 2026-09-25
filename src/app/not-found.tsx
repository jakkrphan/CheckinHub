import type { Metadata } from "next";
import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";

export const metadata: Metadata = { title: "ไม่พบหน้า" };

export default function NotFound() {
  return <StatusPage fullPage icon={SearchXIcon} code="404" title="ไม่พบหน้าที่ต้องการ"
    description="ลิงก์อาจพิมพ์ผิด ถูกย้าย หรือโครงการนี้ถูกปิดไปแล้ว ถ้าได้ลิงก์มาจากผู้จัด กรุณาติดต่อผู้จัดเพื่อขอลิงก์ใหม่"
    actions={<><Button asChild><Link href="/">กลับหน้าแรก</Link></Button><Button asChild variant="outline"><Link href="/login">เข้าสู่ระบบเจ้าหน้าที่</Link></Button></>} />;
}
