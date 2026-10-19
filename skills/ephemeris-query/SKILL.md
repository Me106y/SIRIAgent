---
name: ephemeris-query
description: 查询选定卫星的当前星下点、轨道高度、TLE 新鲜度与载荷参数
when-to-use: 用户问“某颗卫星现在在哪”“当前经纬度”“轨道多高”“TLE 是否过期”时
---

# Ephemeris Query

1. 先用 `list_satellites` 或本地目录确认 NORAD ID，不要猜。
2. 当前星下点用 `current_position`；批量位置用 `list_positions`。
3. 轨道高度、载荷、幅宽、TLE 历元用 `get_satellite`。
4. 输出统一带 `accuracy_note`；TLE 年龄 >72 h 要明确提示精度下降。
