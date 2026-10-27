import { ArrowDownRight, Building2, Leaf, MapPin, ShieldCheck, Sprout, TreePine } from "lucide-react";
import { Skeleton } from "../common/Primitives";

const ICONS = {
  "highest-priority": MapPin,
  "largest-decline": ArrowDownRight,
  "lowest-green": Leaf,
  "highest-built": Building2,
  "most-stable": ShieldCheck,
  "plantable-potential": Sprout,
  "lowest-tree": TreePine,
};

export default function InsightCards({ insights, loading, onOpenZone, showEvidence = false }) {
  if (loading) {
    return (
      <div className="insight-grid">
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="skeleton--card" />)}
      </div>
    );
  }
  if (!insights.length) return <p className="muted">Insights appear when the zone ranking loads.</p>;
  return (
    <div className="insight-grid">
      {insights.map((insight) => {
        const Icon = ICONS[insight.id] || MapPin;
        return (
          <article className={`insight insight--${insight.tone}`} key={insight.id}>
            <div className="insight__head">
              <span className="insight__icon"><Icon size={16} aria-hidden="true" /></span>
              <p>{insight.title}</p>
            </div>
            <p className="insight__value">
              {insight.value}
              {insight.unit && <span>{insight.unit}</span>}
            </p>
            {insight.zoneId && onOpenZone ? (
              <button type="button" className="link-button insight__location" onClick={() => onOpenZone(insight.zoneId, insight.cellId)}>{insight.location}</button>
            ) : (
              <p className="insight__location">{insight.location}</p>
            )}
            <p className="insight__detail">{insight.detail}</p>
            {showEvidence && (
              <p className="insight__evidence">
                <span>Evidence:</span> {insight.evidence.join(" · ")}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
