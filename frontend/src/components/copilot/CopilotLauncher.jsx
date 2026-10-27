import { forwardRef } from "react";
import { Sparkles } from "lucide-react";

const CopilotLauncher = forwardRef(function CopilotLauncher({ hidden, busy, unread, onOpen }, ref) {
  // The accessible name starts with the visible text (WCAG 2.5.3), so "click Ask Copilot" works by voice.
  const label = `Ask Copilot${busy ? ", answer in progress" : unread ? ", new answer" : ""}`;
  return (
    <button
      ref={ref}
      type="button"
      className={`copilot-launcher${busy ? " is-busy" : ""}`}
      hidden={hidden}
      onClick={onOpen}
      aria-label={label}
      title="GreenPulse AI Copilot"
    >
      <span className="copilot-launcher__mark" aria-hidden="true">
        <Sparkles size={19} strokeWidth={2.1} />
      </span>
      <span className="copilot-launcher__label" aria-hidden="true">Ask Copilot</span>
      {unread && <span className="copilot-launcher__dot" aria-hidden="true" />}
    </button>
  );
});

export default CopilotLauncher;
