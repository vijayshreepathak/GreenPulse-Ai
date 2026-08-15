const number = (value, digits = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "N/A";
};

function getSummaryValue(summary, candidates) {
  for (const key of candidates) {
    if (summary?.[key] !== undefined && summary?.[key] !== null) return summary[key];
  }
  return null;
}

export default function SummaryCards({ summary, priority, recentAqi }) {
  const topZone = priority?.[0];
  const cards = [
    {
      label: "Campus area",
      value: `${number(getSummaryValue(summary, ["total_area_hectares", "campus_area_hectares", "area_hectares"]))} ha`,
    },
    {
      label: "Green cover",
      value: `${number(getSummaryValue(summary, ["green_cover_percent", "campus_green_cover_percent"]))}%`,
    },
    {
      label: "Average NDVI",
      value: number(getSummaryValue(summary, ["average_ndvi", "mean_ndvi", "campus_mean_ndvi"]), 3),
    },
    {
      label: "Highest priority zone",
      value: topZone?.zone_name || topZone?.zone_id || "N/A",
    },
    {
      label: "Recent PM stress",
      value: number(recentAqi?.stress_score),
    },
  ];

  return (
    <section className="summary-grid">
      {cards.map((card) => (
        <article className="summary-card" key={card.label}>
          <p>{card.label}</p>
          <strong>{card.value}</strong>
        </article>
      ))}
    </section>
  );
}
