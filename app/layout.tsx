import type { Metadata } from "next";
import { BIZ_UDPGothic } from "next/font/google";
import "./globals.css";

// 駅名の数字・カナを読み分けやすい UD 書体。日本語のサブセットは無く、
// グリフが多くて先読みすると重いので preload しない
const bizUdpGothic = BIZ_UDPGothic({
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "合流駅さがし",
  description: "別々の駅から同じ目的駅へ向かう二人が、途中で落ち合える駅を探す",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={bizUdpGothic.className}>{children}</body>
    </html>
  );
}
