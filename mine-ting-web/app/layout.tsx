import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mine Ting",
  description: "Finn igjen det du eier – og gjør det enklere å selge.",
  appleWebApp: {
    capable: true,
    title: "Mine Ting",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#D3EBFF"
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="nb"><body>{children}</body></html>;
}
