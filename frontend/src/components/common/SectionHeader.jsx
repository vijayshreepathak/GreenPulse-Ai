export default function SectionHeader({ eyebrow, title, description, action, id }) {
  return (
    <header className="section-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
        {description && <p className="section-description">{description}</p>}
      </div>
      {action && <div className="section-header__action">{action}</div>}
    </header>
  );
}
