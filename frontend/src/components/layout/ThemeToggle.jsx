import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";

/** One click switches directly between light and dark. "System" lives in Settings. */
export default function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-pressed={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="theme-toggle__switch" aria-hidden="true">
        <span className="theme-toggle__knob">{dark ? <Moon size={12} /> : <Sun size={12} />}</span>
      </span>
      <span className="theme-toggle__text">Dark mode</span>
    </button>
  );
}
