import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import { loadAmap, loadAmapPlugin } from "../lib/amap";
import {
  formatPolygonWkt,
  gcj02ToWgs84,
  parsePolygonWkt,
  wgs84ToGcj02,
  type LonLat,
} from "../lib/coord";

interface Props {
  open: boolean;
  initialWkt?: string;
  onClose: () => void;
  onComplete: (wkt: string) => void;
}

export function MapDrawModal({ open, initialWkt, onClose, onComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pointsRef = useRef<LonLat[]>([]);
  const editingRef = useRef(false);
  const controlsRef = useRef<{
    undo: () => void;
    reset: () => void;
    edit: () => void;
    finish: () => void;
  } | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const initialRef = useRef(initialWkt);
  initialRef.current = initialWkt;
  const [count, setCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    let alive = true;
    let map: any = null;
    let preview: any = null;
    let polygon: any = null;
    let editor: any = null;
    let AMapRef: any = null;

    const syncPreview = () => {
      if (!map || !AMapRef) return;
      if (preview) {
        map.remove(preview);
        preview = null;
      }
      if (editingRef.current) return;
      const pts = pointsRef.current;
      if (pts.length >= 2) {
        preview = new AMapRef.Polyline({
          path: pts,
          strokeColor: "#22D3EE",
          strokeWeight: 2,
          strokeOpacity: 0.9,
        });
        map.add(preview);
      }
      if (pts.length >= 3) {
        preview = new AMapRef.Polygon({
          path: pts,
          strokeColor: "#A5F3FC",
          strokeWeight: 1.5,
          fillColor: "#22D3EE",
          fillOpacity: 0.18,
        });
        map.add(preview);
      }
    };

    const enterEdit = () => {
      if (!map || !AMapRef || editingRef.current || pointsRef.current.length < 3) return;
      if (preview) {
        map.remove(preview);
        preview = null;
      }
      polygon = new AMapRef.Polygon({
        path: pointsRef.current,
        strokeColor: "#A5F3FC",
        strokeWeight: 1.5,
        fillColor: "#22D3EE",
        fillOpacity: 0.18,
      });
      map.add(polygon);
      editor = new AMapRef.PolygonEditor(map, polygon);
      editor.open();
      editingRef.current = true;
      setEditing(true);
    };

    const reset = () => {
      if (editor) {
        try {
          editor.close();
        } catch {
          // 编辑器可能已被地图销毁
        }
        editor = null;
      }
      if (polygon) {
        map.remove(polygon);
        polygon = null;
      }
      if (preview) {
        map.remove(preview);
        preview = null;
      }
      editingRef.current = false;
      setEditing(false);
      pointsRef.current = [];
      setCount(0);
    };

    const finish = () => {
      const path: LonLat[] = polygon
        ? polygon.getPath().map((point: any) => [point.lng, point.lat] as LonLat)
        : [...pointsRef.current];
      if (path.length < 3) {
        setError("至少需要 3 个点");
        return;
      }
      const wgs = path.map(([lon, lat]) => gcj02ToWgs84(lon, lat));
      onCompleteRef.current(formatPolygonWkt(wgs));
    };

    const undo = () => {
      if (editingRef.current) return;
      pointsRef.current.pop();
      setCount(pointsRef.current.length);
      syncPreview();
    };

    controlsRef.current = { undo, reset, edit: enterEdit, finish };

    (async () => {
      try {
        const config = await api.config();
        const AMap = await loadAmap({
          key: config.amap_js_key,
          security: config.amap_security_code,
        });
        await loadAmapPlugin(AMap, "AMap.PolygonEditor");
        if (!alive || !containerRef.current) return;
        AMapRef = AMap;
        map = new AMap.Map(containerRef.current, {
          zoom: 9,
          center: [120.16, 30.27],
          viewMode: "2D",
        });
        map.on("click", (event: any) => {
          if (editingRef.current) return;
          pointsRef.current.push([event.lnglat.getLng(), event.lnglat.getLat()]);
          setCount(pointsRef.current.length);
          syncPreview();
        });

        const ring = parsePolygonWkt(initialRef.current ?? "");
        if (ring) {
          pointsRef.current = ring.map(([lon, lat]) => wgs84ToGcj02(lon, lat));
          setCount(pointsRef.current.length);
          enterEdit();
          if (polygon) {
            setTimeout(() => {
              if (map && polygon) map.setFitView([polygon]);
            }, 50);
          }
        }
        setReady(true);
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "地图加载失败");
        }
      }
    })();

    return () => {
      alive = false;
      if (editor) {
        try {
          editor.close();
        } catch {
          // 已销毁
        }
      }
      if (map) {
        try {
          map.destroy();
        } catch {
          // 已销毁
        }
      }
      controlsRef.current = null;
      pointsRef.current = [];
      editingRef.current = false;
      setCount(0);
      setEditing(false);
      setReady(false);
      setError(null);
    };
  }, [open]);

  if (!open) return null;

  const canFinish = count >= 3;

  return (
    <div className="map-modal" role="dialog" aria-modal="true" aria-label="在地图上绘制范围">
      <div className="map-modal-panel">
        <div className="map-modal-head">
          <span>在地图上绘制范围（高德）</span>
          <span className="map-modal-count">
            {count} 个点{editing ? " · 拖动顶点调整" : ""}
          </span>
        </div>
        <div className="map-modal-canvas" ref={containerRef}>
          {!ready && <div className="map-modal-loading">{error ?? "地图加载中…"}</div>}
        </div>
        <div className="map-modal-foot">
          <span className="map-modal-hint">
            点击地图添加顶点；≥3 个后可“调整顶点”拖动或增删顶点，完成回填 WKT
          </span>
          <div className="map-modal-actions">
            <button
              type="button"
              onClick={() => controlsRef.current?.undo()}
              disabled={editing || count === 0}
            >
              撤销
            </button>
            <button
              type="button"
              onClick={() => controlsRef.current?.reset()}
              disabled={count === 0 && !editing}
            >
              {editing ? "重新绘制" : "清空"}
            </button>
            <button type="button" onClick={onClose}>
              取消
            </button>
            {!editing && (
              <button
                type="button"
                onClick={() => controlsRef.current?.edit()}
                disabled={!canFinish}
              >
                调整顶点
              </button>
            )}
            <button
              type="button"
              className="question-submit"
              onClick={() => controlsRef.current?.finish()}
              disabled={!canFinish}
            >
              完成
            </button>
          </div>
        </div>
        {error && <div className="map-modal-error">{error}</div>}
      </div>
    </div>
  );
}
