# CVI 机型 `$falcon.jsapi.http` 实测记录

> 设备：有道词典笔 CVI 机型（`平台=Linux`，`系统版本=1.6.3`，`API 版本=1`，`设备型号=IoT Miniapp`，
> `机型族(主题)=theme-y02-1`，逻辑/物理屏 `936×280`）
> 日期：2026-11-13
> 方法：应用内「功能检测」页诊断 + 回归安装验证，无 adb 权限可用。

本文记录 CVI 固件对外暴露的网络能力与调用形态，作为 `ui/src/services/platform/net-cvi.js`
的实现依据。开发手册参考
[POSC-MiniApp-开发文档](../_公共开发环境/_ref/docs2/6a68678ed058702606960911_POSC-MiniApp-开发文档.md)
与工作区逆向笔记（`docs/06-ocr-and-services.md`、`native-modules-api.md`）。

## 1. 固件暴露了什么

`$falcon.jsapi` 在真机上可枚举出两个模块：

```
http    (object)  eventMap_ uniqueId name downloadAndUnzip downloadFile downloadFileNoCache request
storage (object)  eventMap_ uniqueId name clearGlobalStorage clearStorage getStorageInfo
                  getGlobalStorageInfo getStorage setStorage getGlobalStorage removeStorage
                  removeGlobalStorage setGlobalStorage
```

`$falcon` 自身键：`eventMap_ _uniqueId util _pageMap _modules _serviceMap App Page _NAVIGATOR _JSAPI jsapi env navTo closeApp`。
`$jsapi`、`httpModule`、`http`、`net`、`request`、`fetch` 等全局均**不存在**。

## 2. 运行时没有 require

```text
全局 require('httpbridge')=null err=require is not defined
全局 require('http')=null       err=require is not defined
全局 require('net')=null        err=require is not defined
```

- 手册「10.1 http」给的动态 `require('http')` 兜底在该固件**不可用**；
- 工作区逆向笔记里的 `httpbridge`（`new HttpBridge().httpBridge(...)`）属于另一代固件
  （Y02-1 / 4.34.0），本机 `_modules.httpbridge` 不存在；
- 只能走 `$falcon.jsapi.http`。

## 3. `http.request` 唯一可用形态

```js
const http = $falcon.jsapi.http
const r = await http.request({
  url: 'http://www.baidu.com',
  method: 'GET',
  timeout: 3,
  headers: ['User-Agent: ...'],   // 字符串数组, 不能是对象
})
```

实测其它形态的失败方式：

| 形态 | 结果 |
| --- | --- |
| `request({ url, method, timeout })` | ✅ 可用 |
| `request({ url, method, timeout, headers: [] })` | ✅ 可用 |
| `request({ url, method, timeout, headers: {…} })` | 返回 `{"error":3,"result":{"errorMessage":"…"}}` / 挂起 |
| `request(url)` | `{"error":3,"result":{"errorMessage":"url is empty"}}` |
| `request(url, {…})` | Promise 挂起（客户端超时） |

## 4. 返回值形态（关键）

成功（有响应体）：

```json
{ "result": "<!DOCTYPE html>…" }
```

- `result` 是**已按 UTF-8 解码的响应体字符串**（百度首页 713922 字符；本地 mock JSON 74 字符）；
- **没有** `statusCode` / `headers` 字段。

204 空响应：

```json
{ "error": 3, "result": { "errorMessage": "curl curl_easy_getinfo failed, res: 0, resCode:204" } }
```

- 请求其实成功，`error:3` 是空响应体上取信息失败；
- **`resCode:204` 是"网络直连"的硬证据**。

失败（无 resCode）：

```json
{ "error": 3, "result": { "errorMessage": "connect failed" } }
```

`downloadFile` 参数名是 `savePath`（传 `filePath` 会报 `savePath is empty!`），
本应用无文件 JS 模块，未使用它。

## 5. 适配层如何翻译（`net-cvi.js`）

| 固件返回 | net-core 形态 |
| --- | --- |
| `{ result: '<body>' }` | `{ statusCode: 200, body }` |
| `{ error: 3, errorMessage 含 resCode:N }` | `{ statusCode: N, body: 空 }`（204 = 放行） |
| 其它 `error` | 抛错 → `{ ok:false, error }` → 探测失败 |

这样 `detect.js` 现有判定（204 空包体 = free 证据 / 200+body = 门户页 / 3xx = 跳转）
**不需要为 CVI 开特例**；门户页的服务器地址由 `extractRedirect()` 新增的
`portalProxyIP`/`portalProxyPort` 解析兜底（H3C iMC 页面把认证服务器写在脚本变量里，
CVI 又拿不到 Location 头，只能从页面里取）。

## 6. 仍待真机复核

1. **POST body**：固件文档未定义 `request` 的 POST 字段；`net-cvi.js` 同时传 `body`/`data`，
   并保留 H3C 登录的 query 双写兜底。真实校园网（H3C iMC）上需复核 POST 是否被接受；
2. **真实门户页**：本次验证覆盖 204/200/空包体/失败四类响应（本地 Node 单测 + 真机
   「功能检测」），真实校园门户的重定向页解析（`portalProxyIP`）建议在目标网络复测；
3. **storage 持久化**：`$falcon.jsapi.storage` 方法存在，原生 Promise 可能挂起
   （与逆向笔记一致）；`store-core.js` 已加 1.5s 超时与多形态兜底，账号持久化按
   "可用则存、不可用则内存"处理，失败不影响登录主流程。

## 7. 复现方法

应用内「关于 → 功能检测」：

- `原生扩展 panet=无`（CVI 正常）；
- `固件注册的 API` 应列出 `http.*` 与 `storage.*`；
- 自检 `网络` 行可用两次真实请求（`generate_204` + 百度）确认通道；
- 本地 Node 回归见仓库 `test/run-cvi.mjs`（`test/` 不入库，仅在开发机运行）。
