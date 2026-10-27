/** localStorage wrappers that tolerate blocked storage (private mode, sandboxed iframes). */
export function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function readJson(key, fallback) {
  const raw = readStorage(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export const STORAGE_KEYS = {
  theme: "greenpulse:theme",
  preferences: "greenpulse:preferences",
  tour: "greenpulse:tour-completed",
};
