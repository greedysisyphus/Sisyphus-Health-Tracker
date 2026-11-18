import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Eris Health",
  description: "傳照片或打字，Eris 幫你記錄飲食與健康。",
  manifest: "/chat.webmanifest",
  appleWebApp: { capable: true, title: "Eris Health", statusBarStyle: "black-translucent" },
  icons: { apple: "/eris-180.png", icon: "/eris-96.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
