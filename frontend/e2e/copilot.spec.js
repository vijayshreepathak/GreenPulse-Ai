import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * GreenPulse AI Copilot browser flow. The real backend serves all data; only the Copilot chat,
 * progress and cancel endpoints are mocked at the browser boundary so the run is repeatable and
 * makes no billable Gemini calls. (backend/tests/test_ai.py covers the server loop; the live
 * Gemini check is a separate manual smoke test.)
 */
const SCREENSHOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../review-screenshots/copilot");
const API = "http://127.0.0.1:8000";

const STATUS = {
  enabled: true,
  key_configured: true,
  available: true,
  provider: "Google Gemini",
  model: "gemini-3.5-flash-lite",
  provider_status: { state: "connected", category: null, checked_at: "2026-10-28T00:00:00Z", via: "model_lookup" },
  message: "Gemini is reachable with the configured model.",
  data_use: "When you send a question, the question, up to the last few conversation turns and a short description of the current page are sent to Google Gemini.",
  limits: { max_tool_calls: 4, max_history_messages: 12, timeout_seconds: 30, max_message_chars: 2000 },
};

function answer(text, extra = {}) {
  return {
    request_id: "mock",
    answer: text,
    evidence: [],
    facts: [],
    visual: null,
    follow_ups: [],
    tools_used: [],
    context_used: {},
    context_notes: [],
    verification: { status: "no_figures", checked: 0, unverified: [] },
    model: "gemini-3.5-flash-lite",
    created_at: new Date().toISOString(),
    ...extra,
  };
}

/** Builds mocked Copilot answers from the real official ranking served by the backend. */
function rankingAnswer(priority) {
  const top = priority[0];
  return answer(`**${top.zone_name}** (${top.zone_id}) has the highest official priority at ${top.priority_score.toFixed(2)} (${top.priority_class}).`, {
    evidence: [{ id: "official-ranking", label: "Official priority ranking", source: "GreenPulse rule-based score, zone level", detail: `PM stress ${top.pm_stress_score}`, as_of: null }],
    facts: [{ label: `Top priority · ${top.zone_id}`, value: top.priority_score.toFixed(2), unit: "/100", detail: `${top.zone_name} · ${top.priority_class}`, source: "Official score" }],
    visual: {
      type: "table",
      title: "Official priority ranking",
      columns: ["Rank", "Zone", "Score", "Class"],
      rows: priority.map((zone) => [String(zone.rank), `${zone.zone_id} · ${zone.zone_name}`, zone.priority_score.toFixed(2), zone.priority_class]),
      source: "Official rule-based score",
    },
    follow_ups: [`Why is ${top.zone_id} ranked highest?`, "How does the priority score work?"],
    tools_used: [{ name: "get_zone_rankings", label: "Fetching the official zone ranking", status: "ok", detail: null }],
    verification: { status: "verified", checked: 1, unverified: [] },
  });
}

async function installCopilotMocks(page, priority, { delayed = new Set() } = {}) {
  const requests = [];
  await page.route(`${API}/api/ai/status*`, (route) => route.fulfill({ json: STATUS }));
  await page.route(`${API}/api/ai/chat/*/progress`, (route) =>
    route.fulfill({ json: { stage: "tool", label: "Fetching the official zone ranking", steps: [{ tool: "get_zone_rankings", label: "Fetching the official zone ranking", status: "running" }], done: false } })
  );
  await page.route(`${API}/api/ai/chat/*/cancel`, (route) => route.fulfill({ json: { cancelled: true } }));
  await page.route(`${API}/api/ai/chat`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    requests.push(body);
    if (delayed.has(body.message)) {
      delayed.delete(body.message); // only the first attempt is slow
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    let payload;
    if (/^hi\b/i.test(body.message)) payload = answer("Hello! I can explain zone priorities, vegetation trends and modelled air quality on the TIET campus.", { follow_ups: ["Which zone needs the most attention?"] });
    else if (/highest priority/i.test(body.message)) payload = rankingAnswer(priority);
    else if (/selected zone/i.test(body.message)) payload = answer(`You selected **${body.context.zone_id}**. Its official score comes from the zone-level formula.`);
    else if (/compare/i.test(body.message)) payload = answer(`Comparing ${body.context.compare_zone_ids?.join(" and ")} using the official components.`);
    else if (/hypothetical|scenario/i.test(body.message)) payload = answer("Scenario Lab scores are **hypothetical**; the official ranking is unchanged.");
    else payload = answer("Answer.");
    try {
      await route.fulfill({ json: payload });
    } catch {
      // The page aborted the request (Stop); nothing to deliver.
    }
  });
  return requests;
}

async function ask(panel, question) {
  const input = panel.getByRole("textbox", { name: "Message GreenPulse AI Copilot" });
  await input.fill(question);
  await input.press("Enter");
}

test.describe("GreenPulse AI Copilot", () => {
  test("settings, context-aware chat across pages, theme, cancel, retry and disable", async ({ page, request }) => {
    const priority = await (await request.get(`${API}/priority`)).json();
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => message.type() === "error" && problems.push(message.text()));

    await page.addInitScript(() => {
      if (!sessionStorage.getItem("copilot-e2e")) {
        localStorage.clear();
        localStorage.setItem("greenpulse:preferences", JSON.stringify({ motion: "reduce", backgroundRefresh: false, mapScrollZoom: true, aiAssistant: false }));
        sessionStorage.setItem("copilot-e2e", "1");
      }
    });
    const chats = await installCopilotMocks(page, priority, { delayed: new Set(["Which zone has the highest priority?"]) });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Key indicators" }).getByText("99.3")).toBeVisible();
    const launcher = page.getByRole("button", { name: /^Ask Copilot/ });
    await expect(launcher).toHaveCount(0);

    // 1-2. Enable the Copilot in Settings.
    await page.getByRole("button", { name: "Open settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    const toggle = settings.getByRole("switch", { name: /Enable AI Copilot/ });
    await expect(toggle).not.toBeChecked();
    // The native checkbox is visually hidden behind the styled track; users click the label.
    await settings.getByText("Enable AI Copilot").click();
    await expect(toggle).toBeChecked();
    await expect(settings.getByText("gemini-3.5-flash-lite")).toBeVisible();
    await expect(settings.getByText("Connected")).toBeVisible();
    await settings.getByRole("button", { name: "Done" }).click();

    // 3. Open the launcher.
    await expect(launcher).toBeVisible();
    await launcher.click();
    const panel = page.getByRole("dialog", { name: "GreenPulse AI Copilot" });
    await expect(panel.getByRole("heading", { name: "Ask about GreenPulse data" })).toBeVisible();
    await expect(panel.getByText("Google Gemini · gemini-3.5-flash-lite")).toBeVisible();
    await expect(panel.getByRole("textbox", { name: "Message GreenPulse AI Copilot" })).toBeFocused();

    // 4. Greeting.
    await ask(panel, "Hi");
    await expect(panel.getByText(/Hello! I can explain zone priorities/)).toBeVisible();

    // 5. A grounded question, stopped while running and then retried.
    await ask(panel, "Which zone has the highest priority?");
    await expect(panel.getByRole("status")).toContainText(/Preparing context|Fetching the official zone ranking/);
    await expect(launcher).toBeHidden();
    await panel.getByRole("button", { name: "Stop answer" }).click();
    const stopped = panel.getByText("You stopped this answer.");
    await expect(stopped).toBeVisible();
    await panel.locator(".copilot-msg--notice").getByRole("button", { name: "Retry" }).click();
    const top = priority[0];
    await expect(panel.getByLabel("Key figures from GreenPulse data").getByText(top.priority_score.toFixed(2))).toBeVisible();
    await expect(panel.getByRole("region", { name: "Official priority ranking" })).toBeVisible();
    await expect(panel.getByRole("list", { name: "Sources used" })).toContainText("Official priority ranking");
    expect(chats.at(-1).history.map((item) => item.role)).toEqual(["user", "assistant"]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/answer-light.png` });

    // 6-7. Select a zone in the Spatial Explorer, then ask about the selection.
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Spatial Explorer" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const table = page.getByRole("region", { name: "Zone ranking table" });
    const contextStrip = panel.locator(".copilot-context");
    await table.getByRole("button", { name: "South-West Zone" }).click();
    await expect(contextStrip.getByText("Z05 · South-West Zone")).toBeVisible();
    await table.getByRole("button", { name: "North-West Zone" }).click();
    await expect(contextStrip.getByText("Z01 · North-West Zone")).toBeVisible();
    await expect(contextStrip.getByText("Layer: Priority")).toBeVisible();
    await ask(panel, "Explain this selected zone.");
    await expect(panel.getByText(/You selected/)).toBeVisible();
    expect(chats.at(-1).context).toEqual({ page: "map", zone_id: "Z01", map_layer: "priority" });

    // 8-9. Zone Comparison.
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Zone Comparison" }).click();
    await expect(panel.getByText(/^Comparing /)).toBeVisible();
    await ask(panel, "Compare Z01 and Z05.");
    await expect(panel.getByText(/^Comparing Z01 and Z05 using/)).toBeVisible();
    expect(chats.at(-1).context.page).toBe("compare");
    expect(chats.at(-1).context.compare_zone_ids).toEqual(["Z01", "Z05"]);

    // 10-11. Scenario Lab: experimental weights are labelled and shared.
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Scenario Lab" }).click();
    await expect(panel.getByText("Scenario weights (experimental)")).toBeVisible();
    await ask(panel, "How do hypothetical scores differ from official scores?");
    await expect(panel.getByText(/the official ranking is unchanged/)).toBeVisible();
    expect(Object.keys(chats.at(-1).context.scenario_weights)).toEqual(["low_green_cover", "ndvi_decline", "built_up_pressure", "tree_gap", "pm_stress"]);

    // 12. Theme switching keeps the conversation.
    await page.getByRole("button", { name: "Dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(panel.getByText(/Hello! I can explain/)).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/scenario-dark.png` });
    await page.getByRole("button", { name: "Dark mode" }).click(); // the same toggle switches back
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // New chat returns to the welcome screen.
    await panel.getByRole("button", { name: "New chat" }).click();
    await expect(panel.getByRole("heading", { name: "Ask about GreenPulse data" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "What changed in my Scenario Lab?" })).toBeVisible();

    // 14. Disable: launcher and panel disappear and no further requests are sent.
    const sent = chats.length;
    await page.getByRole("button", { name: "Open settings" }).click();
    const settingsAgain = page.getByRole("dialog", { name: "Settings" });
    await settingsAgain.getByText("Enable AI Copilot").click();
    await expect(settingsAgain.getByRole("switch", { name: /Enable AI Copilot/ })).not.toBeChecked();
    await settingsAgain.getByRole("button", { name: "Done" }).click();
    await expect(panel).toHaveCount(0);
    await expect(launcher).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "Ranking table" }).or(page.getByRole("heading", { level: 1 }))).toBeVisible();
    await expect(launcher).toHaveCount(0);
    expect(chats.length).toBe(sent);

    // 15. Existing workflows remain intact.
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Key indicators" }).getByText("447")).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("configuration and provider errors are explained, and the phone layout is full-screen", async ({ page, request }) => {
    const priority = await (await request.get(`${API}/priority`)).json();
    await page.addInitScript(() => localStorage.setItem("greenpulse:preferences", JSON.stringify({ motion: "reduce", backgroundRefresh: false, aiAssistant: true })));
    await installCopilotMocks(page, priority);
    await page.route(`${API}/api/ai/chat`, (route) =>
      route.fulfill({ status: 503, json: { detail: "Your Gemini API configuration needs attention. Gemini rejected the API key.", error: { category: "invalid_key", retryable: false, retry_after: null } } })
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/overview");
    await expect(page.getByRole("region", { name: "Key indicators" }).getByText("99.3")).toBeVisible();
    await page.getByRole("button", { name: "Ask Copilot" }).click();
    const panel = page.getByRole("dialog", { name: "GreenPulse AI Copilot" });
    await expect(panel).toHaveAttribute("aria-modal", "true");
    // Full-screen once the (reduced-motion) entrance frame has passed.
    await expect.poll(async () => panel.boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
    await ask(panel, "Which zone has the highest priority?");
    const alert = panel.getByRole("alert");
    await expect(alert).toContainText("configuration needs attention");
    await expect(alert.getByRole("button", { name: "Retry" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/phone-error.png` });
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ask Copilot" })).toBeFocused();
  });

  test("the header and each answer show the model that actually replied", async ({ page, request }) => {
    const priority = await (await request.get(`${API}/priority`)).json();
    await page.addInitScript(() => localStorage.setItem("greenpulse:preferences", JSON.stringify({ motion: "reduce", backgroundRefresh: false, aiAssistant: true })));
    await installCopilotMocks(page, priority);
    await page.route(`${API}/api/ai/status*`, (route) => route.fulfill({ json: { ...STATUS, fallback_model: "gemini-3.1-flash-lite" } }));
    await page.route(`${API}/api/ai/chat`, (route) =>
      route.fulfill({ json: { ...rankingAnswer(priority), model: "gemini-3.1-flash-lite", primary_model: "gemini-3.5-flash-lite", fallback_used: true, fallback_reason: "rate_limited" } })
    );
    await page.goto("/#/overview");
    await page.getByRole("button", { name: "Ask Copilot" }).click();
    const panel = page.getByRole("dialog", { name: "GreenPulse AI Copilot" });
    const header = panel.locator(".copilot-panel__title p");
    await expect(header).toContainText("Google Gemini · gemini-3.5-flash-lite");
    await ask(panel, "Which zone has the highest priority?");
    await expect(panel.getByText("Answered by gemini-3.1-flash-lite · fallback because the primary model is rate-limited")).toBeVisible();
    await expect(header).toContainText("Google Gemini · gemini-3.1-flash-lite (fallback)");
    await page.getByRole("button", { name: "Open settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByText("Fallback model")).toBeVisible();
    await expect(settings.getByText("gemini-3.1-flash-lite")).toBeVisible();
  });

  for (const theme of ["light", "dark"]) {
    test(`open Copilot has no WCAG A/AA violations in ${theme} theme`, async ({ page, request }) => {
      const priority = await (await request.get(`${API}/priority`)).json();
      await page.addInitScript((value) => {
        localStorage.setItem("greenpulse:theme", value);
        localStorage.setItem("greenpulse:preferences", JSON.stringify({ motion: "reduce", backgroundRefresh: false, aiAssistant: true }));
      }, theme);
      await installCopilotMocks(page, priority);
      await page.goto("/#/map?zone=Z01");
      await expect(page.locator("main h1")).toBeVisible();
      await page.getByRole("button", { name: "Ask Copilot" }).click();
      const panel = page.getByRole("dialog", { name: "GreenPulse AI Copilot" });
      await ask(panel, "Which zone has the highest priority?");
      await expect(panel.getByRole("region", { name: "Official priority ranking" })).toBeVisible();
      await panel.getByText("Source details").click();
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).include(".copilot-panel").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`)).toEqual([]);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/map-${theme}.png` });
    });
  }
});
