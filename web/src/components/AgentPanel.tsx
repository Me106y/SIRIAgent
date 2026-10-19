import { useEffect, useRef, useState } from "react";

import type { ChatMessage } from "../types";

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

export function AgentPanel({ messages, busy, sessionId, onSend, onReset }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    onSend(text);
    setInput("");
  };

  return (
    <section className="agent-panel">
      <div className="agent-head">
        <div>
          <h2>Agent</h2>
          <p>
            DSH · headless
            {sessionId ? ` · ${sessionId.slice(-8)}` : " · 新会话"}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onReset}>
          新会话
        </button>
      </div>

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="welcome">
            <p className="eyebrow">PHASE 2 · AGENT</p>
            <h1>问点什么</h1>
            <p>
              右栏不限制话题。星历、过境、覆盖类问题会走 MCP 查 RS-Service；
              其他问题由 Agent 直接回答。
            </p>
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

        {messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <div className="who">{message.role === "user" ? "你" : "SIRIAgent"}</div>
            <div className={message.error ? "bubble error" : "bubble"}>
              {message.text || (message.role === "assistant" ? "…" : "")}
            </div>
            {message.tools && message.tools.length > 0 && (
              <div className="tool-list">
                {message.tools.map((tool) => (
                  <details className="tool-card" key={tool.callId}>
                    <summary>
                      <span
                        className={
                          tool.status === "completed"
                            ? "tool-status ok"
                            : "tool-status"
                        }
                      />
                      {tool.tool}
                    </summary>
                    {tool.input != null && (
                      <pre>{JSON.stringify(tool.input, null, 2)}</pre>
                    )}
                    {tool.result != null && (
                      <pre>
                        {typeof tool.result === "string"
                          ? tool.result
                          : JSON.stringify(tool.result, null, 2)}
                      </pre>
                    )}
                  </details>
                ))}
              </div>
            )}
            {message.thinking && (
              <details className="thinking">
                <summary>思考过程</summary>
                <pre>{message.thinking}</pre>
              </details>
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
        ))}

        {busy && (
          <article className="message assistant">
            <div className="who">SIRIAgent</div>
            <div className="bubble pending">
              <span className="spinner" />
              正在调用 DSH…
            </div>
          </article>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        />
        <button type="submit" className="send" disabled={busy || !input.trim()}>
          发送
        </button>
      </form>
    </section>
  );
}
