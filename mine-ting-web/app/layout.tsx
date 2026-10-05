import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Mine Ting", description: "Finn igjen det du eier – og gjør det enklere å selge." };
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="nb"><body>{children}</body></html>;
}
