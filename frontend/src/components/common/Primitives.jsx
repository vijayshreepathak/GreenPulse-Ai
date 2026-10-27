import { Component } from "react";
import { AlertCircle, Info, RotateCcw } from "lucide-react";

export function Skeleton({ className = "", label }) {
  return <span className={`skeleton ${className}`.trim()} aria-hidden={label ? undefined : "true"} role={label ? "status" : undefined} aria-label={label} />;
}

export function PageHeader({ eyebrow, title, description, actions, id }) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 id={id} tabIndex={-1}>{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ title, description, actions, as: Heading = "h2", id }) {
  return (
    <div className="section-title">
      <div>
        <Heading id={id}>{title}</Heading>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="section-title__actions">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className = "", as: Element = "section", ...props }) {
  return <Element className={`panel ${className}`.trim()} {...props}>{children}</Element>;
}

export function EmptyState({ title, children, icon: Icon = Info, action }) {
  return (
    <div className="empty-state">
      <Icon size={20} aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
        {action}
      </div>
    </div>
  );
}

export function Alert({ tone = "warning", title, children, action }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <AlertCircle size={18} aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        {children && <div className="alert__body">{children}</div>}
      </div>
      {action && <div className="alert__action">{action}</div>}
    </div>
  );
}

export function SegmentedControl({ label, options, value, onChange, size = "md" }) {
  return (
    <div className={`segmented segmented--${size}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? "is-active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
          title={option.title}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StatTile({ label, value, unit, context, icon: Icon, loading = false, tone, footer }) {
  return (
    <article className={`stat-tile${tone ? ` stat-tile--${tone}` : ""}`}>
      <div className="stat-tile__label">
        {Icon && <Icon size={16} aria-hidden="true" />}
        <span>{label}</span>
      </div>
      {loading ? (
        <Skeleton className="skeleton--value" />
      ) : (
        <p className="stat-tile__value">
          {value}
          {unit && <span className="stat-tile__unit">{unit}</span>}
        </p>
      )}
      {context && <p className="stat-tile__context">{context}</p>}
      {footer}
    </article>
  );
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel">
          <EmptyState
            title={`${this.props.label || "This section"} could not be displayed`}
            icon={AlertCircle}
            action={
              <button className="button button--secondary" type="button" onClick={() => this.setState({ error: null })}>
                <RotateCcw size={15} aria-hidden="true" />
                Try again
              </button>
            }
          >
            The rest of the application remains available.
          </EmptyState>
        </div>
      );
    }
    return this.props.children;
  }
}
