import { test, expect, type Locator, type Page } from "@playwright/test";
import { stubTiles } from "./helpers";

// モバイル幅ではサイドバー(aside)が隠れ、同じパネルが画面下のボトムシートに入る
const sheet = (page: Page) => page.locator("div.fixed.bottom-0");

const heightOf = async (target: Locator): Promise<number> => {
  const box = await target.boundingBox();
  if (!box) throw new Error("シートが描画されていない");
  return box.height;
};

// シートの高さはアニメーションで変わるので、動きが止まるまで待ってから測る
async function settledHeightOf(target: Locator): Promise<number> {
  let prev = await heightOf(target);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const cur = await heightOf(target);
    if (cur === prev) return cur;
    prev = cur;
  }
  return prev;
}

async function pickStation(page: Page, label: string, name: string) {
  const panel = sheet(page);
  await panel.getByLabel(label).fill(name);
  const suggestion = panel
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first();
  await expect(suggestion).toBeVisible({ timeout: 15_000 });
  await suggestion.click();
}

test("スマホ幅で検索すると、ボトムシートに比較表が出て、行を選ぶとシートが畳まれて地図が見える", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto("/");
  await pickStation(page, "Aさんの出発駅", "大宮");
  await pickStation(page, "Bさんの出発駅", "立川");
  await pickStation(page, "目的駅", "横浜");
  await sheet(page).getByRole("button", { name: "検索" }).click();

  const firstRow = sheet(page).getByRole("table").locator("tbody tr").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const opened = await settledHeightOf(sheet(page));

  await firstRow.getByRole("button").click();
  const collapsed = await settledHeightOf(sheet(page));
  // 畳むと画面の大半を地図に譲る
  expect(collapsed).toBeLessThan(opened / 2);
});
