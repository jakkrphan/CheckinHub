import type { Metadata } from "next";
import { Anuphan, Sarabun } from "next/font/google";
import "./globals.css";

// Self-hosted at build time so the strict CSP (font-src 'self') does not block them.
const sarabun = Sarabun({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-sarabun" });
const anuphan = Anuphan({ subsets: ["thai", "latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-anuphan" });

export const metadata: Metadata = {
  title: {
    default: "CheckInHub",
    template: "%s | CheckInHub",
  },
  description: "ระบบลงทะเบียนและเช็คชื่อผู้เข้าร่วมอบรม",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${sarabun.variable} ${anuphan.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
