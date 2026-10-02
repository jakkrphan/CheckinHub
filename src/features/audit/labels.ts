export type AuditTone = "account" | "admin" | "privacy" | "checkin" | "event" | "system";

const labels: Record<string, string> = {
  ADMIN_USER_CREATED: "สร้างบัญชี",
  ADMIN_USER_DETAILS_UPDATED: "แก้ข้อมูลบัญชี",
  ADMIN_USER_ROLE_UPDATED: "เปลี่ยนสิทธิ์",
  ADMIN_USER_STATUS_UPDATED: "เปิด/ปิดบัญชี",
  ADMIN_INVITE_LINK_ISSUED: "ออกลิงก์เชิญ",
  ADMIN_PASSWORD_RESET_LINK_ISSUED: "ออกลิงก์รีเซ็ตรหัสผ่าน",
  ADMIN_FEATURE_TOGGLED: "เปิด/ปิดฟังก์ชันระบบ",
  ACCOUNT_INVITE_ACCEPTED: "รับคำเชิญ",
  ACCOUNT_PASSWORD_RESET: "รีเซ็ตรหัสผ่าน",
  ACCOUNT_PASSWORD_CHANGED: "เปลี่ยนรหัสผ่าน",
  ACCOUNT_LDAP_LINKED: "ผูกบัญชี AD (เข้าระบบครั้งแรก)",
  ACCOUNT_LDAP_PROVISIONED: "สร้างบัญชีจาก AD อัตโนมัติ",
  ADMIN_EVENT_VIEWED: "admin เปิดดูโครงการ",
  ADMIN_EVENT_CREATED: "admin สร้างโครงการ",
  ADMIN_EVENT_DELETED: "admin ลบโครงการ",
  EVENT_SOFT_DELETED: "ลบโครงการ (เก็บประวัติ)",
  EVENT_DELETED: "ลบโครงการ",
  EVENT_UPDATED_BY_ADMIN: "admin แก้โครงการ",
  EVENT_STATUS_CHANGED_BY_ADMIN: "admin เปลี่ยนสถานะโครงการ",
  EVENT_CLONED_BY_ADMIN: "admin ทำสำเนาโครงการ",
  EVENT_FIELDS_CHANGED: "แก้ฟอร์มลงทะเบียน (หลังเผยแพร่/มีผู้สมัคร)",
  EVENT_FIELD_ADDED_BY_ADMIN: "admin เพิ่มฟิลด์ฟอร์ม",
  EVENT_FIELD_UPDATED_BY_ADMIN: "admin แก้ฟิลด์ฟอร์ม",
  EVENT_FIELD_REMOVED_BY_ADMIN: "admin ลบฟิลด์ฟอร์ม",
  EVENT_FIELD_MOVED_BY_ADMIN: "admin เรียงฟิลด์ฟอร์ม",
  REGISTRANT_UPDATED_BY_ADMIN: "admin อนุมัติ/ปฏิเสธแทน",
  REGISTRANTS_APPROVED_BY_ADMIN: "admin อนุมัติหลายคน",
  REGISTRANT_DAY_UPDATED_BY_ADMIN: "admin แก้สถานะรายวัน",
  MANUAL_REGISTRATION_CREATED: "เพิ่มผู้สมัครเอง",
  WAITLIST_PROMOTED_MANUALLY: "เลื่อนคิวสำรอง (ผู้จัดกดเอง)",
  STATUS_LINK_REISSUED: "ออกลิงก์สถานะใหม่",
  DATA_DELETION_REQUESTED: "ผู้สมัครขอลบข้อมูล",
  DATA_DELETION_COMPLETED: "ลบข้อมูลตามคำขอ",
  DATA_DELETION_REJECTED: "ปฏิเสธคำขอลบข้อมูล",
  REGISTRANT_SELF_EDITED: "ผู้สมัครแก้ข้อมูลเอง",
  REGISTRANT_DAYS_CHANGED: "ผู้สมัครเปลี่ยนวันเอง",
  // No longer recorded (removed 27 Sep 2026); kept so entries written before then still read in Thai.
  EXPORT_CSV: "ส่งออก CSV",
  EXPORT_XLSX: "ส่งออก Excel",
  FILE_DOWNLOADED: "เปิดไฟล์แนบ",
  SENSITIVE_ANSWER_VIEWED: "เปิดดูข้อมูลอ่อนไหว",
  CHECKIN_VOIDED: "ยกเลิกการเช็คชื่อ",
  CHECKIN_REVOKED_BY_ADMIN: "admin ยกเลิกการเช็คชื่อ",
  CHECKIN_OVERRIDE: "อนุญาตเช็คชื่อกรณีพิเศษ",
  CHECKIN_ANSWERS_CORRECTED: "แก้ข้อมูลหน้างาน",
  EVENT_SESSION_REMOVED_WITH_CHECKINS: "ลบรอบที่มีประวัติเช็คชื่อ",
  WHOLE_COURSE_DAY_ADDED_BROADCAST_REQUIRED: "เพิ่มวันหลักสูตร (ต้องแจ้งผู้เข้าอบรม)",
  WHOLE_COURSE_DAY_REMOVED_BROADCAST_REQUIRED: "ลบวันหลักสูตร (ต้องแจ้งผู้เข้าอบรม)",
  RETENTION_ANONYMIZED: "ลบข้อมูลตามระยะเก็บ",
};

/** Human-readable Thai label and category for an audit action code; unknown codes fall back to the code itself. */
export function describeAudit(action: string): { label: string; tone: AuditTone } {
  const tone: AuditTone = /^(EXPORT_|FILE_|SENSITIVE_|DATA_)/.test(action) ? "privacy"
    : /^(ADMIN_USER|ADMIN_INVITE|ADMIN_PASSWORD|ACCOUNT_)/.test(action) ? "account"
    : /^CHECKIN_/.test(action) ? "checkin"
    : /^RETENTION_/.test(action) ? "system"
    : /(_BY_ADMIN|^ADMIN_)/.test(action) ? "admin"
    : "event";
  const fallback = action.replace(/_BY_ADMIN$/, "").replaceAll("_", " ").toLowerCase();
  return { label: labels[action] ?? fallback, tone };
}

export const auditToneClass: Record<AuditTone, string> = {
  account: "bg-sky-100 text-sky-900",
  admin: "bg-amber-100 text-amber-900",
  privacy: "bg-rose-100 text-rose-900",
  checkin: "bg-emerald-100 text-emerald-900",
  event: "bg-muted text-foreground",
  system: "bg-violet-100 text-violet-900",
};
