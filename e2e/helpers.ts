import type { Page } from "@playwright/test";

// 地図タイルは外部サービス(tiles.openfreemap.org)から取る。CI を外部の障害や
// レート制限に晒さないため、スタイル定義とタイル本体は差し替える。検証したいのは
// 「maplibre がワーカーを解決できるか」であってタイルの中身ではない。
export const EMPTY_STYLE = {
  version: 8,
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#e8e8e8" } },
  ],
};

export async function stubTiles(page: Page): Promise<void> {
  await page.route("https://tiles.openfreemap.org/**", async (route) => {
    if (route.request().url().includes("/styles/")) {
      await route.fulfill({ json: EMPTY_STYLE });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
}
