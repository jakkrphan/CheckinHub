import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";

export default function AdminNotFound() {
  return <StatusPage icon={SearchXIcon} code="404" title="ไม่พบข้อมูลนี้" description="รายการอาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง"
    actions={<><Button asChild><Link href="/admin?view=events">ดูโครงการทั้งหมด</Link></Button><Button asChild variant="outline"><Link href="/admin">ผู้ใช้ในระบบ</Link></Button></>} />;
}
