// 随机漫步日历：每次点击随机抽一条，避免连续重复
const QUOTES = require('./random-walk-data')

let lastIndex = -1

function count() {
  return QUOTES.length
}

function pick() {
  if (!QUOTES.length) return null
  let i = Math.floor(Math.random() * QUOTES.length)
  if (QUOTES.length > 1 && i === lastIndex) i = (i + 1) % QUOTES.length
  lastIndex = i
  const q = QUOTES[i]
  if (typeof q === 'string') return { text: q, source: '' }
  return { text: q.text || '', source: q.source || '' }
}

module.exports = { count, pick }
