import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { fileUrl } from "../lib/fileLinks";
import type { PlanAoi, PlanCreateBody, PlanJob, PlanOptions, PlanResult, ReportInfo } from "../types";
import { MapDrawModal } from "./MapDrawModal";

interface Props {
  open: boolean;
  onClose: () => void;
  onAnalyze: (path: string) => void;
}

const STEPS = ["任务", "范围", "时间窗", "约束", "求解与报告"];
const SENSOR_LABELS: Record<string, string> = {
  optical: "光学",
  hyperspectral: "高光谱",
  sar: "SAR",
};
const LEVEL_LABELS: Record<string, string> = {
  province: "省级",
  city: "市级",
  district: "区县",
};
const FIELD_LABELS: Record<string, string> = {
  temporal_coverage_target_pct: "单格时间覆盖率",
  mrt_target_minutes: "P95 重访上限",
  n_budget: "星数预算",
  area_target_pct: "面积覆盖率目标",
  fallback_area_target_pct: "面积回退",
  exact_budget: "精确星数预算",
  grid_size_km: "网格大小",
  detection_step_s: "检测步长",
  selection_time_limit_s: "选星时限",
};
const FIELD_HINTS: Record<string, string> = {
  temporal_coverage_target_pct: "每格覆盖时间占比",
  mrt_target_minutes: "分钟",
  n_budget: "颗",
  area_target_pct: "%（达标面积占比）",
  fallback_area_target_pct: "%",
  grid_size_km: "km",
  detection_step_s: "秒",
  selection_time_limit_s: "秒",
};

function nowLocal(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.4l2.7 2.7 6.3-6.2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}

function ArrowIcon({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={back ? "flip" : undefined}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function aoiDigits(item: PlanAoi): string {
  return (item.adcode || item.code || "").replace(/\D/g, "");
}

function parentProvinceCode(item: PlanAoi): string {
  const digits = aoiDigits(item);
  return digits.length >= 2 ? `${digits.slice(0, 2)}0000` : "";
}

function parentCityCode(item: PlanAoi): string {
  const digits = aoiDigits(item);
  return digits.length >= 4 ? `${digits.slice(0, 4)}00` : "";
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8h9" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8h9M8 3.5v9" />
    </svg>
  );
}

interface NumberStepperProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

function NumberStepper({ label, value, onChange, min, max, step = 1, placeholder }: NumberStepperProps) {
  const current = value.trim() === "" ? null : Number(value);
  const numeric = current != null && Number.isFinite(current) ? current : null;
  const floor = min ?? Number.NEGATIVE_INFINITY;
  const ceiling = max ?? Number.POSITIVE_INFINITY;
  const clamp = (next: number) => Math.min(ceiling, Math.max(floor, next));
  const bump = (direction: 1 | -1) => {
    if (numeric == null) {
      onChange(String(min ?? 0));
      return;
    }
    onChange(String(clamp(numeric + direction * step)));
  };
  return (
    <div className="plan-number">
      <button
        type="button"
        className="plan-number-btn"
        onClick={() => bump(-1)}
        disabled={numeric != null && numeric <= floor}
        aria-label={`减少${label}`}
      >
        <MinusIcon />
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (value.trim() === "") return;
          const next = Number(value);
          if (Number.isFinite(next)) onChange(String(clamp(next)));
        }}
      />
      <button
        type="button"
        className="plan-number-btn"
        onClick={() => bump(1)}
        disabled={numeric != null && numeric >= ceiling}
        aria-label={`增加${label}`}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

export function PlanDrawer({ open, onClose, onAnalyze }: Props) {
  const [options, setOptions] = useState<PlanOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [operation, setOperation] = useState("task1");
  const [provinceCode, setProvinceCode] = useState("330000");
  const [cityCode, setCityCode] = useState("330100");
  const [districtCode, setDistrictCode] = useState("");
  const [aoiWkt, setAoiWkt] = useState("");
  const [drawOpen, setDrawOpen] = useState(false);
  const [startLocal, setStartLocal] = useState(nowLocal);
  const [horizon, setHorizon] = useState(72);
  const [autoExpand, setAutoExpand] = useState(false);
  const [sensors, setSensors] = useState<string[]>(["optical", "hyperspectral"]);
  const [maxResolution, setMaxResolution] = useState(10);
  const [pointing, setPointing] = useState<"nadir" | "targeted">("nadir");
  const [cloud, setCloud] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({
    temporal_coverage_target_pct: "0.1",
    mrt_target_minutes: "24",
    n_budget: "3",
    area_target_pct: "90",
  });
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<PlanJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportInfo | null>(null);
  const [reporting, setReporting] = useState(false);

  const task = useMemo(
    () => options?.tasks.find((item) => item.operation === operation) ?? null,
    [options, operation],
  );
  const effectiveCode = districtCode || cityCode || provinceCode;
  const aoi = useMemo(
    () => options?.aoi.find((item) => item.code === effectiveCode) ?? null,
    [options, effectiveCode],
  );
  const cities = useMemo(
    () =>
      (options?.aoi ?? []).filter(
        (item) => item.level === "city" && parentProvinceCode(item) === provinceCode,
      ),
    [options, provinceCode],
  );
  const districts = useMemo(
    () =>
      (options?.aoi ?? []).filter(
        (item) => item.level === "district" && parentCityCode(item) === cityCode,
      ),
    [options, cityCode],
  );

  useEffect(() => {
    if (!open || options) return;
    let alive = true;
    api
      .planOptions()
      .then((payload) => {
        if (!alive) return;
        setOptions(payload);
        setOptionsError(null);
        const province = payload.aoi.find((item) => item.level === "province");
        const nextProvince = province?.code ?? "";
        const firstCity = payload.aoi.find(
          (item) => item.level === "city" && parentProvinceCode(item) === nextProvince,
        );
        setProvinceCode(nextProvince);
        setCityCode(firstCity?.code ?? "");
        setDistrictCode("");
        setAutoExpand(Boolean(payload.defaults?.auto_expand));
      })
      .catch((reason: unknown) => {
        if (alive) setOptionsError(reason instanceof Error ? reason.message : "无法读取规划选项");
      });
    return () => {
      alive = false;
    };
  }, [open, options]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !drawOpen && !jobId) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, drawOpen, jobId, onClose]);

  useEffect(() => {
    if (!open || !jobId) return;
    let alive = true;
    let timer: number | undefined;
    let failures = 0;
    const poll = async () => {
      try {
        const data = await api.planJob(jobId);
        if (!alive) return;
        failures = 0;
        setJob(data);
        setPollError(null);
        if (data.status === "completed" || data.status === "failed") return;
      } catch (reason: unknown) {
        failures += 1;
        if (alive) {
          const message = reason instanceof Error ? reason.message : "状态查询失败";
          setPollError(failures >= 2 ? `状态查询暂时失败，正在重试（${message}）` : message);
        }
      }
      timer = window.setTimeout(poll, failures > 0 ? 2000 : 1200);
    };
    void poll();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [open, jobId]);

  if (!open) return null;

  const stepValid = (index: number): boolean => {
    if (index === 0) return Boolean(operation);
    if (index === 1) return Boolean(effectiveCode || aoiWkt);
    if (index === 2) return Boolean(startLocal) && horizon > 0;
    if (index === 3) {
      if (sensors.length === 0) return false;
      return (task?.required ?? []).every((name) => (fields[name] ?? "").trim() !== "");
    }
    return true;
  };

  const canGoNext = stepValid(step);
  const busy = job?.status === "queued" || job?.status === "running";

  const buildBody = (): PlanCreateBody => {
    const body: PlanCreateBody = {
      operation,
      aoi_code: aoiWkt ? null : effectiveCode,
      aoi_wkt: aoiWkt || null,
      start_utc: new Date(startLocal).toISOString(),
      horizon_h: horizon,
      auto_expand: operation === "task1" ? autoExpand : false,
      sensor_types: sensors,
      max_resolution_m: maxResolution,
      pointing,
      cloud_filter: cloud,
      cloud_threshold_pct: 70,
    };
    const names = new Set<string>([...(task?.required ?? [])]);
    for (const name of names) {
      const raw = (fields[name] ?? "").trim();
      if (!raw) continue;
      if (name === "exact_budget") body[name] = raw === "true";
      else body[name] = Number(raw);
    }
    return body;
  };

  const solve = async () => {
    setError(null);
    setPollError(null);
    setReport(null);
    setJob(null);
    setJobId(null);
    try {
      const created = await api.createPlan(buildBody());
      setJob(created);
      setJobId(created.job_id);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "求解任务创建失败");
    }
  };

  const runReport = async () => {
    if (!jobId) return;
    setReporting(true);
    setError(null);
    try {
      let info;
      try {
        info = await api.renderReport(jobId);
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
        info = await api.renderReport(jobId);
      }
      setPollError(null);
      setReport(info);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "报告生成失败");
    } finally {
      setReporting(false);
    }
  };

  const resetJob = () => {
    setJobId(null);
    setJob(null);
    setReport(null);
    setError(null);
    setPollError(null);
    setStep(3);
  };

  const toggleSensor = (value: string) => {
    setSensors((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  };

  const renderTaskStep = () => (
    <div className="plan-step" key="task">
      <header className="plan-step-head">
        <h2>先确定要回答的问题</h2>
        <p>五个任务问的是不同问题；切换任务会改变下面要填的目标字段。</p>
      </header>
      <div className="plan-task-list" role="radiogroup" aria-label="选择规划任务">
        {(options?.tasks ?? []).map((item, index) => {
          const active = item.operation === operation;
          return (
            <button
              key={item.operation}
              type="button"
              role="radio"
              aria-checked={active}
              className={`plan-task ${active ? "active" : ""}`}
              onClick={() => {
                setOperation(item.operation);
                if (item.operation !== "task1") setAutoExpand(false);
              }}
            >
              <span className="plan-task-mark">{active ? <CheckIcon /> : String(index + 1)}</span>
              <span className="plan-task-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <span className="plan-task-req">
                {item.required
                  .map((name) => FIELD_LABELS[name] ?? name)
                  .join(" · ")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderAoiStep = () => (
    <div className="plan-step" key="aoi">
      <header className="plan-step-head">
        <h2>框定目标范围</h2>
        <p>先选市，再选这个市下的区县；只支持浙江省内，也可以在地图上画一个多边形。</p>
      </header>
      <div className="plan-grid-3">
        <label className="plan-field">
          <span>省</span>
          <select
            value={provinceCode}
            onChange={(event) => {
              const next = event.target.value;
              setProvinceCode(next);
              setAoiWkt("");
              const first = (options?.aoi ?? []).find(
                (item) => item.level === "city" && parentProvinceCode(item) === next,
              );
              setCityCode(first?.code ?? "");
              setDistrictCode("");
            }}
            disabled={Boolean(aoiWkt)}
          >
            {(options?.aoi ?? [])
              .filter((item) => item.level === "province")
              .map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label className="plan-field">
          <span>市</span>
          <select
            value={cityCode}
            onChange={(event) => {
              setCityCode(event.target.value);
              setDistrictCode("");
              setAoiWkt("");
            }}
            disabled={Boolean(aoiWkt) || cities.length === 0}
          >
            <option value="">全省（不选市）</option>
            {cities.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="plan-field">
          <span>区县</span>
          <select
            value={districtCode}
            onChange={(event) => {
              setDistrictCode(event.target.value);
              setAoiWkt("");
            }}
            disabled={Boolean(aoiWkt) || !cityCode || districts.length === 0}
          >
            <option value="">全市（不选区县）</option>
            {districts.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="plan-or">
        <span>或</span>
      </div>
      <div className="plan-draw-row">
        <button type="button" className="plan-ghost" onClick={() => setDrawOpen(true)}>
          {aoiWkt ? "重新绘制范围" : "在地图上画范围"}
        </button>
        {aoiWkt ? (
          <button
            type="button"
            className="plan-link"
            onClick={() => {
              setAoiWkt("");
              setDrawOpen(false);
            }}
          >
            清除自定义范围
          </button>
        ) : null}
      </div>
      {aoiWkt ? (
        <p className="plan-note">已使用自定义多边形；求解时按 WKT 裁剪网格。</p>
      ) : aoi ? (
        <p className="plan-note">
          将分析 {aoi.name}
          {aoi.level ? `（${LEVEL_LABELS[aoi.level] ?? aoi.level}）` : ""}。
        </p>
      ) : null}
    </div>
  );

  const renderTimeStep = () => (
    <div className="plan-step" key="time">
      <header className="plan-step-head">
        <h2>定一个分析窗口</h2>
        <p>窗口越长，覆盖与重访越容易达标；结果只在这个窗口内比较。</p>
      </header>
      <div className="plan-grid-2">
        <label className="plan-field">
          <span>开始时间</span>
          <input
            type="datetime-local"
            value={startLocal}
            onChange={(event) => setStartLocal(event.target.value)}
          />
        </label>
        <div className="plan-field">
          <span>窗口长度（小时）</span>
          <NumberStepper
            label="窗口长度"
            value={horizon ? String(horizon) : ""}
            onChange={(value) => setHorizon(value.trim() === "" ? 0 : Number(value))}
            min={1}
            max={168}
            placeholder="72"
          />
        </div>
      </div>
      <div className="plan-chips" role="group" aria-label="常用窗口">
        {[24, 72, 168].map((hours) => (
          <button
            key={hours}
            type="button"
            className={`plan-chip ${horizon === hours ? "active" : ""}`}
            onClick={() => setHorizon(hours)}
          >
            {hours === 168 ? "7 天" : `${hours} 小时`}
          </button>
        ))}
      </div>
      <p className="plan-note">开始时间按本机时区填写，提交时转成 UTC。</p>
      {(task?.supports_auto_expand ?? operation === "task1") ? (
        <label className="plan-switch">
          <input
            type="checkbox"
            checked={autoExpand}
            onChange={(event) => setAutoExpand(event.target.checked)}
          />
          <span>
            达不到目标时自动扩窗
            <small>
              {horizon >= 168
                ? "当前窗口已是 7 天上限；自动扩窗不会改变窗口。"
                : "先试当前窗口，再试 72h / 7 天；可能几分钟，报告会标注实际窗口。仅 task1。"}
            </small>
          </span>
        </label>
      ) : (
        <p className="plan-note">此任务按你给定的窗口计算，不会自动扩窗。</p>
      )}
    </div>
  );

  const renderConstraintStep = () => (
    <div className="plan-step" key="constraints">
      <header className="plan-step-head">
        <h2>目标和约束</h2>
        <p>只显示当前任务需要的字段；其余参数使用引擎默认值。</p>
      </header>

      <div className="plan-grid-2">
        {(task?.required ?? []).map((name) => (
          <div className="plan-field" key={name}>
            <span>
              {FIELD_LABELS[name] ?? name}
              {FIELD_HINTS[name] ? <small>{FIELD_HINTS[name]}</small> : null}
            </span>
            <NumberStepper
              label={FIELD_LABELS[name] ?? name}
              value={fields[name] ?? ""}
              onChange={(value) =>
                setFields((current) => ({ ...current, [name]: value }))
              }
              min={name === "mrt_target_minutes" ? 0 : name === "temporal_coverage_target_pct" ? 0.01 : 1}
              max={name === "n_budget" ? 500 : name === "temporal_coverage_target_pct" || name === "area_target_pct" ? 100 : 10_000}
              step={name === "temporal_coverage_target_pct" ? 0.1 : 1}
              placeholder={name === "n_budget" ? "3" : name === "mrt_target_minutes" ? "24" : name === "area_target_pct" ? "90" : "0.1"}
            />
          </div>
        ))}
      </div>

      {operation === "task1" ? (
        <p className="plan-note">
          覆盖目标：{fields.area_target_pct || "90"}% 面积至少被任一卫星成像一次；不设时间覆盖率门槛。
        </p>
      ) : null}

      <fieldset className="plan-fieldset">
        <legend>传感器</legend>
        <div className="plan-checks">
          {(options?.sensor_types ?? []).map((item) => {
            const disabled = item.value === "sar";
            return (
              <label key={item.value} className={`plan-check ${disabled ? "disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={sensors.includes(item.value)}
                  disabled={disabled}
                  onChange={() => toggleSensor(item.value)}
                />
                <span>{SENSOR_LABELS[item.value] ?? item.label}</span>
                {disabled ? <small>暂不可用</small> : null}
              </label>
            );
          })}
        </div>
        <p className="plan-hint">SAR 因缺少原生入射角带暂不参与；当前目录为 61 光学 + 4 高光谱。</p>
      </fieldset>

      <div className="plan-grid-2">
        <label className="plan-field">
          <span>最大分辨率（米）</span>
          <select
            value={maxResolution}
            onChange={(event) => setMaxResolution(Number(event.target.value))}
          >
            {[1, 2, 5, 10, 30].map((value) => (
              <option key={value} value={value}>
                {value} m
              </option>
            ))}
          </select>
        </label>
        <div className="plan-field">
          <span>指向</span>
          <div className="plan-seg" role="group" aria-label="指向模式">
            <button
              type="button"
              className={pointing === "nadir" ? "active" : ""}
              onClick={() => setPointing("nadir")}
            >
              星下点
            </button>
            <button
              type="button"
              className={pointing === "targeted" ? "active" : ""}
              onClick={() => setPointing("targeted")}
            >
              目标指向
            </button>
          </div>
        </div>
      </div>

      <label className="plan-switch">
        <input type="checkbox" checked={cloud} onChange={(event) => setCloud(event.target.checked)} />
        <span>
          按云量过滤
          <small>Open-Meteo 逐小时 cloud_cover &gt; 70% 的访问不参与选星</small>
        </span>
      </label>

    </div>
  );

  const tle = options?.tle;
  const tleStale = Boolean(tle?.stale);
  const tleAge = tle?.max_age_hours;
  const result = job?.result ?? null;

  const renderResult = (value: PlanResult) => {
    const cards = value.summary_cards ?? {};
    const sats = value.report_data?.sats ?? [];
    const areaTarget = value.targets?.area_pct;
    const temporalTarget = value.targets?.temporal_coverage_pct;
    const op = value.operation ?? operation;
    const isTask1 = op === "task1" || op.startsWith("task_1");
    const windowInfo = value.window;
    const expanded = Boolean(windowInfo?.expanded);
    const usedHorizon = windowInfo?.used_horizon_h;
    const requestedHorizon = windowInfo?.requested_horizon_h;
    return (
      <div className="plan-result">
        <div className={`plan-verdict ${value.feasible ? "ok" : "warn"}`}>
          <strong>{value.feasible ? "目标可行" : "目标未达成"}</strong>
          <span>
            {value.optimality ?? "—"} · 窗口 {usedHorizon ?? "—"}h
            {expanded ? `（请求 ${requestedHorizon}h，已扩窗）` : ""}
            {isTask1 ? "" : ` · 单格阈值 ${temporalTarget ?? "—"}%`} · 候选{" "}
            {value.candidate_count ?? "—"} 颗 · 未参与 {value.blocked_count ?? 0} 颗
          </span>
        </div>
        <div className="plan-stats">
          <div>
            <span>选中卫星</span>
            <strong>{cards.satellite_count ?? sats.length}</strong>
          </div>
          <div>
            <span>
              {areaTarget != null ? `达标面积（目标 ${areaTarget}%）` : "达标面积"}
            </span>
            <strong>{formatNumber(cards.qualified_area_pct)}%</strong>
          </div>
          {!isTask1 ? (
            <div>
              <span>时间覆盖率</span>
              <strong>{formatNumber(cards.city_mean_temporal_coverage_pct, 2)}%</strong>
            </div>
          ) : null}
          <div>
            <span>面积加权 MRT</span>
            <strong>{formatNumber(cards.area_weighted_mrt_minutes, 0)} 分</strong>
          </div>
        </div>

        {expanded ? (
          <p className="plan-note">
            请求窗口 {requestedHorizon}h，实际按 {usedHorizon}h 计算；报告按实际窗口展示。
          </p>
        ) : null}
        {value.auto_expand?.reason ? (
          <p className="plan-note">自动扩窗：{value.auto_expand.reason}</p>
        ) : null}
        {isTask1 ? (
          <p className="plan-note">
            面积为窗口内累计并集，不是单景；成图可执行性需另看太阳/云量与同时覆盖。
          </p>
        ) : null}
        {value.tle?.degraded ? (
          <p className="plan-warning">
            TLE 最大年龄 {value.tle.max_age_hours}h（&gt;72h），结果按 degraded 处理。
          </p>
        ) : null}

        {sats.length > 0 ? (
          <table className="plan-table">
            <thead>
              <tr>
                <th>卫星</th>
                <th>类型</th>
                <th className="num">分辨率</th>
                <th className="num">过境</th>
              </tr>
            </thead>
            <tbody>
              {sats.map((item) => (
                <tr key={item.sat_id}>
                  <td>
                    {item.name}
                    <small>NORAD {item.sat_id}</small>
                  </td>
                  <td>{item.sensor_label}</td>
                  <td className="num">{item.resolution_m == null ? "—" : `${item.resolution_m} m`}</td>
                  <td className="num">{item.passes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className="plan-report">
          <div>
            <strong>报告</strong>
            <p>四节：卫星构成 / 覆盖与回放 / 推荐计划 / 口径与精度。</p>
          </div>
          <div className="plan-report-actions">
            {report ? (
              <>
                <a className="plan-primary" href={fileUrl(report.relative_report)} target="_blank" rel="noopener">
                  打开报告
                </a>
                <button
                  type="button"
                  className="plan-ghost"
                  onClick={() => onAnalyze(report.relative_plan)}
                >
                  让 Agent 分析
                </button>
              </>
            ) : (
              <button type="button" className="plan-primary" onClick={() => void runReport()} disabled={reporting}>
                {reporting ? "生成中…" : "生成报告"}
              </button>
            )}
            <button type="button" className="plan-ghost" onClick={resetJob}>
              调整参数
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSolveStep = () => (
    <div className="plan-step" key="solve">
      <header className="plan-step-head">
        <h2>求解并生成报告</h2>
        <p>求解在 RS-Service 里执行，通常需要几秒到一分钟；关闭抽屉不会中断后台任务。</p>
      </header>

      <dl className="plan-summary">
        <div>
          <dt>任务</dt>
          <dd>{task?.label ?? operation}</dd>
        </div>
        <div>
          <dt>范围</dt>
          <dd>{aoiWkt ? "自定义多边形" : aoi?.name ?? effectiveCode}</dd>
        </div>
        <div>
          <dt>窗口</dt>
          <dd>
            {startLocal.replace("T", " ")} · {horizon} h
          </dd>
        </div>
        <div>
          <dt>约束</dt>
          <dd>
            {sensors.map((item) => SENSOR_LABELS[item] ?? item).join(" + ") || "—"} · ≤{maxResolution} m ·{" "}
            {pointing === "nadir" ? "星下点" : "目标指向"} · {cloud ? "云量过滤" : "不过滤云量"}
          </dd>
        </div>
      </dl>

      {error ? (
        <div className="plan-error" role="alert">
          {error}
        </div>
      ) : null}

      {pollError && !error ? (
        <p className="plan-note">状态查询暂时失败，正在重试：{pollError}</p>
      ) : null}

      {!jobId ? (
        <button
          type="button"
          className="plan-solve"
          onClick={() => void solve()}
          disabled={tleStale}
        >
          开始求解
          <ArrowIcon />
        </button>
      ) : null}

      {busy ? (
        <div className="plan-progress" role="status" aria-live="polite">
          <span className="plan-spinner" />
          <div>
            <strong>{job?.status === "queued" ? "排队中…" : "正在传播与选星…"}</strong>
            <p>任务 {jobId}；可以关闭抽屉，稍后回来不会保留这个页面的进度。</p>
          </div>
        </div>
      ) : null}

      {job?.status === "failed" ? (
        <div className="plan-error" role="alert">
          <strong>{job.error?.code ?? "execution_error"}</strong>
          <p>{job.error?.message ?? "求解失败"}</p>
          <button type="button" className="plan-ghost" onClick={resetJob}>
            返回修改
          </button>
        </div>
      ) : null}

      {job?.status === "completed" && result ? renderResult(result) : null}
    </div>
  );

  const stepContent = [
    renderTaskStep,
    renderAoiStep,
    renderTimeStep,
    renderConstraintStep,
    renderSolveStep,
  ][step];

  return (
    <div
      className="plan-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="卫星成图"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !jobId) onClose();
      }}
    >
      <div className="plan-shell">
        <aside className="plan-rail">
          <div className="plan-rail-head">
            <div>
              <span className="plan-mark">成图</span>
              <h2>卫星成图</h2>
            </div>
            <button type="button" className="plan-close" onClick={onClose} aria-label="关闭">
              <CloseIcon />
            </button>
          </div>
          <ol className="plan-steps">
            {STEPS.map((label, index) => {
              const active = index === step;
              const done = index < step;
              return (
                <li key={label}>
                  <button
                    type="button"
                    className={`${active ? "active" : ""} ${done ? "done" : ""}`}
                    onClick={() => {
                      if (index < step) setStep(index);
                    }}
                    disabled={index > step}
                  >
                    <span className="plan-step-dot">{done ? <CheckIcon /> : index + 1}</span>
                    <span>{label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="plan-rail-foot">
            <span>{options?.capability.plannable ?? "—"} 颗可规划</span>
            <small>浙江省 · 5 km 网格 · TLE 每日同步</small>
          </div>
        </aside>

        <section className="plan-main">
          {optionsError ? (
            <div className="plan-error" role="alert">
              <strong>规划服务不可用</strong>
              <p>{optionsError}</p>
            </div>
          ) : null}
          {!options && !optionsError ? <div className="plan-loading">正在读取任务与范围…</div> : null}
          {options && tleStale ? (
            <div className="plan-error" role="alert">
              <strong>TLE 已过期</strong>
              <p>
                最新 TLE 年龄 {tleAge ?? "—"} 小时（超过 7 天）；先运行
                <code> rs-service sync</code> 再规划。
              </p>
            </div>
          ) : options && tle?.degraded ? (
            <p className="plan-warning">
              TLE 最大年龄 {tleAge}h（&gt;72h）；本次结果会标 degraded。
            </p>
          ) : null}
          {options ? stepContent() : null}

          {options ? (
            <footer className="plan-nav">
              <button
                type="button"
                className="plan-ghost"
                onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
              >
                {step === 0 ? "取消" : "上一步"}
              </button>
              {step < 4 ? (
                <button
                  type="button"
                  className="plan-primary"
                  disabled={!canGoNext}
                  onClick={() => setStep(step + 1)}
                >
                  下一步
                  <ArrowIcon />
                </button>
              ) : (
                <button type="button" className="plan-ghost" onClick={onClose}>
                  完成
                </button>
              )}
            </footer>
          ) : null}
        </section>
      </div>

      <MapDrawModal
        open={drawOpen}
        initialWkt={aoiWkt}
        onClose={() => setDrawOpen(false)}
        onComplete={(wkt) => {
          setAoiWkt(wkt);
          setDrawOpen(false);
        }}
      />
    </div>
  );
}
