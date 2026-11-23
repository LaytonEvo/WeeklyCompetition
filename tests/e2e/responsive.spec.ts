import { expect, test } from "@playwright/test";

for (const path of ["/", "/leaderboard", "/enter", "/winners", "/hall-of-fame", "/fitting"]) {
  test(`mobile layout has no horizontal overflow: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("mobile menu opens", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Menu").click();
  await expect(page.getByRole("link", { name: "Hall of Fame" }).last()).toBeVisible();
});
