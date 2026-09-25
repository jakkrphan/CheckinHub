import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";

export default function CheckInNotFound() {
  return <StatusPage fullPage icon={SearchXIcon} code="404" title="ไม่พบโครงการสำหรับเช็คชื่อ"
    description="บัญชีนี้อาจไม่ได้รับสิทธิ์เช็คชื่อในโครงการนี้ หรือโครงการถูกปิดไปแล้ว กรุณาแจ้งผู้จัดโครงการ"
    actions={<Button asChild><Link href="/check-in">เลือกโครงการอื่น</Link></Button>} />;
}
