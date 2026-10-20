import { useState } from "react";

import { MapDrawModal } from "./MapDrawModal";
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
  onRevise?: (text: string) => void;
}

export function QuestionCard({ block, interactive = true, onAnswer, onRevise }: Props) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revising, setRevising] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [revisedAnswers, setRevisedAnswers] = useState<QuestionAnswer[] | null>(null);

  const answered = revisedAnswers ?? block.answers;
  const total = block.questions.length;

  const startRevise = () => {
    const nextSelected: Record<string, string[]> = {};
    const nextCustom: Record<string, string> = {};
    for (const answer of block.answers ?? []) {
      nextSelected[answer.id] = answer.selected ?? [];
      if (answer.custom) nextCustom[answer.id] = answer.custom;
    }
    setSelected(nextSelected);
    setCustom(nextCustom);
    setStep(0);
    setRevising(true);
  };

  if (answered && !revising) {
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
        {onRevise && !revising && (
          <button type="button" className="question-back" onClick={startRevise}>
            修改
          </button>
        )}
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

  if (total === 0) return null;

  const index = Math.min(step, total - 1);
  const question = block.questions[index];
  const multi = Boolean(question.multiSelect ?? question.multi_select);
  const picked = selected[question.id] ?? [];
  const text = custom[question.id] ?? "";
  const ready = picked.length > 0 || Boolean(text.trim());
  const isLast = index >= total - 1;
  const areaQuestion = /aoi|范围|地区|城市|区域|覆盖哪里|目标范围/i.test(
    `${question.id} ${question.header ?? ""} ${question.question}`,
  );

  const toggle = (label: string) => {
    setSelected((current) => {
      const currentPicked = current[question.id] ?? [];
      if (!multi) {
        const next = currentPicked[0] === label ? [] : [label];
        if (next.length > 0) {
          setCustom((values) => ({ ...values, [question.id]: "" }));
        }
        return { ...current, [question.id]: next };
      }
      return {
        ...current,
        [question.id]: currentPicked.includes(label)
          ? currentPicked.filter((item) => item !== label)
          : [...currentPicked, label],
      };
    });
  };

  const submitAll = async () => {
    const answers: QuestionAnswer[] = block.questions.map((item) => {
      const freeText = custom[item.id]?.trim();
      return {
        id: item.id,
        selected: selected[item.id] ?? [],
        ...(freeText ? { custom: freeText } : {}),
      };
    });
    if (revising) {
      const text =
        "更正上一轮的选择：" +
        block.questions
          .map((item, index) => {
            const answer = answers[index];
            const value = [...answer.selected, ...(answer.custom ? [answer.custom] : [])].join("、");
            return `${item.question} ${value || "—"}`;
          })
          .join("；") +
        "。请据此重新计算。";
      onRevise?.(text);
      setRevisedAnswers(answers);
      setRevising(false);
      return;
    }
    setSending(true);
    const ok = await onAnswer(block.id, block.callId, answers);
    setSending(false);
    if (!ok) setFailed(true);
  };

  const advance = () => {
    if (!ready || sending) return;
    if (isLast) {
      void submitAll();
      return;
    }
    setStep(index + 1);
  };

  return (
    <div
      className="question-card"
      role="group"
      aria-label={`需要你确认，第 ${index + 1} 个问题，共 ${total} 个`}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          advance();
        }
      }}
    >
      <div className="question-head">
        <span>需要你确认</span>
        <span className="question-progress">
          {index + 1} / {total}
        </span>
      </div>

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
                onClick={() => toggle(option.label)}
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
        value={text}
        onChange={(event) => {
          const value = event.target.value;
          setCustom((current) => ({ ...current, [question.id]: value }));
          if (!multi && value.trim()) {
            setSelected((current) => ({ ...current, [question.id]: [] }));
          }
        }}
        placeholder={question.options?.length ? "其他（可选，直接输入）" : "请输入"}
      />

      {areaQuestion && (
        <button
          type="button"
          className="question-draw"
          onClick={() => setDrawOpen(true)}
        >
          在地图上绘制
        </button>
      )}

      {failed && <div className="question-error">提交失败，请重试</div>}

      <div className="question-nav">
        {index > 0 && (
          <button
            type="button"
            className="question-back"
            onClick={() => setStep(index - 1)}
            disabled={sending}
          >
            上一步
          </button>
        )}
        <button
          type="button"
          className="question-submit"
          onClick={advance}
          disabled={!ready || sending}
        >
          {sending ? "提交中…" : isLast ? (revising ? "重新提交" : "提交") : "下一步"}
        </button>
      </div>

      <MapDrawModal
        open={drawOpen}
        onClose={() => setDrawOpen(false)}
        initialWkt={custom[question.id] ?? ""}
        onComplete={(wkt) => {
          setCustom((current) => ({ ...current, [question.id]: wkt }));
          if (!multi) {
            setSelected((current) => ({ ...current, [question.id]: [] }));
          }
          setDrawOpen(false);
        }}
      />
    </div>
  );
}
