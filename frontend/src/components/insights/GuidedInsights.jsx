import { useId, useMemo, useState } from "react";
import { ArrowRight, Bot, CircleSlash } from "lucide-react";
import { answerQuestion, QUESTIONS } from "../../lib/assistant";
import Badge from "../common/Badge";

export default function GuidedInsights({ context, onOpenZone }) {
  const [questionId, setQuestionId] = useState(QUESTIONS[0].id);
  const answerId = useId();
  const answer = useMemo(() => answerQuestion(questionId, context), [questionId, context]);

  return (
    <div className="assistant">
      <div className="assistant__questions" role="group" aria-label="Questions">
        {QUESTIONS.map((question) => (
          <button
            key={question.id}
            type="button"
            className={`assistant__question${question.id === questionId ? " is-active" : ""}`}
            aria-pressed={question.id === questionId}
            aria-controls={answerId}
            onClick={() => setQuestionId(question.id)}
          >
            {question.text}
          </button>
        ))}
      </div>
      <article className="assistant__answer" id={answerId} aria-live="polite">
        <header>
          <Badge tone="neutral" icon={Bot}>Rule-based answer</Badge>
          <h3>{answer.title}</h3>
        </header>
        {answer.status === "unavailable" && (
          <p className="assistant__unavailable"><CircleSlash size={16} aria-hidden="true" />{answer.summary}</p>
        )}
        {answer.status !== "unavailable" && <p className="assistant__summary">{answer.summary}</p>}
        {answer.points.length > 0 && (
          <ul className="assistant__points">
            {answer.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        )}
        {answer.evidence.length > 0 && (
          <dl className="assistant__evidence">
            {answer.evidence.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {answer.zoneId && onOpenZone && (
          <button type="button" className="button button--link" onClick={() => onOpenZone(answer.zoneId)}>
            Show this zone on the map <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
        <p className="fine-print">Assembled from the loaded datasets and documented methodology by fixed rules. This is not a generative AI model or a trained agent.</p>
      </article>
    </div>
  );
}
