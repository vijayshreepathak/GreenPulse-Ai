import { useCallback, useEffect, useState } from "react";

export const VIEW_IDS = ["overview", "map", "trends", "air-quality", "compare", "scenario", "insights", "report"];

/** Parse "#/map?zone=Z01&layer=ndvi" into { view, params }. Unknown views fall back to overview. */
export function parseHash(hash) {
  const text = String(hash || "").replace(/^#\/?/, "");
  const [path, query = ""] = text.split("?");
  const view = VIEW_IDS.includes(path) ? path : "overview";
  return { view, params: Object.fromEntries(new URLSearchParams(query)) };
}

export function buildHash(view, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ""));
  const suffix = query.toString();
  return `#/${view}${suffix ? `?${suffix}` : ""}`;
}

function initialRoute() {
  const route = parseHash(window.location.hash);
  // Backwards compatibility with the documented "?layer=ndvi" deep link: rewrite it to the
  // hash route so later hash-derived updates keep the map view.
  const legacyLayer = new URLSearchParams(window.location.search).get("layer");
  if (!window.location.hash && legacyLayer) {
    const params = { layer: legacyLayer };
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${buildHash("map", params)}`);
    return { view: "map", params };
  }
  return route;
}

/**
 * `revision` increases only on real hash navigation (links, address bar, back/forward), never on
 * `replaceParams`, so callers can adopt URL params without echoing their own updates back.
 */
export function useHashRoute() {
  const [route, setRoute] = useState(() => ({ ...initialRoute(), revision: 0 }));

  useEffect(() => {
    const onHashChange = () => setRoute((current) => ({ ...parseHash(window.location.hash), revision: current.revision + 1 }));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  /** Push a history entry so browser back/forward moves between views. */
  const navigate = useCallback((view, params = {}) => {
    const hash = buildHash(view, params);
    if (window.location.hash === hash) return;
    window.location.hash = hash;
  }, []);

  /** Update shareable params (selection, layer) without adding history entries. */
  const replaceParams = useCallback((params) => {
    const { view } = parseHash(window.location.hash);
    const hash = buildHash(view, params);
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, "", hash);
    setRoute((current) => ({ view, params, revision: current.revision }));
  }, []);

  return { ...route, navigate, replaceParams };
}
