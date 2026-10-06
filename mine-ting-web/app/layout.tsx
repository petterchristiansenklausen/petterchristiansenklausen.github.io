import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegister from "./PwaRegister";

export const metadata: Metadata = {
  metadataBase: new URL("https://mine-ting-web.vercel.app"),
  alternates: { canonical: "/" },
  title: "Mine Ting",
  description: "Finn igjen det du eier – og gjør det enklere å selge.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Mine Ting", statusBarStyle: "default" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#D3EBFF"
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="nb"><body><PwaRegister />{children}</body></html>;
}
