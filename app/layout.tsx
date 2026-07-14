import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "日常營養｜減重與飲食紀錄", description: "一個為日常飲食與減脂節奏打造的個人紀錄工具。" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-Hant"><body>{children}</body></html>; }
