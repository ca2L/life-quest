/**
 * 我的书架 · 已读数据层
 *
 * 参考的开源项目（只借数据模型与体验，不引入后端 / 不复制代码）：
 *  - Jelu / LibrisLog / BookWyrm：阅读状态（想读 / 在读 / 已读 / 弃读）、
 *    起止日期、评分、短评、标签、按年月统计、Goodreads CSV 导入导出。
 *  - readNeo / dsh-weread：微信读书式书架、阅读时长、年度书墙、热力图。
 *  - Kavita / Calibre-Web：书籍元数据与封面字段的最小集合。
 *
 * 与微信读书的关键差异（如实说明）：
 *  - 不读取微信读书账号、不破解任何接口；这里的数据由本人手动添加或从自己导出的 CSV / JSON 导入。
 *  - 没有版权书城、没有社交排行；「已读」是自己的记录，不是平台认证。
 *  - 本地优先（wx.storage），导出为开放 JSON / CSV，能并入「人生存档」迁移走。
 */

const KEY = 'lifeBookshelf@1'
const GOAL_KEY = 'lifeBookshelfGoal'
const SCHEMA = 'life-quest/bookshelf@1'
const MAX_BOOKS = 500

const STATUSES = [
  { key: 'want', label: '想读', icon: '🔖' },
  { key: 'reading', label: '在读', icon: '📖' },
  { key: 'read', label: '已读', icon: '✅' },
  { key: 'dropped', label: '弃读', icon: '🌙' },
]

// 无 storage 的环境（node 校验 / 部分预览容器）退到进程内内存，避免报错
let memory = {}

function lsGet(key, fallback) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      const v = wx.getStorageSync(key)
      return v === '' || v == null ? fallback : v
    }
  } catch (e) { /* 忽略 */ }
  return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback
}
function lsSet(key, value) {
  memory[key] = value
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') wx.setStorageSync(key, value)
  } catch (e) { /* 忽略 */ }
}

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
function isoNow() { return new Date().toISOString() }
function clean(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max || 200)
}
function makeId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}
function num(v, fallback) {
  const n = Number(v)
  return isFinite(n) ? n : (fallback == null ? 0 : fallback)
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }
/** 统一日期：2024/05/01、2024.5.1、带时分秒的导出值都归一为 YYYY-MM-DD；无效则为空 */
function normalizeDate(v) {
  let s = String(v == null ? '' : v).trim().slice(0, 10).replace(/[\/.]/g, '-')
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (!m) return ''
  const p = (n) => String(n).padStart(2, '0')
  return m[1] + '-' + p(m[2]) + '-' + p(m[3])
}

function normalize(b) {
  const status = STATUSES.some((s) => s.key === b.status) ? b.status : 'want'
  const rating = clamp(Math.round(num(b.rating, 0)), 0, 5)
  const pages = Math.max(0, Math.round(num(b.pages, 0)))
  const minutes = Math.max(0, Math.round(num(b.minutes, 0)))
  const progress = status === 'read' ? 100 : clamp(Math.round(num(b.progress, 0)), 0, 100)
  const finishedAt = normalizeDate(b.finishedAt)
  const startedAt = normalizeDate(b.startedAt)
  return {
    id: b.id != null ? String(b.id) : makeId(),
    title: clean(b.title, 80) || '未命名书籍',
    author: clean(b.author, 60),
    cover: clean(b.cover, 500),
    isbn: clean(b.isbn, 40),
    status,
    rating,
    review: clean(b.review, 1000),
    startedAt,
    // 不自动补「今天」：读完日期只能由用户填写或一键标记时写入，
    // 否则一本没填日期的已读书会随年份漂移，年度统计就变成编造的。
    finishedAt,
    pages,
    minutes,
    progress,
    tags: Array.isArray(b.tags) ? b.tags.map((t) => clean(t, 24)).filter(Boolean).slice(0, 8) : [],
    source: b.source === 'import' ? 'import' : 'manual',
    createdAt: b.createdAt || isoNow(),
    updatedAt: b.updatedAt || isoNow(),
  }
}

function loadBooks() {
  const raw = lsGet(KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_BOOKS).map(normalize)
}
function saveBooks(list) {
  const cleanList = (list || []).slice(0, MAX_BOOKS).map(normalize)
  lsSet(KEY, cleanList)
  return cleanList
}
function bookById(id) {
  return loadBooks().find((b) => String(b.id) === String(id)) || null
}
function addBook(payload) {
  const list = loadBooks()
  const b = normalize(Object.assign({}, payload, { id: makeId(), createdAt: isoNow(), updatedAt: isoNow() }))
  list.unshift(b)
  saveBooks(list)
  return b
}
function updateBook(id, patch) {
  const next = loadBooks().map((b) => (
    String(b.id) === String(id)
      ? normalize(Object.assign({}, b, patch, { id: b.id, createdAt: b.createdAt, updatedAt: isoNow() }))
      : b
  ))
  saveBooks(next)
  return next
}
function removeBook(id) {
  return saveBooks(loadBooks().filter((b) => String(b.id) !== String(id)))
}
/** 一键读完：状态、完成日、进度一起对齐，避免出现「已读但进度 20%」的错位 */
function markRead(id, date) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today()
  return updateBook(id, { status: 'read', finishedAt: day, progress: 100 })
}
function bumpProgress(id, delta) {
  const b = bookById(id)
  if (!b) return loadBooks()
  return updateBook(id, { progress: clamp(num(b.progress, 0) + (Number(delta) || 10), 0, 100) })
}

function getGoal() {
  const n = Math.round(num(lsGet(GOAL_KEY, 0), 0))
  return clamp(n, 0, 9999)
}
function setGoal(n) {
  const v = clamp(Math.round(num(n, 0)), 0, 9999)
  lsSet(GOAL_KEY, v)
  return v
}

// ── 统计：微信读书式年度概览，数字全部由已录入书籍算出 ──────────────────
function statsOf(books, todayStr, goal) {
  const list = Array.isArray(books) ? books : []
  const now = /^\d{4}-\d{2}-\d{2}$/.test(todayStr || '') ? todayStr : today()
  const year = now.slice(0, 4)
  const month = now.slice(0, 7)
  const byStatus = {}
  STATUSES.forEach((s) => { byStatus[s.key] = 0 })
  const byYearMap = {}
  const byMonth = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, label: String(i + 1) + '月', count: 0,
  }))
  const byRating = [1, 2, 3, 4, 5].map((star) => ({ star, count: 0 }))
  const authorMap = {}
  let minutes = 0
  let pages = 0
  let ratedSum = 0
  let ratedCount = 0
  let thisYear = 0
  let thisMonth = 0
  let finishedDays = {}

  list.forEach((b) => {
    byStatus[b.status] = (byStatus[b.status] || 0) + 1
    minutes += num(b.minutes, 0)
    pages += num(b.pages, 0)
    if (b.rating > 0) {
      ratedSum += b.rating
      ratedCount += 1
      const r = byRating.find((x) => x.star === b.rating)
      if (r) r.count += 1
    }
    if (b.author) authorMap[b.author] = (authorMap[b.author] || 0) + 1
    if (b.status !== 'read' || !b.finishedAt) return
    const y = b.finishedAt.slice(0, 4)
    byYearMap[y] = (byYearMap[y] || 0) + 1
    finishedDays[b.finishedAt] = true
    if (b.finishedAt.slice(0, 4) === year) {
      thisYear += 1
      const m = Number(b.finishedAt.slice(5, 7))
      if (m >= 1 && m <= 12) byMonth[m - 1].count += 1
      if (b.finishedAt.slice(0, 7) === month) thisMonth += 1
    }
  })

  const byYear = Object.keys(byYearMap).sort((a, b) => b.localeCompare(a))
    .map((y) => ({ year: y, count: byYearMap[y] }))
  const topAuthors = Object.keys(authorMap)
    .map((name) => ({ name, count: authorMap[name] }))
    .sort((a, b) => b.count - a.count).slice(0, 5)

  const g = clamp(Math.round(num(goal, 0)), 0, 9999)
  return {
    total: list.length,
    byStatus,
    readCount: byStatus.read || 0,
    readingCount: byStatus.reading || 0,
    wantCount: byStatus.want || 0,
    droppedCount: byStatus.dropped || 0,
    thisYear,
    thisMonth,
    minutes,
    pages,
    avgRating: ratedCount ? (ratedSum / ratedCount).toFixed(1) : '',
    ratedCount,
    byYear,
    byMonth,
    byRating,
    topAuthors,
    finishedDays: Object.keys(finishedDays).length,
    goal: g,
    goalPercent: g ? Math.min(100, Math.round((thisYear / g) * 100)) : 0,
    year,
  }
}

// ── 导入：CSV（Goodreads / 微信读书导出 / 通用表）、JSON、竖线文本 ────────
const FIELD_MAP = {
  title: ['title', 'book title', '书名', '书籍名称', '名称', 'book', 'name'],
  author: ['author', '作者', '作者名', 'authors'],
  rating: ['rating', 'my rating', '评分', '我的评分', '打分', '星级'],
  status: ['bookshelves', 'exclusive shelf', 'shelf', '状态', '书架', '阅读状态', '阅读状态 ', 'status'],
  finishedAt: ['date read', 'date finished', 'finish date', '读完日期', '读完时间', '完成日期', '阅读完成时间', '结束日期', 'finishedat', 'finisheddate', 'dateread'],
  startedAt: ['date started', 'started', '开始日期', '开始阅读', 'start date', 'startedat', 'startdate'],
  pages: ['number of pages', '页数', '总页数', 'pages'],
  progress: ['progress', '进度', '阅读进度', '读到'],
  minutes: ['阅读时长(分钟)', '阅读时长分钟', '阅读时长', '阅读分钟', '时长', 'minutes', 'reading time', '阅读时间'],
  review: ['my review', 'review', '书评', '短评', '感想', '笔记', 'notes'],
  isbn: ['isbn', 'isbn13', 'isbn 13'],
  cover: ['cover', '封面', '封面链接', 'cover url'],
  tags: ['tags', '标签', '分类', 'categories'],
}
const STATUS_ALIASES = {
  read: 'read', 已读: 'read', 读完: 'read', finished: 'read', 已读完: 'read',
  reading: 'reading', 在读: 'reading', 'currently-reading': 'reading', 正在读: 'reading', 阅读中: 'reading',
  want: 'want', 想读: 'want', 'to-read': 'want', 'want to read': 'want', 未读: 'want', 待读: 'want',
  dropped: 'dropped', 弃读: 'dropped', 放弃: 'dropped', dnf: 'dropped',
}
function normKey(s) {
  return String(s == null ? '' : s).replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_\-()（）]/g, '')
}
function fieldOf(header) {
  const h = normKey(header)
  const keys = Object.keys(FIELD_MAP)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (FIELD_MAP[k].some((alias) => normKey(alias) === h)) return k
  }
  return ''
}
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ }
      else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim()); cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}
function statusOf(raw, hasFinish, hasRating) {
  const v = normKey(raw)
  if (STATUS_ALIASES[v]) return STATUS_ALIASES[v]
  if (/^read$|^已读/.test(String(raw || '').trim())) return 'read'
  if (/读|reading/.test(String(raw || '').trim()) && !/未|想/.test(String(raw || '').trim())) return 'reading'
  if (hasFinish || hasRating) return 'read'
  return 'want'
}
function fromFields(obj) {
  const ratingRaw = clean(obj.rating, 10)
  const rating = clamp(Math.round(num(ratingRaw.replace(/[^\d.]/g, ''), 0)), 0, 5)
  const finishedAt = normalizeDate(obj.finishedAt)
  const startedAt = normalizeDate(obj.startedAt)
  const rawStatus = clean(obj.status, 40)
  const status = statusOf(rawStatus, !!finishedAt, rating > 0)
  const tags = clean(obj.tags, 200).split(/[,，;；|]/).map((s) => s.trim()).filter(Boolean).slice(0, 8)
  return {
    title: clean(obj.title, 80),
    author: clean(obj.author, 60),
    cover: clean(obj.cover, 500),
    isbn: clean(obj.isbn, 40),
    status,
    rating,
    finishedAt,
    startedAt,
    pages: Math.max(0, Math.round(num(obj.pages, 0))),
    minutes: Math.max(0, Math.round(num(obj.minutes, 0))),
    progress: clamp(Math.round(num(obj.progress, 0)), 0, 100),
    review: clean(obj.review, 1000),
    tags,
    source: 'import',
  }
}

/** 返回可预览的候选书籍数组，不写存储；由 importBooks 决定是否合并 */
function parseImport(text) {
  const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim()
  if (!raw) return []
  // 1) JSON
  if (raw[0] === '[' || raw[0] === '{') {
    try {
      const j = JSON.parse(raw)
      const arr = Array.isArray(j) ? j : (j.books || j.data || j.items || [])
      if (Array.isArray(arr)) {
        return arr.map((x) => {
          if (typeof x === 'string') return fromFields({ title: x })
          const row = {}
          Object.keys(x).forEach((k) => {
            const f = fieldOf(k)
            if (f) row[f] = x[k]
            else if (normKey(k) === normKey('title')) row.title = x[k]
          })
          if (!row.title) row.title = clean(x.title || x.name || x.book, 80)
          return fromFields(row)
        }).filter((b) => b.title)
      }
    } catch (e) { /* 落到文本解析 */ }
  }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.charAt(0) !== '#')
  if (!lines.length) return []
  // 2) CSV 带表头
  const head = splitCsvLine(lines[0])
  const mapped = head.map(fieldOf)
  if (mapped.filter(Boolean).length >= 2 && mapped.indexOf('title') >= 0) {
    return lines.slice(1).map((line) => {
      const cells = splitCsvLine(line)
      const row = {}
      mapped.forEach((f, i) => { if (f) row[f] = cells[i] == null ? '' : cells[i] })
      return fromFields(row)
    }).filter((b) => b.title)
  }
  // 3) 竖线 / 制表符文本：书名 | 作者 | 评分 | 读完日期 | 短评
  const firstCells = lines[0].split(/\||\t/).map((s) => s.trim())
  const hasPipeHeader = firstCells.length >= 2 && fieldOf(firstCells[0]) === 'title'
  return lines.slice(hasPipeHeader ? 1 : 0).map((line) => {
    const cells = line.split(/\||\t/).map((s) => s.trim())
    return fromFields({
      title: cells[0] || '',
      author: cells[1] || '',
      rating: cells[2] || '',
      finishedAt: cells[3] || '',
      review: cells[4] || '',
    })
  }).filter((b) => b.title)
}

function bookKey(b) {
  return (clean(b.title, 80) + '|' + clean(b.author, 60)).toLowerCase()
}
/** 合并导入，按 书名|作者 去重；返回 { added, skipped, list } */
function importBooks(text) {
  const candidates = parseImport(text).filter((b) => b.title)
  const list = loadBooks()
  const seen = {}
  list.forEach((b) => { seen[bookKey(b)] = true })
  let added = 0
  let skipped = 0
  candidates.slice(0, MAX_BOOKS).forEach((c) => {
    const key = bookKey(c)
    if (seen[key]) { skipped += 1; return }
    seen[key] = true
    list.push(normalize(Object.assign({}, c, { id: makeId(), createdAt: isoNow(), updatedAt: isoNow() })))
    added += 1
  })
  saveBooks(list)
  return { added, skipped, list: loadBooks() }
}

// ── 导出：开放格式，可迁移 ──────────────────────────────────────────────
function csvCell(v) {
  const s = String(v == null ? '' : v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function exportCsv(books) {
  const head = ['书名', '作者', '状态', '评分', '开始日期', '读完日期', '页数', '阅读时长(分钟)', '短评', '标签', 'ISBN', '封面链接']
  const rows = (books || []).map((b) => [
    b.title, b.author, (STATUSES.find((s) => s.key === b.status) || {}).label || b.status,
    b.rating || '', b.startedAt, b.finishedAt, b.pages || '', b.minutes || '',
    b.review, (b.tags || []).join('|'), b.isbn, b.cover,
  ].map(csvCell).join(','))
  return [head.join(','), ...rows].join('\n')
}
function exportJson(books) {
  return JSON.stringify({
    schema: SCHEMA,
    exportedAt: isoNow(),
    note: '开放格式：可直接导入本 App，也可自行迁移到 Jelu / LibrisLog / BookWyrm 等阅读记录工具。',
    books: books || [],
  }, null, 2)
}
function booksFinishedIn(books, year) {
  const y = String(year)
  return (books || []).filter((b) => b.status === 'read' && String(b.finishedAt || '').slice(0, 4) === y)
}

module.exports = {
  KEY, GOAL_KEY, SCHEMA, MAX_BOOKS, STATUSES,
  today, loadBooks, saveBooks, bookById, addBook, updateBook, removeBook,
  markRead, bumpProgress, getGoal, setGoal, statsOf,
  parseImport, importBooks, exportCsv, exportJson, booksFinishedIn,
  normalize,
}
