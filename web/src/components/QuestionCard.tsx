import { useState } from "react";

import type { MessageBlock, QuestionAnswer } from "../types";

type QuestionBlock = Extract<MessageBlock, { kind: "question" }>;

interface Props {
  block: QuestionBlock;
  interactive?: boolean;
  onAnswer: (
    blockId: string,
    callId: string,
    answers: QuestionAnswer[],
  ) => Promise<boolean>;
}

export function QuestionCard({ block, interactive = true, onAnswer }: Props) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const answered = block.answers;
  const isMulti = (questionId: string) => {
    const question = block.questions.find((item) => item.id === questionId);
    return Boolean(question?.multiSelect ?? question?.multi_select);
  };

  const toggle = (questionId: string, label: string) => {
    setSelected((current) => {
      const picked = current[questionId] ?? [];
      const multi = isMulti(questionId);
      if (!multi) {
        return { ...current, [questionId]: picked[0] === label ? [] : [label] };
      }
      return {
        ...current,
        [questionId]: picked.includes(label)
          ? picked.filter((item) => item !== label)
          : [...picked, label],
      };
    });
  };

  const ready = block.questions.every(
    (question) =>
      (selected[question.id]?.length ?? 0) > 0 ||
      Boolean(custom[question.id]?.trim()),
  );

  const submit = async () => {
    const answers: QuestionAnswer[] = block.questions.map((question) => {
      const text = custom[question.id]?.trim();
      return {
        id: question.id,
        selected: selected[question.id] ?? [],
        ...(text ? { custom: text } : {}),
      };
    });
    setSending(true);
    const ok = await onAnswer(block.id, block.callId, answers);
    setSending(false);
    if (!ok) setFailed(true);
  };

  if (answered) {
    return (
      <div className="question-card answered">
        <div className="question-head">已提交选择</div>
        {block.questions.map((question) => {
          const answer = answered.find((item) => item.id === question.id);
          const labels = [
            ...(answer?.selected ?? []),
            ...(answer?.custom ? [answer.custom] : []),
          ];
          return (
            <div className="question-line" key={question.id}>
              <span>{question.question}</span>
              <strong>{labels.join("、") || "—"}</strong>
            </div>
          );
        })}
      </div>
    );
  }

  if (!interactive) {
    return (
      <div className="question-card expired">
        <div className="question-head">问题未回答</div>
        {block.questions.map((question) => (
          <div className="question-line" key={question.id}>
            <span>{question.question}</span>
            <strong>—</strong>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="question-card" role="group" aria-label="需要你的选择">
      <div className="question-head">需要你确认</div>
      {block.questions.map((question) => {
        const picked = selected[question.id] ?? [];
        const multi = question.multiSelect ?? question.multi_select;
        return (
          <div className="question-item" key={question.id}>
            {question.header && <div className="question-header">{question.header}</div>}
            <div className="question-text">{question.question}</div>
            {question.detail && <div className="question-detail">{question.detail}</div>}
            {question.options && question.options.length > 0 && (
              <div className="question-options">
                {question.options.map((option) => {
                  const active = picked.includes(option.label);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      role={multi ? "checkbox" : "radio"}
                      aria-checked={active}
                      className={active ? "question-option active" : "question-option"}
                      onClick={() => toggle(question.id, option.label)}
                    >
                      <span className="question-option-label">{option.label}</span>
                      {option.description && (
                        <span className="question-option-desc">{option.description}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              className="question-custom"
              value={custom[question.id] ?? ""}
              onChange={(event) =>
                setCustom((current) => ({
                  ...current,
                  [question.id]: event.target.value,
                }))
              }
              placeholder="其他（可选，直接输入）"
            />
          </div>
        );
      })}
      {failed && <div className="question-error">提交失败，请重试</div>}
      <button
        type="button"
        className="question-submit"
        onClick={() => void submit()}
        disabled={!ready || sending}
      >
        {sending ? "提交中…" : "提交选择"}
      </button>
    </div>
  );
}
