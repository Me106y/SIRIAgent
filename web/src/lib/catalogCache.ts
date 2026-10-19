import type { Satellite } from "../types";

const KEY = "siria:catalog:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CachedCatalog {
  savedAt: number;
  items: Satellite[];
}

/** 上一次的卫星目录：用于刷新时先秒出列表，再等 bootstrap 覆盖。 */
export function readCatalogCache(): Satellite[] | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCatalog>;
    if (!parsed.savedAt || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null;
    }
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

export function writeCatalogCache(items: Satellite[]): void {
  if (items.length === 0) return;
  try {
    const payload: CachedCatalog = { savedAt: Date.now(), items };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // 隐私模式或配额不足时静默降级，不影响在线数据。
  }
}
