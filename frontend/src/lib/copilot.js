/**
 * GreenPulse AI Copilot helpers: what page context is shared with the backend, the chips that
 * show it, starter questions, bounded history and error wording. The backend validates every ID
 * and never trusts numbers from here; these only describe what the user is looking at.
 */
import { VIEW_TITLES } from "../components/layout/navigation";
import { LAYER_CONFIGS } from "../components/map/layerConfig";
import { FACTORS } from "./constants";
import { scenarioMatchesOfficial, weightsToPercent } from "./scenario";

export const MAX_MESSAGE_CHARS = 2000;
export const DATA_USE_NOTICE =
  "When you ask a question, the question, the last few conversation turns and a short description of the current page are sent to Google Gemini. The API key stays on the GreenPulse backend, and conversations are kept only in this tab's memory.";
const MAX_HISTORY_CHARS = 4000;
const TREND_LABELS = { sentinel: "Sentinel-2", landsat: "Landsat" };
const METRIC_LABELS = { ndvi: "NDVI", green: "Green cover" };

export function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The page context sent with a question. Only what is relevant to the current page is included:
 * the map sends its layer and the zone shown in its panel; other pages send a zone only if the
 * user explicitly selected one.
 */
export function buildCopilotContext({
  view,
  activeLayer,
  displayedZoneId,
  selectedZoneId,
  selectedCellId,
  compareIds = [],
  scenarioWeights = null, // null until the user changes a Scenario Lab weight
  officialWeights,
  viewContext = {},
}) {
  const context = { page: view };
  const zoneId = view === "map" ? displayedZoneId : selectedZoneId;
  if (zoneId) context.zone_id = String(zoneId);
  if (selectedCellId && (view === "map" || view === "trends")) context.cell_id = String(selectedCellId);
  if (view === "map" && activeLayer) context.map_layer = activeLayer;
  if (view === "trends" && viewContext.trends) {
    context.trend_dataset = viewContext.trends.dataset;
    context.trend_unit = viewContext.trends.unit;
    context.trend_metric = viewContext.trends.metric;
    if (viewContext.trends.unit !== "cell") delete context.cell_id;
  }
  if (view === "compare" && compareIds.length) context.compare_zone_ids = compareIds.slice(0, 3).map(String);
  if (view === "air-quality" && viewContext.air?.range) context.air_quality_range_hours = viewContext.air.range;
  // The Scenario Lab page always shares its weights; other pages only once they differ from official.
  const modified = Boolean(scenarioWeights) && Boolean(officialWeights) && !scenarioMatchesOfficial(scenarioWeights, officialWeights);
  const shared = view === "scenario" ? scenarioWeights ?? (officialWeights && weightsToPercent(officialWeights)) : modified ? scenarioWeights : null;
  if (shared) {
    context.scenario_weights = Object.fromEntries(FACTORS.map((factor) => [factor.key, Number(shared[factor.key]) || 0]));
  }
  return context;
}

/** Short labels for the context strip and for the "asked on …" caption of a sent question. */
export function contextChips(context, zoneNames = new Map()) {
  if (!context) return [];
  const chips = [{ key: "page", label: VIEW_TITLES[context.page] || "Overview" }];
  if (context.zone_id) {
    const name = zoneNames.get(String(context.zone_id));
    chips.push({ key: "zone", label: name ? `${context.zone_id} · ${name}` : `Zone ${context.zone_id}` });
  }
  if (context.cell_id) chips.push({ key: "cell", label: `Cell ${context.cell_id}` });
  if (context.map_layer) chips.push({ key: "layer", label: `Layer: ${LAYER_CONFIGS[context.map_layer]?.label || context.map_layer}` });
  if (context.trend_dataset) {
    chips.push({ key: "trend", label: `${TREND_LABELS[context.trend_dataset] || context.trend_dataset} · ${context.trend_unit} · ${METRIC_LABELS[context.trend_metric] || context.trend_metric}` });
  }
  if (context.compare_zone_ids?.length) chips.push({ key: "compare", label: `Comparing ${context.compare_zone_ids.join(", ")}` });
  if (context.air_quality_range_hours) chips.push({ key: "range", label: `Range ${context.air_quality_range_hours === 168 ? "7D" : `${context.air_quality_range_hours}H`}` });
  if (context.scenario_weights) chips.push({ key: "scenario", label: "Scenario weights (experimental)", tone: "experimental" });
  return chips;
}

const GENERAL_STARTERS = [
  "Which campus zone has the highest environmental priority?",
  "Explain the current vegetation trends.",
  "Compare two campus zones.",
  "How does the environmental priority score work?",
];

/** Four clickable starter questions that follow the current page and selection. */
export function starterQuestions(context) {
  const page = context?.page;
  const zone = context?.zone_id;
  let specific = [];
  if (page === "map") {
    specific = [zone ? "Explain the zone I have selected." : "Which zone needs the most attention?", "What does this map layer represent?"];
    if (context.cell_id) specific.unshift("Explain the selected 50 m cell.");
  } else if (page === "trends") {
    specific = ["How has vegetation changed between 2018 and 2025?", "Why are Sentinel-2 and Landsat shown separately?"];
  } else if (page === "air-quality") {
    specific = ["What is the PM2.5 level in the latest available data?", "Why is PM stress not an official AQI?"];
  } else if (page === "compare") {
    specific = [context.compare_zone_ids?.length >= 2 ? `Compare ${context.compare_zone_ids.join(" and ")}.` : "Compare the North-West and South-West zones.", "Which factor explains the score gap?"];
  } else if (page === "scenario") {
    specific = ["What changed in my Scenario Lab?", "How do hypothetical scores differ from official scores?"];
  } else if (page === "insights" || page === "report") {
    specific = ["What is the difference between NDVI and NDBI?", "Why shouldn't we use these results as proof of causation?"];
  } else if (zone) {
    specific = ["Explain the zone I have selected."];
  }
  return [...new Set([...specific, ...GENERAL_STARTERS])].slice(0, 4);
}

/** The last `max` user/assistant turns, oldest first, without errors or notices. */
export function historyForRequest(messages, max = 12) {
  if (!(max > 0)) return [];
  return messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content)
    .slice(-max)
    .map((message) => ({ role: message.role, content: String(message.content).slice(0, MAX_HISTORY_CHARS) }));
}

const NETWORK_MESSAGE = "The GreenPulse API could not be reached. Check that the backend is running, then try again.";

/** User-facing wording and retry advice for a failed Copilot request. */
export function describeAiError(error) {
  const details = error?.details || {};
  if (error?.kind === "network") return { category: "network", message: NETWORK_MESSAGE, retryable: true };
  if (error?.kind === "timeout") return { category: "timeout", message: "The answer took too long. Please try again.", retryable: true };
  if (details.category) {
    return { category: details.category, message: error.message, retryable: Boolean(details.retryable), diagnostic: details.diagnostic || null };
  }
  if (error?.status === 422) return { category: "invalid_request", message: "The question could not be sent. Shorten it and try again.", retryable: false };
  if (error?.status === 413) return { category: "too_large", message: "The conversation is too long. Start a new chat and ask again.", retryable: false };
  return { category: "unknown", message: error?.message || "The Copilot could not answer. Please try again.", retryable: true };
}

const FALLBACK_REASONS = {
  quota_exhausted: "primary model's quota is used up",
  rate_limited: "primary model is rate-limited",
  provider_unavailable: "primary model is overloaded",
  timeout: "primary model was too slow",
  model_unavailable: "primary model is unavailable",
  permission_denied: "primary model is not permitted for this key",
};

export function fallbackReasonText(reason) {
  return FALLBACK_REASONS[reason] || "primary model could not answer";
}

/**
 * The model to show in the panel header: the one that produced the latest answer in this
 * conversation; before any answer, the model the next question will use (the fallback while the
 * primary is paused after a 429 or 503).
 */
export function displayedModel(status, messages = []) {
  const last = [...messages].reverse().find((message) => message.role === "assistant" && message.response?.model)?.response;
  if (last) return { model: last.model, fallback: Boolean(last.fallback_used) };
  const data = status?.data;
  if (!data?.model) return null;
  if (data.fallback_model && data.models?.[0]?.cooldown) return { model: data.fallback_model, fallback: true };
  return { model: data.model, fallback: false };
}

/** Status line for Settings and the panel. */
export function describeAiStatus(status) {
  if (status.state === "loading" || status.state === "idle") return { tone: "neutral", label: "Checking…" };
  if (status.state === "error") return { tone: "warning", label: "API unreachable", message: NETWORK_MESSAGE };
  const data = status.data;
  if (!data.enabled) return { tone: "neutral", label: "Disabled on the server", message: data.message };
  if (!data.key_configured) return { tone: "warning", label: "Configuration needed", message: data.message };
  const provider = data.provider_status || {};
  if (provider.state === "connected") return { tone: "positive", label: "Connected", message: data.message };
  if (provider.state === "error") return { tone: "warning", label: "Needs attention", message: data.message };
  return { tone: "neutral", label: "Configured · not checked yet", message: data.message };
}
