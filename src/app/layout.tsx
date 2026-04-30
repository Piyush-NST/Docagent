import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocAgent - AI Document Assistant",
  description: "Upload documents and ask questions. AI answers based only on document content.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
