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

interface Controls {
  undo: () => void;
  clear: () => void;
  edit: () => void;
  finish: () => void;
}

function ringArea(points: LonLat[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function pointInRing(lng: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function MapDrawModal({ open, initialWkt, onClose, onComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pointsRef = useRef<LonLat[]>([]);
  const editingRef = useRef(false);
  const controlsRef = useRef<Controls | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const initialRef = useRef(initialWkt);
  initialRef.current = initialWkt;
  const [count, setCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [closed, setClosed] = useState(false);
  const [ready, setReady] = useState(false);
  const [boundary, setBoundary] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    let alive = true;
    let map: any = null;
    let AMapRef: any = null;
    let line: any = null;
    let polygon: any = null;
    let editor: any = null;
    const markers: any[] = [];
    const boundaryLayers: any[] = [];
    const rings: LonLat[][] = [];
    let boundaryReady = false;

    const remove = (overlay: any) => {
      if (overlay && map) {
        try {
          map.remove(overlay);
        } catch {
          // 已被移除
        }
      }
    };

    const insideZhejiang = (lng: number, lat: number) =>
      rings.some((ring) => pointInRing(lng, lat, ring));

    const removeMarkers = () => {
      while (markers.length) remove(markers.pop());
    };

    const syncLine = () => {
      remove(line);
      line = null;
      if (editingRef.current || pointsRef.current.length < 2) return;
      line = new AMapRef.Polyline({
        path: pointsRef.current,
        strokeColor: "#22D3EE",
        strokeWeight: 2,
        strokeOpacity: 0.95,
        clickable: false,
        bubble: true,
      });
      map.add(line);
    };

    const vertexRadius = () => {
      const resolution =
        typeof map.getResolution === "function" ? map.getResolution(map.getZoom()) : 1000;
      return Math.max(60, resolution * 5);
    };

    const addMarker = (point: LonLat) => {
      const marker = new AMapRef.Circle({
        center: point,
        radius: vertexRadius(),
        fillColor: "#22D3EE",
        fillOpacity: 1,
        strokeColor: "#02121F",
        strokeWeight: 2,
        zIndex: 120,
        clickable: false,
        bubble: true,
      });
      map.add(marker);
      markers.push(marker);
    };

    const clearDrawing = () => {
      if (editor) {
        try {
          editor.close();
        } catch {
          // 已关闭
        }
        editor = null;
      }
      remove(polygon);
      polygon = null;
      remove(line);
      line = null;
      removeMarkers();
      pointsRef.current = [];
      editingRef.current = false;
      setCount(0);
      setEditing(false);
      setClosed(false);
      setError(null);
    };

    const enterEdit = () => {
      if (editingRef.current || pointsRef.current.length < 3) return;
      if (ringArea(pointsRef.current) < 1e-8) {
        setError("点几乎在一条线上，无法构成封闭区域");
        return;
      }
      remove(line);
      line = null;
      removeMarkers();
      polygon = new AMapRef.Polygon({
        path: pointsRef.current,
        strokeColor: "#A5F3FC",
        strokeWeight: 1.5,
        fillColor: "#22D3EE",
        fillOpacity: 0.18,
        zIndex: 60,
      });
      map.add(polygon);
      editor = new AMapRef.PolygonEditor(map, polygon);
      editor.open();
      editingRef.current = true;
      setEditing(true);
      setClosed(true);
      setError(null);
    };

    const nearFirst = (lng: number, lat: number) => {
      if (!map || pointsRef.current.length < 1) return false;
      const [firstLng, firstLat] = pointsRef.current[0];
      const a = map.lngLatToContainer(new AMapRef.LngLat(firstLng, firstLat));
      const b = map.lngLatToContainer(new AMapRef.LngLat(lng, lat));
      return Math.hypot(a.x - b.x, a.y - b.y) <= 12;
    };

    const addVertex = (lng: number, lat: number) => {
      if (editingRef.current) return;
      if (!boundaryReady) {
        setError("省界未加载，无法校验范围");
        return;
      }
      if (rings.length && !insideZhejiang(lng, lat)) {
        setError("顶点必须在浙江省界内");
        return;
      }
      if (nearFirst(lng, lat)) {
        if (pointsRef.current.length < 3) {
          setError("至少需要 3 个顶点才能闭合");
          return;
        }
        enterEdit();
        return;
      }
      pointsRef.current.push([lng, lat]);
      addMarker([lng, lat]);
      setCount(pointsRef.current.length);
      setError(null);
      syncLine();
    };

    const undo = () => {
      if (editingRef.current) return;
      pointsRef.current.pop();
      remove(markers.pop());
      setCount(pointsRef.current.length);
      setError(null);
      syncLine();
    };

    const finish = () => {
      const path: LonLat[] = polygon
        ? polygon.getPath().map((point: any) => [point.lng, point.lat] as LonLat)
        : [...pointsRef.current];
      if (path.length < 3) {
        setError("至少需要 3 个顶点");
        return;
      }
      if (ringArea(path) < 1e-8) {
        setError("点几乎在一条线上，无法构成封闭区域");
        return;
      }
      if (boundaryReady && path.some(([lng, lat]) => !insideZhejiang(lng, lat))) {
        setError("有顶点在浙江省界外，请拖动调整");
        return;
      }
      const wgs = path.map(([lon, lat]) => gcj02ToWgs84(lon, lat));
      onCompleteRef.current(formatPolygonWkt(wgs));
    };

    controlsRef.current = { undo, clear: clearDrawing, edit: enterEdit, finish };

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
          zoom: 8,
          center: [120.16, 30.27],
          viewMode: "2D",
        });
        map.on("click", (event: any) => {
          addVertex(event.lnglat.getLng(), event.lnglat.getLat());
        });
        map.on("zoomend", () => {
          const radius = vertexRadius();
          for (const marker of markers) {
            if (typeof marker.setRadius === "function") marker.setRadius(radius);
          }
        });

        // 省界来自本地 GeoJSON（含舟山群岛），WGS84 转 GCJ-02 后绘制。
        try {
          const resp = await fetch("/data/zhejiang-boundary.geojson", { cache: "force-cache" });
          if (!resp.ok) throw new Error(`省界数据加载失败 (${resp.status})`);
          const geo: any = await resp.json();
          const geometry = geo.geometry ?? geo.features?.[0]?.geometry;
          const polygons: number[][][][] =
            geometry?.type === "Polygon"
              ? [geometry.coordinates]
              : geometry?.type === "MultiPolygon"
                ? geometry.coordinates
                : [];
          for (const poly of polygons) {
            const exterior = poly[0] ?? [];
            const ring: LonLat[] = exterior.map((point: number[]) =>
              wgs84ToGcj02(Number(point[0]), Number(point[1])),
            );
            if (ring.length < 3) continue;
            rings.push(ring);
            const layer = new AMap.Polygon({
              path: ring,
              strokeColor: "#F59E0B",
              strokeWeight: 1.5,
              strokeOpacity: 1,
              fillColor: "#F59E0B",
              fillOpacity: 0.08,
              zIndex: 10,
              clickable: false,
              bubble: true,
            });
            map.add(layer);
            boundaryLayers.push(layer);
          }
          boundaryReady = rings.length > 0;
          setBoundary(boundaryReady ? "ready" : "failed");
          if (boundaryReady) {
            setTimeout(() => {
              if (map) map.setZoomAndCenter(7, [120.16, 29.2]);
            }, 50);
          }
        } catch (err) {
          setBoundary("failed");
          setError(err instanceof Error ? err.message : "省界数据加载失败");
        }

        const ring = parsePolygonWkt(initialRef.current ?? "");
        if (ring) {
          pointsRef.current = ring.map(([lon, lat]) => wgs84ToGcj02(lon, lat));
          setCount(pointsRef.current.length);
          if (pointsRef.current.some(([lng, lat]) => !insideZhejiang(lng, lat))) {
            setError("已有范围有顶点在浙江省界外，请拖动调整");
          }
          enterEdit();
          if (polygon) {
            setTimeout(() => {
              if (map && polygon) map.setFitView([polygon], false, [40, 40, 40, 40], 14);
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
          // 已关闭
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
      setClosed(false);
      setReady(false);
      setBoundary("loading");
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
            {count} 个点{editing ? " · 拖动顶点调整" : closed ? " · 已闭合" : ""}
            {" · "}
            {boundary === "ready"
              ? "限浙江省内"
              : boundary === "loading"
                ? "省界加载中…"
                : "省界未加载"}
          </span>
        </div>
        <div className="map-modal-canvas" ref={containerRef}>
          {!ready && <div className="map-modal-loading">{error ?? "地图加载中…"}</div>}
        </div>
        <div className="map-modal-foot">
          <span className="map-modal-hint">
            点击加顶点（限浙江省内）；点回第一个顶点闭合；闭合后可拖动顶点
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
              onClick={() => controlsRef.current?.clear()}
              disabled={count === 0}
            >
              清空
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
                闭合
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
