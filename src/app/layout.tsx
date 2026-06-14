import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "흉통 평가 보조 AI",
  description: "흉통 감별진단 임상추론 보조 도구"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
