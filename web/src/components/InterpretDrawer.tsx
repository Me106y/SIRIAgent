import { useEffect, useRef, useState } from "react";

import { api, uploadImage } from "../api";
import { fileUrl } from "../lib/fileLinks";
import type { DetectionResult, WorkspaceImage } from "../types";

interface SlotValue {
  path: string;
  name: string;
  width?: number;
  height?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const MAX_BYTES = 20 * 1024 * 1024;

function slotFromImage(image: WorkspaceImage): SlotValue {
  return {
    path: image.path,
    name: image.name,
    width: image.width,
    height: image.height,
  };
}

export function InterpretDrawer({ open, onClose }: Props) {
  const [images, setImages] = useState<WorkspaceImage[]>([]);
  const [before, setBefore] = useState<SlotValue | null>(null);
  const [after, setAfter] = useState<SlotValue | null>(null);
  const [activeSlot, setActiveSlot] = useState<"before" | "after">("before");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<"before" | "after">("before");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .workspaceImages()
      .then((payload) => {
        if (alive) setImages(payload.items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onClose]);

  const assign = (slot: "before" | "after", value: SlotValue) => {
    if (slot === "before") setBefore(value);
    else setAfter(value);
    setActiveSlot(slot === "before" ? "after" : "before");
  };

  // 从列表点选不依赖 activeSlot：先填前图，再填后图，两个都满时替换后图。
  // 避免连续点击时 React 批处理拿到同一个旧 activeSlot。
  const assignFromGallery = (image: WorkspaceImage) => {
    const value = slotFromImage(image);
    if (!before) {
      setBefore(value);
      setActiveSlot("after");
      return;
    }
    if (!after) {
      setAfter(value);
      setActiveSlot("before");
      return;
    }
    setAfter(value);
  };

  const chooseFile = (slot: "before" | "after") => {
    uploadTarget.current = slot;
    fileInput.current?.click();
  };

  const handleFile = async (file: File) => {
    if (!/\.(png|jpe?g)$/i.test(file.name)) {
      setError("只支持 PNG / JPG 图像。");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("单个文件不能超过 20MB。");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadImage(file);
      assign(uploadTarget.current, {
        path: uploaded.path,
        name: uploaded.name,
      });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      uploadTarget.current = activeSlot;
      void handleFile(file);
    }
  };

  const run = async () => {
    if (!before || !after || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.detectChange(before.path, after.path));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "检测失败");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="plan-overlay"
      role="dialog"
      aria-label="遥感解译"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="interpret-shell"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <header className="interpret-head">
          <div>
            <h2>遥感解译</h2>
            <p>
              本版只做变化检测；前后图可从工作区选择，也可拖拽或上传。模型为
              WHU-CD 建筑变化权重，模拟影像可能没有超过阈值的变化。
            </p>
          </div>
          <button
            type="button"
            className="plan-ghost"
            onClick={onClose}
            disabled={busy}
          >
            关闭
          </button>
        </header>

        <section className="interpret-top">
          <label className="interpret-field">
            <span>解译功能</span>
            <select value="change" disabled>
              <option value="change">变化检测（FlickCD）</option>
            </select>
          </label>

          <div className="interpret-slots">
            {(
              [
                ["before", "前图", before],
                ["after", "后图", after],
              ] as const
            ).map(([slot, label, value]) => (
              <button
                type="button"
                key={slot}
                className={`interpret-slot ${activeSlot === slot ? "active" : ""}`}
                onClick={() => setActiveSlot(slot)}
                onDoubleClick={() => chooseFile(slot)}
              >
                <span>{label}</span>
                {value ? (
                  <>
                    <b>{value.name}</b>
                    <em>
                      {value.width && value.height
                        ? `${value.width} × ${value.height}`
                        : "已选择"}
                    </em>
                  </>
                ) : (
                  <em>点击选中后，从下方挑选；双击上传</em>
                )}
              </button>
            ))}
          </div>

          <div className="interpret-actions">
            <button
              type="button"
              className="plan-ghost"
              onClick={() => chooseFile(activeSlot)}
              disabled={uploading || busy}
            >
              {uploading ? "上传中…" : "从文件夹上传"}
            </button>
            <button
              type="button"
              className="plan-primary"
              onClick={() => void run()}
              disabled={!before || !after || busy}
            >
              {busy ? "检测中…" : "开始检测"}
            </button>
          </div>

          <p className="interpret-hint">
            支持 PNG / JPG，单文件 ≤ 20MB；最大边超过 2048 会先缩放到 2048 再检测。
          </p>
        </section>

        {error && <div className="interpret-error">{error}</div>}

        <section className="interpret-gallery">
          <h3>工作区图像（{images.length}）</h3>
          {images.length === 0 ? (
            <p className="muted">还没有图像；先购买一份方案，或直接上传。</p>
          ) : (
            <div className="interpret-grid">
              {images.map((image) => (
                <button
                  type="button"
                  className="interpret-item"
                  key={image.path}
                  onClick={() => assignFromGallery(image)}
                  title={`放入${activeSlot === "before" ? "前图" : "后图"}`}
                >
                  <img src={fileUrl(image.path)} alt={image.name} loading="lazy" />
                  <span>{image.name}</span>
                  <small>
                    {image.kind === "purchase" ? "购买" : "上传"} ·{" "}
                    {image.width && image.height
                      ? `${image.width}×${image.height}`
                      : image.group}
                  </small>
                </button>
              ))}
            </div>
          )}
        </section>

        {result && (
          <section className="interpret-result">
            <h3>检测结果</h3>
            <div className="interpret-triple">
              {(
                [
                  [result.before_path, "前图"],
                  [result.after_path, "后图"],
                  [result.mask_path, "变化掩膜"],
                ] as const
              ).map(([path, label]) => (
                <figure key={label}>
                  <img src={fileUrl(path)} alt={label} />
                  <figcaption>{label}</figcaption>
                </figure>
              ))}
            </div>
            <div className="interpret-stats">
              <span>变化面积 {result.changed_px} px</span>
              <span>占比 {(result.changed_ratio * 100).toFixed(2)}%</span>
              <span>连通域 {result.components}</span>
              <span>耗时 {(result.elapsed_ms / 1000).toFixed(1)} s</span>
              <span>{result.device === "cuda" ? "GPU" : "CPU"}</span>
              {result.resized && <span>已缩放到 2048</span>}
            </div>
            {result.changed_px === 0 && (
              <p className="interpret-empty">
                未检测到超过 0.5 阈值的变化。可换一组差异更明显的图，例如沥青
                2014 / 2018，或火灾“灾前 / 灾中热红外”。
              </p>
            )}
            <p className="interpret-note">{result.accuracy_note}</p>
          </section>
        )}

        <input
          ref={fileInput}
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>
    </div>
  );
}
