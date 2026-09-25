// Every consent wording shown to registrants is kept here by version so stored evidence can be traced back to the exact text.
export const CONSENT_TEXTS = {
  v1: "ยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลเพื่อจัดการลงทะเบียนและเช็คชื่อกิจกรรมนี้",
} as const;

export type ConsentVersion = keyof typeof CONSENT_TEXTS;
export const CURRENT_CONSENT_VERSION: ConsentVersion = "v1";
export const CURRENT_CONSENT_TEXT = CONSENT_TEXTS[CURRENT_CONSENT_VERSION];
