import type {
  ChatUsage,
  PassItem,
  PositionItem,
  Satellite,
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
  positions: () =>
    getJson<{ count: number; items: PositionItem[]; generated_at: string }>(
      "/api/rs/positions",
    ),
  track: (norad: number) =>
    getJson<{ points: TrackPoint[]; tle_age_hours: number }>(
      `/api/rs/satellites/${norad}/track?hours=2&step=120`,
    ),
  passes: (norad: number) =>
    getJson<{ passes: PassItem[]; tle_age_hours: number }>(
      `/api/rs/satellites/${norad}/passes?hours=24&min_elev=5`,
    ),
  sync: () => getJson<SyncStatus>("/api/rs/sync/status"),
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
