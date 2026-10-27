import { RefreshCw, WifiOff } from "lucide-react";

export default function StatusPill({ freshness, refreshing, online }) {
  let tone = freshness.tone;
  let label = `PM data: ${freshness.label}`;
  let detail = freshness.fetchedRelative ? `fetched ${freshness.fetchedRelative}` : freshness.modelTime ? `model ${freshness.modelTime}` : "";
  if (!online) {
    tone = "unavailable";
    label = "Offline";
    detail = "showing last loaded data";
  } else if (refreshing) {
    tone = "updating";
    label = "Updating PM data";
    detail = "";
  } else if (freshness.refreshError) {
    tone = "stale";
    label = "PM refresh failed";
    detail = freshness.fetchedRelative ? `last fetch ${freshness.fetchedRelative}` : "showing last loaded data";
  }
  return (
    <a
      className={`status-pill status-pill--${tone}`}
      href="#/air-quality"
      title={`${label}${detail ? ` — ${detail}` : ""}. Modelled estimates, not campus sensors.`}
    >
      {!online ? <WifiOff size={14} aria-hidden="true" /> : refreshing ? <RefreshCw size={14} className="is-spinning" aria-hidden="true" /> : <span className="status-dot" aria-hidden="true" />}
      <span className="status-pill__label">{label}</span>
      {detail && <span className="status-pill__detail">{detail}</span>}
      <span className="sr-only">(modelled estimates; open air quality)</span>
    </a>
  );
}
