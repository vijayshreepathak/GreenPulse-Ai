import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

export const TOUR_STEPS = [
  {
    view: "overview",
    target: '[data-tour="kpis"]',
    title: "Campus overview",
    body: "Key indicators come straight from the loaded datasets: campus area, green cover, NDVI, zones, cells and regional PM stress.",
  },
  {
    view: "map",
    target: '[data-tour="map"]',
    title: "Interactive environmental map",
    body: "Switch between the official zone priority layer and eight 50 m indicator layers. Click a zone or cell to inspect it.",
  },
  {
    view: "map",
    target: '[data-tour="score-breakdown"]',
    title: "Why a zone ranks where it does",
    body: "Each official score is a weighted sum of five components. The breakdown shows every input, weight and contribution.",
  },
  {
    view: "trends",
    target: '[data-tour="trend-chart"]',
    title: "Historical trends",
    body: "Compare Sentinel-2 seasonal NDVI from baseline to latest year per zone or 50 m cell. Landsat is shown separately as context.",
  },
  {
    view: "scenario",
    target: '[data-tour="scenario-weights"]',
    title: "Scenario Lab",
    body: "Test how sensitive the order is to the weights. Results are experimental and never replace the official ranking.",
  },
];

/** Non-modal guided tour: it never traps focus and the app stays usable underneath. */
export default function ProductTour({ step, onStepChange, onClose, onNavigate, currentView }) {
  const panelRef = useRef(null);
  const config = TOUR_STEPS[step];

  // Take focus on open and give it back on close (or to the view heading if that control is gone).
  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.focus();
    return () => {
      const target = previous instanceof HTMLElement && previous !== document.body && previous.isConnected ? previous : document.querySelector("main h1");
      target?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!config) return undefined;
    if (currentView !== config.view) {
      onNavigate(config.view);
      return undefined;
    }
    let highlighted = null;
    const timer = window.setTimeout(() => {
      highlighted = document.querySelector(config.target);
      if (highlighted) {
        highlighted.classList.add("tour-target");
        highlighted.scrollIntoView({ block: "center", behavior: document.documentElement.dataset.motion === "reduce" ? "auto" : "smooth" });
      }
    }, 120);
    return () => {
      window.clearTimeout(timer);
      highlighted?.classList.remove("tour-target");
    };
  }, [config, currentView, onNavigate]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector(".dialog")) onClose("skip");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!config) return null;
  const last = step === TOUR_STEPS.length - 1;

  return (
    <section className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body" ref={panelRef} tabIndex={-1}>
      <header className="tour__head">
        <span className="tour__step">Step {step + 1} of {TOUR_STEPS.length}</span>
        <button type="button" className="icon-button icon-button--sm" onClick={() => onClose("skip")} aria-label="Skip tour">
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <h2 id="tour-title">{config.title}</h2>
      <p id="tour-body">{config.body}</p>
      <div className="tour__progress" aria-hidden="true">
        {TOUR_STEPS.map((item, index) => <span key={item.title} className={index <= step ? "is-done" : ""} />)}
      </div>
      <footer className="tour__actions">
        <button type="button" className="button button--ghost button--sm" onClick={() => onClose("skip")}>Skip</button>
        <span className="tour__spacer" />
        <button type="button" className="button button--secondary button--sm" onClick={() => onStepChange(step - 1)} disabled={step === 0}>
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
        {last ? (
          <button type="button" className="button button--primary button--sm" onClick={() => onClose("finish")}>Finish</button>
        ) : (
          <button type="button" className="button button--primary button--sm" onClick={() => onStepChange(step + 1)}>
            Next <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
      </footer>
    </section>
  );
}
