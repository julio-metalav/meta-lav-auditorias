import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Meta Lav • Auditorias" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
