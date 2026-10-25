import "./globals.css";
export const metadata = {
  title: "Mine Apper Admin",
  description: "Privat administrasjon for Mine-familien",
  robots: { index: false, follow: false }
};
export default function RootLayout({ children }) {
  return <html lang="nb"><body>{children}</body></html>;
}
