import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qard — Your learning, in focus.",
  description: "A focused home for your projects, courses, and Q-cards. Create, flip, and learn at your own pace.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
