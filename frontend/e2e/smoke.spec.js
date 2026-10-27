import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const SCREENSHOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../review-screenshots/e2e");
const IGNORED_CONSOLE = [/Reduced Motion enabled/i, /Download the React DevTools/i];

/** Collects console errors, page errors and failed API requests for the whole test. */
function watchProblems(page) {
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !IGNORED_CONSOLE.some((pattern) => pattern.test(message.text()))) problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "";
    if (request.url().includes("tile.openstreetmap") || failure.includes("ERR_ABORTED")) return;
    problems.push(`requestfailed: ${request.url()} ${failure}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes("tile.openstreetmap")) problems.push(`http ${response.status()}: ${response.url()}`);
  });
  return problems;
}

async function freshStart(page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-initialised")) {
      localStorage.clear();
      localStorage.setItem("greenpulse:preferences", JSON.stringify({ motion: "reduce", backgroundRefresh: false, mapScrollZoom: true }));
      sessionStorage.setItem("e2e-initialised", "1");
    }
  });
}

async function openView(page, label, heading) {
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: label }).click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

test.describe("GreenPulse AI end-to-end workflow", () => {
  test("overview, theme persistence and navigation", async ({ page }) => {
    const problems = watchProblems(page);
    await freshStart(page);
    await page.goto("/");

    const kpis = page.getByRole("region", { name: "Key indicators" });
    await expect(kpis.getByText("99.3")).toBeVisible();
    await expect(kpis.getByText("67.4%")).toBeVisible();
    await expect(kpis.getByText("447")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Priority snapshot" })).toBeVisible();

    const toggle = page.getByRole("button", { name: "Dark mode" });
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("region", { name: "Key indicators" }).getByText("99.3")).toBeVisible();
    await page.getByRole("button", { name: "Dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await openView(page, "Spatial Explorer", "Campus environmental map");
    await openView(page, "Vegetation Trends", "Historical vegetation analysis");
    await openView(page, "Air Quality", "Modelled particulate context");
    await openView(page, "Zone Comparison", "Compare campus zones");
    await openView(page, "Scenario Lab", "What-if priority analysis");
    await openView(page, "Insights & Methodology", "Evidence, explanations and limits");
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "What-if priority analysis" })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { level: 1, name: "Evidence, explanations and limits" })).toBeVisible();

    expect(problems).toEqual([]);
  });

  test("map layers, zone and cell selection, and trends", async ({ page }) => {
    const problems = watchProblems(page);
    await freshStart(page);
    await page.goto("/#/map");
    await expect(page.locator(".map-chip")).toContainText("Priority");
    await expect(page.locator("path.leaflet-interactive")).toHaveCount(5);

    // Select a zone from the ranking table: details, map deep link and highlight update.
    await page.getByRole("table", { name: /Official zone environmental priority ranking/ }).getByRole("button", { name: "Central Zone" }).click();
    await expect(page.locator(".selection__title")).toHaveText("Central Zone");
    await expect(page).toHaveURL(/zone=Z03/);
    await expect(page.getByRole("table", { name: /Score components/ })).toContainText("Official priority score");

    // Select a zone on the map itself.
    await page.locator(".map-frame").scrollIntoViewIfNeeded();
    const zoneBox = await page.locator("path.leaflet-interactive").first().boundingBox();
    await page.mouse.click(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2);
    await expect(page.locator(".selection__title")).not.toHaveText("Central Zone");

    // Switch to a 50 m cell layer and select a cell.
    await page.getByRole("button", { name: "NDVI", exact: true }).click();
    await expect(page.locator(".map-chip")).toContainText("447 cells");
    await expect(page.locator("path.leaflet-interactive")).toHaveCount(447);
    // Tag the existing SVG paths: if a selection re-created the layer, the tags would disappear.
    await page.evaluate(() => document.querySelectorAll("path.leaflet-interactive").forEach((node) => node.setAttribute("data-e2e-original", "1")));
    await page.getByRole("button", { name: "Reset map view to the full campus" }).click();
    await page.locator(".map-frame").scrollIntoViewIfNeeded();
    const cell = page.locator("path.leaflet-interactive").nth(200);
    const cellBox = await cell.boundingBox();
    await page.mouse.click(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
    await expect(page.locator(".selection")).toContainText("50 m analysis cell");
    await expect(page.locator(".selection__title")).toHaveText(/^C_/);
    await expect(page.locator(".selection")).toContainText("not per cell");
    await expect(page.locator("path.leaflet-interactive")).toHaveCount(447);
    await expect(page.locator('path.leaflet-interactive[data-e2e-original="1"]')).toHaveCount(447);

    // A link pasted into this tab, and back/forward, drive the selection (URL and panel agree).
    await page.evaluate(() => { window.location.hash = "#/map?layer=priority&zone=Z05"; });
    await expect(page.locator(".selection__title")).toHaveText("South-West Zone");
    await expect(page.locator(".map-chip")).toContainText("Priority");
    await page.evaluate(() => { window.location.hash = "#/map?layer=priority&zone=Z02"; });
    await expect(page.locator(".selection__title")).toHaveText("North-East Zone");
    await page.goBack();
    await expect(page.locator(".selection__title")).toHaveText("South-West Zone");
    await expect(page).toHaveURL(/zone=Z05/);
    await page.goForward();
    await expect(page.locator(".selection__title")).toHaveText("North-East Zone");
    await page.getByRole("button", { name: "NDVI", exact: true }).click();
    await page.locator(".map-frame").scrollIntoViewIfNeeded();
    const again = await page.locator("path.leaflet-interactive").nth(200).boundingBox();
    await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
    await expect(page.locator(".selection__title")).toHaveText(/^C_/);

    // Cell history in the trends view.
    await page.getByRole("button", { name: "Cell NDVI history" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Historical vegetation analysis" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Analysis unit" }).getByRole("button", { name: "50 m cell" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".recharts-line-curve").first()).toBeVisible();
    await page.getByRole("group", { name: "Analysis unit" }).getByRole("button", { name: "Zone" }).click();
    await page.getByRole("button", { name: "Landsat" }).click();
    await expect(page.locator(".source-note")).toContainText("not directly comparable with Sentinel-2");
    await expect(page.getByText("Baseline (2014)")).toBeVisible();

    expect(problems).toEqual([]);
  });

  test("comparison, scenario lab, guided insights and exports", async ({ page }) => {
    const problems = watchProblems(page);
    await freshStart(page);
    await page.goto("/#/compare");
    await expect(page.getByText(/North-West Zone scores [\d.]+ points above South-West Zone/)).toBeVisible();
    await page.getByRole("checkbox", { name: "Central Zone" }).check({ force: true });
    await expect(page.getByRole("table", { name: /Indicators for the selected zones/ }).locator("thead th")).toHaveCount(5);

    const comparisonDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    expect((await comparisonDownload).suggestedFilename()).toMatch(/^greenpulse-comparison-z01-z05-z03-\d{4}-\d{2}-\d{2}\.csv$/);

    await openView(page, "Scenario Lab", "What-if priority analysis");
    await expect(page.getByText("Experimental scenario — not the official priority ranking", { exact: true })).toBeVisible();
    const tree = page.getByRole("spinbutton", { name: "Tree gap raw weight" });
    await tree.fill("100");
    await tree.press("Enter");
    await expect(page.getByText(/change rank under this scenario/)).toBeVisible();
    await page.getByRole("button", { name: "Reset to official weights" }).click();
    await expect(page.getByText("Zone order is unchanged under this scenario.")).toBeVisible();

    await openView(page, "Insights & Methodology", "Evidence, explanations and limits");
    await expect(page.getByRole("heading", { name: "Official scoring method" })).toBeVisible();
    await page.getByRole("button", { name: "Are the air-quality readings from campus sensors?" }).click();
    await expect(page.locator(".assistant__summary")).toContainText("No. The values are modelled");
    // An out-of-scope question gets an explicit refusal, never invented numbers or a zone link.
    await page.getByRole("button", { name: "Which tree species should be planted, and where?" }).click();
    await expect(page.locator(".assistant__unavailable")).toContainText("Not answered");
    await expect(page.getByRole("button", { name: "Show this zone on the map" })).toHaveCount(0);

    const rankingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export analysis" }).click();
    await page.getByRole("menuitem", { name: /Priority ranking/ }).click();
    const download = await rankingDownload;
    expect(download.suggestedFilename()).toMatch(/^greenpulse-priority-ranking-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile(await download.path(), "utf8");
    expect(csv).toContain("# GreenPulse AI: Official zone environmental priority ranking");
    expect(csv).toMatch(/\r\n1,Z01,North-West Zone,/);

    await page.getByRole("button", { name: /Printable report/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Thapar Institute of Engineering and Technology campus/ })).toBeVisible();

    expect(problems).toEqual([]);
  });

  test("air-quality refresh, provider failure and API outage handling", async ({ page }) => {
    const problems = watchProblems(page);
    await freshStart(page);
    await page.goto("/#/air-quality");
    await expect(page.getByText("Modelled air-quality estimates near TIET campus, not readings from campus sensors.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Chart range" })).toBeVisible();
    await page.getByRole("button", { name: "7D" }).click();

    const refreshed = page.waitForResponse((response) => response.url().includes("/api/analysis/current?refresh=true"));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const response = await refreshed;
    expect(response.status()).toBe(200);
    const body = await response.json();
    const expectedLabel = { live: "Fresh fetch", cached: "Cached", stale: "Stale (last good)", unavailable: "Unavailable" }[body.environment.freshness];
    await expect(page.locator(".freshness-badge strong")).toHaveText(expectedLabel);
    // The ranking applied with this response uses the PM stress it reports.
    expect(new Set(body.priority.filter((zone) => zone.priority_score !== null).map((zone) => zone.pm_stress_score))).toEqual(new Set([body.environment.stress_score]));
    const summary = page.getByRole("region", { name: "Particulate summary" });
    const shownStress = await summary.locator(".stat-tile").filter({ hasText: "Regional PM stress" }).locator(".stat-tile__value").textContent();
    expect(shownStress).toContain(body.environment.stress_score.toFixed(1));
    expect(problems).toEqual([]);

    // Simulated network failure: previous values stay visible and the error is explained.
    await page.route("**/api/analysis/current**", (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Refresh failed", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /PM refresh failed/ })).toBeVisible();
    // The exact previously loaded value is still shown, not blanked or replaced.
    await expect(summary.locator(".stat-tile").filter({ hasText: "Regional PM stress" }).locator(".stat-tile__value")).toHaveText(shownStress);
    await page.unroute("**/api/analysis/current**");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Refresh failed", { exact: true })).toBeHidden();
    await expect(page.getByRole("link", { name: /PM refresh failed/ })).toHaveCount(0);
  });

  test("navigating during a slow refresh keeps one consistent snapshot everywhere", async ({ page }) => {
    const problems = watchProblems(page);
    await freshStart(page);
    await page.goto("/#/overview");
    await expect(page.getByRole("region", { name: "Key indicators" }).getByText("99.3")).toBeVisible();

    // MOCK (clearly identified): the real response re-scored with a regional PM stress of 60, delayed 2.5 s.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/analysis/current?refresh=true", async (route) => {
      const real = await (await route.fetch()).json();
      const original = real.environment.pm_stress_source === "modelled" ? real.environment.stress_score : 60;
      const shift = (60 - original) * 0.1;
      real.environment = { ...real.environment, stress_score: 60, pm_stress_source: "modelled", freshness: "live" };
      real.priority = real.priority.map((zone) => zone.priority_score === null ? zone : {
        ...zone,
        pm_stress_score: 60,
        contribution_pm_stress: 6,
        priority_score: Math.round((zone.priority_score + shift) * 100) / 100,
      });
      await gate;
      await route.fulfill({ json: real });
    });
    const expected = await page.evaluate(async () => {
      const response = await fetch("http://127.0.0.1:8000/api/analysis/current");
      const body = await response.json();
      const original = body.environment.pm_stress_source === "modelled" ? body.environment.stress_score : 60;
      return Object.fromEntries(body.priority.map((zone) => [zone.zone_id, (Math.round((zone.priority_score + (60 - original) * 0.1) * 100) / 100).toFixed(2)]));
    });

    await page.getByRole("button", { name: "Refresh modelled air quality and ranking" }).click();
    await expect(page.getByRole("link", { name: /Updating PM data/ })).toBeVisible();
    // While the request is pending: change route, zone and layer.
    await openView(page, "Spatial Explorer", "Campus environmental map");
    await page.getByRole("table", { name: /Official zone environmental priority ranking/ }).getByRole("button", { name: "Central Zone" }).click();
    await page.getByRole("button", { name: "Tree cover", exact: true }).click();
    await page.getByRole("button", { name: "Priority", exact: true }).click();
    await openView(page, "Scenario Lab", "What-if priority analysis");
    await openView(page, "Spatial Explorer", "Campus environmental map");
    release();

    await expect(page.getByRole("link", { name: /Updating PM data/ })).toHaveCount(0);
    await expect(page.locator(".selection__title")).toHaveText("Central Zone"); // selection survived the refresh
    await expect(page).toHaveURL(/zone=Z03/);
    await expect(page.locator(".selection__score strong")).toHaveText(expected.Z03);
    await expect(page.getByRole("table", { name: /Score components/ }).locator("tfoot")).toContainText(expected.Z03);

    // Report and export use the same refreshed snapshot as the screen.
    await page.getByRole("button", { name: "Export analysis" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /Priority ranking/ }).click();
    const csv = await readFile(await (await download).path(), "utf8");
    expect(csv).toContain(`Z03,Central Zone,${Number(expected.Z03)},`);
    expect(csv).toContain("Modelled Open-Meteo/CAMS; freshness=live");
    await page.getByRole("button", { name: "Export analysis" }).click();
    await page.getByRole("menuitem", { name: /Printable report/ }).click();
    await expect(page.getByRole("region", { name: "Zone ranking table" })).toContainText(expected.Z01);
    await expect(page.locator(".report__kpis")).toContainText("60.0 / 100");
    await page.unroute("**/api/analysis/current?refresh=true");
    expect(problems).toEqual([]);
  });

  test("map stays usable without background tiles or the zone GeoJSON", async ({ page }) => {
    await freshStart(page);
    await page.route("**/tile.openstreetmap.org/**", (route) => route.abort("internetdisconnected"));
    await page.goto("/#/map");
    await expect(page.locator("path.leaflet-interactive")).toHaveCount(5); // polygons render without tiles
    await page.getByRole("button", { name: "NDVI", exact: true }).click();
    await expect(page.locator("path.leaflet-interactive")).toHaveCount(447);

    await page.route("**/thapar_zones.geojson", (route) => route.fulfill({ status: 404, body: "missing" }));
    await page.goto("/#/map?layer=priority");
    await page.reload();
    await expect(page.locator(".map-message")).toContainText("Zone map file not found");
    // The table remains a working alternative for choosing a zone.
    await page.getByRole("table", { name: /Official zone environmental priority ranking/ }).getByRole("button", { name: "Central Zone" }).click();
    await expect(page.locator(".selection__title")).toHaveText("Central Zone");
    await page.getByRole("button", { name: "NDVI", exact: true }).click();
    await expect(page.locator("path.leaflet-interactive")).toHaveCount(447); // cell layers still work
  });

  test("legacy ?layer= deep link opens the map on that layer", async ({ page }) => {
    await freshStart(page);
    await page.goto("/?layer=ndvi");
    await expect(page.getByRole("heading", { level: 1, name: "Campus environmental map" })).toBeVisible();
    await expect(page.locator(".map-chip")).toContainText("NDVI");
    await expect(page).toHaveURL(/#\/map\?layer=ndvi/);
  });

  test("dashboard outage shows a recoverable error", async ({ page }) => {
    await freshStart(page);
    await page.route("**/dashboard", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Dataset validation failed: test outage" }) }));
    await page.goto("/");
    await expect(page.getByText("The dashboard could not load")).toBeVisible();
    await expect(page.getByText("Dataset validation failed: test outage")).toBeVisible();
    await page.unroute("**/dashboard");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("region", { name: "Key indicators" }).getByText("99.3")).toBeVisible();
  });

  test("guided tour is opt-in, remembers completion, and settings persist", async ({ page }) => {
    const problems = watchProblems(page);
    await freshStart(page);
    await page.goto("/");
    await expect(page.getByRole("dialog", { name: "Campus overview" })).toHaveCount(0);
    await page.getByRole("button", { name: "Guided demo" }).click();
    const steps = ["Campus overview", "Interactive environmental map", "Why a zone ranks where it does", "Historical trends", "Scenario Lab"];
    for (const [index, title] of steps.entries()) {
      await expect(page.getByRole("dialog", { name: title })).toBeVisible();
      if (index === 1) {
        await page.getByRole("button", { name: "Back" }).click();
        await expect(page.getByRole("dialog", { name: steps[0] })).toBeVisible();
        await page.getByRole("button", { name: "Next" }).click();
      }
      if (index < steps.length - 1) await page.getByRole("button", { name: "Next" }).click();
    }
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator(".tour")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
    await page.goto("/#/overview");
    await page.reload();
    await expect(page.locator(".tour")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Replay guided demo" })).toBeVisible();

    await page.getByRole("button", { name: "Open settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByText("System", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("mobile navigation drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshStart(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await drawer.getByRole("link", { name: "Air Quality" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Modelled particulate context" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("screenshots in both themes at desktop and mobile widths", async ({ browser }) => {
    for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await freshStart(page);
        await page.addInitScript((value) => localStorage.setItem("greenpulse:theme", value), theme);
        for (const view of ["overview", "map", "scenario"]) {
          await page.goto(`/#/${view}`);
          await expect(page.locator("main h1")).toBeVisible();
          await page.waitForLoadState("networkidle");
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-${theme}-${view}.png`), fullPage: true });
        }
        await context.close();
      }
    }
  });
});
