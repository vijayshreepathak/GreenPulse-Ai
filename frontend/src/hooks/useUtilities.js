import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** Current time, re-rendered on an interval so relative labels ("4 min ago") stay correct. */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function mediaList(query) {
  try {
    return window.matchMedia?.(query) ?? null;
  } catch {
    return null;
  }
}

export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const list = mediaList(query);
      list?.addEventListener?.("change", onChange);
      return () => list?.removeEventListener?.("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => Boolean(mediaList(query)?.matches), () => false);
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
