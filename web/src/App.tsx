import { useCallback, useEffect, useMemo, useState } from "react";

import { api, chat, streamChat } from "./api";
import { AgentPanel } from "./components/AgentPanel";
import { Globe } from "./components/Globe";
import { SatellitePanel } from "./components/SatellitePanel";
import type {
  Balance,
  ChatMessage,
  PassItem,
  PositionItem,
  Satellite,
  TrackPoint,
} from "./types";

export default function App() {
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const [positions, setPositions] = useState<Record<number, PositionItem>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [passes, setPasses] = useState<PassItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swathKm, setSwathKm] = useState<number | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [hangzhouToken, setHangzhouToken] = useState(0);
  const [hangzhouPolygon, setHangzhouPolygon] = useState<number[][] | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .satellites()
      .then((payload) => {
        if (!alive) return;
        setSatellites(payload.items);
        const preferred =
          payload.items.find((item) => item.norad === 40118) || payload.items[0];
        if (preferred) setSelected((current) => current ?? preferred.norad);
      })
      .catch((exc: Error) => alive && setError(`卫星目录加载失败：${exc.message}`));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .hangzhouBoundary()
      .then((payload) => {
        if (!alive) return;
        setHangzhouPolygon(payload.features[0]?.geometry.coordinates[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async (refresh = false) => {
      try {
        const payload = await api.balance(refresh);
        if (alive) setBalance(payload);
      } catch {
        if (alive) setBalance({ ok: false, error: "unreachable" });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      api
        .positions()
        .then((payload) => {
          if (!alive) return;
          const next: Record<number, PositionItem> = {};
          payload.items.forEach((item) => {
            next[item.norad] = item;
          });
          setPositions(next);
          setError(null);
        })
        .catch((exc: Error) => {
          if (alive) setError(`星历服务不可达：${exc.message}`);
        });
    };
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (selected == null) {
      setTrack([]);
      setPasses([]);
      return;
    }
    let alive = true;
    Promise.all([api.track(selected), api.passes(selected)])
      .then(([trackPayload, passPayload]) => {
        if (!alive) return;
        setTrack(trackPayload.points);
        setPasses(passPayload.passes);
      })
      .catch(() => {
        if (!alive) return;
        setTrack([]);
        setPasses([]);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  useEffect(() => {
    if (selected == null) {
      setSwathKm(null);
      return;
    }
    let alive = true;
    api
      .satellite(selected)
      .then((detail) => {
        if (alive) setSwathKm(detail.sensor?.swath_km ?? null);
      })
      .catch(() => {
        if (alive) setSwathKm(null);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  const selectedAge = useMemo(() => {
    if (selected == null) return null;
    return positions[selected]?.tle_age_hours ?? null;
  }, [selected, positions]);

  const selectedPosition = selected != null ? positions[selected] : undefined;
  const send = useCallback(
    async (text: string) => {
      const assistantId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", text },
        { id: assistantId, role: "assistant", text: "" },
      ]);
      setBusy(true);
      setError(null);

      const update = (patch: Partial<ChatMessage>) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, ...patch } : message,
          ),
        );
      };

      try {
        await streamChat(text, sessionId, (event) => {
          switch (event.type) {
            case "session":
              setSessionId(event.session_id);
              break;
            case "text":
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        text: event.replace ? event.text : message.text + event.text,
                      }
                    : message,
                ),
              );
              break;
            case "reasoning":
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, thinking: (message.thinking || "") + event.text }
                    : message,
                ),
              );
              break;
            case "tool_call":
              setMessages((current) =>
                current.map((message) => {
                  if (message.id !== assistantId) return message;
                  const tools = message.tools ? [...message.tools] : [];
                  if (tools.some((tool) => tool.callId === event.callId)) {
                    return message;
                  }
                  return {
                    ...message,
                    tools: [
                      ...tools,
                      {
                        callId: event.callId,
                        tool: event.tool,
                        input: event.input,
                        status: "running",
                      },
                    ],
                  };
                }),
              );
              break;
            case "tool_result":
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        tools: (message.tools || []).map((tool) =>
                          tool.callId === event.callId
                            ? { ...tool, status: event.status, result: event.result }
                            : tool,
                        ),
                      }
                    : message,
                ),
              );
              break;
            case "done":
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        text: event.text || message.text || "（没有文本）",
                        elapsed_ms: event.elapsed_ms,
                      }
                    : message,
                ),
              );
              if (event.session_id) setSessionId(event.session_id);
              break;
            case "error":
              update({ text: event.message, error: true });
              break;
            default:
              break;
          }
        });
      } catch (streamError) {
        try {
          const response = await chat(text, sessionId);
          if (!response.ok) throw new Error(response.error || "DSH 没有返回结果。");
          if (response.session_id) setSessionId(response.session_id);
          update({
            text: response.text || "（没有文本）",
            thinking: response.thinking || undefined,
            tools: response.tool_calls || [],
            usage: response.usage || null,
            elapsed_ms: response.elapsed_ms,
          });
        } catch (fallbackError) {
          const message =
            fallbackError instanceof Error ? fallbackError.message : "请求失败";
          update({
            text:
              streamError instanceof Error
                ? `${streamError.message}；回退失败：${message}`
                : message,
            error: true,
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );
  const reset = useCallback(() => {
    setMessages([]);
    setSessionId(undefined);
    setError(null);
  }, []);

  const balanceValue = Number(balance?.total);
  const balanceLabel = balance?.ok
    ? `${balance.currency === "USD" ? "$" : "¥"}${
        Number.isFinite(balanceValue) ? balanceValue.toFixed(2) : "—"
      }`
    : balance
      ? "余额 —"
      : "余额 …";
  const balanceTitle = balance?.ok
    ? `赠送 ${balance.granted ?? "—"} · 充值 ${balance.topped_up ?? "—"} · 点击刷新`
    : "API 余额不可用";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img
            className="brand-logo"
            src="/logo-96.png"
            srcSet="/logo-96.png 1x, /logo-192.png 2x"
            alt=""
          />
          <div>
            <strong>SIRIAgent</strong>
            <small>遥感任务与星历服务</small>
          </div>
        </div>
        <div className="top-meta">
          <button
            type="button"
            className={`balance-pill ${balance?.ok ? "ok" : ""}`}
            title={balanceTitle}
            onClick={() => {
              setBalance(null);
              api
                .balance(true)
                .then(setBalance)
                .catch(() => setBalance({ ok: false, error: "unreachable" }));
            }}
          >
            <span className="dot" />
            API 余额 <strong>{balanceLabel}</strong>
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <main className="layout">
        <div className="left-col">
          <div className="globe-card">
            <Globe
              positions={Object.values(positions)}
              selected={selected}
              track={track}
              onSelect={setSelected}
              footprintLat={selectedPosition?.lat ?? null}
              footprintLon={selectedPosition?.lon ?? null}
              footprintRadiusKm={swathKm != null ? swathKm / 2 : null}
              focusToken={focusToken}
              hangzhouToken={hangzhouToken}
              hangzhouPolygon={hangzhouPolygon}
            />
            <div className="globe-caption">
              <span>
                111 颗国产卫星 · 5 s 刷新
                {swathKm != null ? ` · 足迹 ${swathKm.toFixed(0)} km` : ""}
              </span>
              <span>{track.length > 0 ? "轨迹：选中星 2h" : "点击卫星查看轨迹"}</span>
            </div>
          </div>
          <SatellitePanel
            satellites={satellites}
            positions={positions}
            selected={selected}
            passes={passes}
            tleAge={selectedAge}
            onSelect={setSelected}
            onFocus={() => setFocusToken((value) => value + 1)}
            onHangzhou={() => setHangzhouToken((value) => value + 1)}
          />
        </div>
        <AgentPanel
          messages={messages}
          busy={busy}
          sessionId={sessionId}
          onSend={send}
          onReset={reset}
        />
      </main>
    </div>
  );
}
