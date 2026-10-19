import { useEffect, useRef } from "react";
import * as Cesium from "cesium";

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
}

export function Globe({ positions, selected, track, onSelect }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const entitiesRef = useRef(new Map<number, Cesium.Entity>());
  const colorsRef = useRef(new Map<number, string>());
  const trackRef = useRef<Cesium.Entity[]>([]);
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
    return () => {
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
      entitiesRef.current.clear();
      colorsRef.current.clear();
      trackRef.current = [];
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

  return <div className="globe" ref={containerRef} />;
}
