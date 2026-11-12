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

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  multi_select?: boolean;
}

export type AnswerResult = "ok" | "stale" | "network";

export interface QuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

export type MessageBlock =
  | { id: string; kind: "thinking"; text: string }
  | {
      id: string;
      kind: "tool";
      callId: string;
      tool: string;
      input?: unknown;
      status?: string;
      result?: unknown;
    }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "notice"; text: string }
  | {
      id: string;
      kind: "question";
      callId: string;
      questions: QuestionItem[];
      answers?: QuestionAnswer[];
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks?: MessageBlock[];
  phase?: "streaming" | "done" | "error";
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
  | { type: "question"; callId: string; questions: QuestionItem[] }
  | { type: "notice"; message: string }
  | {
      type: "done";
      session_id: string;
      text: string;
      finish_reason?: string | null;
      elapsed_ms?: number;
    }
  | { type: "error"; message: string }
  | { type: "closed" };

export interface HangzhouBoundary {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      code: string;
      name: string;
      source: string;
      datum: string;
      accuracy: string;
      points: number;
      bbox: [number, number, number, number];
    };
    geometry: { type: "Polygon"; coordinates: number[][][] };
  }>;
}

export interface Balance {
  ok: boolean;
  available?: boolean;
  currency?: string;
  total?: string;
  granted?: string;
  topped_up?: string;
  checked_at?: string;
  error?: string;
}

export interface Skill {
  name: string;
  description: string;
  when_to_use: string;
  path: string;
}

export interface PlanTask {
  operation: string;
  supports_auto_expand?: boolean;
  label: string;
  required: string[];
  advanced: string[];
  description: string;
}

export interface PlanAdvancedField {
  name: string;
  label: string;
  type: "number" | "boolean" | string;
  default: number | boolean | null;
}

export interface PlanAoi {
  code: string;
  name: string;
  level: string | null;
  adcode: string | null;
}

export interface PlanOptions {
  ok: boolean;
  tasks: PlanTask[];
  advanced: PlanAdvancedField[];
  sensor_types: Array<{ value: string; label: string }>;
  defaults: Record<string, unknown>;
  aoi: PlanAoi[];
  capability: {
    plannable: number;
    blocked: number;
    blocked_by_reason: Record<string, number>;
  };
  tle?: {
    latest_epoch_utc?: string | null;
    oldest_epoch_utc?: string | null;
    max_age_hours?: number | null;
    degraded?: boolean;
    stale?: boolean;
  };
}

export interface PlanSummaryCards {
  satellite_count?: number;
  qualified_area_pct?: number;
  covered_area_pct?: number;
  city_mean_temporal_coverage_pct?: number;
  city_mean_observable_duration_minutes?: number;
  area_weighted_mrt_minutes?: number;
  area_weighted_art_minutes?: number;
  [key: string]: number | undefined;
}

export interface PlanSat {
  sat_id: number;
  name: string;
  sensor_label: string;
  resolution_m: number | null;
  swath_km: number | null;
  passes: number | null;
  cumulative_minutes: number | null;
}

export interface PlanPass {
  satellite: string;
  start_utc: string;
  end_utc: string;
  duration_minutes: number;
  average_covered_area_pct: number;
  maximum_covered_area_pct: number;
}

export interface PlanResult {
  status: string;
  operation: string;
  feasible?: boolean;
  optimality?: string;
  summary_cards?: PlanSummaryCards;
  targets?: {
    temporal_coverage_pct?: number | null;
    area_pct?: number | null;
    mrt_minutes?: number | null;
  };
  window?: {
    requested_horizon_h?: number;
    used_horizon_h?: number;
    expanded?: boolean;
    attempts?: number;
  };
  tle?: {
    latest_epoch_utc?: string | null;
    max_age_hours?: number | null;
    min_age_hours?: number | null;
    degraded?: boolean;
    stale?: boolean;
  };
  report_data?: {
    sats?: PlanSat[];
    selected_count?: number;
    selected_ids?: number[];
    playback?: {
      events?: Array<{ sat_id: number; label: string; points: number[][] }>;
      uncovered?: number[][];
      total?: number;
    };
  };
  city?: { name: string; area_km2: number };
  input_summary?: { start_utc?: string; end_utc?: string; analysis_horizon_h?: number };
  city_pass_window_table?: PlanPass[];
  weak_areas?: Array<{ grid_id: string; area_km2: number; temporal_coverage_pct: number; mrt_minutes: number }>;
  assumptions?: string[];
  warnings?: string[];
  cloud?: { filtered?: boolean; threshold_pct?: number; dropped_windows?: number; reason?: string };
  blocked_satellites?: Array<{ norad_id: number; name: string; reason: string }>;
  candidate_count?: number;
  blocked_count?: number;
  [key: string]: unknown;
}

export interface PlanJob {
  ok: boolean;
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  result?: PlanResult | null;
  error?: { code: string; message: string; [key: string]: unknown } | null;
}

export interface ReportInfo {
  ok: boolean;
  run_id: string;
  report_path: string;
  plan_path: string;
  relative_report: string;
  relative_plan: string;
  latest: string;
  report_url: string;
}

export interface PlanCreateBody {
  operation: string;
  aoi_code?: string | null;
  aoi_wkt?: string | null;
  start_utc?: string;
  horizon_h?: number;
  auto_expand?: boolean;
  sensor_types?: string[];
  max_resolution_m?: number;
  pointing?: "nadir" | "targeted";
  cloud_filter?: boolean;
  cloud_threshold_pct?: number;
  [key: string]: unknown;
}

export interface ModelOption {
  id: string;
  name: string;
  short?: string;
  description?: string;
}

export interface ReasoningEffortOption {
  id: string;
  name: string;
}

export interface ChatModelSettings {
  defaults: { model: string; reasoning_effort: string };
  models: ModelOption[];
  reasoning_efforts: ReasoningEffortOption[];
}

export interface PurchaseFile {
  name: string;
  bytes: number;
  width?: number;
  height?: number;
}

export interface FixedPairFile {
  name: string;
  phase: "before" | "after";
  label: string;
  path: string;
  bytes?: number;
  width?: number;
  height?: number;
}

export interface PurchaseSummary {
  city?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  sat_count?: number | null;
  qualified_area_pct?: number | null;
  area_target_pct?: number | null;
  operation?: string | null;
}

export interface PurchaseRecord {
  purchase_id: string;
  run_id: string;
  workspace_dir: string;
  summary: PurchaseSummary;
  image_files: FixedPairFile[];
  created_at: string;
  simulated: boolean;
}

export interface WorkspaceImage {
  kind: "purchase" | "upload" | "demo";
  group: string;
  name: string;
  path: string;
  bytes: number;
  width?: number;
  height?: number;
}

export interface DetectionResult {
  ok: boolean;
  run_id: string;
  mask_path: string;
  before_path: string;
  after_path: string;
  width: number;
  height: number;
  changed_px: number;
  changed_ratio: number;
  components: number;
  elapsed_ms: number;
  resized: boolean;
  device: string;
  accuracy_note: string;
}

export interface ObjectDetection {
  label: string;
  class_id: number;
  score: number;
  box: number[];
}

export interface ObjectDetectionResult {
  ok: boolean;
  run_id: string;
  image_path: string;
  annotated_path: string;
  width: number;
  height: number;
  count: number;
  class_count: number;
  classes: string[];
  score_mean: number;
  score_min: number;
  detections: ObjectDetection[];
  resized: boolean;
  elapsed_ms: number;
  device: string;
  accuracy_note: string;
}
