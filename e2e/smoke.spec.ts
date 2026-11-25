import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { CATEGORY_COLORS } from "../lib/candidate-category";
import { ROUTE_COLORS } from "../lib/route-colors";
import { stubTiles } from "./helpers";

// 地図のスクリーンショットのうち、指定した色（#rrggbb）の画素数。
// 地図側は GeoJSON ソースに描くだけで DOM に要素が出ないので、画素で数える。
async function pixelsOf(png: Buffer, hex: string): Promise<number> {
  const [r, g, b] = (hex.match(/[0-9a-f]{2}/gi) ?? []).map((h) =>
    parseInt(h, 16),
  );
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let k = 0; k < data.length; k += info.channels)
    if (
      Math.abs(data[k]! - r!) < 10 &&
      Math.abs(data[k + 1]! - g!) < 10 &&
      Math.abs(data[k + 2]! - b!) < 10
    )
      n++;
  return n;
}

// 同じパネルがサイドバー(デスクトップ)とボトムシート(md:hidden)の2箇所に描画される。
// デスクトップ幅で走らせるので、サイドバー側だけを触る。
const sidebar = (page: Page) => page.locator("aside");

// 駅名の入力欄に打ち込み、候補の先頭（駅名が前方一致するもの）を選ぶ
async function pickStation(page: Page, label: string, name: string) {
  const panel = sidebar(page);
  await panel.getByLabel(label).fill(name);
  // 候補の一覧（ul）の中から選ぶ。比較表にも同じ駅名のボタンがあるので、
  // 一覧に絞らないと表の行を押してしまう（川崎は大宮・立川→横浜の候補にもある）
  const suggestion = panel
    .locator("ul")
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

test("表の行を選ぶと、その駅を via にした経路を取りに行き、地図に Aさんの経路が描かれる", async ({
  page,
}) => {
  await searchOmiyaTachikawaYokohama(page);
  const firstRow = sidebar(page).getByRole("table").locator("tbody tr").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const pathResponse = page.waitForResponse(
    (res) =>
      res.url().includes("/api/meeting/path?") &&
      res.url().includes("via=") &&
      res.url().includes("metric=fare"),
  );
  await firstRow.getByRole("button").click();
  expect((await pathResponse).status()).toBe(200);
  // 線が描かれ、地図がその経路に寄るのを待つ
  await expect
    .poll(
      async () =>
        pixelsOf(
          await page.locator("canvas.maplibregl-canvas").screenshot(),
          ROUTE_COLORS.a,
        ),
      { timeout: 15_000 },
    )
    // A の出発駅の印（同じ色の丸、100画素ほど）も写るので、線と言える量を求める
    .toBeGreaterThan(400);
});

test("検索すると、地図に表の上位5件が番号つきで出て、1番は表の先頭の駅になる", async ({
  page,
}) => {
  await searchOmiyaTachikawaYokohama(page);
  const firstRow = sidebar(page).getByRole("table").locator("tbody tr").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const firstName = (
    await firstRow.locator("td").first().textContent()
  )?.trim();
  const picks = page.getByRole("img", { name: /^おすすめ\d/ });
  await expect(picks).toHaveCount(5);
  await expect(
    page.getByRole("img", { name: `おすすめ1: ${firstName}` }),
  ).toBeVisible();
});

test("二人とも遠回りしない候補は、地図に緑の円で描かれる", async ({ page }) => {
  await searchOmiyaTachikawaYokohama(page);
  // 表の先頭は二人とも 0円（大宮・立川→横浜では多摩川など）
  const firstRow = sidebar(page).getByRole("table").locator("tbody tr").first();
  await expect(firstRow.locator("td").nth(1)).toHaveText("0円", {
    timeout: 30_000,
  });
  await expect
    .poll(
      async () =>
        pixelsOf(
          await page.locator("canvas.maplibregl-canvas").screenshot(),
          CATEGORY_COLORS.none,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(30);
});

test("検索すると、地図の色の意味を示す凡例が表の上に出る", async ({ page }) => {
  await searchOmiyaTachikawaYokohama(page);
  const legend = sidebar(page).getByRole("list", { name: "地図の色" });
  await expect(legend).toBeVisible({ timeout: 30_000 });
  await expect(legend).toContainText("二人とも遠回りなし");
  await expect(legend).toContainText("Aさんだけ遠回り");
  await expect(legend).toContainText("Bさんだけ遠回り");
  await expect(legend).toContainText("二人とも遠回り");
});

test("検索に失敗したら、前の検索の比較表を消してエラーだけを出す", async ({
  page,
}) => {
  await searchOmiyaTachikawaYokohama(page);
  const table = sidebar(page).getByRole("table");
  await expect(table).toBeVisible({ timeout: 30_000 });
  // 目的駅を博多に変えると、運賃が1万円を超えて 422 で断られる
  await pickStation(page, "目的駅", "博多");
  await sidebar(page).getByRole("button", { name: "検索" }).click();
  await expect(
    sidebar(page).getByText("遠すぎて合流駅を探せません"),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(table).toHaveCount(0);
});

test("検索中に前の表の行を選んでも、新しい結果が出たらその選択は外れる", async ({
  page,
}) => {
  await searchOmiyaTachikawaYokohama(page);
  const rows = sidebar(page).getByRole("table").locator("tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  // 新しい検索の応答を、前の表の行を押し終えるまで止めておく
  let release!: () => void;
  const clicked = new Promise<void>((r) => (release = r));
  await page.route("**/api/meeting?*", async (route) => {
    await clicked;
    await route.continue();
  });
  await pickStation(page, "目的駅", "川崎");
  await sidebar(page).getByRole("button", { name: "検索" }).click();
  await rows.first().getByRole("button").click();
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  release();
  await expect(rows.last()).toContainText("現地集合（川崎）", {
    timeout: 30_000,
  });
  await expect(
    sidebar(page).locator('tbody tr[aria-selected="true"]'),
  ).toHaveCount(0);
});

test("経路を表示中に物差しを切り替えると、metric を変えて経路を取り直す", async ({
  page,
}) => {
  await searchOmiyaTachikawaYokohama(page);
  const firstRow = sidebar(page).getByRole("table").locator("tbody tr").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await firstRow.getByRole("button").click();
  const kmPath = page.waitForResponse(
    (res) =>
      res.url().includes("/api/meeting/path?") &&
      res.url().includes("metric=km"),
  );
  await sidebar(page).getByLabel("距離").check();
  expect((await kmPath).status()).toBe(200);
});
