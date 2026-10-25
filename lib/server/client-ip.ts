// Next.js 15 で NextRequest.ip が削除されたので、プロキシのヘッダから取る。
// x-forwarded-for の先頭は利用者が自由に書けるので、偽装すればレート制限をすり抜けられる。
// Azure Container Apps の前段（Envoy）は接続元の IP を末尾に足すので、末尾を使う。
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
