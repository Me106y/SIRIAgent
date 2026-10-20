const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

export type LonLat = [number, number];

function outOfChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret +=
    ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) /
    3.0;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret =
    300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret +=
    ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) /
    3.0;
  return ret;
}

/** WGS84 → GCJ-02（高德底图使用 GCJ-02）。 */
export function wgs84ToGcj02(lon: number, lat: number): LonLat {
  if (outOfChina(lon, lat)) return [lon, lat];
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lon + dLon, lat + dLat];
}

/** GCJ-02 → WGS84（迭代反解，误差 < 1 m）。 */
export function gcj02ToWgs84(lon: number, lat: number): LonLat {
  if (outOfChina(lon, lat)) return [lon, lat];
  let wgsLon = lon;
  let wgsLat = lat;
  for (let i = 0; i < 3; i += 1) {
    const [gcjLon, gcjLat] = wgs84ToGcj02(wgsLon, wgsLat);
    wgsLon += lon - gcjLon;
    wgsLat += lat - gcjLat;
  }
  return [wgsLon, wgsLat];
}

/** 解析 POLYGON((lon lat, ...))，返回去掉闭合点的环。 */
export function parsePolygonWkt(wkt: string): LonLat[] | null {
  const match = wkt.trim().match(/^POLYGON\s*\(\(\s*(.+?)\s*\)\)$/is);
  if (!match) return null;
  const ring = match[1]
    .split(",")
    .map((pair) => pair.trim().split(/\s+/).map(Number))
    .filter((pair) => pair.length >= 2 && pair.every((value) => Number.isFinite(value)))
    .map((pair) => [pair[0], pair[1]] as LonLat);
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  return ring.length >= 3 ? ring : null;
}

export function formatPolygonWkt(points: LonLat[]): string {
  const ring = [...points, points[0]]
    .map(([lon, lat]) => `${lon.toFixed(6)} ${lat.toFixed(6)}`)
    .join(", ");
  return `POLYGON((${ring}))`;
}
