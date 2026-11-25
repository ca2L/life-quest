// 全球选点：微信 wx.chooseLocation 只有国内 POI，境外地点用原生 <map> 点击取坐标 +
// 内置境外城市速查表补全。选完写入 storage，由足迹页 onShow 回填表单。
// 原生 <map> 放在独立页面而非弹层，避免原生组件层级穿透盖住弹层。
const { groupPlaces, findPlace } = require('../../utils/world-places')
const { countryOfCoord } = require('../../utils/china-map')

function toast(title) {
  if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
    wx.showToast({ title, icon: 'none', duration: 1800 })
  }
}

Page({
  data: {
    keyword: '',
    groups: groupPlaces(''),
    center: { latitude: 25, longitude: 20 },
    scale: 3,
    markers: [],
    lat: null,
    lng: null,
    latText: '—',
    lngText: '—',
    placeName: '',
    country: '',
    countryInput: '',
    source: '',
    mapAvailable: false,
  },

  onLoad() {
    this.setData({
      mapAvailable: typeof wx !== 'undefined' && typeof wx.createMapContext === 'function',
    })
  },

  onSearch(event) {
    const keyword = event.detail.value || ''
    this.setData({ keyword, groups: groupPlaces(keyword) })
  },

  pickCity(event) {
    const d = event.currentTarget.dataset
    const p = findPlace(d.name)
    if (!p) return
    this.applyCoord(p.lat, p.lng, p.name, p.country, 'city')
    this.setData({ center: { latitude: p.lat, longitude: p.lng }, scale: 9, keyword: '', groups: groupPlaces('') })
  },

  // 点击地图任意位置取坐标（境外没有逆地理编码，名称交给用户填）
  onMapTap(event) {
    const d = (event && event.detail) || {}
    const la = Number(d.latitude)
    const ln = Number(d.longitude)
    if (!isFinite(la) || !isFinite(ln)) return
    const c = countryOfCoord(la, ln)
    this.applyCoord(la, ln, '', c ? c.name : '境外', 'map')
  },

  // bindtap 拿不到坐标时的兜底：取地图中心点
  useCenter() {
    if (typeof wx === 'undefined' || typeof wx.createMapContext !== 'function') {
      toast('当前环境不支持地图取点，请从下方城市列表选择')
      return
    }
    wx.createMapContext('globeMap', this).getCenterLocation({
      success: (r) => {
        const la = Number(r.latitude)
        const ln = Number(r.longitude)
        if (!isFinite(la) || !isFinite(ln)) { toast('取点失败，请选一个城市'); return }
        const c = countryOfCoord(la, ln)
        this.applyCoord(la, ln, '', c ? c.name : '境外', 'center')
      },
      fail: () => toast('取点失败，请从下方城市列表选择'),
    })
  },

  applyCoord(la, ln, name, country, source) {
    const lat = Math.round(la * 10000) / 10000
    const lng = Math.round(ln * 10000) / 10000
    this.setData({
      lat,
      lng,
      latText: lat.toFixed(4),
      lngText: lng.toFixed(4),
      placeName: name || this.data.placeName,
      country: country || this.data.country,
      // 国家可编辑：坐标矩形判定在国界交界处会误判，选城市列表或手动改正都以这里为准
      countryInput: country || this.data.countryInput,
      source,
      markers: [{
        id: 1,
        latitude: lat,
        longitude: lng,
        callout: {
          content: name || '选中的地点',
          fontSize: 12,
          bgColor: '#ffffff',
          color: '#1a1730',
          borderRadius: 8,
          padding: 8,
          display: 'ALWAYS',
        },
      }],
    })
  },

  onNameInput(event) {
    this.setData({ placeName: event.detail.value || '' })
  },

  onCountryInput(event) {
    this.setData({ countryInput: event.detail.value || '' })
  },

  confirm() {
    if (this.data.lat == null || this.data.lng == null) {
      toast('先在地图上点一下，或选一个城市')
      return
    }
    const name = String(this.data.placeName || '').trim()
    if (!name) { toast('给这个地点起个名字'); return }
    const country = String(this.data.countryInput || '').trim()
    const payload = {
      locationName: name,
      address: country ? country + ' · ' + name : name,
      country,
      latitude: this.data.lat,
      longitude: this.data.lng,
    }
    try {
      if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
        wx.setStorageSync('globePickResult', payload)
      }
    } catch (e) { /* 存储不可用时忽略，不影响返回 */ }
    if (typeof wx !== 'undefined' && typeof wx.navigateBack === 'function') wx.navigateBack()
    else if (typeof wx !== 'undefined' && typeof wx.switchTab === 'function') wx.switchTab({ url: '/pages/footprints/footprints' })
  },

  cancel() {
    if (typeof wx !== 'undefined' && typeof wx.navigateBack === 'function') wx.navigateBack()
  },
})
