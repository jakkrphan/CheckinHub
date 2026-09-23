import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CheckInHub",
    template: "%s | CheckInHub",
  },
  description: "ระบบลงทะเบียนและเช็คชื่อผู้เข้าร่วมอบรม",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
