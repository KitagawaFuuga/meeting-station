import { test, expect, type Page } from "@playwright/test";
import { stubTiles } from "./helpers";

// 同じパネルがサイドバー(デスクトップ)とボトムシート(md:hidden)の2箇所に描画される。
// デスクトップ幅で走らせるので、サイドバー側だけを触る。
const sidebar = (page: Page) => page.locator("aside");

// 駅名の入力欄に打ち込み、候補の先頭（駅名が前方一致するもの）を選ぶ
async function pickStation(page: Page, label: string, name: string) {
  const panel = sidebar(page);
  await panel.getByLabel(label).fill(name);
  const suggestion = panel
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first();
  await expect(suggestion).toBeVisible({ timeout: 15_000 });
  await suggestion.click();
}

async function searchOmiyaTachikawaYokohama(page: Page) {
  await stubTiles(page);
  await page.goto("/");
  await pickStation(page, "Aさんの出発駅", "大宮");
  await pickStation(page, "Bさんの出発駅", "立川");
  await pickStation(page, "目的駅", "横浜");
  await sidebar(page).getByRole("button", { name: "検索" }).click();
}

test("地図が初期化され、maplibre のワーカーが 404 にならない", async ({
  page,
}) => {
  // Turbopack のチャンク URL と node_modules 上の相対位置がずれると、maplibre の
  // ワーカーが 404 になりタイルが永久に読み込み中で止まる（過去に発生）。
  // ビルドも typecheck も通ってしまうため、ブラウザで開く以外に検出できない。
  const badResponses: string[] = [];
  page.on("response", (res) => {
    if (res.status() >= 400 && /maplibre-gl.*\.mjs/.test(res.url())) {
      badResponses.push(`${res.status()} ${res.url()}`);
    }
  });
  const workerErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /worker|maplibre/i.test(msg.text())) {
      workerErrors.push(msg.text());
    }
  });

  await stubTiles(page);
  await page.goto("/");

  // ワーカーの解決に失敗すると maplibre は canvas を描かないまま止まる。
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 30_000,
  });

  const workerStatus = await page.evaluate(
    async () => (await fetch("/maplibre-gl-worker.mjs")).status,
  );
  expect(workerStatus, "public/ のワーカー実体が配信されていること").toBe(200);

  expect(badResponses).toEqual([]);
  expect(workerErrors).toEqual([]);
});

test("3駅を入れて検索すると、比較表に合流駅の候補が並び、最後の行が現地集合になる", async ({
  page,
}) => {
  await searchOmiyaTachikawaYokohama(page);
  const rows = sidebar(page).getByRole("table").locator("tbody tr");
  await expect(rows.last()).toContainText("現地集合（横浜）", {
    timeout: 30_000,
  });
  expect(await rows.count()).toBeGreaterThan(1);
});

// 表の「一緒に乗る区間」列（4列目）の数値。単位（円・km）は捨てる
async function sharedColumn(page: Page): Promise<number[]> {
  const cells = await sidebar(page)
    .getByRole("table")
    .locator("tbody tr td:nth-child(4)")
    .allTextContents();
  return cells.map((t) => parseFloat(t));
}

test("並べ方を長く一緒に乗れる順に切り替えると、先頭の行の一緒に乗る区間が最大になる", async ({
  page,
}) => {
  await searchOmiyaTachikawaYokohama(page);
  const rows = sidebar(page).getByRole("table").locator("tbody tr");
  await expect(rows.last()).toContainText("現地集合", { timeout: 30_000 });
  await sidebar(page).getByLabel("長く一緒に乗れる順").check();
  const shared = await sharedColumn(page);
  expect(shared[0]).toBe(Math.max(...shared));
});

test("物差しを距離に切り替えると、表の単位が km になる", async ({ page }) => {
  await searchOmiyaTachikawaYokohama(page);
  const firstShared = sidebar(page)
    .getByRole("table")
    .locator("tbody tr td:nth-child(4)")
    .first();
  await expect(firstShared).toHaveText(/円$/, { timeout: 30_000 });
  const fareValues = await sharedColumn(page);
  await sidebar(page).getByLabel("距離").check();
  await expect(firstShared).toHaveText(/km$/);
  // 単位の表示だけでなく、距離の候補一覧に入れ替わっている
  expect(await sharedColumn(page)).not.toEqual(fareValues);
});
