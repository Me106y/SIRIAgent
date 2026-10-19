export type Category = "commercial" | "civil" | "meteorology" | string;

export interface Satellite {
  norad: number;
  name: string;
  name_zh: string | null;
  category: Category;
  orbit_regime: string | null;
  operator: string | null;
  country: string | null;
  status: string | null;
  payload_public: boolean;
}

export interface PositionItem {
  norad: number;
  name: string;
  category: Category;
  orbit_regime: string | null;
  payload_public: boolean;
  lat: number;
  lon: number;
  alt_km: number;
  tle_age_hours: number;
}

export interface CoverageCell {
  lat: number;
  lon: number;
  count: number;
}

export interface CoverageGrid {
  aoi: { lat: number; lon: number; radius_km: number };
  cells: CoverageCell[];
  min_count: number;
  max_count: number;
  grid_deg: number;
  lon_step_deg: number;
  satellites_used: number;
  passes_used: number;
  coverage_note: string;
  accuracy_note: string;
}

export interface SensorInfo {
  sensor_type?: string | null;
  confidence?: string | null;
  raw_spec?: string | null;
  swath_km?: number | null;
  payload_public?: boolean;
}

export interface SatelliteDetail {
  satellite: Satellite;
  sensor: SensorInfo | null;
  tle: { epoch_utc: string; age_hours: number } | null;
}

export interface TrackPoint {
  time_utc: string;
  lat_deg: number;
  lon_deg: number;
  alt_km: number;
}

export interface PassItem {
  aos_utc: string;
  los_utc: string;
  tca_utc: string;
  max_elev_deg: number;
  aos_az_deg: number;
  los_az_deg: number;
  duration_s: number;
  sun_elev_deg: number;
  is_daylight: boolean;
  optical_imaging_ok: boolean;
}

export interface SyncRun {
  status: string;
  attempt_no: number;
  max_attempts: number;
  started_at_utc: string | null;
  finished_at_utc: string | null;
  error_code: string | null;
}

export interface SyncStatus {
  last_run: SyncRun | null;
  state: {
    last_attempt_at: string | null;
    last_success_at: string | null;
    last_status: string | null;
    consecutive_failures: number;
    attempts_today: number;
    circuit_open_until: string | null;
  } | null;
  tle_current_count: number;
  tle_max_age_hours: number | null;
}

export interface ChatUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface ToolCall {
  callId: string;
  tool: string;
  input?: unknown;
  status?: string;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  tools?: ToolCall[];
  usage?: ChatUsage | null;
  elapsed_ms?: number;
  error?: boolean;
}

export type StreamEvent =
  | { type: "session"; session_id: string }
  | { type: "tool_call"; callId: string; tool: string; input?: unknown }
  | { type: "tool_result"; callId: string; status?: string; result?: unknown }
  | { type: "text"; text: string; replace?: boolean }
  | { type: "reasoning"; text: string }
  | { type: "notice"; message: string }
  | {
      type: "done";
      session_id: string;
      text: string;
      finish_reason?: string | null;
      elapsed_ms?: number;
    }
  | { type: "error"; message: string };
