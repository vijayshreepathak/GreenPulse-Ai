import { AlertTriangle, CircleCheck, CircleDot, CircleHelp, OctagonAlert } from "lucide-react";
import { priorityTone } from "../../lib/constants";

export default function Badge({ children, tone = "neutral", icon: Icon, className = "" }) {
  return (
    <span className={`badge badge--${tone} ${className}`.trim()}>
      {Icon && <Icon size={13} aria-hidden="true" />}
      {children}
    </span>
  );
}

const PRIORITY_ICONS = { low: CircleCheck, moderate: CircleDot, high: AlertTriangle, urgent: OctagonAlert, neutral: CircleHelp };

/** Priority class badge: status colour is always paired with an icon and the class name. */
export function PriorityBadge({ priorityClass }) {
  const tone = priorityTone(priorityClass);
  return (
    <Badge tone={tone} icon={PRIORITY_ICONS[tone]} className="badge--priority">
      {priorityClass || "Unavailable"}
    </Badge>
  );
}
