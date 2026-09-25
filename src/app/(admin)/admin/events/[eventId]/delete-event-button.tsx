"use client";

import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";

import { deleteEvent } from "../actions";

export function DeleteEventButton({ eventId, title, hasRegistrants }: { eventId: string; title: string; hasRegistrants: boolean }) {
  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    const consequence = hasRegistrants
      ? "ระบบจะปิดโครงการจากหน้าผู้ใช้และเก็บข้อมูลเดิมไว้ตรวจสอบย้อนหลัง"
      : "โครงการนี้ยังไม่มีผู้สมัครและจะถูกลบถาวร";
    if (!window.confirm(`ยืนยันลบโครงการ “${title}”? ${consequence}`)) event.preventDefault();
  }

  return <form action={deleteEvent.bind(null, eventId)} onSubmit={confirmDelete}>
    <Button type="submit" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">ลบโครงการ</Button>
  </form>;
}
