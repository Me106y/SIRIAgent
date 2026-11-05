import type {
  Balance,
  ChatUsage,
  HangzhouBoundary,
  PassItem,
  PositionItem,
  AnswerResult,
  QuestionAnswer,
  Satellite,
  SatelliteDetail,
  Skill,
  StreamEvent,
  SyncStatus,
  ToolCall,
  TrackPoint,
  PlanCreateBody,
  PlanJob,
  PlanOptions,
  ReportInfo,
} from "./types";

async function postJson<T>(
  path: string,
  body: unknown,
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | (T & { detail?: unknown })
      | null;
    if (!response.ok) {
      const detail = payload?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : detail && typeof detail === "object" && "message" in detail
            ? String((detail as { message?: unknown }).message)
            : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload as T;
  } finally {
    window.clearTimeout(timer);
  }
}

async function getJson<T>(path: string, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${path} -> HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export interface BootstrapPayload {
  ok: boolean;
  satellites: { total: number; items: Satellite[] };
  positions: { count: number; items: PositionItem[]; generated_at: string };
  balance: Balance;
}

export const api = {
  config: () => getJson<{ amap_js_key: string; amap_security_code?: string }>("/api/config"),
  bootstrap: () => getJson<BootstrapPayload>("/api/bootstrap", 20_000),
  satellites: () =>
    getJson<{ total: number; items: Satellite[] }>("/api/rs/satellites?limit=200"),
  satellite: (norad: number) =>
    getJson<SatelliteDetail>(`/api/rs/satellites/${norad}`),
  positions: (at?: string) =>
    getJson<{ count: number; items: PositionItem[]; generated_at: string }>(
      `/api/rs/positions${at ? `?at=${encodeURIComponent(at)}` : ""}`,
    ),
  track: (norad: number, at?: string) =>
    getJson<{ points: TrackPoint[]; tle_age_hours: number }>(
      `/api/rs/satellites/${norad}/track?hours=2&step=120${
        at ? `&at=${encodeURIComponent(at)}` : ""
      }`,
    ),
  passes: (norad: number) =>
    getJson<{ passes: PassItem[]; tle_age_hours: number }>(
      `/api/rs/satellites/${norad}/passes?hours=24&min_elev=5`,
    ),
  sync: () => getJson<SyncStatus>("/api/rs/sync/status"),
  hangzhouBoundary: () => getJson<HangzhouBoundary>("/api/rs/aoi/hangzhou"),
  balance: (refresh = false) =>
    getJson<Balance>(`/api/balance${refresh ? "?refresh=1" : ""}`),
  skills: () => getJson<{ items: Skill[] }>("/api/skills"),
  planOptions: () => getJson<PlanOptions>("/api/rs/plan-options", 20_000),
  createPlan: (body: PlanCreateBody) => postJson<PlanJob>("/api/rs/plans", body, 30_000),
  planJob: (jobId: string) => getJson<PlanJob>(`/api/rs/plans/${jobId}`, 30_000),
  renderReport: (jobId: string) =>
    postJson<ReportInfo>(`/api/rs/plans/${jobId}/report`, {}, 60_000),
};

export interface ChatResponse {
  ok: boolean;
  session_id?: string;
  text?: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  usage?: ChatUsage | null;
  elapsed_ms?: number;
  error?: string;
}

export async function chat(message: string, sessionId?: string): Promise<ChatResponse> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  const raw = await response.text();
  let payload: ChatResponse;
  try {
    payload = JSON.parse(raw) as ChatResponse;
  } catch {
    const detail = raw.trim().slice(0, 240);
    return {
      ok: false,
      error: `HTTP ${response.status} ${detail || "（空响应）"}`,
    };
  }
  if (!response.ok) {
    return { ok: false, error: payload.error || `HTTP ${response.status}` };
  }
  return payload;
}

export interface TurnHandle {
  turn_id: string;
  session_id: string;
}

export class TurnGoneError extends Error {}
export class TurnBusyError extends Error {}

export async function startTurn(
  message: string,
  sessionId: string | undefined,
): Promise<TurnHandle> {
  const response = await fetch("/api/chat/turns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; turn_id?: string; session_id?: string; error?: string }
    | null;
  if (response.status === 409) {
    throw new TurnBusyError(payload?.error || "上一轮仍在运行。");
  }
  if (!response.ok || !payload?.ok || !payload.turn_id) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return { turn_id: payload.turn_id, session_id: payload.session_id || "" };
}

/**
 * 读取一轮事件。返回下一次续读的游标；收到 done/error/closed 才算正常结束。
 * 连接被隧道掐断时抛错，调用方用同一个 turn_id + 游标重连即可补发。
 */
export async function streamTurn(
  turnId: string,
  cursor: number,
  onEvent: (event: StreamEvent) => void,
): Promise<number> {
  const response = await fetch(
    `/api/chat/turns/${encodeURIComponent(turnId)}/events?cursor=${cursor}`,
    { headers: { Accept: "text/event-stream" } },
  );
  if (response.status === 404) {
    throw new TurnGoneError("会话回合已过期");
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let nextCursor = cursor;
  let finished = false;

  const consume = (frame: string) => {
    let frameId: number | null = null;
    let data: string | null = null;
    for (const line of frame.split("\n")) {
      if (line.startsWith("id:")) {
        const parsed = Number(line.slice(3).trim());
        if (Number.isFinite(parsed)) frameId = parsed;
      } else if (line.startsWith("data:")) {
        data = (data ?? "") + line.slice(5).trim();
      }
    }
    if (data === null) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(data) as StreamEvent;
    } catch {
      // 帧被截断时不要推进游标，重连后服务器会重发这一条。
      return;
    }
    onEvent(event);
    if (frameId !== null) nextCursor = frameId + 1;
    if (
      event.type === "done" ||
      event.type === "error" ||
      event.type === "closed"
    ) {
      finished = true;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        consume(frame);
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finished) {
    throw new Error("事件流提前结束");
  }
  return nextCursor;
}

const ANSWER_TIMEOUT_MS = 10_000;
// 隧道抖动常持续几十秒：答复比 SSE 更重要，给足重试预算（最坏约 1 分钟）。
const ANSWER_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * 提交问题答复。隧道抖动时答复 POST 可能被中间层打断（浏览器看到 502/504），
 * 而服务端的问题仍在等待，所以对网络错误/5xx 自动重试；服务端按 callId 幂等，
 * 即使上一次其实已经送达，重试也会返回成功。
 */
export async function answerQuestion(
  callId: string,
  answers: QuestionAnswer[],
): Promise<AnswerResult> {
  for (let attempt = 1; attempt <= ANSWER_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), ANSWER_TIMEOUT_MS);
    try {
      const response = await fetch("/api/question/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, answers }),
        signal: controller.signal,
      });
      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
        return payload?.ok ? "ok" : "stale";
      }
      const transient =
        response.status >= 500 || response.status === 408 || response.status === 429;
      if (!transient || attempt === ANSWER_ATTEMPTS) return "network";
    } catch {
      if (attempt === ANSWER_ATTEMPTS) return "network";
    } finally {
      window.clearTimeout(timer);
    }
    await sleep(Math.min(3000, 700 * attempt));
  }
  return "network";
}

export async function cancelChat(): Promise<void> {
  await fetch("/api/chat/cancel", { method: "POST" }).catch(() => undefined);
}
