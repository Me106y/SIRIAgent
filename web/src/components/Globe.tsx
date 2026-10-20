import { useEffect, useRef, useState } from "react";
import type * as CesiumModule from "cesium";

import { loadCesium } from "../lib/cesium";
import type { PositionItem, TrackPoint } from "../types";

const CATEGORY_COLORS: Record<string, string> = {
  commercial: "#22D3EE",
  civil: "#2DD4BF",
  meteorology: "#A78BFA",
};

const SELECTED_COLOR = "#F8FAFC";

interface GlobeProps {
  positions: PositionItem[];
  selected: number | null;
  track: TrackPoint[];
  onSelect: (norad: number) => void;
  footprintLat: number | null;
  footprintLon: number | null;
  footprintRadiusKm: number | null;
  focusToken: number;
  hangzhouToken: number;
  hangzhouPolygon: number[][] | null;
  enabled?: boolean;
}

export function Globe({
  positions,
  selected,
  track,
  onSelect,
  footprintLat,
  footprintLon,
  footprintRadiusKm,
  focusToken,
  hangzhouToken,
  hangzhouPolygon,
  enabled = true,
}: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cesium, setCesium] = useState<typeof import("cesium") | null>(null);
  const [cesiumFailed, setCesiumFailed] = useState(false);
  const viewerRef = useRef<CesiumModule.Viewer | null>(null);
  const entitiesRef = useRef(new Map<number, CesiumModule.Entity>());
  const colorsRef = useRef(new Map<number, string>());
  const trackRef = useRef<CesiumModule.Entity[]>([]);
  const footprintRef = useRef<CesiumModule.Entity | null>(null);
  const pulseRef = useRef<CesiumModule.Entity | null>(null);
  const pulseTimer = useRef<number | null>(null);
  const focusRef = useRef({ lat: footprintLat, lon: footprintLon, radius: footprintRadiusKm });
  focusRef.current = { lat: footprintLat, lon: footprintLon, radius: footprintRadiusKm };
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // 再等一小会儿，让目录选中星的 track/passes 先回来。
    const timer = window.setTimeout(() => {
      loadCesium()
        .then((namespace) => {
          if (alive) setCesium(namespace);
        })
        .catch(() => {
          if (alive) setCesiumFailed(true);
        });
    }, 800);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  useEffect(() => {
    if (!cesium || !containerRef.current) return;
    let viewer: CesiumModule.Viewer;
    try {
      viewer = new cesium.Viewer(containerRef.current, {
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
    } catch {
      // WebGL 初始化失败：保留目录/过境，地球退化为占位。
      setCesiumFailed(true);
      return;
    }
    viewer.scene.globe.baseColor = cesium.Color.fromCssColorString("#07182B");
    viewer.scene.backgroundColor = cesium.Color.fromCssColorString("#03080F");
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.globe.showGroundAtmosphere = true;
    // 底图约 4.7 MB：先让目录/过境请求跑完，再在后台补贴图。
    let imageryCancelled = false;
    const imageryTimer = window.setTimeout(() => {
      if (imageryCancelled || viewer.isDestroyed()) return;
      cesium.TileMapServiceImageryProvider.fromUrl(
        cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
        { maximumLevel: 2 },
      )
        .then((provider) => {
          if (imageryCancelled || viewer.isDestroyed()) return;
          const layer = viewer.imageryLayers.addImageryProvider(provider);
          layer.brightness = 0.32;
          layer.contrast = 1.28;
          layer.saturation = 0.22;
        })
        .catch(() => undefined);
    }, 1500);
    viewer.scene.fog.enabled = true;
    viewer.camera.setView({
      destination: cesium.Cartesian3.fromDegrees(112, 27, 20_000_000),
    });
    const credit = viewer.cesiumWidget.creditContainer as HTMLElement;
    credit.style.display = "none";

    const handler = new cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(
      (movement: { position: CesiumModule.Cartesian2 }) => {
        const picked = viewer.scene.pick(movement.position);
        const entityId = picked?.id?.id;
        if (typeof entityId === "string" && entityId.startsWith("sat-")) {
          onSelectRef.current(Number(entityId.slice(4)));
        }
      },
      cesium.ScreenSpaceEventType.LEFT_CLICK,
    );

    viewerRef.current = viewer;
    (window as unknown as { __viewer?: CesiumModule.Viewer }).__viewer = viewer;
    return () => {
      imageryCancelled = true;
      window.clearTimeout(imageryTimer);
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
      entitiesRef.current.clear();
      colorsRef.current.clear();
      trackRef.current = [];
      footprintRef.current = null;
      if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current);
      if (pulseRef.current && !viewer.isDestroyed()) viewer.entities.remove(pulseRef.current);
      pulseRef.current = null;
    };
  }, [cesium]);

  useEffect(() => {
    if (!cesium) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    const seen = new Set<number>();
    positions.forEach((item) => {
      seen.add(item.norad);
      const color = CATEGORY_COLORS[item.category] || "#22D3EE";
      colorsRef.current.set(item.norad, color);
      const position = cesium.Cartesian3.fromDegrees(item.lon, item.lat, item.alt_km * 1000);
      const existing = entitiesRef.current.get(item.norad);
      if (existing) {
        existing.position = new cesium.ConstantPositionProperty(position);
        if (existing.point) {
          existing.point.pixelSize = new cesium.ConstantProperty(
            item.norad === selected ? 11 : 6,
          );
        }
      } else {
        const entity = viewer.entities.add({
          id: `sat-${item.norad}`,
          position,
          point: {
            pixelSize: item.norad === selected ? 11 : 6,
            color: cesium.Color.fromCssColorString(
              item.norad === selected ? SELECTED_COLOR : color,
            ),
            outlineColor: cesium.Color.fromCssColorString("#02121F"),
            outlineWidth: 1,
          },
        });
        entitiesRef.current.set(item.norad, entity);
      }
    });
    for (const [norad, entity] of entitiesRef.current) {
      if (!seen.has(norad)) {
        viewer.entities.remove(entity);
        entitiesRef.current.delete(norad);
        colorsRef.current.delete(norad);
      }
    }
  }, [cesium, positions, selected]);

  useEffect(() => {
    if (!cesium) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    trackRef.current.forEach((entity) => viewer.entities.remove(entity));
    trackRef.current = [];
    if (track.length < 2) return;
    const orbit = track.map((point) =>
      cesium.Cartesian3.fromDegrees(point.lon_deg, point.lat_deg, point.alt_km * 1000),
    );
    const ground = track.map((point) =>
      cesium.Cartesian3.fromDegrees(point.lon_deg, point.lat_deg, 0),
    );
    trackRef.current.push(
      viewer.entities.add({
        polyline: {
          positions: orbit,
          width: 2,
          material: new cesium.PolylineGlowMaterialProperty({
            color: cesium.Color.fromCssColorString("#22D3EE"),
            glowPower: 0.2,
          }),
        },
      }),
      viewer.entities.add({
        polyline: {
          positions: ground,
          width: 1.5,
          material: cesium.Color.fromCssColorString("#2DD4BF").withAlpha(0.75),
        },
      }),
    );
  }, [cesium, track]);

  useEffect(() => {
    if (!cesium || hangzhouToken === 0) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: cesium.Cartesian3.fromDegrees(120.16, 30.27, 650_000),
      orientation: {
        heading: 0,
        pitch: cesium.Math.toRadians(-90),
        roll: 0,
      },
      duration: 1.1,
    });

    if (pulseRef.current) {
      viewer.entities.remove(pulseRef.current);
      pulseRef.current = null;
    }
    if (pulseTimer.current != null) {
      window.clearTimeout(pulseTimer.current);
      pulseTimer.current = null;
    }
    const started = performance.now();
    const alpha = () => {
      const seconds = (performance.now() - started) / 1000;
      return 0.5 + 0.5 * Math.sin(seconds * Math.PI * 2 * 1.4);
    };
    const fill = new cesium.CallbackProperty(
      () => cesium.Color.fromCssColorString("#22D3EE").withAlpha(0.1 + 0.45 * alpha()),
      false,
    );
    const outline = new cesium.CallbackProperty(
      () =>
        cesium.Color.fromCssColorString("#A5F3FC").withAlpha(0.35 + 0.55 * alpha()),
      false,
    );
    const center = cesium.Cartesian3.fromDegrees(120.2099, 30.2466, 80);
    const common = {
      position: center,
      label: {
        text: "杭州",
        font: "12px sans-serif",
        fillColor: cesium.Color.fromCssColorString("#E0F7FF"),
        showBackground: true,
        backgroundColor: cesium.Color.fromCssColorString("#04121F").withAlpha(0.75),
        pixelOffset: new cesium.Cartesian2(0, -18),
      },
    } as const;
    if (hangzhouPolygon && hangzhouPolygon.length > 3) {
      pulseRef.current = viewer.entities.add({
        ...common,
        polygon: {
          hierarchy: new cesium.PolygonHierarchy(
            cesium.Cartesian3.fromDegreesArray(hangzhouPolygon.flat()),
          ),
          height: 50,
          material: new cesium.ColorMaterialProperty(fill),
          outline: true,
          outlineColor: outline,
        },
      });
    } else {
      pulseRef.current = viewer.entities.add({
        ...common,
        ellipse: {
          semiMajorAxis: 80_000,
          semiMinorAxis: 80_000,
          height: 50,
          material: new cesium.ColorMaterialProperty(fill),
          outline: true,
          outlineColor: outline,
        },
      });
    }
    pulseTimer.current = window.setTimeout(() => {
      if (!viewer.isDestroyed() && pulseRef.current) {
        viewer.entities.remove(pulseRef.current);
        pulseRef.current = null;
      }
    }, 6000);
  }, [cesium, hangzhouToken, hangzhouPolygon]);

  useEffect(() => {
    if (!cesium || focusToken === 0) return;
    const viewer = viewerRef.current;
    const target = focusRef.current;
    if (!viewer || target.lat == null || target.lon == null) return;
    const radius = target.radius ?? 100;
    const height = Math.min(6_000_000, Math.max(400_000, radius * 1000 * 8));
    viewer.camera.flyTo({
      destination: cesium.Cartesian3.fromDegrees(target.lon, target.lat, height),
      duration: 1.1,
    });
  }, [cesium, focusToken]);

  useEffect(() => {
    if (!cesium) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (footprintRef.current) {
      viewer.entities.remove(footprintRef.current);
      footprintRef.current = null;
    }
    if (
      footprintLat == null ||
      footprintLon == null ||
      footprintRadiusKm == null ||
      footprintRadiusKm <= 0
    ) {
      return;
    }
    footprintRef.current = viewer.entities.add({
      position: cesium.Cartesian3.fromDegrees(footprintLon, footprintLat, 0),
      point: {
        pixelSize: 5,
        color: cesium.Color.fromCssColorString("#F8FAFC"),
        outlineColor: cesium.Color.fromCssColorString("#22D3EE"),
        outlineWidth: 2,
      },
      label: {
        text: `足迹 ${(footprintRadiusKm * 2).toFixed(0)} km`,
        font: "11px monospace",
        fillColor: cesium.Color.fromCssColorString("#A5F3FC"),
        showBackground: true,
        backgroundColor: cesium.Color.fromCssColorString("#04121F").withAlpha(0.8),
        pixelOffset: new cesium.Cartesian2(0, -18),
      },
      ellipse: {
        semiMajorAxis: footprintRadiusKm * 1000,
        semiMinorAxis: footprintRadiusKm * 1000,
        height: 0,
        material: cesium.Color.fromCssColorString("#22D3EE").withAlpha(0.22),
        outline: true,
        outlineColor: cesium.Color.fromCssColorString("#22D3EE").withAlpha(0.85),
      },
    });
  }, [cesium, footprintLat, footprintLon, footprintRadiusKm]);

  return (
    <div className="globe" ref={containerRef}>
      {!cesium && (
        <div className="globe-loading" role="status" aria-live="polite">
          {cesiumFailed ? "地球组件加载失败，列表仍可使用" : "地球加载中…"}
        </div>
      )}
    </div>
  );
}
