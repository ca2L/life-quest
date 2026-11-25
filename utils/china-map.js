const { findPlace } = require('./world-places')

// 真实省界地图引擎 + 全球足迹看板。
// 合规说明：
// 1. 省界数据来自国内合规源（阿里云 DataV.GeoAtlas 行政区划边界），含 34 个省级行政区
//    与标准九段线；南海诸岛按国家规范以右下角插图呈现。
// 2. 只绘制省界轮廓用于「个人足迹点亮」数据可视化，不作为标准地图发布；
//    台湾省 / 香港特别行政区 / 澳门特别行政区均按中国省级行政区渲染，不单独成国。
// 3. 国界一律不自绘：境外足迹只用离线范围表做归属判定（输出国家名，不渲染任何边界）；
//    需要真实境外底图时，使用微信原生 <map>（腾讯地图）合规底图，不接境外瓦片源。
const GEO = require('./china-geo')

// 省份简称（用于地图标注与归一化匹配）
const SHORT = {
  北京市: '京', 天津市: '津', 河北省: '冀', 山西省: '晋', 内蒙古自治区: '蒙',
  辽宁省: '辽', 吉林省: '吉', 黑龙江省: '黑', 上海市: '沪', 江苏省: '苏',
  浙江省: '浙', 安徽省: '皖', 福建省: '闽', 江西省: '赣', 山东省: '鲁',
  河南省: '豫', 湖北省: '鄂', 湖南省: '湘', 广东省: '粤', 广西壮族自治区: '桂',
  海南省: '琼', 重庆市: '渝', 四川省: '川', 贵州省: '贵', 云南省: '云',
  西藏自治区: '藏', 陕西省: '陕', 甘肃省: '甘', 青海省: '青', 宁夏回族自治区: '宁',
  新疆维吾尔自治区: '新', 台湾省: '台', 香港特别行政区: '港', 澳门特别行政区: '澳',
}

function baseName(name) {
  return String(name || '')
    .replace(/特别行政区$/, '')
    .replace(/维吾尔自治区$/, '')
    .replace(/壮族自治区$/, '')
    .replace(/回族自治区$/, '')
    .replace(/自治区$/, '')
    .replace(/省$/, '')
    .replace(/市$/, '')
}

// 「广东省」/「广东」/「粤」统一归一到省数据里的全名
function canonicalProvince(name) {
  const s = String(name || '')
  if (SHORT[s]) return s
  const b = baseName(s)
  const hit = Object.keys(SHORT).find((k) => baseName(k) === b || SHORT[k] === s)
  return hit || ''
}

// ===== 投影：墨卡托（与腾讯地图底图同投影，形状自然）=====
function mercY(lat) {
  const r = (lat * Math.PI) / 180
  return Math.log(Math.tan(Math.PI / 4 + r / 2)) * (180 / Math.PI)
}

function makeProjector(bbox, rect) {
  const [minLng, minLat, maxLng, maxLat] = bbox
  const y0 = mercY(minLat)
  const y1 = mercY(maxLat)
  const spanX = maxLng - minLng
  const spanY = y1 - y0
  const scale = Math.min(rect.w / spanX, rect.h / spanY)
  const offX = rect.x + (rect.w - spanX * scale) / 2
  const offY = rect.y + (rect.h - spanY * scale) / 2
  return (lng, lat) => [offX + (lng - minLng) * scale, offY + (y1 - mercY(lat)) * scale]
}

// 坐标取整：viewBox 宽 680px，整数精度在手机上无可见差异，可显著减小 SVG 体积
const f1 = (n) => Math.round(n)

function ringPath(ring, proj) {
  let d = ''
  for (let i = 0; i < ring.length; i += 2) {
    const p = proj(ring[i], ring[i + 1])
    d += (i === 0 ? 'M' : 'L') + f1(p[0]) + ',' + f1(p[1])
  }
  return d + 'Z'
}

function ringCenter(ring) {
  let minX = Infinity, minY = -Infinity, maxX = -Infinity, maxY = Infinity
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i])
    minY = Math.max(minY, -ring[i + 1]); maxY = Math.min(maxY, -ring[i + 1])
  }
  return [(minX + maxX) / 2, -(minY + maxY) / 2]
}

// 生成完整中国省份点亮 SVG（深色主题，嵌在深紫旅程卡里）。
// litNames: 已点亮省份名数组（可为「广东省」「广东」「粤」）。
function buildChinaSvg(litNames, opts) {
  const o = opts || {}
  const W = 680
  const H = 470
  const lit = new Set((litNames || []).map(canonicalProvince).filter(Boolean))
  const mainRect = { x: 12, y: 14, w: 508, h: 374 }
  const insetRect = { x: 548, y: 262, w: 120, h: 192 }
  const proj = makeProjector(GEO.bbox, mainRect)
  const jdProj = makeProjector(GEO.jdBbox, insetRect)

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`)
  parts.push('<defs><linearGradient id="lit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9c8bff"/><stop offset="1" stop-color="#6f5ce8"/></linearGradient></defs>')
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#171233" rx="18"/>`)

  // 未点亮省份：暗底 + 淡紫省界；点亮省份：紫色渐变 + 发光双层描边
  GEO.provinces.forEach((p) => {
    const isLit = lit.has(p.n)
    const d = p.r.map((r) => ringPath(r, proj)).join('')
    if (isLit) {
      parts.push(`<path d="${d}" fill="none" stroke="#8b78ff" stroke-width="5" stroke-opacity="0.28" stroke-linejoin="round"/>`)
    }
    parts.push(`<path d="${d}" fill="${isLit ? 'url(#lit)' : '#2b2547'}" fill-rule="evenodd" stroke="${isLit ? '#d6c9ff' : '#574c86'}" stroke-width="${isLit ? 1.6 : 0.9}" stroke-linejoin="round"/>`)
  })

  // 省名标注：点亮省亮白字，未点亮省淡紫字
  GEO.provinces.forEach((p) => {
    const isLit = lit.has(p.n)
    const largest = p.r.slice().sort((a, b) => b.length - a.length)[0]
    if (!largest) return
    const c = ringCenter(largest)
    const xy = proj(c[0], c[1])
    const sh = SHORT[p.n] || ''
    const fs = ['京', '津', '沪', '港', '澳'].indexOf(sh) >= 0 ? 9 : 11
    parts.push(`<text x="${f1(xy[0])}" y="${f1(xy[1] + 3.5)}" text-anchor="middle" font-size="${fs}" font-family="sans-serif" fill="${isLit ? '#ffffff' : '#8d82bb'}" font-weight="${isLit ? 700 : 400}">${sh}</text>`)
  })

  // 南海诸岛插图（国家规范：九段线 + 岛礁，右下角）
  parts.push(`<rect x="${insetRect.x - 6}" y="${insetRect.y - 6}" width="${insetRect.w + 12}" height="${insetRect.h + 12}" rx="10" fill="#1d1740" stroke="#574c86" stroke-width="1"/>`)
  GEO.southIslands.forEach((r) => {
    parts.push(`<path d="${ringPath(r, jdProj)}" fill="#4a3f7d" stroke="#8d82bb" stroke-width="0.6"/>`)
  })
  GEO.boundary.forEach((r) => {
    parts.push(`<path d="${ringPath(r, jdProj)}" fill="none" stroke="#a493ff" stroke-width="1.8" stroke-linecap="round"/>`)
  })
  parts.push(`<text x="${insetRect.x + insetRect.w / 2}" y="${insetRect.y + insetRect.h + 16}" text-anchor="middle" font-size="10" font-family="sans-serif" fill="#8d82bb">南海诸岛</text>`)

  // 图例
  const n = lit.size
  parts.push(`<circle cx="22" cy="446" r="6" fill="url(#lit)"/>`)
  parts.push(`<text x="34" y="450" font-size="12" font-family="sans-serif" fill="#e6ddff">已点亮 ${n}/34 个省级行政区</text>`)
  if (o.source !== false) {
    parts.push(`<text x="${W - 12}" y="450" text-anchor="end" font-size="9" font-family="sans-serif" fill="#6d639c">省界示意 · 个人足迹可视化</text>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

// data URL：用 percent-encoding（不需要 btoa/TextEncoder，小程序与 H5 预览都可用）
function buildChinaDataUrl(litNames, opts) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildChinaSvg(litNames, opts))
}

// ===== canvas 2d 绘制（真机主路径）：与 SVG 同一套投影/配色 =====
function traceRings(ctx, rings, proj) {
  ctx.beginPath()
  rings.forEach((r) => {
    for (let i = 0; i < r.length; i += 2) {
      const p = proj(r[i], r[i + 1])
      if (i === 0) ctx.moveTo(p[0], p[1])
      else ctx.lineTo(p[0], p[1])
    }
    ctx.closePath()
  })
}

function drawChinaMap(ctx, litNames, opts) {
  const o = opts || {}
  const W = 680, H = 470
  const cssW = o.width || W
  const cssH = o.height || H
  const dpr = o.dpr || 1
  const lit = new Set((litNames || []).map(canonicalProvince).filter(Boolean))
  const mainRect = { x: 12, y: 14, w: 508, h: 374 }
  const insetRect = { x: 548, y: 262, w: 120, h: 192 }
  const proj = makeProjector(GEO.bbox, mainRect)
  const jdProj = makeProjector(GEO.jdBbox, insetRect)

  ctx.setTransform((dpr * cssW) / W, 0, 0, (dpr * cssH) / H, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#171233'
  ctx.fillRect(0, 0, W, H)

  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#9c8bff')
  grad.addColorStop(1, '#6f5ce8')

  GEO.provinces.forEach((p) => {
    const isLit = lit.has(p.n)
    traceRings(ctx, p.r, proj)
    ctx.fillStyle = isLit ? grad : '#2b2547'
    ctx.fill('evenodd')
    if (isLit) {
      ctx.save()
      ctx.shadowColor = 'rgba(139,120,255,0.65)'
      ctx.shadowBlur = 12
      ctx.strokeStyle = 'rgba(139,120,255,0.35)'
      ctx.lineWidth = 5
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()
    }
    ctx.strokeStyle = isLit ? '#d6c9ff' : '#574c86'
    ctx.lineWidth = isLit ? 1.6 : 0.9
    ctx.lineJoin = 'round'
    ctx.stroke()
  })

  // 省名
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  GEO.provinces.forEach((p) => {
    const isLit = lit.has(p.n)
    const largest = p.r.slice().sort((a, b) => b.length - a.length)[0]
    if (!largest) return
    const c = ringCenter(largest)
    const xy = proj(c[0], c[1])
    const sh = SHORT[p.n] || ''
    const small = ['京', '津', '沪', '港', '澳'].indexOf(sh) >= 0
    ctx.font = (small ? 9 : 11) + 'px sans-serif'
    ctx.fillStyle = isLit ? '#ffffff' : '#8d82bb'
    ctx.fillText(sh, xy[0], xy[1])
  })

  // 南海诸岛插图
  ctx.fillStyle = '#1d1740'
  ctx.strokeStyle = '#574c86'
  ctx.lineWidth = 1
  ctx.fillRect(insetRect.x - 6, insetRect.y - 6, insetRect.w + 12, insetRect.h + 12)
  ctx.strokeRect(insetRect.x - 6, insetRect.y - 6, insetRect.w + 12, insetRect.h + 12)
  GEO.southIslands.forEach((r) => {
    traceRings(ctx, [r], jdProj)
    ctx.fillStyle = '#4a3f7d'
    ctx.fill()
    ctx.strokeStyle = '#8d82bb'
    ctx.lineWidth = 0.6
    ctx.stroke()
  })
  GEO.boundary.forEach((r) => {
    traceRings(ctx, [r], jdProj)
    ctx.strokeStyle = '#a493ff'
    ctx.lineWidth = 1.8
    ctx.lineCap = 'round'
    ctx.stroke()
  })
  ctx.font = '10px sans-serif'
  ctx.fillStyle = '#8d82bb'
  ctx.fillText('南海诸岛', insetRect.x + insetRect.w / 2, insetRect.y + insetRect.h + 14)

  // 图例
  ctx.beginPath()
  ctx.arc(22, 446, 6, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.font = '12px sans-serif'
  ctx.fillStyle = '#e6ddff'
  ctx.fillText('已点亮 ' + lit.size + '/34 个省级行政区', 34, 446)
  ctx.textAlign = 'right'
  ctx.font = '9px sans-serif'
  ctx.fillStyle = '#6d639c'
  ctx.fillText('省界示意 · 个人足迹可视化', W - 12, 446)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return lit.size
}

// ===== 点内判定：精确判断坐标是否在中国境内（含港澳台）=====
function pointInRing(lng, lat, ring) {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2], yi = ring[i * 2 + 1]
    const xj = ring[j * 2], yj = ring[j * 2 + 1]
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

function provinceOfCoord(lat, lng) {
  for (let i = 0; i < GEO.provinces.length; i++) {
    const p = GEO.provinces[i]
    for (let k = 0; k < p.r.length; k++) {
      if (pointInRing(lng, lat, p.r[k])) return p.n
    }
  }
  return ''
}

// ===== 境外国家归属判定（仅输出国家名，不绘制任何边界）=====
// 格式：[lat1, lat2, lng1, lng2]；多个范围用于飞地（美国阿拉斯加/夏威夷等）。
const COUNTRIES = [
  { n: '日本', f: '🇯🇵', c: '亚洲', b: [[24.0, 45.6, 122.9, 146.0]] },
  { n: '韩国', f: '🇰🇷', c: '亚洲', b: [[33.1, 38.7, 124.6, 131.0]] },
  { n: '朝鲜', f: '🇰🇵', c: '亚洲', b: [[37.5, 43.1, 124.2, 130.7]] },
  { n: '蒙古', f: '🇲🇳', c: '亚洲', b: [[41.6, 52.2, 87.7, 119.9]] },
  { n: '越南', f: '🇻🇳', c: '亚洲', b: [[8.2, 23.4, 102.1, 109.6]] },
  { n: '老挝', f: '🇱🇦', c: '亚洲', b: [[13.9, 22.5, 100.0, 107.7]] },
  { n: '柬埔寨', f: '🇰🇭', c: '亚洲', b: [[10.4, 14.7, 102.3, 107.7]] },
  { n: '泰国', f: '🇹🇭', c: '亚洲', b: [[5.6, 20.5, 97.3, 105.7]] },
  { n: '缅甸', f: '🇲🇲', c: '亚洲', b: [[9.8, 28.6, 92.2, 101.2]] },
  { n: '马来西亚', f: '🇲🇾', c: '亚洲', b: [[0.9, 7.4, 99.6, 119.3]] },
  { n: '新加坡', f: '🇸🇬', c: '亚洲', b: [[1.15, 1.5, 103.6, 104.1]] },
  { n: '印度尼西亚', f: '🇮🇩', c: '亚洲', b: [[-11.1, 6.1, 94.9, 141.1]] },
  { n: '菲律宾', f: '🇵🇭', c: '亚洲', b: [[4.6, 21.2, 116.9, 126.6]] },
  { n: '印度', f: '🇮🇳', c: '亚洲', b: [[6.7, 35.5, 68.1, 97.4]] },
  { n: '尼泊尔', f: '🇳🇵', c: '亚洲', b: [[26.3, 30.5, 80.0, 88.2]] },
  { n: '斯里兰卡', f: '🇱🇰', c: '亚洲', b: [[5.9, 9.9, 79.6, 81.9]] },
  { n: '马尔代夫', f: '🇲🇻', c: '亚洲', b: [[0.6, 8.0, 72.5, 73.8]] },
  { n: '哈萨克斯坦', f: '🇰🇿', c: '亚洲', b: [[40.6, 55.5, 46.5, 87.4]] },
  { n: '乌兹别克斯坦', f: '🇺🇿', c: '亚洲', b: [[37.0, 45.6, 55.9, 73.2]] },
  { n: '阿联酋', f: '🇦🇪', c: '亚洲', b: [[22.6, 26.1, 51.5, 56.4]] },
  { n: '卡塔尔', f: '🇶🇦', c: '亚洲', b: [[24.4, 26.2, 50.7, 51.7]] },
  { n: '沙特阿拉伯', f: '🇸🇦', c: '亚洲', b: [[16.3, 32.2, 34.5, 55.7]] },
  { n: '土耳其', f: '🇹🇷', c: '亚洲', b: [[35.8, 42.1, 25.7, 44.8]] },
  { n: '以色列', f: '🇮🇱', c: '亚洲', b: [[29.4, 33.4, 34.2, 35.9]] },
  { n: '英国', f: '🇬🇧', c: '欧洲', b: [[49.9, 60.9, -8.7, 1.8]] },
  { n: '爱尔兰', f: '🇮🇪', c: '欧洲', b: [[51.4, 55.5, -10.6, -5.9]] },
  { n: '法国', f: '🇫🇷', c: '欧洲', b: [[41.3, 51.1, -5.2, 9.7]] },
  { n: '德国', f: '🇩🇪', c: '欧洲', b: [[47.2, 55.1, 5.8, 15.1]] },
  { n: '意大利', f: '🇮🇹', c: '欧洲', b: [[35.5, 47.1, 6.6, 18.6]] },
  { n: '西班牙', f: '🇪🇸', c: '欧洲', b: [[35.9, 43.8, -9.4, 4.4]] },
  { n: '葡萄牙', f: '🇵🇹', c: '欧洲', b: [[36.9, 42.2, -9.6, -6.1]] },
  { n: '荷兰', f: '🇳🇱', c: '欧洲', b: [[50.7, 53.6, 3.3, 7.3]] },
  { n: '比利时', f: '🇧🇪', c: '欧洲', b: [[49.4, 51.6, 2.5, 6.5]] },
  { n: '瑞士', f: '🇨🇭', c: '欧洲', b: [[45.8, 47.9, 5.9, 10.6]] },
  { n: '奥地利', f: '🇦🇹', c: '欧洲', b: [[46.3, 49.1, 9.5, 17.2]] },
  { n: '瑞典', f: '🇸🇪', c: '欧洲', b: [[55.3, 69.1, 10.9, 24.2]] },
  { n: '挪威', f: '🇳🇴', c: '欧洲', b: [[57.9, 71.2, 4.6, 31.1]] },
  { n: '丹麦', f: '🇩🇰', c: '欧洲', b: [[54.5, 57.8, 8.0, 15.2]] },
  { n: '芬兰', f: '🇫🇮', c: '欧洲', b: [[59.8, 70.1, 20.5, 31.6]] },
  { n: '波兰', f: '🇵🇱', c: '欧洲', b: [[49.0, 54.9, 14.1, 24.2]] },
  { n: '捷克', f: '🇨🇿', c: '欧洲', b: [[48.5, 51.1, 12.0, 18.9]] },
  { n: '希腊', f: '🇬🇷', c: '欧洲', b: [[34.8, 41.8, 19.3, 28.3]] },
  { n: '匈牙利', f: '🇭🇺', c: '欧洲', b: [[45.7, 48.6, 16.1, 22.9]] },
  { n: '乌克兰', f: '🇺🇦', c: '欧洲', b: [[44.3, 52.4, 22.1, 40.2]] },
  { n: '俄罗斯', f: '🇷🇺', c: '欧洲', b: [[41.2, 77.0, 27.0, 180.0]] },
  { n: '美国', f: '🇺🇸', c: '北美洲', b: [[24.4, 49.4, -125.0, -66.9], [51.0, 71.4, -179.0, -129.0], [18.9, 22.3, -160.3, -154.8]] },
  { n: '加拿大', f: '🇨🇦', c: '北美洲', b: [[41.7, 72.0, -141.0, -52.6]] },
  { n: '墨西哥', f: '🇲🇽', c: '北美洲', b: [[14.5, 32.7, -118.4, -86.7]] },
  { n: '古巴', f: '🇨🇺', c: '北美洲', b: [[19.8, 23.3, -84.9, -74.1]] },
  { n: '巴西', f: '🇧🇷', c: '南美洲', b: [[-33.8, 5.3, -74.0, -34.8]] },
  { n: '阿根廷', f: '🇦🇷', c: '南美洲', b: [[-55.1, -21.8, -73.6, -53.5]] },
  { n: '智利', f: '🇨🇱', c: '南美洲', b: [[-56.0, -17.5, -75.7, -66.4], [-27.5, -26.8, -109.9, -108.9]] },
  { n: '秘鲁', f: '🇵🇪', c: '南美洲', b: [[-18.4, 0.0, -81.4, -68.6]] },
  { n: '哥伦比亚', f: '🇨🇴', c: '南美洲', b: [[-4.3, 13.4, -79.0, -66.8]] },
  { n: '澳大利亚', f: '🇦🇺', c: '大洋洲', b: [[-43.7, -10.0, 112.9, 153.7]] },
  { n: '新西兰', f: '🇳🇿', c: '大洋洲', b: [[-47.3, -34.4, 166.4, 178.6]] },
  { n: '埃及', f: '🇪🇬', c: '非洲', b: [[21.7, 31.7, 24.7, 36.9]] },
  { n: '南非', f: '🇿🇦', c: '非洲', b: [[-34.9, -22.1, 16.4, 32.9]] },
  { n: '摩洛哥', f: '🇲🇦', c: '非洲', b: [[21.0, 36.0, -13.2, -1.0]] },
  { n: '肯尼亚', f: '🇰🇪', c: '非洲', b: [[-4.7, 5.5, 33.9, 41.9]] },
  { n: '尼日利亚', f: '🇳🇬', c: '非洲', b: [[4.0, 13.9, 2.7, 14.7]] },
  { n: '坦桑尼亚', f: '🇹🇿', c: '非洲', b: [[-11.8, -0.9, 29.3, 40.5]] },
  { n: '约旦', f: '🇯🇴', c: '亚洲', b: [[29.2, 33.4, 34.9, 39.3]] },
  { n: '文莱', f: '🇧🇳', c: '亚洲', b: [[4.0, 5.1, 114.0, 115.4]] },
  { n: '格鲁吉亚', f: '🇬🇪', c: '亚洲', b: [[41.0, 43.6, 40.0, 46.7]] },
  { n: '亚美尼亚', f: '🇦🇲', c: '亚洲', b: [[38.8, 41.3, 43.4, 46.6]] },
  { n: '阿塞拜疆', f: '🇦🇿', c: '亚洲', b: [[38.4, 41.9, 44.8, 50.4]] },
  { n: '克罗地亚', f: '🇭🇷', c: '欧洲', b: [[42.4, 46.6, 13.5, 19.4]] },
  { n: '塞尔维亚', f: '🇷🇸', c: '欧洲', b: [[42.2, 46.2, 18.8, 23.0]] },
  { n: '保加利亚', f: '🇧🇬', c: '欧洲', b: [[41.2, 44.2, 22.3, 28.6]] },
  { n: '罗马尼亚', f: '🇷🇴', c: '欧洲', b: [[43.6, 48.3, 20.2, 29.7]] },
  { n: '卢森堡', f: '🇱🇺', c: '欧洲', b: [[49.4, 50.2, 5.7, 6.5]] },
  { n: '马耳他', f: '🇲🇹', c: '欧洲', b: [[35.8, 36.1, 14.2, 14.6]] },
  { n: '塞浦路斯', f: '🇨🇾', c: '欧洲', b: [[34.5, 35.7, 32.2, 34.6]] },
  { n: '白俄罗斯', f: '🇧🇾', c: '欧洲', b: [[51.2, 56.2, 23.1, 32.8]] },
  { n: '爱沙尼亚', f: '🇪🇪', c: '欧洲', b: [[57.5, 59.7, 21.8, 28.2]] },
  { n: '拉脱维亚', f: '🇱🇻', c: '欧洲', b: [[55.7, 58.1, 20.9, 28.2]] },
  { n: '立陶宛', f: '🇱🇹', c: '欧洲', b: [[53.9, 56.5, 20.9, 26.9]] },
  { n: '牙买加', f: '🇯🇲', c: '北美洲', b: [[17.7, 18.6, -78.4, -76.1]] },
  { n: '多米尼加', f: '🇩🇴', c: '北美洲', b: [[17.5, 20.0, -72.1, -68.3]] },
  { n: '哥斯达黎加', f: '🇨🇷', c: '北美洲', b: [[8.0, 11.3, -86.0, -82.5]] },
  { n: '巴拿马', f: '🇵🇦', c: '北美洲', b: [[7.2, 9.7, -83.1, -77.1]] },
  { n: '玻利维亚', f: '🇧🇴', c: '南美洲', b: [[-22.9, -9.6, -69.7, -57.4]] },
  { n: '厄瓜多尔', f: '🇪🇨', c: '南美洲', b: [[-5.1, 1.5, -81.1, -75.2], [-1.5, 0.8, -91.6, -89.0]] },
  { n: '委内瑞拉', f: '🇻🇪', c: '南美洲', b: [[0.6, 12.5, -73.4, -59.8]] },
  { n: '乌拉圭', f: '🇺🇾', c: '南美洲', b: [[-35.0, -30.1, -58.5, -53.1]] },
  { n: '斐济', f: '🇫🇯', c: '大洋洲', b: [[-19.2, -16.1, 177.0, 180.0]] },
  { n: '法属波利尼西亚', f: '🇵🇫', c: '大洋洲', b: [[-27.7, -7.9, -154.0, -134.0]] },
  { n: '新喀里多尼亚', f: '🇳🇨', c: '大洋洲', b: [[-23.4, -19.0, 163.0, 168.0]] },
  { n: '巴布亚新几内亚', f: '🇵🇬', c: '大洋洲', b: [[-11.7, -1.3, 130.9, 155.9]] },
  { n: '关岛', f: '🇬🇺', c: '大洋洲', b: [[13.2, 13.7, 144.6, 145.0]] },
  { n: '北马里亚纳', f: '🇲🇵', c: '大洋洲', b: [[14.0, 20.6, 144.8, 146.1]] },
  { n: '突尼斯', f: '🇹🇳', c: '非洲', b: [[30.2, 37.6, 7.4, 11.6]] },
  { n: '津巴布韦', f: '🇿🇼', c: '非洲', b: [[-22.5, -15.6, 25.2, 33.1]] },
  { n: '纳米比亚', f: '🇳🇦', c: '非洲', b: [[-29.0, -16.9, 11.7, 25.3]] },
  { n: '卢旺达', f: '🇷🇼', c: '非洲', b: [[-2.9, -1.0, 28.8, 30.9]] },
  { n: '埃塞俄比亚', f: '🇪🇹', c: '非洲', b: [[3.4, 14.9, 32.9, 48.0]] },
  { n: '毛里求斯', f: '🇲🇺', c: '非洲', b: [[-20.6, -19.9, 57.3, 57.9]] },
  { n: '塞舌尔', f: '🇸🇨', c: '非洲', b: [[-5.1, -3.7, 55.2, 56.4]] },
  { n: '冰岛', f: '🇮🇸', c: '欧洲', b: [[63.3, 66.6, -24.5, -13.5]] },
]

const CONTINENT_ICON = { 亚洲: '🏯', 欧洲: '🏰', 北美洲: '🗽', 南美洲: '🌴', 大洋洲: '🦘', 非洲: '🦁' }
const CONTINENT_ORDER = ['亚洲', '欧洲', '北美洲', '南美洲', '大洋洲', '非洲']

// 坐标 → 国家（中国境内由省界精确判定，含港澳台；境外用范围表，重叠时取小面积）
function countryOfCoord(lat, lng) {
  const la = Number(lat); const ln = Number(lng)
  if (!isFinite(la) || !isFinite(ln)) return null
  if (provinceOfCoord(la, ln)) return { name: '中国', flag: '🇨🇳', continent: '亚洲', isChina: true }
  let best = null
  let bestArea = Infinity
  COUNTRIES.forEach((c) => {
    c.b.forEach((b) => {
      if (la >= b[0] && la <= b[1] && ln >= b[2] && ln <= b[3]) {
        const area = (b[1] - b[0]) * (b[3] - b[2])
        if (area < bestArea) { bestArea = area; best = c }
      }
    })
  })
  if (best) return { name: best.n, flag: best.f, continent: best.c, isChina: false }
  return null
}

// 全球足迹看板：国家/大洲点亮统计 + 供腾讯地图打点的 markers
// 优先使用足迹自带的国家（列表选点 / 手填），比坐标矩形判定准；没有才回落到坐标识别。
// 矩形 bbox 在国界交界处天然会误判（如福冈被韩国 bbox 覆盖），所以列表选点必须带 country。
function metaOfCountry(name) {
  const key = String(name || '').trim()
  if (!key) return null
  if (key === '中国') return { name: '中国', flag: '🇨🇳', continent: '亚洲', isChina: true }
  const hit = COUNTRIES.find((x) => x.n === key)
  if (hit) return { name: hit.n, flag: hit.f, continent: hit.c, isChina: false }
  return { name: key, flag: '', continent: '其他', isChina: false }
}

// 地点名反查：足迹没带 country 时，用内置地点库的名称匹配兜底（如「普吉岛」→ 泰国）。
// 换设备后本地映射丢失，这条链路仍能保证列表选点的国家正确。
function metaOfPlaceName(name) {
  const hit = findPlace(String(name || '').trim())
  return hit ? metaOfCountry(hit.country) : null
}

function buildGlobalBoard(footprints) {
  const all = footprints || []
  const map = {}
  const markers = []
  let overseasCount = 0
  let chinaCount = 0
  let unknownCount = 0
  all.forEach((f, i) => {
    const la = Number(f.latitude); const ln = Number(f.longitude)
    if (!isFinite(la) || !isFinite(ln) || !la || !ln) return
    markers.push({
      id: i + 1,
      latitude: la,
      longitude: ln,
      callout: { content: f.location_name || f.title || '足迹', fontSize: 11, bgColor: '#ffffff', color: '#1a1730', borderRadius: 8, padding: 6, display: 'BYCLICK' },
    })
    const c = metaOfCountry(f.country) || metaOfPlaceName(f.location_name) || countryOfCoord(la, ln)
    if (!c) { unknownCount++; return }
    if (c.isChina) chinaCount++
    else overseasCount++
    const key = c.name
    if (!map[key]) map[key] = { name: key, flag: c.flag, continent: c.continent, count: 0, isChina: c.isChina, places: [], lastDate: '' }
    map[key].count += 1
    const place = (f.location_name || '').trim()
    if (place && map[key].places.indexOf(place) < 0) map[key].places.push(place)
    const d = String(f.occurred_at || '').slice(0, 10)
    if (d > map[key].lastDate) map[key].lastDate = d
  })
  const countries = Object.keys(map).map((k) => {
    const c = map[k]
    c.firstPlace = c.places[0] || '已点亮'
    return c
  }).sort((a, b) => b.count - a.count)
  const groups = CONTINENT_ORDER.concat(['其他']).map((c) => ({
    name: c,
    icon: CONTINENT_ICON[c] || '🌍',
    countries: countries.filter((x) => (c === '其他'
      ? CONTINENT_ORDER.indexOf(x.continent) < 0
      : x.continent === c)),
  })).filter((g) => g.countries.length)
  return {
    countries,
    groups,
    countryCount: countries.length,
    overseasCountryCount: countries.filter((c) => !c.isChina).length,
    overseasCount,
    chinaCount,
    unknownCount,
    markers,
    // 全球视图中心：优先取首个境外点，否则中国中心
    center: (() => {
      const m = all.find((f) => {
        const la = Number(f.latitude); const ln = Number(f.longitude)
        return isFinite(la) && isFinite(ln) && la && ln && !provinceOfCoord(la, ln)
      })
      if (m) return { latitude: Number(m.latitude), longitude: Number(m.longitude) }
      return { latitude: 35.8617, longitude: 104.1954 }
    })(),
  }
}

module.exports = {
  SHORT,
  canonicalProvince,
  buildChinaSvg,
  buildChinaDataUrl,
  drawChinaMap,
  provinceOfCoord,
  countryOfCoord,
  buildGlobalBoard,
  COUNTRIES,
  CONTINENT_ORDER,
}
