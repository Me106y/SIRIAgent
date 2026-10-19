import { useEffect, useRef } from "react";
import * as Cesium from "cesium";

import type { CoverageGrid, PositionItem, TrackPoint } from "../types";

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
  coverage: CoverageGrid | null;
  coverageToken: number;
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
  coverage,
  coverageToken,
}: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const entitiesRef = useRef(new Map<number, Cesium.Entity>());
  const colorsRef = useRef(new Map<number, string>());
  const trackRef = useRef<Cesium.Entity[]>([]);
  const footprintRef = useRef<Cesium.Entity | null>(null);
  const coverageRef = useRef<Cesium.Entity[]>([]);
  const focusRef = useRef({ lat: footprintLat, lon: footprintLon, radius: footprintRadiusKm });
  focusRef.current = { lat: footprintLat, lon: footprintLon, radius: footprintRadiusKm };
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = new Cesium.Viewer(containerRef.current, {
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
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.globe.showGroundAtmosphere = true;
    Cesium.TileMapServiceImageryProvider.fromUrl(
      Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
    )
      .then((provider) => {
        if (viewer.isDestroyed()) return;
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.brightness = 0.32;
        layer.contrast = 1.28;
        layer.saturation = 0.22;
      })
      .catch(() => undefined);
    viewer.scene.fog.enabled = true;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(112, 27, 20_000_000),
    });
    const credit = viewer.cesiumWidget.creditContainer as HTMLElement;
    credit.style.display = "none";

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(
      (movement: { position: Cesium.Cartesian2 }) => {
        const picked = viewer.scene.pick(movement.position);
        const entityId = picked?.id?.id;
        if (typeof entityId === "string" && entityId.startsWith("sat-")) {
          onSelectRef.current(Number(entityId.slice(4)));
        }
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );

    viewerRef.current = viewer;
    (window as unknown as { __viewer?: Cesium.Viewer }).__viewer = viewer;
    return () => {
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
      entitiesRef.current.clear();
      colorsRef.current.clear();
      trackRef.current = [];
      footprintRef.current = null;
      coverageRef.current = [];
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const seen = new Set<number>();
    positions.forEach((item) => {
      seen.add(item.norad);
      const color = CATEGORY_COLORS[item.category] || "#22D3EE";
      colorsRef.current.set(item.norad, color);
      const position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, item.alt_km * 1000);
      const existing = entitiesRef.current.get(item.norad);
      if (existing) {
        existing.position = new Cesium.ConstantPositionProperty(position);
        if (existing.point) {
          existing.point.pixelSize = new Cesium.ConstantProperty(
            item.norad === selected ? 11 : 6,
          );
        }
      } else {
        const entity = viewer.entities.add({
          id: `sat-${item.norad}`,
          position,
          point: {
            pixelSize: item.norad === selected ? 11 : 6,
            color: Cesium.Color.fromCssColorString(
              item.norad === selected ? SELECTED_COLOR : color,
            ),
            outlineColor: Cesium.Color.fromCssColorString("#02121F"),
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
  }, [positions, selected]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    trackRef.current.forEach((entity) => viewer.entities.remove(entity));
    trackRef.current = [];
    if (track.length < 2) return;
    const orbit = track.map((point) =>
      Cesium.Cartesian3.fromDegrees(point.lon_deg, point.lat_deg, point.alt_km * 1000),
    );
    const ground = track.map((point) =>
      Cesium.Cartesian3.fromDegrees(point.lon_deg, point.lat_deg, 0),
    );
    trackRef.current.push(
      viewer.entities.add({
        polyline: {
          positions: orbit,
          width: 2,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: Cesium.Color.fromCssColorString("#22D3EE"),
            glowPower: 0.2,
          }),
        },
      }),
      viewer.entities.add({
        polyline: {
          positions: ground,
          width: 1.5,
          material: Cesium.Color.fromCssColorString("#2DD4BF").withAlpha(0.75),
        },
      }),
    );
  }, [track]);

  useEffect(() => {
    if (coverageToken === 0) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(120.16, 30.27, 900_000),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
      duration: 1.1,
    });
  }, [coverageToken]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    coverageRef.current.forEach((entity) => viewer.entities.remove(entity));
    coverageRef.current = [];
    if (!coverage || coverage.cells.length === 0) return;
    const maxCount = Math.max(1, coverage.max_count);
    const minCount = coverage.min_count ?? 0;
    const span = Math.max(1, maxCount - minCount);
    const halfLat = coverage.grid_deg / 2;
    const halfLon = (coverage.lon_step_deg || coverage.grid_deg) / 2;
    coverageRef.current = coverage.cells.map((cell) => {
      const ratio = Math.max(0, Math.min(1, (cell.count - minCount) / span));
      const hue = 0.5 - 0.42 * ratio;
      return viewer.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            cell.lon - halfLon,
            cell.lat - halfLat,
            cell.lon + halfLon,
            cell.lat + halfLat,
          ),
          height: 30,
          material: Cesium.Color.fromHsl(hue, 0.85, 0.55, 0.25 + 0.2 * ratio),
        },
      });
    });
    return () => {
      coverageRef.current.forEach((entity) => {
        if (!viewer.isDestroyed()) viewer.entities.remove(entity);
      });
      coverageRef.current = [];
    };
  }, [coverage]);

  useEffect(() => {
    if (hangzhouToken === 0) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(120.16, 30.27, 900_000),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
      duration: 1.1,
    });
  }, [hangzhouToken]);

  useEffect(() => {
    if (focusToken === 0) return;
    const viewer = viewerRef.current;
    const target = focusRef.current;
    if (!viewer || target.lat == null || target.lon == null) return;
    const radius = target.radius ?? 100;
    const height = Math.min(6_000_000, Math.max(400_000, radius * 1000 * 8));
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(target.lon, target.lat, height),
      duration: 1.1,
    });
  }, [focusToken]);

  useEffect(() => {
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
      position: Cesium.Cartesian3.fromDegrees(footprintLon, footprintLat, 0),
      point: {
        pixelSize: 5,
        color: Cesium.Color.fromCssColorString("#F8FAFC"),
        outlineColor: Cesium.Color.fromCssColorString("#22D3EE"),
        outlineWidth: 2,
      },
      label: {
        text: `足迹 ${(footprintRadiusKm * 2).toFixed(0)} km`,
        font: "11px monospace",
        fillColor: Cesium.Color.fromCssColorString("#A5F3FC"),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#04121F").withAlpha(0.8),
        pixelOffset: new Cesium.Cartesian2(0, -18),
      },
      ellipse: {
        semiMajorAxis: footprintRadiusKm * 1000,
        semiMinorAxis: footprintRadiusKm * 1000,
        height: 0,
        material: Cesium.Color.fromCssColorString("#22D3EE").withAlpha(0.22),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#22D3EE").withAlpha(0.85),
      },
    });
  }, [footprintLat, footprintLon, footprintRadiusKm]);

  return <div className="globe" ref={containerRef} />;
}
