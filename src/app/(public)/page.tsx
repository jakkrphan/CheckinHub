import Link from "next/link";
import { ArrowRightIcon, QrCodeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

const productAreas = [
  {
    title: "จัดการโครงการ",
    description: "สร้างวันอบรม รอบเช็คชื่อ ฟอร์มลงทะเบียน และผู้ร่วมจัดจากจุดเดียว",
  },
  {
    title: "ลงทะเบียนสาธารณะ",
    description: "รองรับหลายวัน การอนุมัติ ที่นั่งรายวัน คิวสำรอง และ PDPA",
  },
  {
    title: "เช็คชื่อหน้างาน",
    description: "เตรียมพร้อมสำหรับกล้อง เครื่องยิงบาร์โค้ด และการค้นหารายชื่อบนมือถือ",
  },
];

export default function HomePage() {
  return (
    <main className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <QrCodeIcon aria-hidden="true" />
            CheckInHub
          </Link>
          <Button asChild variant="outline">
            <Link href="/login">เข้าสู่ระบบผู้จัด</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-10 px-5 py-20 lg:px-8 lg:py-28">
        <div className="flex max-w-3xl flex-col gap-5">
          <p className="text-sm font-medium text-muted-foreground">ระบบลงทะเบียนและเช็คชื่ออบรม</p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            จัดการตั้งแต่เปิดรับสมัคร ถึงเช็คชื่อหน้างาน
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
            โครงเริ่มต้นของ CheckInHub แยกพื้นที่สาธารณะ พอร์ทัลผู้จัด และหน้าปฏิบัติงานเช็คชื่ออย่างชัดเจน
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/organizer">
                เปิดพอร์ทัลผู้จัด
                <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/check-in">เปิดหน้าเช็คชื่อ</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-6 border-t pt-8 md:grid-cols-3">
          {productAreas.map((area) => (
            <article key={area.title} className="flex flex-col gap-2">
              <h2 className="font-semibold">{area.title}</h2>
              <p className="text-sm leading-6 text-muted-foreground">{area.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
