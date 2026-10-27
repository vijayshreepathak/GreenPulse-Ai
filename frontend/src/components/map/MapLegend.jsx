import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { NO_DATA_LEGEND } from "./layerConfig";

function initiallyOpen() {
  try {
    return !window.matchMedia?.("(max-width: 640px)").matches;
  } catch {
    return true;
  }
}

/** Collapsible so it does not cover most of the map on phones. */
export default function MapLegend({ config }) {
  const [open, setOpen] = useState(initiallyOpen);
  const items = [...config.legend, NO_DATA_LEGEND];
  return (
    <aside className={`map-legend${open ? " is-open" : ""}`} aria-label={`${config.label} legend`}>
      <button type="button" className="map-legend__toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <strong>{config.label}{config.unit ? ` (${config.unit})` : ""}</strong>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul>
          {items.map((item) => (
            <li key={item.label}>
              <i style={{ backgroundColor: item.color }} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
