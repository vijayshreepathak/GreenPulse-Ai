import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cancelAiChat, getAiProgress, getAiStatus, isAbortError, postAiChat } from "../api";
import { buildCopilotContext, contextChips, createRequestId, describeAiError, historyForRequest, MAX_MESSAGE_CHARS } from "../lib/copilot";
import { usePreferences } from "./PreferencesContext";

const CopilotContext = createContext(null);
const ReportContext = createContext(() => {});

const POLL_INTERVAL_MS = 600;
const FIRST_POLL_MS = 250;

let idCounter = 0;
const nextId = (prefix) => `${prefix}-${(idCounter += 1)}`;

/**
 * Conversation state for the GreenPulse AI Copilot. Kept in memory only (never in browser storage),
 * bounded by the server's history limit, and discarded on New chat / Clear chat or page reload.
 * While the assistant is disabled no page context is collected and no request is sent.
 */
export function CopilotProvider({ appContext, zoneNames, children }) {
  const { preferences, updatePreference } = usePreferences();
  const enabled = preferences.aiAssistant;
  const [status, setStatus] = useState({ state: "idle", data: null, checking: false });
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(null);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(false);
  const [viewContext, setViewContext] = useState({});
  const active = useRef(null);

  const context = enabled ? buildCopilotContext({ ...appContext, viewContext }) : null;
  const chips = contextChips(context, zoneNames);
  const limits = status.data?.limits;
  const launcherVisible = enabled && status.data?.enabled !== false;
  // Unknown status (still loading, or the API is unreachable) does not block a question; the
  // request then reports the real problem. A server that says it is unavailable does.
  const canSend = enabled && !(status.data && !status.data.available);

  const latest = useRef({});
  useLayoutEffect(() => {
    latest.current = {
      enabled,
      open,
      messages,
      context,
      zoneNames,
      canSend,
      maxHistory: limits?.max_history_messages ?? 12,
      timeoutMs: ((limits?.timeout_seconds ?? 30) + 20) * 1000,
    };
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    getAiStatus({ signal: controller.signal })
      .then((data) => setStatus({ state: "ready", data, checking: false }))
      .catch((error) => {
        if (!isAbortError(error)) setStatus({ state: "error", data: null, checking: false });
      });
    return () => controller.abort();
  }, [enabled]);

  // The server updates its provider status after every answer or provider error; mirror it so the
  // header dot and Settings never show "connected" after a rejected key, or vice versa.
  const refreshStatus = useCallback(() => {
    getAiStatus()
      .then((data) => setStatus((current) => ({ ...current, state: "ready", data })))
      .catch(() => {});
  }, []);

  const finishRun = useCallback((run) => {
    window.clearTimeout(run.pollTimer);
    run.pollController.abort();
    if (active.current === run) {
      active.current = null;
      setPending(null);
    }
  }, []);

  const schedulePoll = useCallback((run) => {
    const tick = async () => {
      if (active.current !== run) return;
      try {
        const progress = await getAiProgress(run.requestId, { signal: run.pollController.signal });
        if (active.current === run && !progress.done) {
          setPending((current) => (current?.requestId === run.requestId ? { ...current, label: progress.label, steps: progress.steps || [] } : current));
        }
      } catch {
        // Not registered yet, already finished, or offline: keep the last real state.
      }
      if (active.current === run) run.pollTimer = window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    run.pollTimer = window.setTimeout(tick, FIRST_POLL_MS);
  }, []);

  /** Stop the running request. `silent` drops it without a "stopped" note (new chat, disable). */
  const stopActive = useCallback(
    ({ silent = false } = {}) => {
      const run = active.current;
      if (!run) return;
      if (silent) finishRun(run);
      run.controller.abort();
      cancelAiChat(run.requestId).catch(() => {});
    },
    [finishRun]
  );

  useEffect(() => () => stopActive({ silent: true }), [stopActive]);

  const send = useCallback(
    async (text, { retryOf = null } = {}) => {
      const state = latest.current;
      const question = String(text ?? "").trim();
      if (!question || question.length > MAX_MESSAGE_CHARS || !state.enabled || !state.canSend || active.current) return false;

      let history;
      let userMessageId;
      if (retryOf) {
        userMessageId = retryOf.userMessageId;
        const index = state.messages.findIndex((message) => message.id === userMessageId);
        history = historyForRequest(index >= 0 ? state.messages.slice(0, index) : state.messages, state.maxHistory);
        setMessages((current) => current.filter((message) => message.id !== retryOf.id));
      } else {
        userMessageId = nextId("user");
        history = historyForRequest(state.messages, state.maxHistory);
        const userMessage = { id: userMessageId, role: "user", content: question, chips: contextChips(state.context, state.zoneNames) };
        setMessages((current) => [...current, userMessage]);
      }

      const run = { requestId: createRequestId(), controller: new AbortController(), pollController: new AbortController(), pollTimer: null };
      active.current = run;
      setPending({ requestId: run.requestId, label: "Preparing context", steps: [] });
      schedulePoll(run);
      try {
        const response = await postAiChat(
          { request_id: run.requestId, message: question, history, context: state.context },
          { signal: run.controller.signal, timeoutMs: state.timeoutMs }
        );
        if (active.current !== run) return true; // superseded: new chat, disabled or unmounted
        setMessages((current) => [...current, { id: nextId("assistant"), role: "assistant", content: response.answer, response }]);
        if (!latest.current.open) setUnread(true);
        refreshStatus();
      } catch (error) {
        if (active.current !== run) return true;
        if (isAbortError(error)) {
          setMessages((current) => [...current, { id: nextId("notice"), role: "notice", content: "You stopped this answer.", question, userMessageId, retryable: true }]);
        } else {
          const info = describeAiError(error);
          setMessages((current) => [...current, { id: nextId("error"), role: "error", content: info.message, diagnostic: info.diagnostic, category: info.category, retryable: info.retryable, question, userMessageId }]);
          refreshStatus();
        }
      } finally {
        finishRun(run);
      }
      return true;
    },
    [finishRun, schedulePoll, refreshStatus]
  );

  const retry = useCallback((message) => send(message.question, { retryOf: message }), [send]);
  const cancel = useCallback(() => stopActive(), [stopActive]);

  const newChat = useCallback(() => {
    stopActive({ silent: true });
    setMessages([]);
    setUnread(false);
  }, [stopActive]);

  const clearChat = useCallback(() => {
    newChat();
    setDraft("");
  }, [newChat]);

  const setEnabled = useCallback(
    (value) => {
      if (!value) {
        stopActive({ silent: true });
        setOpen(false);
        setUnread(false);
        setViewContext({});
      }
      updatePreference("aiAssistant", Boolean(value));
    },
    [stopActive, updatePreference]
  );

  const checkConnection = useCallback(() => {
    setStatus((current) => ({ ...current, checking: true }));
    return getAiStatus({ verify: true })
      .then((data) => setStatus({ state: "ready", data, checking: false }))
      .catch(() => setStatus({ state: "error", data: null, checking: false }));
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    setUnread(false);
  }, []);
  const closePanel = useCallback(() => setOpen(false), []);

  const report = useCallback((key, value) => {
    if (!latest.current.enabled) return;
    setViewContext((current) => {
      if (value === null) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      if (JSON.stringify(current[key]) === JSON.stringify(value)) return current;
      return { ...current, [key]: value };
    });
  }, []);

  const value = {
    enabled,
    setEnabled,
    status,
    checkConnection,
    launcherVisible,
    canSend,
    open,
    openPanel,
    closePanel,
    messages,
    pending,
    draft,
    setDraft,
    send,
    retry,
    cancel,
    newChat,
    clearChat,
    unread,
    context,
    chips,
  };

  return (
    <ReportContext.Provider value={report}>
      <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>
    </ReportContext.Provider>
  );
}

export function useCopilot() {
  const context = useContext(CopilotContext);
  if (!context) throw new Error("useCopilot must be used inside CopilotProvider");
  return context;
}

/** Lets a view share its local settings (e.g. the trend dataset) as Copilot page context. */
export function useCopilotViewContext(key, value) {
  const report = useContext(ReportContext);
  const serialized = JSON.stringify(value ?? null);
  useEffect(() => {
    report(key, JSON.parse(serialized));
    return () => report(key, null);
  }, [report, key, serialized]);
}
