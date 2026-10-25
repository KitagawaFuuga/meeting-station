import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/server/client-ip";

describe("clientIp", () => {
  it("x-forwarded-for が複数あるとき、利用者が書き換えられない末尾の値を使う", () => {
    const h = new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
    expect(clientIp(h)).toBe("203.0.113.9");
  });

  it("x-forwarded-for が無いとき、x-real-ip を使う", () => {
    const h = new Headers({ "x-real-ip": "198.51.100.4" });
    expect(clientIp(h)).toBe("198.51.100.4");
  });

  it("x-forwarded-for が1件だけのとき、その値を使う", () => {
    const h = new Headers({ "x-forwarded-for": " 203.0.113.9 " });
    expect(clientIp(h)).toBe("203.0.113.9");
  });

  it("どちらのヘッダも無いとき、unknown を返す", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
