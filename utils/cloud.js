// 全局唯一的云服务客户端，使用应用 publicConfig 初始化。
// endpoint / publishableKey / workBuddyOAuthClientId 均来自云服务配置，勿手写或外泄其它密钥。
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_awGl15NmcYBQWRf2v7t2gC_PIGqt2JhQnNRpU6lAb8Z3KCVzlg84Kwz',
  workBuddyOAuthClientId: 'cb_jq6QyEPkOkJXPcpz0JxS_wbapp_awGl15NmcYBQWRf2v7t2gC',
  wx: createDiagnosticWx(wx),
})

module.exports = { cloud }
