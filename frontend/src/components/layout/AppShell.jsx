import { useRef, useState } from "react";
import { Compass, Leaf, Menu, Settings, X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useMediaQuery } from "../../hooks/useUtilities";
import ExportMenu from "./ExportMenu";
import { NAV_ITEMS, navSection, VIEW_TITLES } from "./navigation";
import StatusPill from "./StatusPill";
import ThemeToggle from "./ThemeToggle";

function Brand() {
  return (
    <a className="brand" href="#/overview" title="Go to overview">
      <span className="brand__mark" aria-hidden="true"><Leaf size={18} strokeWidth={2.2} /></span>
      <span className="brand__text">
        <strong>GreenPulse AI</strong>
        <small>TIET environmental intelligence</small>
      </span>
    </a>
  );
}

function NavList({ view, onNavigate }) {
  const active = navSection(view);
  return (
    <ul className="nav-list">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.id}>
            <a
              href={`#/${item.id}`}
              className={`nav-link${active === item.id ? " is-active" : ""}`}
              aria-current={active === item.id ? "page" : undefined}
              onClick={onNavigate}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarFooter({ satelliteLabel }) {
  return (
    <div className="sidebar__footer">
      <p>{satelliteLabel}</p>
      <p>Decision support for ground review — not ground truth.</p>
    </div>
  );
}

export default function AppShell({ view, children, freshness, refreshing, online, onOpenSettings, onStartTour, exportActions, satelliteLabel, announcement = "" }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef(null);
  const wide = useMediaQuery("(min-width: 1080px)");
  // The drawer only exists below the sidebar breakpoint.
  const drawerVisible = drawerOpen && !wide;
  const closeDrawer = () => setDrawerOpen(false);
  useFocusTrap(drawerRef, drawerVisible, closeDrawer);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <p className="sr-only" role="status">{announcement}</p>

      <aside className="sidebar" aria-label="Primary">
        <Brand />
        <nav aria-label="Primary navigation">
          <NavList view={view} />
        </nav>
        <SidebarFooter satelliteLabel={satelliteLabel} />
      </aside>

      {drawerVisible && (
        <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeDrawer()}>
          <div className="drawer" role="dialog" aria-modal="true" aria-label="Navigation menu" ref={drawerRef} id="mobile-navigation">
            <div className="drawer__head">
              <Brand />
              <button type="button" className="icon-button" onClick={closeDrawer} aria-label="Close navigation">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Mobile navigation">
              <NavList view={view} onNavigate={closeDrawer} />
            </nav>
            <SidebarFooter satelliteLabel={satelliteLabel} />
          </div>
        </div>
      )}

      <div className="workspace">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar__menu"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerVisible}
            aria-controls="mobile-navigation"
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <div className="topbar__title">
            <span className="topbar__app">GreenPulse AI</span>
            <span className="topbar__view">{VIEW_TITLES[view] || "Overview"}</span>
          </div>
          <div className="topbar__actions">
            <StatusPill freshness={freshness} refreshing={refreshing} online={online} />
            <ExportMenu actions={exportActions} />
            <button type="button" className="icon-button" onClick={onStartTour} aria-label="Start guided tour" title="Guided tour">
              <Compass size={18} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" onClick={onOpenSettings} aria-label="Open settings" title="Settings">
              <Settings size={18} aria-hidden="true" />
            </button>
            <ThemeToggle />
          </div>
        </header>
        <main id="main-content" className="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
