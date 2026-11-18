import type { Metadata, Viewport } from "next";
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

/** maximumScale stops iPhone from zooming into a focused field and staying zoomed; pinch zoom still works. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" className={`${inter.variable} ${notoSansTc.variable}`}>
      <body>{children}</body>
    </html>
  );
}
