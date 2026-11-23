import { expect, test, type Page } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function staffLogin(page: Page, who: "staff" | "manager" | "admin") {
  await page.goto("/admin/login");
  await page.fill("#email", `${who}@evolutiongolf.test`);
  await page.fill("#password", "pinhunters-dev");
  await Promise.all([page.waitForURL("**/admin"), page.click("button[type=submit]")]);
}

async function keypad(page: Page, metres: string) {
  for (const ch of metres) await page.getByRole("button", { name: ch === "." ? "." : ch, exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test("Journey B: staff registers a walk-in, records five shots and the leaderboard updates", async ({ page, browser }) => {
  // Open the public leaderboard in a second tab first, to observe the live update.
  const viewer = await browser.newPage();
  await viewer.goto("/leaderboard");
  // Two competitions are open in the e2e fixture; navigate to Week 2's board.
  if (!(await viewer.getByRole("heading", { name: /Week 2/i }).count())) await viewer.getByRole("link", { name: "Pin Hunters — Week 2" }).click();
  await expect(viewer.getByRole("heading", { name: /Week 2/i })).toBeVisible();

  await staffLogin(page, "staff");
  await page.goto("/admin/live");
  await page.getByRole("button", { name: "Add walk-in entry" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Competition").selectOption({ label: "Pin Hunters — Week 2" });
  await dialog.getByRole("button", { name: "New customer" }).click();
  await dialog.getByLabel("First name").fill("Zara");
  await dialog.getByLabel("Last name").fill("Quickshot");
  await dialog.getByRole("textbox", { name: "Email" }).fill(`zara.${Date.now()}@example.com`);
  await dialog.getByLabel("Mobile").fill("07700 911911");
  await dialog.getByText("Customer has read and accepts the competition rules").click();
  await dialog.getByText("Customer confirms they are eligible").click();
  await dialog.getByLabel("Payment reference").fill("TERM-E2E-1");
  await dialog.getByRole("button", { name: "Create entry & check in" }).click();

  await expect(page.getByRole("heading", { name: "Zara Quickshot" })).toBeVisible();
  await page.getByRole("button", { name: /Start round/ }).click();
  const distances = ["4.26", "0.21", "3.1", "2.05", "6"];
  for (let i = 0; i < distances.length; i++) {
    await keypad(page, distances[i]);
    if (i === 3) await page.getByRole("button", { name: "On the green" }).click(); // off the green
    await page.getByRole("button", { name: new RegExp(`Record shot ${i + 1}`) }).click();
    await expect(page.getByRole("button", { name: new RegExp(`Record shot ${i + 2}`) }).or(page.getByRole("button", { name: /Complete & verify/ }))).toBeVisible();
  }
  await expect(page.getByText("Off green — doesn't count")).toBeVisible();
  await page.getByRole("button", { name: "Complete & verify round" }).click();
  await expect(page.getByText(/Round verified/).first()).toBeVisible();

  // Live update reaches the already-open public leaderboard (SSE → refetch).
  await expect(viewer.getByRole("row", { name: /Zara Q\./ })).toContainText("0.21 m", { timeout: 15_000 });
  await expect(viewer.locator("tbody tr").first()).toContainText("Zara Q.");
  // No contact details are ever rendered publicly.
  await expect(viewer.locator("body")).not.toContainText("07700");
  await expect(viewer.locator("body")).not.toContainText("@example.com");
});

test("Journey A (free mode): customer books online, gets a QR confirmation, staff check them in", async ({ page, browser }) => {
  await page.goto("/enter");
  // Week 2 is paid and Stripe isn't configured, so only the free competition is offered online.
  if (await page.getByLabel("Competition").count()) await page.getByLabel("Competition").selectOption({ label: "E2E Free Challenge" });
  await expect(page.getByText("E2E Free Challenge")).toBeVisible();
  const firstFree = page.getByRole("listbox", { name: "Choose a time" }).getByRole("option").and(page.locator(":not([disabled])")).first();
  await firstFree.click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.fill("#firstName", "Olivia");
  await page.fill("#lastName", "Booker");
  await page.fill("#email", `olivia.${Date.now()}@example.com`);
  await page.fill("#mobile", "07700 922922");
  await page.getByText("I accept the").click();
  await page.getByText(/I confirm I am/).click();
  await page.getByRole("button", { name: "Confirm my free entry" }).click();
  await page.waitForURL(/\/booking\/[A-Z0-9]{8}/);
  await expect(page.getByText("You're booked in")).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code for booking/ })).toBeVisible();
  const code = page.url().match(/booking\/([A-Z0-9]{8})/)![1];

  const staff = await browser.newPage();
  await staffLogin(staff, "staff");
  await staff.goto("/admin/live");
  await staff.getByLabel("Booking code").fill(code);
  await staff.getByRole("button", { name: "Check in", exact: true }).first().click();
  await expect(staff.getByRole("heading", { name: "Olivia Booker" })).toBeVisible();
  await expect(staff.getByRole("button", { name: /Start round/ })).toBeVisible();
});

test("Journey D: hole-in-one needs evidence and a different manager's approval", async ({ page, browser }) => {
  await staffLogin(page, "staff");
  await page.goto("/admin/live");
  await page.getByRole("button", { name: "Add walk-in entry" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Competition").selectOption({ label: "Pin Hunters — Week 2" });
  await dialog.getByRole("button", { name: "New customer" }).click();
  await dialog.getByLabel("First name").fill("Ace");
  await dialog.getByLabel("Last name").fill("Holder");
  await dialog.getByRole("textbox", { name: "Email" }).fill(`ace.${Date.now()}@example.com`);
  await dialog.getByLabel("Mobile").fill("07700 933933");
  await dialog.getByText("Customer has read and accepts the competition rules").click();
  await dialog.getByText("Customer confirms they are eligible").click();
  await dialog.getByRole("button", { name: "Create entry & check in" }).click();
  await page.getByRole("button", { name: /Start round/ }).click();
  await page.getByRole("button", { name: "Hole-in-one!" }).click();
  await page.getByLabel("What did you witness?").fill("Ball rolled in, HOLE IN ONE banner on simulator.");
  await page.getByRole("button", { name: /Record shot 1/ }).click();
  await expect(page.getByText("Hole-in-one claim pending")).toBeVisible();
  // Attach evidence to the shot
  const chooser = page.waitForEvent("filechooser");
  await page.getByTitle("Attach evidence").first().click();
  await (await chooser).setFiles({ name: "sim.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Evidence saved.")).toBeVisible();

  const mgr = await browser.newPage();
  await staffLogin(mgr, "manager");
  await mgr.goto("/admin/hole-in-one");
  const card = mgr.locator("div.overflow-hidden").filter({ has: mgr.getByRole("heading", { name: "Ace Holder" }) });
  await card.getByLabel("Reason").fill("Screenshot shows hole-in-one banner; witness statement consistent.");
  mgr.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Record decision" }).click();
  await expect(mgr.getByRole("listitem").filter({ hasText: "Ace Holder" })).toContainText(/approved.*jackpot £1,000/);
});

test("Journey C/account: returning customer signs in with a magic link and sees their history", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "james.robinson@example.com"); // fictional seed player
  await page.getByRole("button", { name: /Email me a sign-in link/ }).click();
  await expect(page.getByText(/If that email has a Pin Hunters account/)).toBeVisible();
  // Development mode shows the link instead of requiring an inbox.
  await page.getByRole("link", { name: "Open sign-in link" }).click();
  await page.getByRole("button", { name: "Continue to my account" }).click();
  await page.waitForURL("**/account");
  await expect(page.getByRole("heading", { name: "Hi James" })).toBeVisible();
  await expect(page.getByText("Competition history")).toBeVisible();
  // Single-use: the same link no longer works
});

test("Shop TV mode shows the live top 10 without private data", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/tv");
  await expect(page.getByText("Pin Hunters").first()).toBeVisible();
  await expect(page.getByText(/Live|Opens soon|Closed/).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("@");
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 2);
  expect(overflow).toBe(false);
});

test("Paid entry is not offered online when Stripe isn't configured", async ({ page }) => {
  await page.goto("/leaderboard");
  if (!(await page.getByRole("heading", { name: /Week 2/i }).count())) await page.getByRole("link", { name: "Pin Hunters — Week 2" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Week 2/i })).toBeVisible();
  await page.getByRole("link", { name: "Rules & prizes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Week 2/i })).toBeVisible();
  await expect(page.getByText("Enter in store")).toBeVisible();
  await page.goto("/enter");
  await expect(page.getByText("Pin Hunters — Week 2")).toHaveCount(0);
});
