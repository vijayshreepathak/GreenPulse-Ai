import { useEffect, useId, useRef, useState } from "react";
import { Download } from "lucide-react";

/** Menu button: arrow keys move between items, Escape closes and returns focus. */
export default function ExportMenu({ actions }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    rootRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onKeyDown = (event) => {
    const items = [...(rootRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape" && open) {
      // Handled here: an open guided tour must not also close on this key press.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Export analysis"
        title="Export"
        onClick={() => setOpen((value) => !value)}
      >
        <Download size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="menu__popover" role="menu" id={menuId} aria-label="Export options">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className="menu__item"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
                buttonRef.current?.focus();
              }}
            >
              <strong>{action.label}</strong>
              <small>{action.description}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
