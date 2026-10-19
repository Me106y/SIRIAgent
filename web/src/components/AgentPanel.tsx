import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api";
import type { ChatMessage, MessageBlock, Skill } from "../types";
import { Markdown } from "./Markdown";

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  sessionId?: string;
  onSend: (text: string) => void;
  onReset: () => void;
}

const EXAMPLES = [
  "杭州明天有哪些卫星过境？",
  "GF-2 现在在什么位置？",
  "帮我看看这 111 颗星里，哪些是 SAR。",
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.4l2.7 2.7 6.3-6.2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="tool-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 3.5L10 8l-4.5 4.5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
    </svg>
  );
}

function toolLabel(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
}

function pretty(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function inputSummary(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.replace(/\s+/g, " ").trim();
  if (typeof input !== "object") return String(input);
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length === 0) return "";
  const command = record.command ?? record.cmd;
  if (typeof command === "string" && command.trim()) {
    return `$ ${command.replace(/\s+/g, " ").trim()}`;
  }
  const path = record.path ?? record.file_path ?? record.file;
  if (typeof path === "string") return path;
  const pairs = Object.entries(record)
    .filter(([, value]) => value == null || typeof value !== "object")
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`);
  if (pairs.length > 0) return pairs.join(" · ");
  const json = JSON.stringify(record).replace(/\s+/g, " ");
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

type ToolBlock = Extract<MessageBlock, { kind: "tool" }>;

function ToolRow({ block }: { block: ToolBlock }) {
  const done = block.status === "completed";
  const detail = inputSummary(block.input);
  return (
    <details className={`tool-card ${done ? "done" : "running"}`}>
      <summary>
        <span className={`tool-icon ${done ? "ok" : "running"}`}>
          {done ? <CheckIcon /> : <span className="tool-spinner" />}
        </span>
        <span className="tool-name" title={block.tool}>
          {toolLabel(block.tool)}
        </span>
        {detail ? (
          <span
            className={detail.startsWith("$ ") ? "tool-detail command" : "tool-detail"}
            title={detail}
          >
            {detail}
          </span>
        ) : null}
        <span className="tool-state">{done ? "完成" : "运行中"}</span>
        <ChevronIcon />
      </summary>
      <div className="tool-body">
        {block.input != null && (
          <>
            <div className="tool-label">参数</div>
            <pre>{pretty(block.input)}</pre>
          </>
        )}
        {block.result != null && (
          <>
            <div className="tool-label">结果</div>
            <pre>{pretty(block.result)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function ThinkingRow({ block }: { block: Extract<MessageBlock, { kind: "thinking" }> }) {
  const flat = block.text.replace(/\s+/g, " ").trim();
  const preview = flat.length > 96 ? `${flat.slice(0, 93)}…` : flat;
  return (
    <details className="thinking thinking-row">
      <summary>
        <span className="thinking-mark" aria-hidden="true" />
        <span className="thinking-title">思考</span>
        <span className="thinking-preview" title={flat}>
          {preview}
        </span>
        <ChevronIcon />
      </summary>
      <pre>{block.text}</pre>
    </details>
  );
}

function WorkSteps({
  blocks,
  phase,
  elapsedMs,
}: {
  blocks: MessageBlock[];
  phase: "streaming" | "done" | "error";
  elapsedMs?: number;
}) {
  const finished = phase !== "streaming";
  const [open, setOpen] = useState(!finished);
  const [pinned, setPinned] = useState(false);
  const tools = blocks.filter((block): block is ToolBlock => block.kind === "tool");
  const current = tools[tools.length - 1];

  useEffect(() => {
    if (phase === "error") {
      setOpen(true);
      return;
    }
    if (finished && !pinned) setOpen(false);
  }, [phase, finished, pinned]);

  return (
    <details
      className="work-steps"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        if (finished) setPinned(next);
      }}
    >
      <summary>
        {phase === "streaming" ? (
          <span className="tool-spinner" aria-hidden="true" />
        ) : (
          <span className="work-check" aria-hidden="true">
            <CheckIcon />
          </span>
        )}
        <span className="work-title">工作步骤</span>
        <span className="work-count">
          {blocks.length} 步{tools.length > 0 ? ` · ${tools.length} 个工具` : ""}
        </span>
        {phase === "streaming" && current && (
          <span className="work-current">{toolLabel(current.tool)}</span>
        )}
        {finished && elapsedMs != null && (
          <span className="work-time">{(elapsedMs / 1000).toFixed(1)} s</span>
        )}
        <ChevronIcon />
      </summary>
      <div className="work-body">
        {blocks.map((block) => {
          if (block.kind === "tool") return <ToolRow key={block.id} block={block} />;
          if (block.kind === "thinking") return <ThinkingRow key={block.id} block={block} />;
          return null;
        })}
      </div>
    </details>
  );
}

export function AgentPanel({ messages, busy, sessionId, onSend, onReset }: Props) {
  const [input, setInput] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const filteredSkills = useMemo(() => {
    if (!input.startsWith("/")) return [];
    const query = input.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    return skills.filter(
      (skill) =>
        !query ||
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query),
    );
  }, [input, skills]);

  useEffect(() => {
    let alive = true;
    api
      .skills()
      .then((payload) => {
        if (alive) setSkills(payload.items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 150)}px`;
  }, [input]);

  useEffect(() => {
    if (!slashOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".composer-wrap")) setSlashOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [slashOpen]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    onSend(text);
    setInput("");
    setSlashOpen(false);
  };

  const openSlash = () => {
    const node = inputRef.current;
    const cursor = node?.selectionStart ?? input.length;
    const next = input.slice(0, cursor) + "/" + input.slice(cursor);
    setInput(next);
    setSlashOpen(next.startsWith("/"));
    setSlashIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const chooseSkill = (skill: Skill) => {
    const tail =
      input.startsWith("/") && input.includes(" ")
        ? input.slice(input.indexOf(" ") + 1).trim()
        : "";
    const usage = `请使用 ${skill.name} 技能（读取 ${skill.path}）：${skill.description}。`;
    setInput(tail ? `${usage}\n${tail}` : `${usage}\n`);
    setSlashOpen(false);
    setSlashIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && filteredSkills.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((index) => (index + 1) % filteredSkills.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex(
          (index) => (index - 1 + filteredSkills.length) % filteredSkills.length,
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        chooseSkill(filteredSkills[slashIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section className="agent-panel">
      <div className="agent-head">
        <div>
          <h2>Agent</h2>
          <p>{sessionId ? `会话 · ${sessionId.slice(-8)}` : "新会话"}</p>
        </div>
        <button type="button" className="ghost" onClick={onReset}>
          新会话
        </button>
      </div>

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="welcome">
            <h1>今天想查哪颗卫星？</h1>
            <p>查询位置、过境窗口与任务可行性，也可以直接描述你的需求。</p>
            <div className="examples">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="chip"
                  onClick={() => setInput(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          const blocks = message.blocks ?? [];
          const phase = message.phase ?? "done";
          const work = blocks.filter(
            (block) => block.kind === "thinking" || block.kind === "tool",
          );
          const texts = blocks.filter((block) => block.kind === "text");
          const notices = blocks.filter((block) => block.kind === "notice");
          const loading =
            message.role === "assistant" && phase === "streaming" && texts.length === 0;

          const renderLive = (block: MessageBlock) => {
            if (block.kind === "tool") return <ToolRow key={block.id} block={block} />;
            if (block.kind === "thinking") {
              return <ThinkingRow key={block.id} block={block} />;
            }
            if (block.kind === "notice") {
              return (
                <div className="stream-notice" key={block.id}>
                  {block.text}
                </div>
              );
            }
            return (
              <div
                className={message.error ? "bubble error" : "bubble markdown-bubble"}
                key={block.id}
              >
                <Markdown text={block.text} />
              </div>
            );
          };

          return (
            <article key={message.id} className={`message ${message.role}`}>
              <div className="who">{message.role === "user" ? "你" : "SIRIAgent"}</div>
              {message.role === "user" ? (
                <div className="bubble">{message.text}</div>
              ) : (
                <div className="timeline">
                  {phase === "streaming" ? (
                    <>
                      {blocks.map(renderLive)}
                      {loading && (
                        <div className="assistant-loading" aria-live="polite">
                          <span className="thinking-dots" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                          {blocks.length > 0 ? "正在整理结果" : "正在思考"}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {work.length > 0 && (
                        <WorkSteps
                          blocks={work}
                          phase={phase}
                          elapsedMs={message.elapsed_ms}
                        />
                      )}
                      {texts.map((block) => (
                        <div
                          className={
                            message.error ? "bubble error" : "bubble markdown-bubble"
                          }
                          key={block.id}
                        >
                          <Markdown text={block.text} />
                        </div>
                      ))}
                      {notices.map((block) => (
                        <div className="stream-notice" key={block.id}>
                          {block.text}
                        </div>
                      ))}
                      {blocks.length === 0 && (
                        <div className="bubble markdown-bubble">
                          {message.text ? <Markdown text={message.text} /> : "…"}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {(message.usage || message.elapsed_ms) && (
                <div className="meta">
                  {message.elapsed_ms != null && (
                    <span>{(message.elapsed_ms / 1000).toFixed(1)} s</span>
                  )}
                  {message.usage?.total_tokens != null && (
                    <span>{message.usage.total_tokens} tokens</span>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="composer-wrap">
          {slashOpen && filteredSkills.length > 0 && (
            <div className="slash-menu" role="listbox" aria-label="技能">
              <div className="slash-head">
                <span>调用技能</span>
                <span>↑↓ 选择 · Enter 使用 · Esc 关闭</span>
              </div>
              {filteredSkills.map((skill, index) => (
                <button
                  key={skill.name}
                  type="button"
                  role="option"
                  aria-selected={index === slashIndex}
                  className={index === slashIndex ? "slash-item active" : "slash-item"}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSlashIndex(index)}
                  onClick={() => chooseSkill(skill)}
                >
                  <span className="slash-name">/{skill.name}</span>
                  <span className="slash-desc">{skill.description}</span>
                </button>
              ))}
            </div>
          )}
          <div className="composer-box">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => {
                const value = event.target.value;
                setInput(value);
                const menu = value.startsWith("/") && !value.includes("\n");
                setSlashOpen(menu);
                if (menu) setSlashIndex(0);
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="输入消息，或输入 / 调用技能"
              aria-label="输入消息"
            />
            <div className="composer-bar">
              <button
                type="button"
                className={slashOpen ? "composer-tool active" : "composer-tool"}
                onClick={openSlash}
                aria-expanded={slashOpen}
                title="调用技能"
              >
                /
              </button>
              <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
              <button
                type="submit"
                className="send"
                disabled={busy || !input.trim()}
                aria-label="发送"
                title="发送"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
