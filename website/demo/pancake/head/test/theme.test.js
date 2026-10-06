import { expect, test } from "@playwright/test";

test("remembers the chosen theme across reloads", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Switch to dark mode" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("follows the system preference until the guest chooses", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
