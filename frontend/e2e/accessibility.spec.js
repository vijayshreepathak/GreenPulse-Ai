import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const VIEWS = ["overview", "map", "trends", "air-quality", "compare", "scenario", "insights", "report"];

for (const theme of ["light", "dark"]) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("greenpulse:theme", value);
      localStorage.setItem("greenpulse:preferences", JSON.stringify({ motion: "reduce", backgroundRefresh: false, mapScrollZoom: true }));
    }, theme);
    await page.goto("/#/overview");
    await expect(page.getByRole("region", { name: "Key indicators" }).getByText("99.3")).toBeVisible();
    const report = {};
    for (const view of VIEWS) {
      await page.goto(`/#/${view}`);
      await expect(page.locator("main h1")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500); // let 200 ms fade-ins finish before measuring contrast
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Leaflet's third-party tile images are outside the app's control.
        .exclude(".leaflet-tile-pane")
        .analyze();
      const violations = results.violations.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
      if (violations.length) report[view] = violations;
    }
    expect(report).toEqual({});
  });
}

test("no WCAG A/AA violations in overlays, edge states and phone layouts", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("greenpulse:preferences", JSON.stringify({ motion: "reduce", backgroundRefresh: false, mapScrollZoom: true }));
  });
  const scan = async (label) => {
    await page.waitForTimeout(300);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .exclude(".leaflet-tile-pane")
      .analyze();
    return results.violations.map((violation) => `${label}: ${violation.id} (${violation.impact}) ${violation.nodes.slice(0, 2).map((node) => node.target.join(" ")).join(" | ")}`);
  };
  const problems = [];
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/overview");
    await page.evaluate((value) => localStorage.setItem("greenpulse:theme", value), theme);
    await page.reload();
    await expect(page.getByRole("region", { name: "Key indicators" }).getByText("99.3")).toBeVisible();

    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    problems.push(...(await scan(`${theme} settings dialog`)));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Export analysis" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    problems.push(...(await scan(`${theme} export menu`)));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Start guided tour" }).click();
    await expect(page.getByRole("dialog", { name: "Campus overview" })).toBeVisible();
    problems.push(...(await scan(`${theme} guided tour`)));
    await page.getByRole("button", { name: "Skip tour" }).click();

    await page.goto("/#/scenario");
    await page.getByRole("button", { name: "Equal weights" }).click();
    for (const name of ["Low green cover", "NDVI decline", "Built-up pressure", "Tree gap"]) {
      const input = page.getByRole("spinbutton", { name: `${name} raw weight` });
      await input.fill("0");
      await input.press("Enter");
    }
    await expect(page.getByText("Every zone has the same scenario score, so this weighting cannot distinguish zones.")).toBeVisible();
    problems.push(...(await scan(`${theme} scenario all tied`)));
    const pm = page.getByRole("spinbutton", { name: "Regional PM stress raw weight" });
    await pm.fill("0");
    await pm.press("Enter");
    await expect(page.getByText("No valid scenario")).toBeVisible();
    problems.push(...(await scan(`${theme} scenario invalid`)));
    await page.getByRole("button", { name: "Reset to official weights" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    for (const view of ["overview", "map", "scenario"]) {
      await page.goto(`/#/${view}`);
      await expect(page.locator("main h1")).toBeVisible();
      await page.waitForLoadState("networkidle");
      problems.push(...(await scan(`${theme} 390px ${view}`)));
    }
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
    problems.push(...(await scan(`${theme} mobile drawer`)));
    await page.keyboard.press("Escape");
  }
  expect(problems).toEqual([]);
});
