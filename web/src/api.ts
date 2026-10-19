import type {
  ChatUsage,
  HangzhouBoundary,
  PassItem,
  PositionItem,
  Satellite,
  SatelliteDetail,
  StreamEvent,
  SyncStatus,
  ToolCall,
  TrackPoint,
} from "./types";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
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
  const payload = (await response.json()) as ChatResponse;
  if (!response.ok) {
    return { ok: false, error: payload.error || `HTTP ${response.status}` };
  }
  return payload;
}

export async function streamChat(
  message: string,
  sessionId: string | undefined,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          onEvent(JSON.parse(raw) as StreamEvent);
        } catch {
          // 忽略无法解析的保活帧
        }
      }
      separator = buffer.indexOf("\n\n");
    }
  }
}
