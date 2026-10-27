/** Shared Recharts tooltip body; values are formatted by the caller and never coerced from null. */
export default function ChartTooltip({ active, payload, label, formatLabel = (value) => value, formatValue, hideKeys = [] }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((item) => !hideKeys.includes(item.dataKey));
  if (!rows.length) return null;
  return (
    <div className="chart-tooltip">
      <span className="chart-tooltip__label">{formatLabel(label)}</span>
      <ul>
        {rows.map((item) => (
          <li key={item.dataKey}>
            <i style={{ backgroundColor: item.color }} aria-hidden="true" />
            <span>{item.name}</span>
            <strong>{formatValue(item.value, item)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
