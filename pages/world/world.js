const { footprintAccess, characterAccess, todayStr } = require('../../utils/store')
const {
  REALMS, intimacyLevelOf, buildWorld, buildRealMap, buildTravelBoard, readLocalCharacters,
  loadCharacters, createCharacter, updateCharacter, removeCharacter, newId, isSelfCharacter,
} = require('../../utils/world')
const { chooseImages, readImageAsDataUrl } = require('../../utils/footprint-helpers')
const { buildGlobalBoard, buildChinaDataUrl, drawChinaMap } = require('../../utils/china-map')
const { buildCompanionStats } = require('../../utils/companion-stats')

const RELATIONS = ['主角', '家人', '挚友', '朋友', '恋人', '同学', '同事', '宠物', '其他']
// 角色头像候选：用 emoji，跨平台显示稳定
const AVATARS = ['🧍', '👩', '👨', '🧑', '👧', '👦', '👵', '👴', '👨‍👩‍👧', '🐶', '🐱', '🌟', '🦊', '🌈']
const COLORS = ['#6f5ce8', '#e879a8', '#2f9e8f', '#f5a623', '#ff7b6b', '#5aa9e6']

function emptyForm() {
  return {
    name: '', avatar: '🧍', relation: '朋友', color: '#6f5ce8',
    metDate: '', story: '', avatarUrl: '',
  }
}

// 用固定像素高度替代 vh：真机上 scroll-view 在没有明确高度的 flex 容器里不会滚动，
// 加上输入法弹起会重算 vh，导致底部字段（故事线/主题色）被固定按钮遮住、滑不下去。
// 与足迹表单 computeSheetStyles 同源方案，真机用内联 px，预览环境保留 vh 兜底。
function computeSheetStyles() {
  let h = 0
  try {
    if (typeof wx !== 'undefined') {
      if (typeof wx.getWindowInfo === 'function') h = wx.getWindowInfo().windowHeight || 0
      else if (typeof wx.getSystemInfoSync === 'function') h = wx.getSystemInfoSync().windowHeight || 0
    }
  } catch (e) { h = 0 }
  if (!h || h < 400) return { sheetStyle: '' }
  const sheet = Math.round(h * 0.9)
  return { sheetStyle: 'height:' + sheet + 'px;' }
}

Page({
  data: {
    authState: 'checking',
    loadError: '',
    world: { realms: [], activeRealms: [], explored: 0, total: 24, remaining: 24, percent: 0, footprintCount: 0 },
    realMap: { places: [], markers: [], center: { latitude: 35.8617, longitude: 104.1954 }, scale: 4, litCount: 0, cityCount: 0, withGeoCount: 0 },
    // 航旅式行程看板（年份筛选 / 航迹 / 里程 / 省份）
    board: { year: '全部', yearOptions: ['全部'], scopedCount: 0, scopedGeoCount: 0, track: [], polyline: [], distanceKm: 0, provinces: [], provinceCount: 0, provinceGrid: [] },
    // 全球足迹看板（腾讯地图合规底图 + 国家点亮，不绘国界）
    globalBoard: { countries: [], groups: [], countryCount: 0, overseasCountryCount: 0, overseasCount: 0, chinaCount: 0, unknownCount: 0, markers: [], center: { latitude: 35.8617, longitude: 104.1954 } },
    // 真实省界图：canvas 主路径（真机）/ SVG data URL（H5 预览与真机兜底）/ 格子图二级兜底
    canvasAvailable: false,
    chinaMapSrc: '',
    chinaMapFallback: 0,
    provinceView: 'real', // real 真实省界（默认） | bars 电量条 | grid 格子图
    allFeet: [], // 缓存全部足迹，年份切换时无需重新请求
    activeYear: '全部',
    mapAvailable: false,
    mapMode: 'map', // map 真实地图 | list 地点清单
    focusPlace: '',
    characters: [],
    characterCount: 0,
    companions: [], // 排除「我」并按名字去重后的同行者
    companionCount: 0,
    totalIntimacy: 0,
    topCharacter: null,
    // 真实足迹统计：不再读角色表的 meet_count 计数器
    companionStats: { totalLinks: 0, footprintsWithPeople: 0, charactersWithRecords: 0, unlinkedCount: 0, unlinkedNames: [] },
    // 主视图切换：map 中国地图 | global 全球足迹 | roles 角色卡
    mainTab: 'map',
    // 地图分区浏览
    activeRealmKey: 'all',
    realmFilter: [],
    // 角色编辑弹层
    showForm: false,
    editingId: null,
    form: emptyForm(),
    formError: '',
    relations: RELATIONS,
    avatars: AVATARS,
    colors: COLORS,
    todayKey: '',
    uploading: false,
    saving: false,
    sheetStyle: '',
  },

  onLoad() {
    this.setData(Object.assign({
      mapAvailable: typeof wx !== 'undefined' && typeof wx.createMapContext === 'function',
      canvasAvailable: typeof wx !== 'undefined' && typeof wx.createSelectorQuery === 'function',
      todayKey: todayStr(),
    }, computeSheetStyles()))
  },

  onShow() {
    this.restore()
  },

  async restore() {
    this.setData({ authState: 'checking', loadError: '' })
    const { data: session, error } = await getApp().ensureSession()
    if (error || !session) {
      getApp().resetSession()
      if (error && getApp().isTransientError(error) && getApp().wasSignedIn()) {
        this.setData({
          authState: 'signed-in',
          loadError: '云服务暂时不稳定，点亮数据仍是最近一次的内容',
        })
        return
      }
      // 未登录也展示本地角色与空地图，保证预览可见
      this.setData({ authState: 'signed-out' })
      this.buildFromLocal()
      return
    }
    this.setData({ authState: 'signed-in' })
    await this.loadData()
  },

  // 预览/未登录：用本地角色 + 空地图渲染，让功能始终可见
  buildFromLocal() {
    const characters = readLocalCharacters().map((c) => this.decorateCharacter(c))
    // 未登录 / 预览态没有云端足迹，同行次数应真实为 0，而不是沿用缓存计数
    this.applyCharacters(characters, [])
    this.setData({
      world: buildWorld([]), realMap: buildRealMap([]), board: buildTravelBoard([], '全部'),
      globalBoard: buildGlobalBoard([]), allFeet: [], activeYear: '全部',
    }, () => this.refreshChinaMap())
  },

  async onSignedIn() {
    getApp().resetSession()
    await this.restore()
  },

  async onSignOut() {
    const { cloud } = require('../../utils/store')
    await cloud.auth.signOut()
    getApp().resetSession()
    this.setData({ authState: 'signed-out' })
    this.buildFromLocal()
  },

  async loadData() {
    this.setData({ loadError: '' })
    const [footRes] = await Promise.all([footprintAccess.list()])
    const feet = footRes.data || []
    const world = buildWorld(feet)
    const board = buildTravelBoard(feet, this.data.activeYear || '全部')
    const realMap = board.map
    const globalBoard = buildGlobalBoard(feet)
    const { characters } = await loadCharacters(characterAccess)
    this.setData({
      world, board, realMap, globalBoard, allFeet: feet,
      mapMode: realMap.litCount ? 'map' : 'list',
    }, () => { this.applyCharacters(characters, feet); this.refreshChinaMap() })
    if (footRes.error) {
      this.setData({ loadError: footRes.error.message || '地图数据加载失败' })
    }
  },

  // 年份切换：基于缓存足迹重算航迹与看板，不重新请求云端
  setYear(event) {
    const year = event.currentTarget.dataset.year || '全部'
    if (year === this.data.activeYear) return
    const board = buildTravelBoard(this.data.allFeet, year)
    this.setData({
      activeYear: year,
      board,
      realMap: board.map,
      mapMode: board.map.litCount ? 'map' : 'list',
      focusPlace: '',
    }, () => this.refreshChinaMap())
  },

  decorateCharacter(c) {
    return Object.assign({}, c, { level: intimacyLevelOf(c.intimacy) })
  },

  /**
   * 角色卡渲染：同行次数一律从真实足迹重新聚合，覆盖角色表里可能存在的
   * 旧 meet_count 计数器（示例数据 / 历史累加），页面上还能展开逐条核对。
   * feet 为空数组时统计结果必然全为 0，绝不留假数据。
   */
  applyCharacters(raw, feet) {
    const base = (raw || []).map((c) => this.decorateCharacter(c))
    const sourceFeet = Array.isArray(feet) ? feet : (this.data.allFeet || [])
    const stats = buildCompanionStats(base, sourceFeet, { isSelf: isSelfCharacter })
    const byId = {}
    stats.rows.forEach((r) => { byId[String(r.id)] = r })
    const characters = base.map((c) => {
      const s = byId[String(c.id)] || {}
      return Object.assign({}, c, {
        meetCount: s.meetCount || 0,
        meetText: s.meetText || '🤝 还没有共同足迹',
        lastMetText: s.lastMetText || '',
        sharedPlaces: s.placesCount || 0,
        totalRecords: s.totalRecords || 0,
        sharedRecords: s.records || [],
        sharedOpen: false,
      })
    })
    // 同行者统计：排除「我」（主角自己），并按名字去重——自己陪自己不算羁绊
    const seen = new Set()
    const companions = []
    characters.forEach((c) => {
      if (isSelfCharacter(c)) return
      const key = String(c.name || '').trim()
      if (key && seen.has(key)) return
      if (key) seen.add(key)
      companions.push(c)
    })
    const totalIntimacy = companions.reduce((s, c) => s + (Number(c.intimacy) || 0), 0)
    const top = companions.slice().sort((a, b) => (b.intimacy || 0) - (a.intimacy || 0))[0] || null
    const realmFilter = [{ key: 'all', label: '全部', icon: '🌍' }].concat(
      this.data.world.activeRealms.map((r) => ({ key: r.key, label: r.name, icon: r.icon }))
    )
    this.setData({
      characters,
      companions,
      companionCount: companions.length,
      characterCount: characters.length,
      totalIntimacy,
      topCharacter: top,
      realmFilter,
      companionStats: {
        totalLinks: stats.totalLinks,
        footprintsWithPeople: stats.footprintsWithPeople,
        charactersWithRecords: stats.charactersWithRecords,
        unlinkedCount: stats.unlinkedCount,
        unlinkedNames: stats.unlinkedNames,
      },
    })
  },

  // 展开/收起某张角色卡背后的真实足迹明细，让「同行 N 次」可以核对
  toggleShared(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    this.setData({
      characters: (this.data.characters || []).map((c) => (
        String(c.id) === id ? Object.assign({}, c, { sharedOpen: !c.sharedOpen }) : c
      )),
    })
  },

  handleRetry() { this.loadData() },

  setRealmFilter(event) {
    this.setData({ activeRealmKey: event.currentTarget.dataset.key })
  },

  // 角色弹层
  openForm() {
    this.setData({ showForm: true, editingId: null, form: emptyForm(), formError: '' })
  },

  closeForm() {
    this.setData({ showForm: false, editingId: null, formError: '' })
  },

  noop() {},

  editCharacter(event) {
    const id = event.currentTarget.dataset.id
    const found = (this.data.characters || []).find((c) => String(c.id) === String(id))
    if (!found) return
    this.setData({
      showForm: true,
      editingId: found.id,
      form: {
        name: found.name, avatar: found.avatar, relation: found.relation, color: found.color,
        metDate: found.metDate || '', story: found.story || '', avatarUrl: found.avatarUrl || '',
      },
      formError: '',
    })
  },

  onFieldInput(event) {
    const key = event.currentTarget.dataset.field
    this.setData({ [`form.${key}`]: event.detail.value, formError: '' })
  },

  pickAvatar(event) {
    this.setData({ 'form.avatar': event.currentTarget.dataset.avatar })
  },

  pickColor(event) {
    this.setData({ 'form.color': event.currentTarget.dataset.color })
  },

  pickRelation(event) {
    this.setData({ 'form.relation': event.currentTarget.dataset.relation })
  },

  onMetDateChange(event) {
    this.setData({ 'form.metDate': event.detail.value })
  },

  clearMetDate() {
    this.setData({ 'form.metDate': '' })
  },

  // 上传真实头像：选图后读成 data URL 内联保存，不依赖云存储，预览/真机都能显示
  async uploadAvatar() {
    const res = await chooseImages(1)
    if (res.error) { wx.showToast({ title: res.error.message, icon: 'none' }); return }
    if (!res.data || !res.data.length) return
    this.setData({ uploading: true })
    wx.showLoading({ title: '处理头像…' })
    const dataUrl = await readImageAsDataUrl(res.data[0])
    wx.hideLoading()
    this.setData({ uploading: false })
    if (!dataUrl) { wx.showToast({ title: '头像读取失败', icon: 'none' }); return }
    this.setData({ 'form.avatarUrl': dataUrl })
  },

  removeAvatar() {
    this.setData({ 'form.avatarUrl': '' })
  },

  setMainTab(event) {
    this.setData({ mainTab: event.currentTarget.dataset.tab })
  },

  setMapMode(event) {
    this.setData({ mapMode: event.currentTarget.dataset.mode })
  },

  // 点亮省份图表样式切换：real 真实省界（默认）| bars 电量条 | grid 格子图
  setProvinceView(event) {
    const raw = event.currentTarget.dataset.mode
    const mode = ['real', 'bars', 'grid'].indexOf(raw) >= 0 ? raw : 'real'
    this.setData({ provinceView: mode }, () => {
      if (mode === 'real') this.refreshChinaMap()
    })
  },

  // 真实省界渲染：先备好 SVG data URL（预览/兜底都能用），真机再尝试 canvas 2d 绘制。
  refreshChinaMap() {
    const names = (this.data.board.provinces || []).map((p) => p.name)
    let src = ''
    try { src = buildChinaDataUrl(names) } catch (e) { src = '' }
    this.setData({ chinaMapSrc: src, chinaMapFallback: 0 }, () => {
      if (this.data.canvasAvailable) this.drawCanvasMap(names)
    })
  },

  drawCanvasMap(names, attempt) {
    const retry = attempt || 0
    if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') {
      this.setData({ canvasAvailable: false }); return
    }
    try {
      wx.createSelectorQuery().select('#china-map').fields({ node: true, size: true }).exec((res) => {
        const item = res && res[0]
        if (!item || !item.node || typeof item.node.getContext !== 'function') {
          // 节点可能还没渲染完，重试一次再降级到 SVG
          if (retry < 1) setTimeout(() => this.drawCanvasMap(names, retry + 1), 80)
          else this.setData({ canvasAvailable: false })
          return
        }
        const canvas = item.node
        const ctx = canvas.getContext('2d')
        if (!ctx) { this.setData({ canvasAvailable: false }); return }
        let dpr = 2
        try {
          const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
          dpr = info.pixelRatio || 2
        } catch (e) { dpr = 2 }
        const cssW = item.width || 340
        const cssH = item.height || 235
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
        try { drawChinaMap(ctx, names, { width: cssW, height: cssH, dpr }) }
        catch (e) { this.setData({ canvasAvailable: false }) }
      })
    } catch (e) {
      this.setData({ canvasAvailable: false })
    }
  },

  // SVG 加载失败：先退到本地静态省界图，再退到格子图，保证任何环境都有内容
  onChinaMapError() {
    if (this.data.chinaMapFallback === 0) {
      this.setData({ chinaMapSrc: '/assets/china-base.svg', chinaMapFallback: 1 })
    } else {
      this.setData({ provinceView: 'grid' })
      if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '已切换为格子省份图', icon: 'none' })
    }
  },

  // 点击地图 marker：切到清单并高亮该地点
  onMarkerTap(event) {
    const id = event.detail && event.detail.markerId
    const idx = Number(id) - 1
    const place = (this.data.realMap.places || [])[idx]
    if (!place) return
    this.setData({ mapMode: 'list', focusPlace: place.name })
    wx.showToast({ title: place.name, icon: 'none' })
  },

  // 从清单点地点：用微信原生 map 打开真实位置（合规）
  openPlace(event) {
    const name = event.currentTarget.dataset.name
    const place = (this.data.realMap.places || []).find((p) => p.name === name)
    if (!place) return
    if (typeof wx !== 'undefined' && typeof wx.openLocation === 'function') {
      wx.openLocation({
        latitude: place.latitude,
        longitude: place.longitude,
        name: place.name,
        address: place.name,
        scale: 15,
      })
    } else {
      wx.showToast({ title: '当前环境不支持打开地图', icon: 'none' })
    }
  },

  goFootprints() {
    wx.switchTab({ url: '/pages/footprints/footprints' })
  },

  async saveCharacter() {
    const f = this.data.form
    if (!f.name || !f.name.trim()) { this.setData({ formError: '给角色起个名字吧' }); return }
    this.setData({ saving: true, formError: '' })
    const payload = {
      name: f.name.trim(), avatar: f.avatar, relation: f.relation, color: f.color,
      metDate: f.metDate || '', story: (f.story || '').trim(), avatarUrl: f.avatarUrl || '',
    }
    const isEdit = !!this.data.editingId
    let next
    if (isEdit) {
      next = await updateCharacter(this.data.editingId, payload, characterAccess)
    } else {
      next = await createCharacter(payload, characterAccess)
    }
    this.setData({ saving: false })
    this.closeForm()
    this.applyCharacters(next)
    wx.showToast({ title: isEdit ? '已更新' : '角色已加入', icon: 'success' })
  },

  removeCharacter(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '移除角色',
      content: '移除后亲密度记录也会消失，确定吗？',
      confirmColor: '#e0603b',
      success: async (r) => {
        if (!r.confirm) return
        const next = await removeCharacter(id, characterAccess)
        this.applyCharacters(next)
        wx.showToast({ title: '已移除', icon: 'success' })
      },
    })
  },

})
