import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  // 開発サーバー（next dev）は localhost 以外から開かれると開発用の通信を遮断し、
  // 画面が動かない（入力しても駅の候補が出ない）。スマホなど LAN の別端末から
  // 確かめられるよう、家庭の LAN の IP（DHCP で変わる）をまとめて許す。本番には効かない
  allowedDevOrigins: ["192.168.*.*"],
  // 全パスに同じヘッダを付ける。Next.js のヘッダ設定はファイルシステムより
  // 先に評価されるので、public/ 配下の静的ファイルにも効く。
  headers: () =>
    Promise.resolve([{ source: "/:path*", headers: securityHeaders }]),
};

export default nextConfig;
