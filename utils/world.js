// 开放世界数据引擎：真实地图点亮 + 角色卡 + 亲密度成长。
// 设计原则：
// 1. 真实地图：使用微信小程序原生 <map> 组件（底层腾讯地图，GCJ-02 坐标，无需 key，
//    完全符合地图合规白名单）。足迹的真实经纬度打点标记，去过的地方即「点亮」。
//    不自绘国界/敏感区域，个人坐标遵循 RLS owner-only，仅本人可见。
// 2. 分类探索作为「成就进度」辅助呈现，与真实地图并存，不替代地图。
// 3. 所有派生逻辑用纯函数，便于单测；角色卡本地 storage 可靠存储 + 云端尽力同步，
//    预览环境（云端表未建）也能立即使用。

// 8 大主题区，与足迹分类 key 一一对应，每区 3 个地块，共 24 格。
const REALMS = [
  { key: 'life', name: '生命之树', icon: '🌳', color: '#7c6cf0', tiles: ['初心泉', '日常林', '生命之巅'] },
  { key: 'food', name: '烟火镇', icon: '🍜', color: '#ff9f43', tiles: ['早餐铺', '街角摊', '百味堂'] },
  { key: 'fun', name: '欢娱港', icon: '🎮', color: '#e879a8', tiles: ['游戏厅', '游乐场', '不夜城'] },
  { key: 'travel', name: '远行漠', icon: '✈️', color: '#22c1a4', tiles: ['启程站', '风沙堡', '天涯塔'] },
  { key: 'growth', name: '成长峰', icon: '🌱', color: '#5aa9e6', tiles: ['幼苗圃', '书页径', '智慧顶'] },
  { key: 'work', name: '荣耀城', icon: '💼', color: '#f5a623', tiles: ['新手村', '试炼场', '王者座'] },
  { key: 'family', name: '暖灯村', icon: '🏡', color: '#ff7b6b', tiles: ['老家门', '团圆桌', '守望塔'] },
  { key: 'love', name: '心之屿', icon: '💗', color: '#ff6b9d', tiles: ['初遇桥', '星语庭', '永恒湾'] },
]

// 亲密度等级：随同行次数成长，越往后越难，制造长期目标。
const INTIMACY_LEVELS = [
  { min: 0, name: '初识', icon: '🌱', color: '#9a94b8' },
  { min: 30, name: '熟悉', icon: '🤝', color: '#6f5ce8' },
  { min: 80, name: '亲密', icon: '💜', color: '#a56bf0' },
  { min: 150, name: '挚友', icon: '💎', color: '#2f9e8f' },
  { min: 300, name: '灵魂羁绊', icon: '👑', color: '#f5a623' },
]

const STORAGE_KEY = 'lq_characters_v1'

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

function newId() {
  return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
}

// 亲密度 → 等级信息（当前段、下一级阈值、段内进度）
function intimacyLevelOf(value) {
  const v = Math.max(0, Number(value) || 0)
  let idx = 0
  for (let i = 0; i < INTIMACY_LEVELS.length; i++) {
    if (v >= INTIMACY_LEVELS[i].min) idx = i
  }
  const level = INTIMACY_LEVELS[idx]
  const next = INTIMACY_LEVELS[idx + 1] || null
  const span = next ? next.min - level.min : 1
  const percent = next ? clamp(Math.round(((v - level.min) / span) * 100), 0, 100) : 100
  return {
    index: idx,
    name: level.name,
    icon: level.icon,
    color: level.color,
    value: v,
    nextMin: next ? next.min : null,
    nextName: next ? next.name : null,
    need: next ? Math.max(0, next.min - v) : 0,
    percent,
    isMax: !next,
  }
}

// 足迹分类 key 归一：兼容 enriched(categoryKey) 与原始(category)。
function categoryKeyOf(fp) {
  return fp.categoryKey || fp.category || 'life'
}

// 由足迹列表构建开放世界地图状态。
// 点亮规则：某区有 N 条足迹，则第 i 格亮度 = clamp(N - i, 0, 3)；
// 亮度 0 表示仍被迷雾覆盖，>0 表示已点亮。足迹越多，格子越亮。
function buildWorld(footprints) {
  const counts = {}
  ;(footprints || []).forEach((fp) => {
    const key = categoryKeyOf(fp)
    counts[key] = (counts[key] || 0) + 1
  })

  let explored = 0
  let total = 0
  const realms = REALMS.map((realm) => {
    const visited = counts[realm.key] || 0
    const tiles = realm.tiles.map((name, i) => {
      const level = clamp(visited - i, 0, 3)
      if (level > 0) explored += 1
      total += 1
      return { name, level, lit: level > 0 }
    })
    return Object.assign({}, realm, {
      visited,
      litCount: tiles.filter((t) => t.lit).length,
      percent: Math.round((tiles.filter((t) => t.lit).length / realm.tiles.length) * 100),
      tiles,
    })
  })

  const activeRealms = realms.filter((r) => r.visited > 0)
  return {
    realms,
    activeRealms,
    explored,
    total,
    remaining: total - explored,
    percent: total ? Math.round((explored / total) * 100) : 0,
    footprintCount: (footprints || []).length,
  }
}

// ===== 真实地图（微信原生 map 组件 / 腾讯地图 / GCJ-02）=====

// 由足迹构建真实地图数据：按地点名去重聚合成「已点亮地点」，生成地图 markers 与地点清单。
// 只有带经纬度的足迹才能点亮地图；无坐标的足迹仍计入分类探索成就。
function buildRealMap(footprints) {
  const placeMap = {}
  ;(footprints || []).forEach((fp) => {
    const lat = Number(fp.latitude)
    const lng = Number(fp.longitude)
    if (!isFinite(lat) || !isFinite(lng) || !lat || !lng) return
    const name = (fp.location_name || '').trim() || `${lat.toFixed(3)}, ${lng.toFixed(3)}`
    const city = extractCity(fp.location_name, fp.address)
    const key = name
    if (!placeMap[key]) {
      placeMap[key] = {
        name,
        city,
        latitude: lat,
        longitude: lng,
        count: 0,
        category: categoryKeyOf(fp),
        lastDate: (fp.occurred_at || '').slice(0, 10),
        titles: [],
      }
    }
    placeMap[key].count += 1
    if (fp.title) placeMap[key].titles.push(fp.title)
    if ((fp.occurred_at || '') > placeMap[key].lastDate) placeMap[key].lastDate = (fp.occurred_at || '').slice(0, 10)
  })

  const places = Object.keys(placeMap).map((k) => placeMap[k])
    .sort((a, b) => b.count - a.count || String(b.lastDate).localeCompare(a.lastDate))

  // 地图 markers：callout 显示地点名 + 足迹数
  const markers = places.map((p, i) => ({
    id: i + 1,
    latitude: p.latitude,
    longitude: p.longitude,
    name: p.name,
    callout: {
      content: `${p.name} · ${p.count}段`,
      color: '#1a1730',
      fontSize: 12,
      anchorY: 2,
      bgColor: '#ffffff',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#e4e1f5',
      padding: 8,
      display: 'BYCLICK',
    },
  }))

  // 地图中心：优先取最新足迹坐标，否则中国中心
  let center = { latitude: 35.8617, longitude: 104.1954 }
  let scale = 4
  if (places.length) {
    const withDate = places.slice().sort((a, b) => String(b.lastDate).localeCompare(a.lastDate))
    center = { latitude: withDate[0].latitude, longitude: withDate[0].longitude }
    scale = places.length === 1 ? 13 : 9
  }

  // 城市去重统计
  const cities = {}
  places.forEach((p) => {
    if (p.city) cities[p.city] = (cities[p.city] || 0) + 1
  })

  return {
    places,
    markers,
    center,
    scale,
    litCount: places.length,
    cityCount: Object.keys(cities).length,
    withGeoCount: footprints ? footprints.filter((f) => {
      const la = Number(f.latitude); const ln = Number(f.longitude)
      return isFinite(la) && isFinite(ln) && la && ln
    }).length : 0,
  }
}

// ===== 航旅式「行程统计」聚合（借鉴航旅纵横 / 高德的看板语言）=====
// 合规：只把用户本人足迹的经纬度用微信原生 <map> 的 polyline 连成旅行航迹，
// 不自绘任何国界/省界，不引入境外地图。个人坐标遵循 RLS owner-only。

// 球面距离（公里），用于估算累计旅行里程
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// 从地址里提取省份/直辖市（用于「足迹遍布」统计），提取不到返回 ''
function extractProvince(address, locationName) {
  const text = `${address || ''} ${locationName || ''}`
  const municipalities = ['北京', '上海', '天津', '重庆']
  for (const m of municipalities) if (text.indexOf(m) >= 0) return m + '市'
  const m = /([^\s·，,省]{2,8})省/.exec(text)
  if (m) return m[1] + '省'
  const auto = /([^\s·，,]{2,8})(自治区|壮族自治区|回族自治区|维吾尔自治区)/.exec(text)
  if (auto) return auto[1] + auto[2]
  const hk = /香港/.test(text) ? '香港' : ''
  const mo = /澳门/.test(text) ? '澳门' : ''
  const tw = /台湾/.test(text) ? '台湾' : ''
  return hk || mo || tw || ''
}

function hasGeo(f) {
  const la = Number(f && f.latitude); const ln = Number(f && f.longitude)
  return isFinite(la) && isFinite(ln) && la !== 0 && ln !== 0
}

// ===== 省份识别：文本优先，坐标兜底 =====
// 足迹的 location_name 往往是「天环广场」这类具体地名、address 可能为空，
// 只靠文本识别会全省份计 0。这里内置 34 个省级行政区的经纬度范围速查表
// （仅用于把本人足迹坐标归到省级行政区，不在地图上绘制任何边界，合规）。
const PROVINCE_BBOXES = [
  { name: '北京市', lat1: 39.44, lat2: 41.06, lng1: 115.42, lng2: 117.51 },
  { name: '天津市', lat1: 38.55, lat2: 40.25, lng1: 116.70, lng2: 118.05 },
  { name: '河北省', lat1: 36.05, lat2: 42.62, lng1: 113.43, lng2: 119.85 },
  { name: '山西省', lat1: 34.60, lat2: 40.74, lng1: 110.23, lng2: 114.35 },
  { name: '内蒙古自治区', lat1: 37.40, lat2: 53.33, lng1: 97.20, lng2: 126.06 },
  { name: '辽宁省', lat1: 38.72, lat2: 43.48, lng1: 118.84, lng2: 126.62 },
  { name: '吉林省', lat1: 40.86, lat2: 45.40, lng1: 121.64, lng2: 131.31 },
  { name: '黑龙江省', lat1: 43.42, lat2: 53.56, lng1: 121.19, lng2: 135.09 },
  { name: '上海市', lat1: 30.67, lat2: 31.88, lng1: 120.86, lng2: 122.12 },
  { name: '江苏省', lat1: 30.76, lat2: 35.13, lng1: 116.34, lng2: 121.95 },
  { name: '浙江省', lat1: 27.03, lat2: 31.19, lng1: 118.03, lng2: 122.87 },
  { name: '安徽省', lat1: 29.39, lat2: 34.65, lng1: 114.90, lng2: 119.64 },
  { name: '福建省', lat1: 23.55, lat2: 28.31, lng1: 115.83, lng2: 120.72 },
  { name: '江西省', lat1: 24.50, lat2: 30.08, lng1: 113.40, lng2: 118.48 },
  { name: '山东省', lat1: 34.38, lat2: 38.43, lng1: 114.80, lng2: 122.71 },
  { name: '河南省', lat1: 31.40, lat2: 36.37, lng1: 110.35, lng2: 116.66 },
  { name: '湖北省', lat1: 29.05, lat2: 33.28, lng1: 108.32, lng2: 116.20 },
  { name: '湖南省', lat1: 24.63, lat2: 30.13, lng1: 108.79, lng2: 114.26 },
  { name: '广东省', lat1: 20.22, lat2: 25.52, lng1: 109.66, lng2: 117.32 },
  { name: '广西壮族自治区', lat1: 20.90, lat2: 26.40, lng1: 104.45, lng2: 112.03 },
  { name: '海南省', lat1: 18.10, lat2: 20.10, lng1: 108.58, lng2: 111.05 },
  { name: '重庆市', lat1: 28.16, lat2: 32.20, lng1: 105.28, lng2: 110.20 },
  { name: '四川省', lat1: 26.05, lat2: 34.32, lng1: 97.28, lng2: 108.85 },
  { name: '贵州省', lat1: 24.62, lat2: 27.80, lng1: 103.60, lng2: 109.55 },
  { name: '云南省', lat1: 21.14, lat2: 29.25, lng1: 97.52, lng2: 106.20 },
  { name: '西藏自治区', lat1: 26.80, lat2: 36.52, lng1: 78.39, lng2: 99.10 },
  { name: '陕西省', lat1: 31.70, lat2: 39.59, lng1: 105.49, lng2: 111.25 },
  { name: '甘肃省', lat1: 32.60, lat2: 42.80, lng1: 92.21, lng2: 108.72 },
  { name: '青海省', lat1: 31.60, lat2: 39.24, lng1: 89.40, lng2: 103.07 },
  { name: '宁夏回族自治区', lat1: 35.24, lat2: 39.63, lng1: 104.28, lng2: 107.68 },
  { name: '新疆维吾尔自治区', lat1: 34.28, lat2: 49.24, lng1: 73.45, lng2: 96.40 },
  { name: '香港特别行政区', lat1: 22.15, lat2: 22.58, lng1: 113.83, lng2: 114.45 },
  { name: '澳门特别行政区', lat1: 22.10, lat2: 22.22, lng1: 113.52, lng2: 113.62 },
  { name: '台湾省', lat1: 21.90, lat2: 25.32, lng1: 119.90, lng2: 122.01 },
]

// 粤桂交界（雷州半岛/茂名 vs 北海/玉林/梧州）的 bbox 完全重叠，用一条对角分界线精修：
// 北部湾沿岸偏西归广西，雷州半岛及以东偏东归广东。仅当两点范围同时命中时生效。
function refineYuGui(lat, lng, name) {
  if (name !== '广东省' && name !== '广西壮族自治区') return name
  const inGX = lat >= 20.90 && lat <= 26.40 && lng >= 104.45 && lng <= 112.03
  const inGD = lat >= 20.22 && lat <= 25.52 && lng >= 109.66 && lng <= 117.32
  if (inGX && inGD) {
    const threshold = 110.15 + (Math.max(lat, 21.4) - 21.4) * 0.597
    return lng < threshold ? '广西壮族自治区' : '广东省'
  }
  return name
}

// 坐标 → 省级行政区：多个范围重叠时取面积最小的（直辖市/港澳的小范围优先命中）。
function provinceOfCoord(lat, lng) {
  const la = Number(lat); const ln = Number(lng)
  if (!isFinite(la) || !isFinite(ln) || !la || !ln) return ''
  let best = null
  let bestArea = Infinity
  PROVINCE_BBOXES.forEach((b) => {
    if (la >= b.lat1 && la <= b.lat2 && ln >= b.lng1 && ln <= b.lng2) {
      const area = (b.lat2 - b.lat1) * (b.lng2 - b.lng1)
      if (area < bestArea) { bestArea = area; best = b }
    }
  })
  return best ? refineYuGui(la, ln, best.name) : ''
}

// 去掉行政区后缀得到简称基名：「广东省」→「广东」，「广西壮族自治区」→「广西」。
function provinceBase(name) {
  return String(name || '')
    .replace(/特别行政区$/, '')
    .replace(/维吾尔自治区$/, '')
    .replace(/壮族自治区$/, '')
    .replace(/回族自治区$/, '')
    .replace(/自治区$/, '')
    .replace(/省$/, '')
    .replace(/市$/, '')
}

// 单条足迹的省份：地址/地点名文本识别优先（最准），失败后用坐标离线兜底。
function provinceOfFootprint(f) {
  if (!f) return ''
  const byText = extractProvince(f.address, f.location_name)
  if (byText) return byText
  if (hasGeo(f)) return provinceOfCoord(f.latitude, f.longitude)
  return ''
}

// 格子省份图布局：抽象网格（不绘制真实省界，合规），col 1-9 / row 0-6 近似地理方位。
const PROVINCE_GRID = [
  { name: '黑龙江省', abbr: '黑', col: 9, row: 0 },
  { name: '吉林省', abbr: '吉', col: 9, row: 1 },
  { name: '辽宁省', abbr: '辽', col: 8, row: 2 },
  { name: '内蒙古自治区', abbr: '蒙', col: 6, row: 1 },
  { name: '北京市', abbr: '京', col: 7, row: 2 },
  { name: '天津市', abbr: '津', col: 8, row: 3 },
  { name: '河北省', abbr: '冀', col: 7, row: 3 },
  { name: '山西省', abbr: '晋', col: 6, row: 3 },
  { name: '陕西省', abbr: '陕', col: 5, row: 3 },
  { name: '宁夏回族自治区', abbr: '宁', col: 5, row: 2 },
  { name: '甘肃省', abbr: '甘', col: 4, row: 2 },
  { name: '青海省', abbr: '青', col: 3, row: 2 },
  { name: '新疆维吾尔自治区', abbr: '新', col: 1, row: 2 },
  { name: '西藏自治区', abbr: '藏', col: 2, row: 3 },
  { name: '四川省', abbr: '川', col: 3, row: 3 },
  { name: '重庆市', abbr: '渝', col: 4, row: 3 },
  { name: '云南省', abbr: '云', col: 3, row: 4 },
  { name: '贵州省', abbr: '贵', col: 4, row: 4 },
  { name: '湖北省', abbr: '鄂', col: 5, row: 4 },
  { name: '河南省', abbr: '豫', col: 6, row: 4 },
  { name: '山东省', abbr: '鲁', col: 8, row: 4 },
  { name: '江苏省', abbr: '苏', col: 9, row: 4 },
  { name: '广西壮族自治区', abbr: '桂', col: 3, row: 5 },
  { name: '广东省', abbr: '粤', col: 4, row: 5 },
  { name: '湖南省', abbr: '湘', col: 5, row: 5 },
  { name: '江西省', abbr: '赣', col: 6, row: 5 },
  { name: '安徽省', abbr: '皖', col: 7, row: 5 },
  { name: '浙江省', abbr: '浙', col: 8, row: 5 },
  { name: '上海市', abbr: '沪', col: 9, row: 5 },
  { name: '海南省', abbr: '琼', col: 3, row: 6 },
  { name: '澳门特别行政区', abbr: '澳', col: 4, row: 6 },
  { name: '香港特别行政区', abbr: '港', col: 5, row: 6 },
  { name: '福建省', abbr: '闽', col: 7, row: 6 },
  { name: '台湾省', abbr: '台', col: 9, row: 6 },
]

// 把省份统计映射到格子布局：col 1-9 → left %，row 0-6 → top %，返回完整 34 格。
function buildProvinceGrid(provinces) {
  const countByBase = {}
  ;(provinces || []).forEach((p) => {
    const base = provinceBase(p.name)
    countByBase[base] = (countByBase[base] || 0) + p.count
  })
  return PROVINCE_GRID.map((cell) => {
    const count = countByBase[provinceBase(cell.name)] || 0
    return Object.assign({}, cell, {
      count,
      lit: count > 0,
      left: ((cell.col - 1) * 10 + 0.8).toFixed(2) + '%',
      top: (cell.row * 14 + 1.2).toFixed(2) + '%',
    })
  })
}

// 生成旅行看板：年份筛选 + 航迹 + 里程 + 省份统计 + 年度计数
function buildTravelBoard(footprints, activeYear) {
  const all = footprints || []
  const withGeo = all.filter(hasGeo)

  // 年份列表（全部足迹的年份，降序）+ 全部
  const yearSet = {}
  all.forEach((f) => {
    const y = String(f.occurred_at || '').slice(0, 4)
    if (/^\d{4}$/.test(y)) yearSet[y] = (yearSet[y] || 0) + 1
  })
  const years = Object.keys(yearSet).sort((a, b) => b.localeCompare(a))
  const yearOptions = ['全部'].concat(years)
  const year = activeYear && activeYear !== '全部' ? activeYear : '全部'

  // 按年份筛选（航迹与看板都基于筛选后的数据）
  const scoped = year === '全部' ? all : all.filter((f) => String(f.occurred_at || '').slice(0, 4) === year)
  const scopedGeo = scoped.filter(hasGeo)

  // 航迹：按时间升序的个人足迹坐标点（去重相邻过近的点，避免折线抖动）
  const track = scopedGeo.slice().sort((a, b) => String(a.occurred_at || '').localeCompare(String(b.occurred_at || '')))
    .map((f) => ({
      latitude: Number(f.latitude),
      longitude: Number(f.longitude),
      locationName: f.location_name || '',
      occurred_at: String(f.occurred_at || '').slice(0, 10),
    }))
  const trackDedup = track.filter((p, i) => {
    if (i === 0) return true
    const prev = track[i - 1]
    return haversineKm(prev.latitude, prev.longitude, p.latitude, p.longitude) > 0.5
  })

  // 微信 map 组件的 polyline：紫色虚线航迹，连成「到过的地方」
  const polyline = trackDedup.length >= 2 ? [{
    points: trackDedup.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    color: '#7c6cf0CC',
    width: 4,
    dottedLine: true,
    arrowLine: false,
    borderWidth: 0,
  }] : []

  // 累计里程：相邻航迹点距离求和
  let distanceKm = 0
  for (let i = 1; i < trackDedup.length; i++) {
    distanceKm += haversineKm(trackDedup[i - 1].latitude, trackDedup[i - 1].longitude, trackDedup[i].latitude, trackDedup[i].longitude)
  }
  distanceKm = Math.round(distanceKm)

  // 省份覆盖统计（高德式「点亮省份」：每省一条电量条，pct 为相对最高省的占比）
  // 识别链路：地址/地点名文本优先，识别不到（如「天环广场」这类纯地名）时用坐标离线兜底。
  const provinceSet = {}
  scoped.forEach((f) => {
    const p = provinceOfFootprint(f)
    if (p) provinceSet[p] = (provinceSet[p] || 0) + 1
  })
  const provinces = Object.keys(provinceSet)
    .map((name) => ({ name, count: provinceSet[name] }))
    .sort((a, b) => b.count - a.count)
  const provinceMax = provinces.length ? provinces[0].count : 0
  provinces.forEach((p) => {
    p.pct = provinceMax ? Math.round((p.count / provinceMax) * 100) : 0
  })
  // 格子省份图：全部 34 个省级行政区都渲染（未去的灰格），去过的亮紫并显示足迹数
  const provinceGrid = buildProvinceGrid(provinces)

  const map = buildRealMap(scoped)
  // 探索度环：以 10 座城市为满环基准，生成完整 background 串（小程序对 CSS 变量 + conic-gradient 支持不稳）
  const ringPct = Math.min(100, Math.round((map.cityCount / 10) * 100))
  const ringStyle = `background: conic-gradient(#7c6cf0 ${ringPct}%, rgba(255,255,255,0.16) ${ringPct}% 100%);`

  // 分享卡「截至」标签：全部=当前年月，某年=该年份
  const now = new Date()
  const asOf = year === '全部'
    ? `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`
    : year

  return {
    year,
    yearOptions,
    asOf,
    scopedCount: scoped.length,
    scopedGeoCount: scopedGeo.length,
    track: trackDedup,
    polyline,
    distanceKm,
    provinces,
    provinceCount: provinces.length,
    provinceGrid,
    litProvinceCount: provinces.length,
    ringPct,
    ringStyle,
    // 复用 buildRealMap 得到地点/marker/中心，基于筛选后的足迹
    map,
  }
}

// 从地点名/地址里提取城市：优先「XX市」，否则取常见分隔符前的第一段。
function extractCity(locationName, address) {
  const text = `${locationName || ''} ${address || ''}`
  const m = /([^\s·，,]{2,8}?)市/.exec(text)
  if (m) return m[1] + '市'
  const first = String(locationName || '').split(/[·，,\s]/)[0]
  return first && first.length <= 12 ? first : ''
}

// 判断角色是否为「我」（主角自己）：主角卡只用于人生进度展示，
// 不参与同行勾选与羁绊统计——自己陪自己不算羁绊。
function isSelfCharacter(c) {
  if (!c) return false
  return c.relation === '主角' || String(c.id) === 'demo_self' || String(c.id).indexOf('demo_self') === 0
}

// 对勾选的同行角色施加成长：亲密度 +intimacy。
// 注意：不再累加「同行次数」计数器。世界页的同行 N 次由 utils/companion-stats.js
// 直接扫真实足迹聚合；这里再 +1 只会制造和足迹对不上的假数据。
// selectedIds 存角色 id（字符串比较，兼容云端的数字 id 与本地的字符串 id）。
function applyCompanionGrowth(characters, selectedIds, opts) {
  const o = opts || {}
  const dIntimacy = o.intimacy == null ? 10 : Number(o.intimacy) || 0
  const dMeet = o.meet == null ? 0 : Number(o.meet) || 0
  const picked = new Set((selectedIds || []).map(String))
  return (characters || []).map((c) => {
    if (!picked.has(String(c.id))) return c
    if (isSelfCharacter(c)) return c // 主角自己不成长
    return Object.assign({}, c, {
      intimacy: Math.max(0, (Number(c.intimacy) || 0) + dIntimacy),
      meetCount: Math.max(0, (Number(c.meetCount) || 0) + dMeet),
    })
  })
}

// 计算编辑足迹时同行人员变化的成长增量：newIds 相对 oldIds 新增的角色成长，
// 移除的角色不做回退（亲密度只增不减，符合关系只积累不断崖的真实逻辑）。
function growthDelta(oldIds, newIds) {
  const oldSet = new Set((oldIds || []).map(String))
  return (newIds || []).filter((id) => !oldSet.has(String(id)))
}

function normalizeCharacter(c) {
  return {
    id: c.id != null ? c.id : newId(),
    name: c.name || '未命名角色',
    avatar: c.avatar || '🧍',
    relation: c.relation || '朋友',
    color: c.color || '#6f5ce8',
    metDate: c.metDate || '',
    story: c.story || '',
    avatarUrl: c.avatarUrl || '',
    intimacy: Math.max(0, Number(c.intimacy) || 0),
    meetCount: Math.max(0, Number(c.meetCount) || 0),
    createdAt: c.createdAt || new Date().toISOString(),
  }
}

// 默认示例角色：首次进入时给几张卡，方便立即体验勾选同行与亲密度；用户可随时删改。
// 不再预置「同行 6 次 / 12 次」这类凭空数字——同行次数只认真实足迹。
function defaultCharacters() {
  const now = new Date().toISOString()
  return [
    normalizeCharacter({ id: 'demo_self', name: '我', avatar: '🧍', relation: '主角', color: '#6f5ce8', intimacy: 0, meetCount: 0, createdAt: now }),
    normalizeCharacter({ id: 'demo_friend', name: '小美', avatar: '👩', relation: '挚友', color: '#e879a8', intimacy: 60, meetCount: 0, createdAt: now }),
    normalizeCharacter({ id: 'demo_family', name: '家人', avatar: '👨‍👩‍👧', relation: '家人', color: '#2f9e8f', intimacy: 120, meetCount: 0, createdAt: now }),
  ]
}

function readLocalCharacters() {
  try {
    if (typeof wx === 'undefined') return defaultCharacters()
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (raw == null || raw === '') return defaultCharacters()
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(list) || !list.length) return defaultCharacters()
    return list.map(normalizeCharacter)
  } catch (e) {
    return defaultCharacters()
  }
}

function writeLocalCharacters(list) {
  try {
    if (typeof wx !== 'undefined') wx.setStorageSync(STORAGE_KEY, list)
  } catch (e) { /* 预览容器可能无 storage，静默降级 */ }
  return list
}

// 从云端加载并合并：先用本地缓存秒开，云端表存在则以云端为准并刷新缓存；
// 云端失败（表未建/无网）则沿用本地，保证预览环境也能用。
async function loadCharacters(characterAccess) {
  const local = readLocalCharacters()
  if (!characterAccess || typeof characterAccess.list !== 'function') {
    return { characters: local, source: 'local' }
  }
  const res = await characterAccess.list()
  if (!res.error && Array.isArray(res.data) && res.data.length) {
    const cloud = res.data.map(normalizeCharacter)
    writeLocalCharacters(cloud)
    return { characters: cloud, source: 'cloud' }
  }
  return { characters: local, source: 'local' }
}

async function createCharacter(payload, characterAccess) {
  const list = readLocalCharacters()
  const temp = normalizeCharacter(Object.assign({}, payload, { id: newId() }))
  const next = list.concat(temp)
  writeLocalCharacters(next)
  if (characterAccess && typeof characterAccess.create === 'function') {
    const row = {
      name: temp.name, avatar: temp.avatar, relation: temp.relation,
      color: temp.color, met_date: temp.metDate, story: temp.story,
      avatar_url: temp.avatarUrl, intimacy: temp.intimacy, meet_count: temp.meetCount,
    }
    const res = await characterAccess.create(row)
    if (!res.error && res.data && res.data.id != null) {
      const merged = next.map((c) => (String(c.id) === String(temp.id)
        ? normalizeCharacter(Object.assign({}, c, { id: res.data.id })) : c))
      writeLocalCharacters(merged)
      return merged
    }
  }
  return next
}

async function updateCharacter(id, patch, characterAccess) {
  const list = readLocalCharacters()
  const next = list.map((c) => (String(c.id) === String(id) ? normalizeCharacter(Object.assign({}, c, patch, { id: c.id })) : c))
  writeLocalCharacters(next)
  if (characterAccess && typeof characterAccess.update === 'function' && String(id).indexOf('demo_') !== 0 && String(id).indexOf('c_') !== 0) {
    const row = {}
    if ('name' in patch) row.name = patch.name
    if ('avatar' in patch) row.avatar = patch.avatar
    if ('relation' in patch) row.relation = patch.relation
    if ('color' in patch) row.color = patch.color
    if ('metDate' in patch) row.met_date = patch.metDate
    if ('story' in patch) row.story = patch.story
    if ('avatarUrl' in patch) row.avatar_url = patch.avatarUrl
    if ('intimacy' in patch) row.intimacy = patch.intimacy
    if ('meetCount' in patch) row.meet_count = patch.meetCount
    if (Object.keys(row).length) await characterAccess.update(id, row)
  }
  return next
}

async function removeCharacter(id, characterAccess) {
  const list = readLocalCharacters()
  const next = list.filter((c) => String(c.id) !== String(id))
  writeLocalCharacters(next)
  if (characterAccess && typeof characterAccess.remove === 'function' && String(id).indexOf('demo_') !== 0 && String(id).indexOf('c_') !== 0) {
    await characterAccess.remove(id)
  }
  return next
}

// 判断 id 是否为云端真实记录（数字或纯数字字符串）；demo_/c_ 前缀为本地示例/待同步记录。
function isCloudId(id) {
  const s = String(id)
  return /^\d+$/.test(s)
}

// 把亲密度变更持久化：本地立即写入保证秒开，云端真实记录尽力同步，
// 这样足迹里勾选同行后，世界页重新加载能拿到最新亲密度。
// meet_count 是历史遗留列，不再写入（同行次数改由真实足迹聚合）。
async function persistGrowth(nextCharacters, characterAccess) {
  const list = nextCharacters.map(normalizeCharacter)
  writeLocalCharacters(list)
  if (characterAccess && typeof characterAccess.update === 'function') {
    const jobs = list
      .filter((c) => isCloudId(c.id))
      .map((c) => characterAccess.update(c.id, { intimacy: c.intimacy }))
    await Promise.all(jobs)
  }
  return list
}

module.exports = {
  REALMS,
  INTIMACY_LEVELS,
  STORAGE_KEY,
  clamp,
  newId,
  intimacyLevelOf,
  buildWorld,
  buildRealMap,
  buildTravelBoard,
  haversineKm,
  extractProvince,
  provinceOfCoord,
  provinceOfFootprint,
  provinceBase,
  buildProvinceGrid,
  PROVINCE_BBOXES,
  PROVINCE_GRID,
  extractCity,
  applyCompanionGrowth,
  growthDelta,
  normalizeCharacter,
  defaultCharacters,
  readLocalCharacters,
  writeLocalCharacters,
  loadCharacters,
  createCharacter,
  updateCharacter,
  removeCharacter,
  persistGrowth,
  isCloudId,
  isSelfCharacter,
}
