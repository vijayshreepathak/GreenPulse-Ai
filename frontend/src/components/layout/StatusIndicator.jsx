import { Clock3 } from "lucide-react";

function getLatestAqiTimestamp(recentAqi) {
  if (recentAqi?.last_updated) return recentAqi.last_updated;

  const records = recentAqi?.records || [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.time && (record.pm2_5 != null || record.pm10 != null)) {
      return record.time;
    }
  }
  return null;
}

function formatTimestamp(value) {
  if (!value) return "Awaiting update";

  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}:00+05:30`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "Update time unavailable";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function formatAge(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "updated just now";
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `updated ${hours}h ago`;
}

export default function StatusIndicator({ loading, updating, error, recentAqi }) {
  const hasAqiData = Boolean(recentAqi?.records?.length);
  const cached = recentAqi?.freshness === "cached" || Boolean(recentAqi?.served_from_cache);
  const timestamp = getLatestAqiTimestamp(recentAqi);
  const formattedTimestamp = formatTimestamp(timestamp);
  const cacheAge = formatAge(recentAqi?.fetched_at);

  let label = "Live modeled";
  let tone = "live";

  if (loading || updating) {
    label = "Updating modeled data";
    tone = "updating";
  } else if (cached) {
    label = "Cached modeled";
    tone = "cached";
  } else if (error && !hasAqiData) {
    label = "Data connection unavailable";
    tone = "offline";
  }

  const secondary = cached && cacheAge ? cacheAge : `${formattedTimestamp}${timestamp ? " IST" : ""}`;
  const statusDescription = `${label}. ${secondary}`;

  return (
    <div
      className={`model-status model-status--${tone}`}
      aria-label={statusDescription}
      title={statusDescription}
      aria-live="polite"
    >
      <span className="model-status__dot" aria-hidden="true" />
      <span className="model-status__copy">
        <strong>{label}</strong>
        <span className="model-status__time">
          <Clock3 size={12} aria-hidden="true" />
          {secondary}
        </span>
      </span>
    </div>
  );
}
