import { ArrowDownRight, Building2, Leaf, MapPin, ShieldCheck, Sprout } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import SectionHeader from "../common/SectionHeader";

const icons = {
  "highest-priority": MapPin,
  "largest-decline": ArrowDownRight,
  "lowest-green": Leaf,
  "highest-built": Building2,
  "most-stable": ShieldCheck,
  "plantable-potential": Sprout,
};

export default function InsightGrid({ insights, compact = false, limit, title = "Environmental snapshot" }) {
  const reduceMotion = useReducedMotion();
  const visible = typeof limit === "number" ? insights.slice(0, limit) : insights;

  if (!visible.length) {
    return <div className="empty-state empty-state--compact">Insights become available when priority data loads.</div>;
  }

  return (
    <section className={`insight-section${compact ? " insight-section--compact" : ""}`}>
      <SectionHeader
        eyebrow={compact ? "Environmental snapshot" : "Deterministic insights"}
        title={title}
        description={compact ? undefined : "Signals are derived directly from the loaded zone and 50 m cell datasets."}
      />
      <div className="insight-grid">
        {visible.map((insight, index) => {
          const Icon = icons[insight.id] || MapPin;
          return (
            <motion.article
              className={`insight-card insight-card--${insight.tone}`}
              key={insight.id}
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              whileHover={reduceMotion ? undefined : { y: -4 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.24, delay: reduceMotion ? 0 : index * 0.06 }}
            >
              <div className="insight-card__icon"><Icon size={18} aria-hidden="true" /></div>
              <p>{insight.title}</p>
              <strong>{insight.value}</strong>
              <span>{insight.location}</span>
              <small>{insight.interpretation}</small>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
