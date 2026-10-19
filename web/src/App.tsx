import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { answerQuestion, api, chat, streamChat } from "./api";
import { readCatalogCache, writeCatalogCache } from "./lib/catalogCache";
import { AgentPanel } from "./components/AgentPanel";
import { Globe } from "./components/Globe";
import { SatellitePanel } from "./components/SatellitePanel";
import type {
  Balance,
  ChatMessage,
  MessageBlock,
  PassItem,
  PositionItem,
  QuestionAnswer,
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
  const [swathKm, setSwathKm] = useState<number | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [hangzhouToken, setHangzhouToken] = useState(0);
  const [hangzhouPolygon, setHangzhouPolygon] = useState<number[][] | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [bootDone, setBootDone] = useState(false);

  const bootRef = useRef<"pending" | "ok" | "failed">("pending");
  const positionsInFlight = useRef(false);

  const applyCatalog = useCallback((items: Satellite[]) => {
    setSatellites(items);
    const preferred = items.find((item) => item.norad === 40118) || items[0];
    if (preferred) setSelected((current) => current ?? preferred.norad);
  }, []);

  const loadSatellites = useCallback(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await api.satellites();
        applyCatalog(payload.items);
        writeCatalogCache(payload.items);
        return;
      } catch (exc) {
        if (attempt === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
          continue;
        }
        console.warn("satellite catalog unavailable", exc);
      }
    }
  }, [applyCatalog]);

  const loadBalance = useCallback(async (refresh = false) => {
    try {
      setBalance(await api.balance(refresh));
    } catch {
      setBalance({ ok: false, error: "unreachable" });
    }
  }, []);

  const loadPositions = useCallback(async () => {
    if (positionsInFlight.current) return;
    positionsInFlight.current = true;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const payload = await api.positions();
          const next: Record<number, PositionItem> = {};
          payload.items.forEach((item) => {
            next[item.norad] = item;
          });
          setPositions(next);
          return;
        } catch (exc) {
          if (attempt === 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 350));
            continue;
          }
          // 后台轮询失败保持上一帧星历，不打断界面。
          console.warn("positions poll unavailable", exc);
        }
      }
    } finally {
      positionsInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const cached = readCatalogCache();
    if (cached) applyCatalog(cached);

    // 目录/星历到位后再放 Cesium 进来，避免 1.7 MB 把 bootstrap 挤到十几秒。
    const safety = window.setTimeout(() => {
      if (alive) setBootDone(true);
    }, 6000);

    const load = async () => {
      try {
        const payload = await api.bootstrap();
        if (!alive) return;
        applyCatalog(payload.satellites.items);
        writeCatalogCache(payload.satellites.items);
        const next: Record<number, PositionItem> = {};
        payload.positions.items.forEach((item) => {
          next[item.norad] = item;
        });
        setPositions(next);
        setBalance(payload.balance);
        bootRef.current = "ok";
      } catch (exc) {
        if (!alive) return;
        bootRef.current = "failed";
        console.warn("bootstrap unavailable", exc);
        void loadSatellites();
        void loadBalance();
        void loadPositions();
      } finally {
        window.clearTimeout(safety);
        if (alive) setBootDone(true);
      }
    };

    void load();
    return () => {
      alive = false;
      window.clearTimeout(safety);
    };
  }, [applyCatalog, loadBalance, loadPositions, loadSatellites]);

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
    if (bootRef.current !== "pending") void loadBalance();
    const timer = window.setInterval(() => void loadBalance(), 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadBalance]);

  useEffect(() => {
    if (bootRef.current !== "pending") void loadPositions();
    const timer = window.setInterval(() => void loadPositions(), 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadPositions]);

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
        { id: assistantId, role: "assistant", text: "", blocks: [], phase: "streaming" },
      ]);
      setBusy(true);

      const update = (patch: Partial<ChatMessage>) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, ...patch } : message,
          ),
        );
      };

      const mutate = (fn: (blocks: MessageBlock[]) => void) => {
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== assistantId) return message;
            const blocks = [...(message.blocks || [])];
            fn(blocks);
            return {
              ...message,
              blocks,
              text: blocks
                .filter((block): block is Extract<MessageBlock, { kind: "text" }> =>
                  block.kind === "text",
                )
                .map((block) => block.text)
                .join("\n\n"),
            };
          }),
        );
      };

      const pushText = (value: string, replace = false) => {
        mutate((blocks) => {
          const last = blocks[blocks.length - 1];
          if (last?.kind === "text") {
            blocks[blocks.length - 1] = {
              ...last,
              text: replace ? value : last.text + value,
            };
          } else {
            blocks.push({ id: crypto.randomUUID(), kind: "text", text: value });
          }
        });
      };

      const pushNotice = (value: string) => {
        mutate((blocks) => {
          blocks.push({ id: crypto.randomUUID(), kind: "notice", text: value });
        });
      };

      let sawEvent = false;
      try {
        await streamChat(text, sessionId, (event) => {
          sawEvent = true;
          switch (event.type) {
            case "session":
              setSessionId(event.session_id);
              break;
            case "text":
              pushText(event.text, event.replace);
              break;
            case "reasoning":
              mutate((blocks) => {
                const last = blocks[blocks.length - 1];
                if (last?.kind === "thinking") {
                  blocks[blocks.length - 1] = {
                    ...last,
                    text: `${last.text}\n\n${event.text}`,
                  };
                } else {
                  blocks.push({
                    id: crypto.randomUUID(),
                    kind: "thinking",
                    text: event.text,
                  });
                }
              });
              break;
            case "tool_call":
              mutate((blocks) => {
                if (
                  blocks.some(
                    (block) => block.kind === "tool" && block.callId === event.callId,
                  )
                ) {
                  return;
                }
                blocks.push({
                  id: crypto.randomUUID(),
                  kind: "tool",
                  callId: event.callId,
                  tool: event.tool,
                  input: event.input,
                  status: "running",
                });
              });
              break;
            case "tool_result":
              mutate((blocks) => {
                const index = blocks.findIndex(
                  (block) => block.kind === "tool" && block.callId === event.callId,
                );
                if (index >= 0) {
                  const block = blocks[index];
                  if (block.kind === "tool") {
                    blocks[index] = {
                      ...block,
                      status: event.status,
                      result: event.result,
                    };
                  }
                }
              });
              break;
            case "question":
              mutate((blocks) => {
                if (
                  blocks.some(
                    (block) =>
                      block.kind === "question" && block.callId === event.callId,
                  )
                ) {
                  return;
                }
                blocks.push({
                  id: crypto.randomUUID(),
                  kind: "question",
                  callId: event.callId,
                  questions: event.questions,
                });
              });
              break;
            case "notice":
              pushNotice(event.message);
              break;
            case "done":
              if (event.text) {
                mutate((blocks) => {
                  const last = blocks[blocks.length - 1];
                  if (last?.kind === "text" && last.text === event.text) return;
                  if (last?.kind === "text" && !last.text) {
                    blocks[blocks.length - 1] = { ...last, text: event.text };
                    return;
                  }
                  blocks.push({
                    id: crypto.randomUUID(),
                    kind: "text",
                    text: event.text,
                  });
                });
              }
              update({ elapsed_ms: event.elapsed_ms, phase: "done" });
              if (event.session_id) setSessionId(event.session_id);
              break;
            case "error":
              pushNotice(event.message);
              update({ error: true, phase: "error" });
              break;
            default:
              break;
          }
        });
      } catch (streamError) {
        const reason =
          streamError instanceof Error ? streamError.message : "连接中断";
        if (!sawEvent) {
          try {
            const response = await chat(text, sessionId);
            if (!response.ok) throw new Error(response.error || "DSH 没有返回结果。");
            if (response.session_id) setSessionId(response.session_id);
            const blocks: MessageBlock[] = [];
            if (response.thinking) {
              blocks.push({
                id: crypto.randomUUID(),
                kind: "thinking",
                text: response.thinking,
              });
            }
            (response.tool_calls || []).forEach((tool) => {
              blocks.push({
                id: crypto.randomUUID(),
                kind: "tool",
                callId: tool.callId,
                tool: tool.tool,
                input: tool.input,
                status: tool.status || "completed",
                result: tool.result,
              });
            });
            blocks.push({
              id: crypto.randomUUID(),
              kind: "text",
              text: response.text || "（没有文本）",
            });
            update({
              blocks,
              text: response.text || "（没有文本）",
              usage: response.usage || null,
              elapsed_ms: response.elapsed_ms,
              phase: "done",
            });
          } catch (fallbackError) {
            const message =
              fallbackError instanceof Error ? fallbackError.message : "请求失败";
            pushNotice(`请求失败：${reason}；回退失败：${message}`);
            update({ error: true, phase: "error" });
          }
        } else {
          pushNotice(`连接中断：${reason}。已保留已收到的内容；可以直接重试。`);
          update({ phase: "error" });
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
  }, []);

  const handleAnswer = useCallback(
    async (blockId: string, callId: string, answers: QuestionAnswer[]) => {
      const ok = await answerQuestion(callId, answers);
      if (!ok) return false;
      setMessages((current) =>
        current.map((message) => ({
          ...message,
          blocks: (message.blocks ?? []).map((block) =>
            block.id === blockId && block.kind === "question"
              ? { ...block, answers }
              : block,
          ),
        })),
      );
      return true;
    },
    [],
  );

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
              enabled={bootDone}
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
          onSend={send} onAnswer={handleAnswer}
          onReset={reset}
        />
      </main>
    </div>
  );
}
