/**
 * 曲目元数据 → 云端数仓（music_library）同步
 *
 * 背景：cloud-music 只把音频文件传到私有目录 users/<uid>/life-music/，
 * 元数据只存在微信本地 storage，管理后台读的是 music_library 表，两者互不相通。
 * 本模块在上云成功后补写一条数仓记录（幂等：按 cloud_path 去重），
 * 同步失败不影响播放——文件已在云端，条目可随时由 syncAll 补齐。
 */

const { cloud } = require('./cloud')

const TABLE = 'music_library'
const CATEGORY = '小程序上传'

function from() {
  return cloud.database.from(TABLE)
}

function titleOf(track) {
  return String(track && track.name ? track.name : '未命名曲目').slice(0, 60)
}

function rowOf(track) {
  return {
    title: titleOf(track),
    artist: '',
    category: CATEGORY,
    cloud_path: String(track.cloudPath || ''),
    size_bytes: Number(track.size) || 0,
    enabled: true,
    tags: 'miniapp',
  }
}

/**
 * 单条同步。按 cloud_path 查重：已有则更新标题，没有则插入。
 * 返回 { ok, id?, error? }。
 */
async function syncTrack(track) {
  if (!track || !track.cloudPath) return { ok: false, error: '该曲目尚未上云，无可同步' }
  try {
    const found = await from().select('id,title').eq('cloud_path', track.cloudPath)
    if (found.error) return { ok: false, error: (found.error.message) || '查询数仓失败' }
    const rows = Array.isArray(found.data) ? found.data : []
    if (rows.length > 0) {
      const patched = await from().update({ title: titleOf(track) }).eq('id', rows[0].id)
      return patched.error
        ? { ok: false, error: patched.error.message || '更新数仓失败' }
        : { ok: true, id: rows[0].id }
    }
    const ins = await from().insert(rowOf(track)).select('id')
    if (ins.error) return { ok: false, error: ins.error.message || '写入数仓失败' }
    const id = Array.isArray(ins.data) && ins.data[0] ? ins.data[0].id : null
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e && e.message) || '数仓同步异常' }
  }
}

/**
 * 批量补同步：把所有已上云的曲目同步进数仓（幂等，每条按 cloud_path 去重）。
 * 一次会话只需要成功跑一遍，调用方自行加标记。
 */
async function syncAll(tracks) {
  const list = (tracks || []).filter((t) => t && t.cloudPath)
  const results = []
  for (const t of list) {
    // 串行执行，避免并发触发网关限流
    results.push(await syncTrack(t))
  }
  const failed = results.filter((r) => !r.ok)
  return {
    total: list.length,
    synced: results.length - failed.length,
    errors: failed.map((r) => r.error),
  }
}

module.exports = { syncTrack, syncAll, CATEGORY }
