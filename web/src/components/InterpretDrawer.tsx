import { useEffect, useRef, useState } from "react";

import { api, uploadImage } from "../api";
import { fileUrl } from "../lib/fileLinks";
import type {
  DetectionResult,
  ObjectDetectionResult,
  SemanticSegmentationResult,
  WorkspaceImage,
} from "../types";

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

type FuncKey = "change" | "object" | "semantic";

interface FuncSpec {
  key: FuncKey;
  label: string;
  hint: string;
  dual: boolean;
}

const FUNCS: FuncSpec[] = [
  {
    key: "change",
    label: "变化检测",
    hint: "双图：变化前 / 变化后，FlickCD 建筑变化权重",
    dual: true,
  },
  {
    key: "object",
    label: "目标检测",
    hint: "单图：YOLOX-S COCO 80 类预训练",
    dual: false,
  },
  {
    key: "semantic",
    label: "语义分割",
    hint: "单图：SparseMask OpenEarthMap 8 类",
    dual: false,
  },
];

const MAX_BYTES = 20 * 1024 * 1024;

function slotFromImage(image: WorkspaceImage): SlotValue {
  return {
    path: image.path,
    name: image.name,
    width: image.width,
    height: image.height,
  };
}

function kindLabel(image: WorkspaceImage): string {
  return image.kind === "purchase" ? "购买" : image.kind === "demo" ? "示例" : "上传";
}

export function InterpretDrawer({ open, onClose }: Props) {
  const [images, setImages] = useState<WorkspaceImage[]>([]);
  const [func, setFunc] = useState<FuncKey>("change");
  const [before, setBefore] = useState<SlotValue | null>(null);
  const [after, setAfter] = useState<SlotValue | null>(null);
  const [single, setSingle] = useState<SlotValue | null>(null);
  const [activeSlot, setActiveSlot] = useState<"before" | "after" | "single">("before");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changeResult, setChangeResult] = useState<DetectionResult | null>(null);
  const [objectResult, setObjectResult] = useState<ObjectDetectionResult | null>(null);
  const [semanticResult, setSemanticResult] = useState<SemanticSegmentationResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<"before" | "after" | "single">("before");

  const spec = FUNCS.find((item) => item.key === func) ?? FUNCS[0];

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

  const resetResult = () => {
    setChangeResult(null);
    setObjectResult(null);
    setSemanticResult(null);
    setError(null);
  };

  const changeFunc = (next: FuncKey) => {
    if (next === func) return;
    setFunc(next);
    resetResult();
    // 切换功能时清空不兼容的槽位。
    if (next === "change") {
      setSingle(null);
      setActiveSlot(before ? "after" : "before");
    } else {
      setBefore(null);
      setAfter(null);
      setActiveSlot("single");
    }
  };

  const assign = (slot: "before" | "after" | "single", value: SlotValue) => {
    if (slot === "before") setBefore(value);
    else if (slot === "after") setAfter(value);
    else setSingle(value);
    setActiveSlot(slot === "before" ? "after" : slot === "after" ? "before" : "single");
  };

  // 从列表点选不依赖 activeSlot：先填前图，再填后图，两个都满时替换后图。
  const assignFromGallery = (image: WorkspaceImage) => {
    const value = slotFromImage(image);
    if (!spec.dual) {
      setSingle(value);
      setActiveSlot("single");
      return;
    }
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

  const chooseFile = (slot: "before" | "after" | "single") => {
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

  const ready = spec.dual ? Boolean(before && after) : Boolean(single);

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    resetResult();
    try {
      if (spec.dual && before && after) {
        setChangeResult(await api.detectChange(before.path, after.path));
      } else if (func === "object" && single) {
        setObjectResult(await api.detectObjects(single.path));
      } else if (func === "semantic" && single) {
        setSemanticResult(await api.segmentSemantics(single.path));
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "解译失败");
    } finally {
      setBusy(false);
    }
  };

  const workspaceImages = images.filter((image) => image.kind !== "demo");
  const demoImages = images.filter((image) => image.kind === "demo");

  if (!open) return null;

  const renderGallery = (items: WorkspaceImage[], title: string, empty: string) => (
    <section className="interpret-gallery">
      <h3>
        {title}（{items.length}）
      </h3>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="interpret-grid">
          {items.map((image) => (
            <button
              type="button"
              className="interpret-item"
              key={image.path}
              onClick={() => assignFromGallery(image)}
              title={`放入${spec.dual ? (activeSlot === "after" ? "后图" : "前图") : "输入图"}`}
            >
              <img src={fileUrl(image.path)} alt={image.name} loading="lazy" />
              <span>{image.name}</span>
              <small>
                {kindLabel(image)} ·{" "}
                {image.width && image.height ? `${image.width}×${image.height}` : image.group}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div
      className="plan-overlay"
      role="dialog"
      aria-label="遥感解译"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="interpret-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <header className="interpret-head">
          <div>
            <h2>遥感解译</h2>
            <p>{spec.hint}。可从工作区或示例图选择，也可拖拽 / 上传。</p>
          </div>
          <button type="button" className="plan-ghost" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>

        <section className="interpret-top">
          <div className="interpret-funcs" role="tablist" aria-label="解译功能">
            {FUNCS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={item.key === func}
                className={`interpret-func ${item.key === func ? "active" : ""}`}
                onClick={() => changeFunc(item.key)}
                disabled={busy}
              >
                {item.label}
              </button>
            ))}
          </div>

          {spec.dual ? (
            <div className="interpret-slots">
              {(
                [
                  ["before", "前图", before],
                  ["after", "后图", after],
                ] as const
              ).map(([slot, label, value]) => (
                <div
                  key={slot}
                  className={`interpret-slot ${activeSlot === slot ? "active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveSlot(slot)}
                  onDoubleClick={() => chooseFile(slot)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveSlot(slot);
                    }
                  }}
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
                      <button
                        type="button"
                        className="interpret-clear"
                        aria-label={`清除${label}`}
                        title={`清除${label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (slot === "before") setBefore(null);
                          else setAfter(null);
                          setActiveSlot(slot);
                        }}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <em>点击选中后，从下方挑选；双击上传</em>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="interpret-slots single">
              <div
                className={`interpret-slot ${activeSlot === "single" ? "active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setActiveSlot("single")}
                onDoubleClick={() => chooseFile("single")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveSlot("single");
                  }
                }}
              >
                <span>输入图</span>
                {single ? (
                  <>
                    <b>{single.name}</b>
                    <em>
                      {single.width && single.height
                        ? `${single.width} × ${single.height}`
                        : "已选择"}
                    </em>
                    <button
                      type="button"
                      className="interpret-clear"
                      aria-label="清除输入图"
                      title="清除输入图"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSingle(null);
                        setActiveSlot("single");
                      }}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <em>点击选中后，从下方挑选；双击上传</em>
                )}
              </div>
            </div>
          )}

          <div className="interpret-actions">
            <button
              type="button"
              className="plan-ghost"
              onClick={() => chooseFile(spec.dual ? activeSlot : "single")}
              disabled={uploading || busy}
            >
              {uploading ? "上传中…" : "从文件夹上传"}
            </button>
            <button
              type="button"
              className="plan-primary"
              onClick={() => void run()}
              disabled={!ready || busy}
            >
              {busy ? "解译中…" : "开始解译"}
            </button>
          </div>

          <p className="interpret-hint">
            支持 PNG / JPG，单文件 ≤ 20MB；最大边超过 2048 会先缩小再解译。
          </p>
        </section>

        {error && <div className="interpret-error">{error}</div>}

        {renderGallery(workspaceImages, "工作区图像", "还没有图像；先购买一份方案，或直接上传。")}
        {renderGallery(demoImages, "示例图", "示例图未就绪（demo/images 为空）。")}

        {changeResult && (
          <section className="interpret-result">
            <h3>变化检测结果</h3>
            <div className="interpret-triple">
              {(
                [
                  [changeResult.before_path, "前图"],
                  [changeResult.after_path, "后图"],
                  [changeResult.mask_path, "变化掩膜"],
                ] as const
              ).map(([path, label]) => (
                <figure key={label}>
                  <img src={fileUrl(path)} alt={label} />
                  <figcaption>{label}</figcaption>
                </figure>
              ))}
            </div>
            <div className="interpret-stats">
              <span>变化面积 {changeResult.changed_px} px</span>
              <span>占比 {(changeResult.changed_ratio * 100).toFixed(2)}%</span>
              <span>连通域 {changeResult.components}</span>
              <span>耗时 {(changeResult.elapsed_ms / 1000).toFixed(1)} s</span>
              <span>{changeResult.device === "cuda" ? "GPU" : "CPU"}</span>
              {changeResult.resized && <span>已缩放到 2048</span>}
            </div>
            {changeResult.changed_px === 0 && (
              <p className="interpret-empty">
                未检测到超过 0.5 阈值的变化。可换一组差异更明显的图。
              </p>
            )}
            <p className="interpret-note">{changeResult.accuracy_note}</p>
          </section>
        )}

        {objectResult && (
          <section className="interpret-result">
            <h3>目标检测结果</h3>
            <div className="interpret-single">
              <figure>
                <img src={fileUrl(objectResult.annotated_path)} alt="检出标注图" />
                <figcaption>检出标注图</figcaption>
              </figure>
            </div>
            <div className="interpret-stats">
              <span>目标数 {objectResult.count}</span>
              <span>类别数 {objectResult.class_count}</span>
              <span>置信度均值 {objectResult.score_mean.toFixed(2)}</span>
              <span>耗时 {(objectResult.elapsed_ms / 1000).toFixed(1)} s</span>
              <span>{objectResult.device === "cuda" ? "GPU" : "CPU"}</span>
              {objectResult.resized && <span>已缩放到 2048</span>}
            </div>
            {objectResult.count === 0 ? (
              <p className="interpret-empty">
                未检出置信度 ≥ 0.25 的目标。可换示例图（车辆 / 机械航拍）或提高分辨率。
              </p>
            ) : (
              <details className="interpret-detections">
                <summary>检测框列表（{objectResult.detections.length}）</summary>
                <ul>
                  {objectResult.detections.map((det, index) => (
                    <li key={`${det.label}-${index}`}>
                      <b>{det.label}</b>
                      <span>{det.score.toFixed(2)}</span>
                      <em>
                        [{det.box.map((value) => Math.round(value)).join(", ")}]
                      </em>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="interpret-note">{objectResult.accuracy_note}</p>
          </section>
        )}

        {semanticResult && (
          <section className="interpret-result">
            <h3>语义分割结果</h3>
            <div className="interpret-triple">
              <figure>
                <img src={fileUrl(semanticResult.image_path)} alt="原图" />
                <figcaption>原图</figcaption>
              </figure>
              <figure>
                <img src={fileUrl(semanticResult.color_map_path)} alt="分类专题图" />
                <figcaption>分类专题图</figcaption>
              </figure>
              <figure>
                <img src={fileUrl(semanticResult.overlay_path)} alt="分类叠加图" />
                <figcaption>分类叠加图</figcaption>
              </figure>
            </div>
            <div className="interpret-stats">
              <span>类别数 {semanticResult.class_count} / 8</span>
              <span>耗时 {(semanticResult.elapsed_ms / 1000).toFixed(1)} s</span>
              <span>CPU</span>
            </div>
            <ul className="interpret-legend">
              {semanticResult.classes
                .filter((item) => item.ratio > 0)
                .sort((a, b) => b.ratio - a.ratio)
                .map((item) => (
                  <li key={item.id}>
                    <i
                      style={{
                        background: `rgb(${item.color[0]}, ${item.color[1]}, ${item.color[2]})`,
                      }}
                    />
                    <b>{item.name}</b>
                    <span>{(item.ratio * 100).toFixed(1)}%</span>
                  </li>
                ))}
            </ul>
            <p className="interpret-note">{semanticResult.accuracy_note}</p>
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
