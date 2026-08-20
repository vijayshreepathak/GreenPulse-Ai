import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Skeleton from "./Skeleton";

function CountUp({ value, decimals = 0, suffix = "", prefix = "" }) {
  const reduceMotion = useReducedMotion();
  const numericValue = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  const [display, setDisplay] = useState(reduceMotion || !Number.isFinite(numericValue) ? numericValue : 0);

  useEffect(() => {
    if (!Number.isFinite(numericValue) || reduceMotion) {
      setDisplay(numericValue);
      return undefined;
    }

    const duration = 650;
    const startedAt = performance.now();
    let frame;
    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(numericValue * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [numericValue, reduceMotion]);

  if (!Number.isFinite(numericValue)) return "N/A";
  return `${prefix}${display.toFixed(decimals)}${suffix}`;
}

export default function MetricCard({
  label,
  value,
  displayValue,
  decimals = 0,
  suffix = "",
  prefix = "",
  context,
  icon: Icon,
  loading = false,
  index = 0,
  tone = "forest",
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.article
      className={`metric-card metric-card--${tone}`}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      whileHover={reduceMotion ? undefined : { y: -4 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.24, delay: reduceMotion ? 0 : index * 0.055 }}
    >
      <div className="metric-card__top">
        <span>{label}</span>
        {Icon && (
          <span className="metric-card__icon" aria-hidden="true">
            <Icon size={17} strokeWidth={1.8} />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="skeleton--metric" />
      ) : (
        <strong className="metric-card__value">
          {displayValue ?? <CountUp value={value} decimals={decimals} suffix={suffix} prefix={prefix} />}
        </strong>
      )}
      {context && <p>{context}</p>}
    </motion.article>
  );
}
