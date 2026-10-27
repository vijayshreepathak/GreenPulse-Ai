/** CSV/JSON export helpers with escaping, spreadsheet formula-injection protection and safe filenames. */
const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

export function escapeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let text = Array.isArray(value) ? value.join("; ") : String(value);
  if (FORMULA_START.test(text) && !NUMERIC.test(text.trim())) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text !== text.trim()) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * @param {{columns: {key: string, label: string, value?: (row) => unknown}[], rows: object[], metadata?: [string, unknown][]}} input
 */
export function toCsv({ columns, rows, metadata = [] }) {
  const lines = metadata.map(([key, value]) => escapeCell(`# ${key}: ${value ?? "N/A"}`));
  lines.push(columns.map((column) => escapeCell(column.label)).join(","));
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(column.value ? column.value(row) : row?.[column.key])).join(","));
  }
  const BYTE_ORDER_MARK = String.fromCharCode(0xfeff); // lets spreadsheet apps detect UTF-8 (µg/m³)
  return `${BYTE_ORDER_MARK}${lines.join("\r\n")}\r\n`;
}

export function safeFilename(name, extension = "csv") {
  const base = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${base || "greenpulse-export"}.${extension}`;
}

/** Local calendar date (YYYY-MM-DD), so a file exported at 01:00 IST is not stamped with yesterday's UTC date. */
export function dateStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function downloadText(filename, text, mimeType = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const EXPORT_DISCLAIMER =
  "Decision-support analysis for ground review; not a validated ecological intervention recommendation.";
