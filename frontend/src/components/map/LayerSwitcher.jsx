import { LAYER_CONFIGS } from "./layerConfig";

export default function LayerSwitcher({ activeLayer, onChange, cellsAvailable }) {
  return (
    <div className="layer-switcher" role="group" aria-label="Environmental map layer">
      {Object.values(LAYER_CONFIGS).map((layer) => {
        const disabled = layer.source === "cell" && !cellsAvailable;
        return (
          <button
            type="button"
            key={layer.id}
            className={activeLayer === layer.id ? "is-active" : ""}
            onClick={() => onChange(layer.id)}
            disabled={disabled}
            aria-pressed={activeLayer === layer.id}
            title={disabled ? `${layer.label}: Coming next` : layer.description}
          >
            <span>{layer.label}</span>
            {disabled && <small>Coming next</small>}
          </button>
        );
      })}
    </div>
  );
}
