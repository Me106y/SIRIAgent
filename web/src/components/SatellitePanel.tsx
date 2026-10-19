import { useMemo, useState } from "react";

import type { PassItem, PositionItem, Satellite } from "../types";

const CATEGORY_LABEL: Record<string, string> = {
  commercial: "商业",
  civil: "民用",
  meteorology: "气象海洋",
};

interface Props {
  satellites: Satellite[];
  positions: Record<number, PositionItem>;
  selected: number | null;
  passes: PassItem[];
  tleAge: number | null;
  onSelect: (norad: number) => void;
  onFocus: () => void;
}

export function SatellitePanel({
  satellites,
  positions,
  selected,
  passes,
  tleAge,
  onSelect,
  onFocus,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const filtered = useMemo(() => {
    const keyword = query.trim().toUpperCase();
    return satellites.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!keyword) return true;
      return (
        item.name.toUpperCase().includes(keyword) ||
        String(item.norad).includes(keyword)
      );
    });
  }, [satellites, query, category]);

  const current = selected
    ? satellites.find((item) => item.norad === selected) || null
    : null;

  return (
    <section className="sat-panel">
      <div className="panel-head">
        <div>
          <h2>卫星目录</h2>
          <p>{filtered.length} / {satellites.length} 颗</p>
        </div>
        <span className="live-dot" title="每 5 秒刷新位置" />
      </div>

      <div className="sat-tools">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名称 / NORAD"
          aria-label="搜索卫星"
        />
        <div className="chips">
          {[
            ["all", "全部"],
            ["commercial", "商业"],
            ["civil", "民用"],
            ["meteorology", "气象海洋"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={category === value ? "chip active" : "chip"}
              onClick={() => setCategory(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="sat-list">
        {filtered.map((item) => {
          const position = positions[item.norad];
          return (
            <li key={item.norad}>
              <button
                type="button"
                className={item.norad === selected ? "sat-row active" : "sat-row"}
                onClick={() => onSelect(item.norad)}
              >
                <span
                  className={`sat-dot cat-${item.category}`}
                  aria-hidden="true"
                />
                <span className="sat-name">
                  <strong>{item.name}</strong>
                  <small>
                    {item.norad} · {CATEGORY_LABEL[item.category] || item.category}
                  </small>
                </span>
                <span className="sat-meta">
                  {position ? `${position.alt_km.toFixed(0)} km` : item.orbit_regime}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {current && (
        <div className="sat-detail">
          <div className="detail-head">
            <div>
              <h3>{current.name}</h3>
              <p>
                NORAD {current.norad} · {current.operator || "—"}
              </p>
            </div>
            <div className="detail-actions">
              {!current.payload_public && <span className="tag warn">仅轨道</span>}
              <button type="button" className="ghost" onClick={onFocus}>
                聚焦
              </button>
            </div>
          </div>
          <div className="detail-grid">
            <span>类别</span>
            <b>{CATEGORY_LABEL[current.category] || current.category}</b>
            <span>轨道</span>
            <b>{current.orbit_regime || "—"}</b>
            <span>TLE 年龄</span>
            <b>{tleAge != null ? `${tleAge.toFixed(1)} h` : "—"}</b>
            <span>载荷</span>
            <b>{current.payload_public ? "公开" : "未公开"}</b>
          </div>
          <h4>未来 24h 过境</h4>
          {passes.length === 0 ? (
            <p className="muted">暂无过境数据（检查 TLE 是否已同步）。</p>
          ) : (
            <table className="pass-table">
              <thead>
                <tr>
                  <th>AOS</th>
                  <th>最高仰角</th>
                  <th>光学</th>
                </tr>
              </thead>
              <tbody>
                {passes.slice(0, 4).map((item) => (
                  <tr key={item.aos_utc}>
                    <td>{formatTime(item.aos_utc)}</td>
                    <td>{item.max_elev_deg.toFixed(0)}°</td>
                    <td>
                      {item.optical_imaging_ok ? (
                        <span className="tag ok">可用</span>
                      ) : (
                        <span className="tag plain">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
