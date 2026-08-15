const defaultNotes = [
  "NDVI and land-cover data were generated from Google Earth Engine.",
  "Dynamic World land-cover outputs are used as zone-level indicators, not building-level ground truth.",
  "Open-Meteo PM2.5 / PM10 values are modeled estimates near the campus coordinates, not direct campus sensor readings.",
  "ML, ESP32 sensing, drone validation, and plant species recommendation are future-scope modules.",
];

export default function DataNotes({ notes }) {
  const allNotes = [...new Set([...(notes?.length ? notes : defaultNotes)])];

  return (
    <section className="panel notes-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Read before interpreting</p>
          <h2>Data notes and limitations</h2>
        </div>
      </div>
      <ul>
        {allNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}
