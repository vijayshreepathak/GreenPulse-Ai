import { LAYER_CONFIGS, LAYER_GROUPS } from "./layerConfig";

export default function LayerSwitcher({ activeLayer, onChange, cellsAvailable }) {
  return (
    <div className="layer-switcher" role="group" aria-label="Map layer">
      {LAYER_GROUPS.map((group) => (
        <div className="layer-switcher__group" key={group.id}>
          <span className="layer-switcher__label">{group.label}</span>
          <div className="layer-switcher__items">
            {Object.values(LAYER_CONFIGS)
              .filter((layer) => layer.group === group.id)
              .map((layer) => {
                const disabled = layer.source === "cell" && !cellsAvailable;
                const active = activeLayer === layer.id;
                return (
                  <button
                    type="button"
                    key={layer.id}
                    className={`chip${active ? " is-active" : ""}`}
                    onClick={() => onChange(layer.id)}
                    disabled={disabled}
                    aria-pressed={active}
                    title={disabled ? `${layer.label}: 50 m cell data unavailable` : layer.description}
                  >
                    {layer.label}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
