import type { Metadata } from "next";
import { Inter, Noto_Sans_TC } from "next/font/google";
import "./globals.css";
import "./mobile.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const notoSansTc = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cjk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "日常營養｜減重與飲食紀錄",
  description: "一個為日常飲食與減脂節奏打造的個人紀錄工具。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" className={`${inter.variable} ${notoSansTc.variable}`}>
      <body>{children}</body>
    </html>
  );
}
