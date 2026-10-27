import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { ArrowUp, CircleAlert, CircleCheck, LoaderCircle, PlugZap, ShieldCheck, Sparkles, Square, SquarePen, Trash2, X } from "lucide-react";
import { useCopilot } from "../../context/CopilotContext";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useMediaQuery } from "../../hooks/useUtilities";
import { describeAiStatus, displayedModel, MAX_MESSAGE_CHARS, starterQuestions } from "../../lib/copilot";
import CopilotMessage from "./CopilotMessage";

const STICK_TO_BOTTOM_PX = 96;

function Welcome({ context, canSend, onAsk }) {
  return (
    <div className="copilot-welcome">
      <span className="copilot-mark copilot-mark--lg" aria-hidden="true">
        <Sparkles size={22} />
      </span>
      <h3>Ask about GreenPulse data</h3>
      <p>
        Answers are built from the campus datasets through read-only tools: official zone scores, Sentinel-2 vegetation history,
        Dynamic World land cover and modelled air quality.
      </p>
      <ul className="copilot-starters" aria-label="Suggested questions">
        {starterQuestions(context).map((question) => (
          <li key={question}>
            <button type="button" className="copilot-starter" onClick={() => onAsk(question)} disabled={!canSend}>
              {question}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Progress({ pending }) {
  return (
    <div className="copilot-progress" role="status">
      <span className="copilot-mark copilot-mark--sm copilot-mark--busy" aria-hidden="true">
        <Sparkles size={13} />
      </span>
      <div>
        <p className="copilot-progress__label">
          {pending.label}
          <span className="copilot-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </p>
        {pending.steps.length > 0 && (
          <ul className="copilot-steps" aria-label="Data tools">
            {pending.steps.map((step, index) => (
              <li key={`${step.tool}-${index}`} className={`is-${step.status}`}>
                {step.status === "running" ? (
                  <LoaderCircle size={13} className="copilot-spin" aria-hidden="true" />
                ) : step.status === "ok" ? (
                  <CircleCheck size={13} aria-hidden="true" />
                ) : (
                  <CircleAlert size={13} aria-hidden="true" />
                )}
                <span>{step.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusNotice({ status, onCheck }) {
  if (status.state === "error") {
    return (
      <p className="copilot-notice" role="note">
        <CircleAlert size={15} aria-hidden="true" />
        <span>The GreenPulse API could not be reached, so the Copilot status is unknown. Questions will report the problem if it persists.</span>
      </p>
    );
  }
  const data = status.data;
  if (!data) return null;
  if (!data.key_configured) {
    return (
      <p className="copilot-notice copilot-notice--warning" role="note">
        <CircleAlert size={15} aria-hidden="true" />
        <span>{data.message} Restart the backend after editing backend/.env.</span>
      </p>
    );
  }
  if (data.provider_status?.state === "error") {
    return (
      <p className="copilot-notice copilot-notice--warning" role="note">
        <CircleAlert size={15} aria-hidden="true" />
        <span>{data.message}</span>
        <button type="button" className="button button--link" onClick={onCheck} disabled={status.checking}>
          <PlugZap size={14} aria-hidden="true" /> {status.checking ? "Checking…" : "Check again"}
        </button>
      </p>
    );
  }
  return null;
}

export default function CopilotPanel({ onClose }) {
  const copilot = useCopilot();
  const { messages, pending, draft, setDraft, send, cancel, retry, newChat, clearChat, canSend, chips, context, status } = copilot;
  const wide = useMediaQuery("(min-width: 720px)");
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const nearBottom = useRef(true);
  const titleId = useId();
  const inputId = useId();
  const hintId = useId();

  // Full-screen on phones: modal with a focus trap, scroll lock and Escape. Side panel otherwise.
  useFocusTrap(panelRef, !wide, onClose);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Follow new content only while the reader is at the bottom; never yank them while they scroll back.
  const lastMessage = messages[messages.length - 1];
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (nearBottom.current || lastMessage?.role === "user") node.scrollTop = node.scrollHeight;
  }, [messages.length, lastMessage?.role, pending?.label, pending?.steps?.length]);

  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [draft]);

  const ask = (question) => {
    if (!question.trim() || pending || !canSend) return;
    setDraft("");
    send(question);
    inputRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask(draft);
    }
  };

  const onPanelKeyDown = (event) => {
    if (wide && event.key === "Escape" && !event.defaultPrevented) {
      event.stopPropagation();
      onClose();
    }
  };

  const model = displayedModel(status, messages);
  const summary = describeAiStatus(status);
  const remaining = MAX_MESSAGE_CHARS - draft.length;
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");

  return (
    <div
      ref={panelRef}
      className={`copilot-panel${wide ? "" : " copilot-panel--modal"}`}
      role="dialog"
      aria-modal={wide ? "false" : "true"}
      aria-labelledby={titleId}
      onKeyDown={onPanelKeyDown}
    >
      <header className="copilot-panel__header">
        <span className={`copilot-mark${pending ? " copilot-mark--busy" : ""}`} aria-hidden="true">
          <Sparkles size={17} />
        </span>
        <div className="copilot-panel__title">
          <h2 id={titleId}>GreenPulse AI Copilot</h2>
          <p>
            <span className={`copilot-status-dot copilot-status-dot--${summary.tone}`} aria-hidden="true" />
            {model ? `Google Gemini · ${model.model}${model.fallback ? " (fallback)" : ""}` : "Google Gemini"}
            <span className="sr-only">, status: {summary.label}</span>
          </p>
        </div>
        <div className="copilot-panel__actions">
          <button type="button" className="icon-button icon-button--sm" onClick={newChat} disabled={!messages.length && !pending} aria-label="New chat" title="New chat">
            <SquarePen size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button icon-button--sm" onClick={clearChat} disabled={!messages.length && !pending && !draft} aria-label="Clear chat" title="Clear chat">
            <Trash2 size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button icon-button--sm" onClick={onClose} aria-label="Close Copilot" title="Close">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="copilot-context">
        <span className="copilot-context__label" id={`${titleId}-context`}>
          Context
        </span>
        <ul aria-labelledby={`${titleId}-context`}>
          {chips.map((chip) => (
            <li key={chip.key} className={`copilot-chip${chip.tone ? ` copilot-chip--${chip.tone}` : ""}`}>
              {chip.label}
            </li>
          ))}
        </ul>
      </div>

      <div
        className="copilot-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < STICK_TO_BOTTOM_PX;
        }}
      >
        <StatusNotice status={status} onCheck={copilot.checkConnection} />
        {messages.length === 0 && !pending ? (
          <Welcome context={context} canSend={canSend} onAsk={ask} />
        ) : (
          <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
            <ol className="copilot-log">
              {messages.map((message) => (
                <CopilotMessage
                  key={message.id}
                  message={message}
                  latest={message === latestAssistant && message === lastMessage}
                  busy={Boolean(pending)}
                  canSend={canSend}
                  onFollowUp={ask}
                  onRetry={retry}
                />
              ))}
            </ol>
          </div>
        )}
        {pending && <Progress pending={pending} />}
      </div>

      <form
        className="copilot-composer"
        onSubmit={(event) => {
          event.preventDefault();
          ask(draft);
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          Message GreenPulse AI Copilot
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={1}
          value={draft}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={canSend ? "Ask about zones, vegetation or air quality…" : "The Copilot is not available"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={!canSend}
          aria-describedby={hintId}
        />
        {pending ? (
          <button type="button" className="copilot-send copilot-send--stop" onClick={cancel} aria-label="Stop answer" title="Stop">
            <Square size={14} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="copilot-send" disabled={!draft.trim() || !canSend} aria-label="Send question" title="Send">
            <ArrowUp size={17} aria-hidden="true" />
          </button>
        )}
        <p id={hintId} className="copilot-composer__hint">
          <ShieldCheck size={12} aria-hidden="true" />
          <span>
            Sent to Google Gemini with the page context above. Enter to send, Shift+Enter for a new line.
            {remaining < 300 && ` ${remaining} characters left.`}
          </span>
        </p>
      </form>
    </div>
  );
}
