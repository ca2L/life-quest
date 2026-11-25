// 随机漫步日历：每次点击随机抽一条，避免连续重复
// 同时提供「今日一句」：按日期种子取固定一条（flomo 式每日回顾），
// 同一天看到的都是同一条，跨天自动换；不影响原来的 pick 随机接口。
const QUOTES = require('./random-walk-data')

let lastIndex = -1

function count() {
  return QUOTES.length
}

function normalize(q) {
  if (!q) return null
  if (typeof q === 'string') return { text: q, source: '' }
  return { text: q.text || '', source: q.source || '' }
}

function pick() {
  if (!QUOTES.length) return null
  let i = Math.floor(Math.random() * QUOTES.length)
  if (QUOTES.length > 1 && i === lastIndex) i = (i + 1) % QUOTES.length
  lastIndex = i
  return normalize(QUOTES[i])
}

// 按日期字符串取当天固定的一条，稳定哈希，同一天任何时刻结果一致
function daily(dateStr) {
  if (!QUOTES.length) return null
  const key = dateStr || new Date().toISOString().slice(0, 10)
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 1000003
  }
  return normalize(QUOTES[hash % QUOTES.length])
}

module.exports = { count, pick, daily }
