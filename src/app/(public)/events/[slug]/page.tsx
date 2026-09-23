import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ลงทะเบียนอบรม",
};

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 px-5 py-12 lg:px-8">
      <p className="text-sm text-muted-foreground">โครงการ: {slug}</p>
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">หน้าลงทะเบียนโครงการ</h1>
        <p className="leading-7 text-muted-foreground">
          Route นี้เตรียมไว้สำหรับรูปปก รายละเอียด วันจัดอบรม ที่นั่งคงเหลือ และ dynamic form
          โดยจะแสดงข้อมูลจริงเฉพาะโครงการที่เผยแพร่แล้ว
        </p>
      </div>
    </main>
  );
}
