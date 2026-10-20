import { useEffect, useRef, useState } from "react";
import type * as CesiumModule from "cesium";

import { loadCesium } from "../lib/cesium";

interface Props {
  open: boolean;
  onClose: () => void;
  onComplete: (wkt: string) => void;
}

interface LonLat {
  lon: number;
  lat: number;
}

export function MapDrawModal({ open, onClose, onComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumModule.Viewer | null>(null);
  const pointsRef = useRef<LonLat[]>([]);
  const redrawRef = useRef<() => void>(() => undefined);
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    let alive = true;
    let viewer: CesiumModule.Viewer | null = null;
    let handler: CesiumModule.ScreenSpaceEventHandler | null = null;

    loadCesium()
      .then((Cesium) => {
        if (!alive || !containerRef.current) return;
        viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          baseLayer: false,
        });
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#07182B");
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#03080F");
        Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
        )
          .then((provider) => {
            if (!viewer || viewer.isDestroyed()) return;
            const layer = viewer.imageryLayers.addImageryProvider(provider);
            layer.brightness = 0.4;
            layer.contrast = 1.2;
            layer.saturation = 0.4;
          })
          .catch(() => undefined);
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(120.16, 30.27, 1_600_000),
        });

        const draw = () => {
          if (!viewer || viewer.isDestroyed()) return;
          viewer.entities.removeAll();
          const pts = pointsRef.current;
          for (const point of pts) {
            viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
              point: {
                pixelSize: 8,
                color: Cesium.Color.fromCssColorString("#22D3EE"),
                outlineColor: Cesium.Color.fromCssColorString("#02121F"),
                outlineWidth: 2,
              },
            });
          }
          if (pts.length >= 2) {
            viewer.entities.add({
              polyline: {
                positions: pts.map((point) =>
                  Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
                ),
                width: 2,
                material: Cesium.Color.fromCssColorString("#22D3EE"),
              },
            });
          }
          if (pts.length >= 3) {
            viewer.entities.add({
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(
                  pts.map((point) =>
                    Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
                  ),
                ),
                material: Cesium.Color.fromCssColorString("#22D3EE").withAlpha(0.18),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString("#A5F3FC"),
              },
            });
          }
        };
        redrawRef.current = draw;

        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction(
          (movement: { position: CesiumModule.Cartesian2 }) => {
            if (!viewer || viewer.isDestroyed()) return;
            const cartesian = viewer.camera.pickEllipsoid(
              movement.position,
              Cesium.Ellipsoid.WGS84,
            );
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            pointsRef.current.push({
              lon: Cesium.Math.toDegrees(carto.longitude),
              lat: Cesium.Math.toDegrees(carto.latitude),
            });
            draw();
            setCount(pointsRef.current.length);
          },
          Cesium.ScreenSpaceEventType.LEFT_CLICK,
        );

        viewerRef.current = viewer;
        setReady(true);
      })
      .catch(() => {
        if (alive) setError("地图组件加载失败");
      });

    return () => {
      alive = false;
      if (handler) handler.destroy();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
      redrawRef.current = () => undefined;
      pointsRef.current = [];
      setCount(0);
      setReady(false);
      setError(null);
    };
  }, [open]);

  if (!open) return null;

  const refresh = () => {
    setCount(pointsRef.current.length);
    redrawRef.current();
  };

  const undo = () => {
    pointsRef.current.pop();
    refresh();
  };

  const clear = () => {
    pointsRef.current = [];
    refresh();
  };

  const finish = () => {
    if (pointsRef.current.length < 3) {
      setError("至少需要 3 个点");
      return;
    }
    const ring = [...pointsRef.current, pointsRef.current[0]]
      .map((point) => `${point.lon.toFixed(6)} ${point.lat.toFixed(6)}`)
      .join(", ");
    onComplete(`POLYGON((${ring}))`);
  };

  return (
    <div className="map-modal" role="dialog" aria-modal="true" aria-label="在地图上绘制范围">
      <div className="map-modal-panel">
        <div className="map-modal-head">
          <span>在地图上绘制范围</span>
          <span className="map-modal-count">{count} 个点</span>
        </div>
        <div className="map-modal-canvas" ref={containerRef}>
          {!ready && <div className="map-modal-loading">{error ?? "地图加载中…"}</div>}
        </div>
        <div className="map-modal-foot">
          <span className="map-modal-hint">左键逐个添加顶点，至少 3 个；完成后回填 WKT</span>
          <div className="map-modal-actions">
            <button type="button" onClick={undo} disabled={count === 0}>
              撤销
            </button>
            <button type="button" onClick={clear} disabled={count === 0}>
              清空
            </button>
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="question-submit"
              onClick={finish}
              disabled={count < 3}
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
