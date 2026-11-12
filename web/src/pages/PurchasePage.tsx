import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import { fileUrl } from "../lib/fileLinks";
import type { PurchaseRecord } from "../types";

function formatTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PurchasePage({ purchaseId }: { purchaseId: string }) {
  const [record, setRecord] = useState<PurchaseRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const started = useRef(false);

  // 全局 body 是 overflow:hidden（主界面用），购买页内容更长，单独放开滚动。
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "auto";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const load = async () => {
      try {
        if (/^pur-/.test(purchaseId)) {
          const payload = await api.purchase(purchaseId);
          setRecord(payload.purchase);
          return;
        }
        // 从报告跳过来的是 run_id：首次进入才触发购买，成功后换成 purchase_id，
        // 刷新时走上面的只读分支，不会重复复制数据。
        const payload = await api.createPurchase(purchaseId);
        setRecord(payload.purchase);
        window.history.replaceState(
          {},
          "",
          `/purchase/${payload.purchase.purchase_id}`,
        );
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "购买失败");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [purchaseId]);

  const summary = record?.summary ?? {};
  const images = record?.image_files ?? [];

  return (
    <div className="purchase-page">
      <header className="purchase-brand">
        <strong>SIRIAgent</strong>
        <span>方案购买</span>
      </header>

      <main className="purchase-card">
        {loading && <div className="purchase-loading">正在准备遥感图像…</div>}

        {!loading && error && (
          <div className="purchase-error">
            <h1>购买未完成</h1>
            <p>{error}</p>
            <a className="purchase-ghost" href="/">
              返回平台
            </a>
          </div>
        )}

        {!loading && !error && record && (
          <>
            <div className="purchase-success">
              <svg viewBox="0 0 48 48" aria-hidden="true">
                <circle cx="24" cy="24" r="21" />
                <path d="M14 24.5l6.5 6.5L34 17.5" />
              </svg>
              <h1>购买成功</h1>
              <p>
                方案 <code>{record.run_id}</code> 的图像已保存到工作区。
              </p>
            </div>

            <div className="purchase-meta">
              <div>
                <span>城市</span>
                <b>{summary.city || "—"}</b>
              </div>
              <div>
                <span>时间窗</span>
                <b>
                  {formatTime(summary.window_start)} – {formatTime(summary.window_end)}
                </b>
              </div>
              <div>
                <span>选中卫星</span>
                <b>{summary.sat_count ?? "—"}</b>
              </div>
              <div>
                <span>达标面积</span>
                <b>
                  {summary.qualified_area_pct != null
                    ? `${summary.qualified_area_pct.toFixed(1)}%`
                    : "—"}
                </b>
              </div>
              <div>
                <span>数据目录</span>
                <b>{record.workspace_dir}</b>
              </div>
              <div>
                <span>图像数量</span>
                <b>{images.length}</b>
              </div>
            </div>

            <div className="purchase-actions">
              <a className="purchase-primary" href="#images">
                查看遥感图像
              </a>
              <a className="purchase-ghost" href="/">
                返回平台
              </a>
            </div>

            <p className="purchase-note">
              模拟数据 · 非真实卫星观测，仅用于平台演示与流程验证。
            </p>

            <section className="purchase-images" id="images">
              <h2>遥感图像（{images.length}）</h2>
              <div className="purchase-grid">
                {images.map((file) => {
                  return (
                    <a
                      className="purchase-item"
                      key={file.name}
                      href={fileUrl(file.path)}
                      target="_blank"
                      rel="noopener"
                    >
                      <img src={fileUrl(file.path)} alt={file.label} loading="lazy" />
                      <span>
                        {file.label}（{file.name}）
                      </span>
                      {file.width && file.height && (
                        <small>
                          {file.width} × {file.height}
                        </small>
                      )}
                    </a>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
