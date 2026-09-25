import Link from "next/link";
import { FolderSearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";

export default function OrganizerNotFound() {
  return <StatusPage icon={FolderSearchIcon} code="404" title="ไม่พบโครงการหรือข้อมูลนี้"
    description="โครงการอาจถูกลบ ลิงก์ไม่ถูกต้อง หรือบัญชีของคุณไม่ได้เป็นเจ้าของ/ผู้ร่วมจัดของโครงการนี้ ติดต่อเจ้าของโครงการเพื่อขอเพิ่มสิทธิ์"
    actions={<Button asChild><Link href="/organizer">กลับไปโครงการของฉัน</Link></Button>} />;
}
