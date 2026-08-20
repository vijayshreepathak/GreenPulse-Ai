import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import TopNav from "./TopNav";

const NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "spatial-intelligence", label: "Spatial Intelligence" },
  { id: "vegetation-trends", label: "Vegetation Trends" },
  { id: "air-quality", label: "Air Quality" },
  { id: "insights", label: "Insights" },
  { id: "data-methodology", label: "Data & Methodology" },
];

export default function AppShell({ children, loading, updating, error, recentAqi }) {
  const [activeSection, setActiveSection] = useState("overview");
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const sections = NAV_ITEMS.map((item) => document.getElementById(item.id)).filter(Boolean);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-84px 0px -58% 0px", threshold: [0, 0.1, 0.25, 0.5] }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sectionId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!sectionId) return undefined;
    const timer = window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "auto", block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, []);

  const navigate = (sectionId) => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    setActiveSection(sectionId);
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="product-shell">
      <TopNav
        items={NAV_ITEMS}
        activeSection={activeSection}
        onNavigate={navigate}
        loading={loading}
        updating={updating}
        error={error}
        recentAqi={recentAqi}
      />
      <motion.main
        className="app-shell"
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: "easeOut" }}
      >
        {children}
      </motion.main>
    </div>
  );
}
