import { ArrowRight, Grid3X3, ListChecks, Satellite, SlidersHorizontal } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

const steps = [
  { label: "Satellite imagery", detail: "Sentinel-2 + Dynamic World", icon: Satellite },
  { label: "50 m spatial grid", detail: "447 usable campus cells", icon: Grid3X3 },
  { label: "Environmental features", detail: "Vegetation + land pressure", icon: SlidersHorizontal },
  { label: "Priority intelligence", detail: "Explainable intervention rank", icon: ListChecks },
];

export default function IntelligencePipeline() {
  const reduceMotion = useReducedMotion();
  return (
    <section className="pipeline-band" aria-labelledby="pipeline-title">
      <div className="pipeline-band__intro">
        <p className="eyebrow">Intelligence pipeline</p>
        <h2 id="pipeline-title">From observation to intervention</h2>
      </div>
      <div className="pipeline-steps">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <motion.div
              className="pipeline-step"
              key={step.label}
              initial={reduceMotion ? false : { opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: 0.32, delay: reduceMotion ? 0 : index * 0.08 }}
            >
              <span className="pipeline-step__icon"><Icon size={18} aria-hidden="true" /></span>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
              {index < steps.length - 1 && <ArrowRight className="pipeline-arrow" size={17} aria-hidden="true" />}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
