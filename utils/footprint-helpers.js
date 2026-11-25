// 足迹辅助：微信定位（GCJ-02，腾讯地图底座）+ 云存储图片上传。
// 所有 wx 能力都做特性检测，H5 预览等无定位/文件 API 的环境自动降级，不崩溃。
const { cloud } = require('./cloud')

function hasWx() {
  return typeof wx !== 'undefined'
}

// 地图选点：wx.chooseLocation 用腾讯地图，返回 GCJ-02 坐标。
function chooseLocation() {
  return new Promise((resolve) => {
    if (!hasWx() || typeof wx.chooseLocation !== 'function') {
      resolve({ error: { message: '当前环境不支持地图选点，请手动填写地点' } })
      return
    }
    wx.chooseLocation({
      success(res) {
        resolve({
          data: {
            locationName: res.name || res.address || '',
            address: res.address || '',
            latitude: res.latitude || null,
            longitude: res.longitude || null,
          },
          error: null,
        })
      },
      fail(err) {
        // 用户主动取消不算错误
        if (err && /cancel/i.test(err.errMsg || '')) {
          resolve({ data: null, error: null, cancelled: true })
        } else {
          resolve({ error: { message: (err && err.errMsg) || '地图选点失败' } })
        }
      },
    })
  })
}

// 当前位置：wx.getLocation 返回 GCJ-02 坐标，需先授权 scope.userLocation。
function getMyLocation() {
  return new Promise((resolve) => {
    if (!hasWx() || typeof wx.getLocation !== 'function') {
      resolve({ error: { message: '当前环境不支持定位，请手动填写地点' } })
      return
    }
    wx.getLocation({
      type: 'gcj02',
      success(res) {
        resolve({
          data: { latitude: res.latitude || null, longitude: res.longitude || null },
          error: null,
        })
      },
      fail(err) {
        resolve({ error: { message: (err && err.errMsg) || '定位失败，请检查定位授权' } })
      },
    })
  })
}

// 反向地理编码：由经纬度取地点名称，用微信 chooseLocation 无法反查，
// 这里只在用户主动选点后使用其返回的 name；纯坐标场景回退为坐标文本。
function describeCoordinates(latitude, longitude) {
  if (latitude == null || longitude == null) return ''
  return `${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}`
}

function chooseImages(count) {
  return new Promise((resolve) => {
    if (!hasWx() || typeof wx.chooseMedia !== 'function') {
      resolve({ error: { message: '当前环境不支持选择图片' } })
      return
    }
    wx.chooseMedia({
      count: count || 6,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success(res) {
        resolve({ data: (res.tempFiles || []).map((f) => f.tempFilePath), error: null })
      },
      fail(err) {
        if (err && /cancel/i.test(err.errMsg || '')) resolve({ data: [], error: null, cancelled: true })
        else resolve({ error: { message: (err && err.errMsg) || '选择图片失败' } })
      },
    })
  })
}

// 把本地临时图片上传到云存储，返回可访问的临时 URL 数组。
// 路径按用户隔离：footprints/<uid>/<时间戳>-<序号>.<ext>，配合 RLS 只本人可读写。
async function uploadImages(filePaths) {
  if (!filePaths || !filePaths.length) return { data: [], error: null }
  if (!cloud || !cloud.storage || typeof cloud.storage.upload !== 'function') {
    return { error: { message: '当前环境不支持图片上传' } }
  }
  let uid = 'me'
  try {
    const session = cloud.auth && cloud.auth.getSession && await cloud.auth.getSession()
    const u = session && session.data && session.data.session && session.data.session.user
    if (u && u.id) uid = String(u.id).replace(/[^a-zA-Z0-9_-]/g, '_')
  } catch (e) { /* 拿不到用户就用默认路径 */ }

  const urls = []
  for (let i = 0; i < filePaths.length; i++) {
    const path = filePaths[i]
    const extMatch = /\.(jpg|jpeg|png|webp|gif)$/i.exec(path)
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
    const objectPath = `footprints/${uid}/${Date.now()}-${i}.${ext}`
    try {
      // 小程序读取本地文件为 ArrayBuffer（云存储上传 body 支持 ArrayBuffer）
      const buffer = await new Promise((resolve, reject) => {
        if (!hasWx() || !wx.getFileSystemManager) { reject(new Error('文件系统不可用')); return }
        wx.getFileSystemManager().readFile({
          filePath: path,
          success(r) { resolve(r.data) },
          fail(e) { reject(e) },
        })
      })
      const up = await cloud.storage.upload(objectPath, buffer, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true })
      if (up.error) return { error: up.error }
      const signed = await cloud.storage.createSignedUrl(objectPath, 60 * 60 * 24 * 365)
      if (signed.error) return { error: signed.error }
      urls.push(signed.data.signedUrl || signed.data.signedURL)
    } catch (e) {
      return { error: { message: (e && e.message) || '图片上传失败' } }
    }
  }
  return { data: urls, error: null }
}

// 把本地临时图片读成 base64 data URL，用于选图后立即预览（不依赖云存储）。
function readImageAsDataUrl(filePath) {
  return new Promise((resolve) => {
    if (!hasWx() || !wx.getFileSystemManager) { resolve(null); return }
    const ext = /\.(jpg|jpeg|png|webp|gif)$/i.exec(filePath)
    const mime = ext ? `image/${ext[1].toLowerCase() === 'jpg' ? 'jpeg' : ext[1].toLowerCase()}` : 'image/jpeg'
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success(r) { resolve(`data:${mime};base64,${r.data}`) },
      fail() { resolve(null) },
    })
  })
}

module.exports = {
  chooseLocation,
  getMyLocation,
  describeCoordinates,
  chooseImages,
  uploadImages,
  readImageAsDataUrl,
}
