import type { Metadata, Viewport } from "next";
import "./chat.css";

export const metadata: Metadata = {
  title: "Eris｜日常營養",
  description: "傳照片或打字，Eris 幫你記進日常營養。",
  manifest: "/chat.webmanifest",
  appleWebApp: { capable: true, title: "Eris", statusBarStyle: "black-translucent" },
  icons: { apple: "/eris-180.png", icon: "/eris-96.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function ChatLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
