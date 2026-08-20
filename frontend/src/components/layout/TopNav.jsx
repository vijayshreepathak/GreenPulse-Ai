import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Layers3, Menu, X } from "lucide-react";
import StatusIndicator from "./StatusIndicator";

export default function TopNav({ items, activeSection, onNavigate, loading, updating, error, recentAqi }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  const navigate = (sectionId) => {
    onNavigate(sectionId);
    setMenuOpen(false);
  };

  return (
    <motion.header
      className="top-nav"
      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <div className="top-nav__inner">
        <button className="brand" type="button" onClick={() => navigate("overview")} aria-label="Go to overview">
          <span className="brand__mark" aria-hidden="true">
            <Layers3 size={20} strokeWidth={2} />
          </span>
          <span className="brand__copy">
            <strong>GreenPulse AI</strong>
            <small>Environmental intelligence</small>
          </span>
        </button>

        <nav className="product-nav" aria-label="Primary navigation">
          {items.map((item) => {
            const active = item.id === activeSection;
            return (
              <button
                className={`product-nav__item${active ? " is-active" : ""}`}
                type="button"
                key={item.id}
                onClick={() => navigate(item.id)}
                aria-current={active ? "page" : undefined}
              >
                {active && (
                  <motion.span
                    className="product-nav__indicator"
                    layoutId="primary-nav-indicator"
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="top-nav__actions">
          <StatusIndicator loading={loading} updating={updating} error={error} recentAqi={recentAqi} />
          <button
            className="mobile-menu-button"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              id="mobile-navigation"
              className="mobile-navigation"
              aria-label="Mobile navigation"
              initial={reduceMotion ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              {items.map((item) => (
                <button
                  className={item.id === activeSection ? "is-active" : ""}
                  type="button"
                  key={item.id}
                  onClick={() => navigate(item.id)}
                  aria-current={item.id === activeSection ? "page" : undefined}
                >
                  {item.label}
                </button>
              ))}
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
}
