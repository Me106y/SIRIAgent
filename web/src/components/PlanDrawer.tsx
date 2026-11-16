import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { fileUrl } from "../lib/fileLinks";
import type {
  PlanAoi,
  PlanCreateBody,
  PlanHistory,
  PlanHistoryItem,
  PlanJob,
  PlanOptions,
  PlanResult,
  PurchaseRecord,
  ReportInfo,
} from "../types";
import { MapDrawModal } from "./MapDrawModal";

interface Props {
  open: boolean;
  onClose: () => void;
  onAnalyze: (path: string) => void;
}

const STEPS = ["范围", "重访", "约束", "求解与报告"];
const LEVEL_LABELS: Record<string, string> = {
  city: "市级",
  district: "区县",
};
const JOB_KEY = "siri.plan.job";
const PROGRESS_STAGES = [
  { key: "prepare", label: "读取卫星与 TLE" },
  { key: "grid", label: "生成网格" },
  { key: "opportunities", label: "传播与过境机会" },
  { key: "cloud", label: "云量过滤" },
  { key: "selection", label: "选星（贪心 + ILP）" },
  { key: "metrics", label: "指标计算" },
  { key: "playback", label: "回放与报告数据" },
];
const RESOLUTION_OPTIONS = [1, 2, 5, 10];

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

function HistoryIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 4.2V8l2.6 1.6" />
      <path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.8" />
      <path d="M13.4 1.8v2.6h-2.6" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`history-chevron ${open ? "open" : ""}`}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatMoment(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function formatDuration(minutes: number | null | undefined): string {
  const value = formatNumber(minutes ?? null, 0);
  if (value === "—") return "—";
  return Number(minutes) >= 120 ? `${formatNumber(Number(minutes) / 60, 1)} h` : `${value} 分`;
}

function formatElapsed(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function formatKpi(item: PlanHistoryItem): string {
  const value = item.kpi?.value;
  if (value == null || Number.isNaN(value)) return "—";
  const unit = item.kpi?.unit ?? "";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "h") return `${value.toFixed(1)} h`;
  return `${Math.round(value)} ${unit}`.trim();
}

function aoiDigits(item: PlanAoi): string {
  return (item.adcode || item.code || "").replace(/\D/g, "");
}

function parentCityCode(item: PlanAoi): string {
  const digits = aoiDigits(item);
  return digits.length >= 4 ? `${digits.slice(0, 4)}00` : "";
}

function windowHours(hours: number): number {
  return Math.min(3 * hours, 168);
}

export function PlanDrawer({ open, onClose, onAnalyze }: Props) {
  const [options, setOptions] = useState<PlanOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [hasFixedPair, setHasFixedPair] = useState(false);
  const [step, setStep] = useState(0);
  const [cityCode, setCityCode] = useState("330100");
  const [districtCode, setDistrictCode] = useState("");
  const [aoiWkt, setAoiWkt] = useState("");
  const [drawOpen, setDrawOpen] = useState(false);
  const [startLocal, setStartLocal] = useState(nowLocal);
  const [revisitHours, setRevisitHours] = useState(48);
  const [maxResolution, setMaxResolution] = useState(10);
  const [cloud, setCloud] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<PlanJob | null>(null);
  const [jobSummary, setJobSummary] = useState<{
    aoi_label: string;
    revisit_hours: number;
    max_resolution_m: number;
    cloud_filter: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportInfo | null>(null);
  const [reporting, setReporting] = useState(false);
  const [view, setView] = useState<"wizard" | "history">("wizard");
  const [history, setHistory] = useState<PlanHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<Record<string, string>>({});
  const [historySeq, setHistorySeq] = useState(0);
  const [, setTick] = useState(0);

  const effectiveCode = districtCode || cityCode;
  const aoi = useMemo(
    () => options?.aoi.find((item) => item.code === effectiveCode) ?? null,
    [options, effectiveCode],
  );
  const cities = useMemo(
    () => (options?.aoi ?? []).filter((item) => item.level === "city"),
    [options],
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
        const firstCity = payload.aoi.find((item) => item.level === "city");
        setCityCode((current) => current || firstCity?.code || "");
        setDistrictCode("");
        setCloud(Boolean(payload.revisit?.cloud_filter_default));
        setRevisitHours(payload.revisit?.default_hours ?? 48);
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
    let alive = true;
    api
      .buildingChange()
      .then((payload) => {
        if (alive) setHasFixedPair(payload.image_files.length >= 2);
      })
      .catch(() => {
        if (alive) setHasFixedPair(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // 关闭抽屉不丢任务：重开时从 localStorage 恢复 job_id。
  useEffect(() => {
    if (!open || jobId) return;
    const stored = window.localStorage.getItem(JOB_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as {
        job_id?: string;
        aoi_label?: string;
        revisit_hours?: number;
        max_resolution_m?: number;
        cloud_filter?: boolean;
      };
      if (parsed?.job_id) {
        setJobId(parsed.job_id);
        setStep(3);
        setJobSummary({
          aoi_label: parsed.aoi_label ?? "—",
          revisit_hours: parsed.revisit_hours ?? 48,
          max_resolution_m: parsed.max_resolution_m ?? 10,
          cloud_filter: Boolean(parsed.cloud_filter),
        });
        setRevisitHours(parsed.revisit_hours ?? 48);
        setMaxResolution(parsed.max_resolution_m ?? 10);
        setCloud(Boolean(parsed.cloud_filter));
      }
    } catch {
      setJobId(stored);
      setStep(3);
    }
  }, [open, jobId]);

  useEffect(() => {
    if (!open || view !== "history") return;
    let alive = true;
    setHistoryLoading(true);
    Promise.all([
      api.planHistory(),
      api.purchases().catch(() => ({ ok: false, items: [] as PurchaseRecord[] })),
    ])
      .then(([snapshot, purchases]) => {
        if (!alive) return;
        setHistory(snapshot);
        const bought: Record<string, string> = {};
        for (const item of purchases.items ?? []) {
          if (item?.run_id && !bought[item.run_id]) bought[item.run_id] = item.purchase_id;
        }
        setPurchased(bought);
        setHistoryError(null);
      })
      .catch((reason: unknown) => {
        if (alive) setHistoryError(reason instanceof Error ? reason.message : "历史报告读取失败");
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, view, historySeq]);

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

  // 选星阶段可能 60s 没有新的 progress 事件；本地每秒刷新已用时间，避免看起来卡死。
  useEffect(() => {
    if (job?.status !== "queued" && job?.status !== "running") return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [job?.status]);

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
        if (data.status === "completed" || data.status === "failed") {
          window.localStorage.removeItem(JOB_KEY);
          return;
        }
      } catch (reason: unknown) {
        failures += 1;
        const message = reason instanceof Error ? reason.message : "状态查询失败";
        if (alive) {
          if (/404/.test(message)) {
            window.localStorage.removeItem(JOB_KEY);
            setJobId(null);
            setPollError("任务已失效（服务可能重启过），请重新求解。");
            return;
          }
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
    if (index === 0) return Boolean(effectiveCode || aoiWkt);
    if (index === 1) return Boolean(startLocal) && (revisitHours === 48 || revisitHours === 72);
    return true;
  };

  const canGoNext = stepValid(step);
  const busy = job?.status === "queued" || job?.status === "running";
  const progress = job?.progress ?? null;
  const elapsedSeconds = job?.created_at
    ? Math.max(0, (Date.now() - new Date(job.created_at).getTime()) / 1000)
    : progress?.elapsed_s ?? null;

  const buildBody = (): PlanCreateBody => ({
    operation: "revisit",
    aoi_code: aoiWkt ? null : effectiveCode,
    aoi_wkt: aoiWkt || null,
    start_utc: new Date(startLocal).toISOString(),
    revisit_hours: revisitHours,
    sensor_types: ["optical"],
    max_resolution_m: maxResolution,
    cloud_filter: cloud,
    cloud_threshold_pct: 70,
  });

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
      const summary = {
        job_id: created.job_id,
        aoi_label: aoiWkt ? "自定义多边形" : aoi?.name ?? effectiveCode,
        revisit_hours: revisitHours,
        max_resolution_m: maxResolution,
        cloud_filter: cloud,
      };
      setJobSummary(summary);
      window.localStorage.setItem(JOB_KEY, JSON.stringify(summary));
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
    window.localStorage.removeItem(JOB_KEY);
    setJobId(null);
    setJob(null);
    setJobSummary(null);
    setReport(null);
    setError(null);
    setPollError(null);
    setStep(2);
  };

  const renderAoiStep = () => (
    <div className="plan-step" key="aoi">
      <header className="plan-step-head">
        <h2>框定目标范围</h2>
        <p>只支持浙江省内的市、区县，或在地图上画一个多边形（面积上限 2 万 km²）。</p>
      </header>
      <div className="plan-grid-2">
        <label className="plan-field">
          <span>市</span>
          <select
            value={cityCode}
            onChange={(event) => {
              setCityCode(event.target.value);
              setDistrictCode("");
              setAoiWkt("");
            }}
            disabled={Boolean(aoiWkt)}
          >
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
            disabled={Boolean(aoiWkt) || districts.length === 0}
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
          {aoi.level ? `（${LEVEL_LABELS[aoi.level] ?? aoi.level}）` : ""}；省级范围本版不开放。
        </p>
      ) : null}
    </div>
  );

  const renderRevisitStep = () => (
    <div className="plan-step" key="revisit">
      <header className="plan-step-head">
        <h2>给定重访时间</h2>
        <p>窗口由系统派生：W = min(3T, 168h)。窗口不能太短，否则“覆盖一次”也会被误判成重访达标。</p>
      </header>
      <div className="plan-chips" role="group" aria-label="重访时间">
        {[48, 72].map((hours) => (
          <button
            key={hours}
            type="button"
            className={`plan-chip ${revisitHours === hours ? "active" : ""}`}
            onClick={() => setRevisitHours(hours)}
          >
            {hours} 小时
          </button>
        ))}
      </div>
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
          <span>评估窗口</span>
          <div className="plan-readout">
            <strong>{windowHours(revisitHours)} h</strong>
            <small>
              {3 * revisitHours > 168
                ? `3T = ${3 * revisitHours} h，受 TLE 7 天上限截断（2.33T）`
                : `3T = ${3 * revisitHours} h`}
            </small>
          </div>
        </div>
      </div>
      <p className="plan-note">开始时间按本机时区填写，提交时转成 UTC；面积目标固定 100%。</p>
    </div>
  );

  const renderConstraintStep = () => (
    <div className="plan-step" key="constraints">
      <header className="plan-step-head">
        <h2>载荷与云量</h2>
        <p>本版只对光学做 100% 承诺；高光谱仍保留在目录与星历里，但不参与本场景选星。</p>
      </header>
      <div className="plan-grid-2">
        <label className="plan-field">
          <span>最大分辨率</span>
          <select
            value={maxResolution}
            onChange={(event) => setMaxResolution(Number(event.target.value))}
          >
            {RESOLUTION_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} m
              </option>
            ))}
          </select>
        </label>
        <div className="plan-field">
          <span>可规划目录</span>
          <div className="plan-readout">
            <strong>{options?.capability.plannable ?? "—"} 颗</strong>
            <small>
              ≤{maxResolution} m 光学 · TLE 最大年龄 {options?.tle?.max_age_hours ?? "—"} h
            </small>
          </div>
        </div>
      </div>
      <label className="plan-switch">
        <input type="checkbox" checked={cloud} onChange={(event) => setCloud(event.target.checked)} />
        <span>
          按云量过滤
          <small>默认关闭。开启后按 AOI 内网格代表点的 Open-Meteo 逐小时 cloud_cover 剔除访问，100% 目标会受天气影响。</small>
        </span>
      </label>
    </div>
  );

  const tle = options?.tle;
  const tleStale = Boolean(tle?.stale);
  const result = job?.result ?? null;

  const renderProgress = () => {
    const stageKey = progress?.stage ?? "queued";
    const cloudOn = jobSummary?.cloud_filter ?? cloud;
    const stages = cloudOn
      ? PROGRESS_STAGES
      : PROGRESS_STAGES.filter((item) => item.key !== "cloud");
    const activeIndex = stages.findIndex((item) => item.key === stageKey);
    return (
      <div className="plan-progress" role="status" aria-live="polite">
        <div className="plan-progress-head">
          <span className="plan-spinner" />
          <div>
            <strong>{progress?.label ?? (job?.status === "queued" ? "排队中…" : "准备中…")}</strong>
            <p>
              已用 {formatElapsed(elapsedSeconds)} · {Math.round(progress?.pct ?? 0)}%
            </p>
          </div>
        </div>
        <div className="plan-progress-bar" aria-hidden="true">
          <span style={{ width: `${Math.max(2, progress?.pct ?? 0)}%` }} />
        </div>
        <ol className="plan-progress-stages">
          {stages.map((item, index) => {
            const done = stageKey === "done" || (activeIndex >= 0 && index < activeIndex);
            const active = activeIndex === index;
            const current =
              active && progress?.current != null && progress?.total != null
                ? ` · ${progress.current}/${progress.total}`
                : "";
            return (
              <li key={item.key} className={`${done ? "done" : ""} ${active ? "active" : ""}`}>
                <span className="plan-progress-dot">{done ? <CheckIcon /> : index + 1}</span>
                <span>
                  {item.label}
                  {current}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="plan-note">
          任务 {jobId}；关闭抽屉不会中断后台任务，重开可以从这里继续看。这里不估算剩余时间。
        </p>
      </div>
    );
  };

  const renderResult = (value: PlanResult) => {
    const cards = value.summary_cards ?? {};
    const sats = value.report_data?.sats ?? [];
    const feasible = Boolean(value.feasible);
    const targetLabel = `达标面积（最长重访 ≤ ${value.targets?.revisit_hours ?? revisitHours} h · 目标 100%）`;
    const ceiling = cards.ceiling_area_pct;
    const suggestion = value.suggestion;
    return (
      <div className="plan-result">
        <div className={`plan-verdict ${feasible ? "ok" : "warn"}`}>
          <strong>{feasible ? "目标可行" : "未达标"}</strong>
          <span>
            {value.optimality ?? "—"} · 窗口 {value.window?.used_horizon_h ?? "—"}h
            {value.window?.capped_by_tle ? "（受 TLE 上限限制）" : ""} · 候选{" "}
            {value.candidate_count ?? "—"} 颗
          </span>
        </div>
        <div className="plan-stats">
          <div>
            <span>选中卫星</span>
            <strong>{cards.satellite_count ?? sats.length}</strong>
          </div>
          <div>
            <span>{targetLabel}</span>
            <strong>{formatNumber(cards.qualified_area_pct)}%</strong>
          </div>
          <div>
            <span>全目录上限</span>
            <strong>{formatNumber(ceiling)}%</strong>
          </div>
          <div>
            <span>面积加权 MRT</span>
            <strong>{formatDuration(cards.area_weighted_mrt_minutes)}</strong>
          </div>
        </div>

        {!feasible ? (
          <p className="plan-note">
            未达标：全目录上限 {formatNumber(ceiling)}%。这不是选星算法偷懒——把全部候选星一起算也只有这个面积。
          </p>
        ) : (
          <p className="plan-note">
            面积口径：全部 5km 网格代表点都在 {value.targets?.revisit_hours ?? revisitHours} 小时内被重访；MRT 含夜间与窗口首尾空档。
          </p>
        )}
        {!feasible && suggestion ? (
          <p className="plan-note">
            出路：放宽到 ≤{suggestion.max_resolution_m} m 后，{suggestion.estimated_sats} 颗{" "}
            {suggestion.source} 可在同窗口做到 100%（{suggestion.basis}）。这只是建议，不会自动切换。
          </p>
        ) : null}
        {value.window?.capped_by_tle ? (
          <p className="plan-note">
            请求窗口 {3 * revisitHours}h，实际按 {value.window.used_horizon_h}h 计算（TLE 7 天上限）。
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
                  disabled={!hasFixedPair}
                  title={hasFixedPair ? undefined : "先购买方案获得图像"}
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
        <p>求解在 RS-Service 里执行；关闭抽屉不会中断后台任务，重开可以继续看进度。</p>
      </header>

      <dl className="plan-summary">
        <div>
          <dt>范围</dt>
          <dd>{jobSummary?.aoi_label ?? (aoiWkt ? "自定义多边形" : aoi?.name ?? effectiveCode)}</dd>
        </div>
        <div>
          <dt>重访</dt>
          <dd>
            ≤ {jobSummary?.revisit_hours ?? revisitHours} h · 窗口 {windowHours(
              jobSummary?.revisit_hours ?? revisitHours,
            )} h
          </dd>
        </div>
        <div>
          <dt>约束</dt>
          <dd>
            光学 · ≤{jobSummary?.max_resolution_m ?? maxResolution} m ·{" "}
            {(jobSummary?.cloud_filter ?? cloud) ? "云量过滤" : "不过滤云量"}
          </dd>
        </div>
      </dl>

      {error ? (
        <div className="plan-error" role="alert">
          {error}
        </div>
      ) : null}

      {pollError && !error ? <p className="plan-note">状态查询暂时失败，正在重试：{pollError}</p> : null}

      {!jobId ? (
        <button type="button" className="plan-solve" onClick={() => void solve()} disabled={tleStale}>
          开始求解
          <ArrowIcon />
        </button>
      ) : null}

      {busy ? renderProgress() : null}

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

  const renderHistoryCard = (run: PlanHistoryItem) => {
    const purchaseId = purchased[run.run_id];
    const custom = run.aoi_kind === "custom";
    return (
      <article className="history-card" key={run.run_id}>
        <div className="history-card-top">
          <span className="history-card-numeral">◷</span>
          <span className={`history-card-area${custom ? " custom" : ""}`}>
            {run.area_name || "—"}
          </span>
          {purchaseId ? (
            <span className="history-card-bought" title={`购买单 ${purchaseId}`}>
              已购买
            </span>
          ) : null}
        </div>
        <div className="history-card-kpi">
          <strong>{formatKpi(run)}</strong>
          <span>{run.kpi?.label ?? "KPI"}</span>
          <em>{run.sat_count} 颗星</em>
        </div>
        <div className="history-card-meta">
          <span className="mono">id {run.run_id}</span>
          <span>{formatMoment(run.created_at)}</span>
        </div>
        <div className="history-card-window mono">
          {formatMoment(run.window_start)} → {formatMoment(run.window_end)}
        </div>
        <div className="history-card-actions">
          <a className="plan-primary" href={fileUrl(run.relative_report)} target="_blank" rel="noopener">
            打开报告
          </a>
          <button type="button" className="plan-ghost" onClick={() => onAnalyze(run.relative_plan)}>
            让 Agent 分析
          </button>
        </div>
      </article>
    );
  };

  const renderHistoryView = () => {
    const runs = history?.runs ?? [];
    const empty = history !== null && !historyLoading && !historyError && history.total === 0;
    return (
      <div className="history" key="history">
        <header className="history-head">
          <div>
            <span className="plan-mark">归档</span>
            <h2>历史结果</h2>
            <p>一份报告一张卡；旧 task1~task5 的报告也在这里，点开仍是当时的四节报告。</p>
          </div>
          <button type="button" className="plan-ghost" onClick={() => setView("wizard")}>
            返回向导
          </button>
        </header>

        {historyLoading && !history ? <div className="plan-loading">正在读取历史报告…</div> : null}

        {historyError ? (
          <div className="plan-error" role="alert">
            <strong>历史报告读取失败</strong>
            <p>{historyError}</p>
            <button type="button" className="plan-ghost" onClick={() => setHistorySeq((value) => value + 1)}>
              重试
            </button>
          </div>
        ) : null}

        {empty ? (
          <div className="history-empty">
            <strong>还没有历史报告</strong>
            <p>先完成一次求解；报告会归档到这里。</p>
            <button type="button" className="plan-primary" onClick={() => setView("wizard")}>
              回到向导
            </button>
          </div>
        ) : null}

        {runs.length > 0 ? <div className="history-grid">{runs.map(renderHistoryCard)}</div> : null}
      </div>
    );
  };

  const stepContent = [renderAoiStep, renderRevisitStep, renderConstraintStep, renderSolveStep][step];

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
              <h2>区域重访</h2>
            </div>
            <button type="button" className="plan-close" onClick={onClose} aria-label="关闭">
              <CloseIcon />
            </button>
          </div>
          <ol className="plan-steps">
            {STEPS.map((label, index) => {
              const active = view === "wizard" && index === step;
              const done = index < step;
              return (
                <li key={label}>
                  <button
                    type="button"
                    className={`${active ? "active" : ""} ${done ? "done" : ""}`}
                    aria-current={active ? "step" : undefined}
                    onClick={() => {
                      if (view === "history") {
                        setView("wizard");
                        if (index <= step) setStep(index);
                        return;
                      }
                      if (index < step) setStep(index);
                    }}
                    disabled={view === "wizard" && index > step}
                  >
                    <span className="plan-step-dot">{done ? <CheckIcon /> : index + 1}</span>
                    <span>{label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="plan-rail-split" role="separator" aria-orientation="horizontal" />
          <button
            type="button"
            className={`plan-rail-history${view === "history" ? " active" : ""}`}
            aria-pressed={view === "history"}
            aria-label="历史结果"
            onClick={() => setView(view === "history" ? "wizard" : "history")}
          >
            <span className="plan-rail-history-icon">
              <HistoryIcon />
            </span>
            <span>历史结果</span>
            {history && history.total > 0 ? <em>{history.total}</em> : null}
          </button>
          <div className="plan-rail-foot">
            <span>{options?.capability.plannable ?? "—"} 颗可规划</span>
            <small>浙江省 · 5 km 网格 · 光学 ≤10m</small>
          </div>
        </aside>

        <section className={`plan-main${view === "history" ? " is-history" : ""}`}>
          {view === "wizard" && optionsError ? (
            <div className="plan-error" role="alert">
              <strong>规划服务不可用</strong>
              <p>{optionsError}</p>
            </div>
          ) : null}
          {view === "wizard" && !options && !optionsError ? (
            <div className="plan-loading">正在读取任务与范围…</div>
          ) : null}
          {view === "wizard" && options && tleStale ? (
            <div className="plan-error" role="alert">
              <strong>TLE 已过期</strong>
              <p>
                最新 TLE 年龄 {tle?.max_age_hours ?? "—"} 小时（超过 7 天）；先运行
                <code> rs-service sync</code> 再规划。
              </p>
            </div>
          ) : null}
          {view === "wizard" && options ? stepContent() : null}
          {view === "history" ? renderHistoryView() : null}

          {view === "wizard" && options ? (
            <footer className="plan-nav">
              <button
                type="button"
                className="plan-ghost"
                onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
              >
                {step === 0 ? "取消" : "上一步"}
              </button>
              {step < 3 ? (
                <button type="button" className="plan-primary" disabled={!canGoNext} onClick={() => setStep(step + 1)}>
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
