import type { Metadata } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TrackIt Finance Dashboard",
  description: "Control center for Swift app users and admin oversight"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body text-ink antialiased">{children}</body>
    </html>
  );
}
