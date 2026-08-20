export default function MapLegend({ config }) {
  return (
    <aside className="map-legend" aria-label={`${config.label} legend`}>
      <strong>{config.label}</strong>
      <span>{config.description}</span>
      <ul>
        {config.legend.map((item) => (
          <li key={item.label}>
            <i style={{ backgroundColor: item.color }} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>
    </aside>
  );
}
