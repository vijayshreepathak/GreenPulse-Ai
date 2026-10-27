import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useCopilot } from "../../context/CopilotContext";
import CopilotLauncher from "./CopilotLauncher";
import "../../styles/copilot.css";

// The panel (Markdown renderer, message views) loads only when the Copilot is first opened.
const CopilotPanel = lazy(() => import("./CopilotPanel"));

function PanelFallback() {
  return (
    <div className="copilot-panel copilot-panel--loading" role="status">
      <span className="copilot-mark copilot-mark--busy" aria-hidden="true" />
      <span>Opening Copilot…</span>
    </div>
  );
}

/** Floating launcher plus the chat panel, rendered outside <main> so landmarks stay clean. */
export default function Copilot() {
  const { launcherVisible, open, openPanel, closePanel, pending, unread } = useCopilot();
  const launcherRef = useRef(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const close = useCallback(() => closePanel(), [closePanel]);

  if (!launcherVisible) return null;
  return createPortal(
    <>
      <CopilotLauncher ref={launcherRef} hidden={open} busy={Boolean(pending)} unread={unread} onOpen={openPanel} />
      {open && (
        <Suspense fallback={<PanelFallback />}>
          <CopilotPanel onClose={close} />
        </Suspense>
      )}
    </>,
    document.body
  );
}
