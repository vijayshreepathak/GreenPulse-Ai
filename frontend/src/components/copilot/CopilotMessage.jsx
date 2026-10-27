import { CircleAlert, CircleCheck, Database, OctagonX, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { fallbackReasonText } from "../../lib/copilot";
import { Markdown } from "../../lib/markdown";
import { formatDateTime } from "../../lib/time";

function Sparkline({ visual }) {
  const points = visual.points || [];
  if (points.length < 2) return null;
  const width = 300;
  const height = 104;
  const pad = { left: 14, right: 14, top: 18, bottom: 22 };
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const x = (index) => pad.left + (index / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - min) / span) * (height - pad.top - pad.bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <svg className="copilot-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${visual.title}: ${first.value} in ${first.year} to ${last.value} in ${last.year}`}>
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className="copilot-sparkline__axis" />
      <path d={path} className="copilot-sparkline__line" />
      {points.map((point, index) => (
        <circle key={point.year} cx={x(index)} cy={y(point.value)} r="4" className="copilot-sparkline__dot">
          <title>{`${point.year}: ${point.value}`}</title>
        </circle>
      ))}
      <text x={x(0)} y={y(first.value) - 8} className="copilot-sparkline__value" textAnchor="start">{first.value}</text>
      <text x={x(points.length - 1)} y={y(last.value) - 8} className="copilot-sparkline__value" textAnchor="end">{last.value}</text>
      <text x={x(0)} y={height - 6} className="copilot-sparkline__year" textAnchor="start">{first.year}</text>
      <text x={x(points.length - 1)} y={height - 6} className="copilot-sparkline__year" textAnchor="end">{last.year}</text>
    </svg>
  );
}

function Visual({ visual }) {
  const table =
    visual.type === "series"
      ? { columns: ["Year", visual.unit || "Value"], rows: (visual.points || []).map((point) => [String(point.year), String(point.value)]) }
      : { columns: visual.columns || [], rows: visual.rows || [] };
  const tableView = (
    <div className="copilot-md__table" role="region" aria-label={visual.title} tabIndex={0}>
      <table>
        <thead>
          <tr>{table.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <figure className="copilot-visual">
      <figcaption>
        <strong>{visual.title}</strong>
        <span>{visual.source} · from GreenPulse data</span>
      </figcaption>
      {visual.type === "series" ? (
        <>
          <Sparkline visual={visual} />
          <details className="copilot-disclosure">
            <summary>Show values</summary>
            {tableView}
          </details>
        </>
      ) : (
        tableView
      )}
    </figure>
  );
}

function Sources({ response }) {
  const { evidence = [], tools_used: tools = [], context_notes: notes = [] } = response;
  if (!evidence.length && !tools.length && !notes.length) return null;
  return (
    <div className="copilot-sources">
      {evidence.length > 0 && (
        <ul className="copilot-evidence" aria-label="Sources used">
          {evidence.map((item) => (
            <li key={item.id} className="copilot-chip copilot-chip--source" title={[item.source, item.detail].filter(Boolean).join(" · ")}>
              <Database size={12} aria-hidden="true" />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
      <details className="copilot-disclosure">
        <summary>Source details</summary>
        <ul className="copilot-source-list">
          {evidence.map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong>
              <span>{item.source}</span>
              {item.detail && <span>{item.detail}</span>}
              {item.as_of && <span>Fetched {formatDateTime(item.as_of)}</span>}
            </li>
          ))}
        </ul>
        {tools.length > 0 && (
          <ul className="copilot-tool-list" aria-label="Data tools run on the server">
            {tools.map((tool, index) => (
              <li key={`${tool.name}-${index}`} className={`is-${tool.status}`}>
                {tool.status === "ok" ? <CircleCheck size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
                <span>
                  {tool.label}
                  {tool.status === "error" && " (no data returned)"}
                  {tool.status === "skipped" && ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {notes.length > 0 && <p className="copilot-fineprint">Ignored page context: {notes.join("; ")}.</p>}
      </details>
    </div>
  );
}

export default function CopilotMessage({ message, latest, busy, canSend, onFollowUp, onRetry }) {
  if (message.role === "user") {
    return (
      <li className="copilot-msg copilot-msg--user">
        <p className="copilot-bubble">{message.content}</p>
        {message.chips?.length > 0 && <p className="copilot-msg__context">Asked on {message.chips.map((chip) => chip.label).join(" · ")}</p>}
      </li>
    );
  }

  if (message.role === "error" || message.role === "notice") {
    const Icon = message.role === "error" ? OctagonX : CircleAlert;
    return (
      <li className={`copilot-msg copilot-msg--${message.role}`}>
        <div className="copilot-alert" role={message.role === "error" ? "alert" : undefined}>
          <Icon size={16} aria-hidden="true" />
          <p>
            {message.content}
            {message.diagnostic && <span className="copilot-alert__detail">{message.diagnostic}</span>}
          </p>
          {message.retryable && (
            <button type="button" className="button button--secondary button--sm" onClick={() => onRetry(message)} disabled={busy || !canSend}>
              <RotateCcw size={14} aria-hidden="true" /> Retry
            </button>
          )}
        </div>
      </li>
    );
  }

  const response = message.response || {};
  const facts = response.facts || [];
  const followUps = response.follow_ups || [];
  const unverified = response.verification?.status === "unverified_figures" ? response.verification.unverified : [];
  return (
    <li className="copilot-msg copilot-msg--assistant">
      <span className="copilot-mark copilot-mark--sm" aria-hidden="true">
        <Sparkles size={13} />
      </span>
      <div className="copilot-answer">
        <p className="sr-only">Copilot answered:</p>
        <Markdown text={message.content} />
        {facts.length > 0 && (
          <dl className="copilot-facts" aria-label="Key figures from GreenPulse data">
            {facts.map((fact) => (
              <div key={fact.label} className="copilot-fact">
                <dt>{fact.label}</dt>
                <dd>
                  <span className="copilot-fact__value">{fact.value}</span>
                  {fact.unit && <span className="copilot-fact__unit">{fact.unit}</span>}
                </dd>
                {fact.detail && <dd className="copilot-fact__detail">{fact.detail}</dd>}
              </div>
            ))}
          </dl>
        )}
        {response.visual && <Visual visual={response.visual} />}
        {unverified.length > 0 && (
          <p className="copilot-verify">
            <TriangleAlert size={14} aria-hidden="true" />
            <span>
              Not found in the retrieved data: {unverified.join(", ")}. Check these figures before relying on them.
            </span>
          </p>
        )}
        <Sources response={response} />
        {response.model && (
          <p className="copilot-answer__model">
            Answered by {response.model}
            {response.fallback_used && ` · fallback because the ${fallbackReasonText(response.fallback_reason)}`}
          </p>
        )}
        {latest && followUps.length > 0 && (
          <div className="copilot-followups">
            <p className="copilot-followups__title">Suggested follow-ups</p>
            <ul>
              {followUps.map((question) => (
                <li key={question}>
                  <button type="button" className="copilot-starter copilot-starter--compact" onClick={() => onFollowUp(question)} disabled={busy || !canSend}>
                    {question}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}
