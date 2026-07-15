import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "史河：九天来流",
  description: "一件从今天仰望中国历史长河的互动数据艺术作品。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
