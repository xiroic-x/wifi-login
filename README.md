<div align="center">

# 📶 WiFi 网络认证（有道词典笔）

**给有道词典笔用的 WiFi 登录器** —— 替代打不开、体验差的认证网页，
在 960×266 横条屏上完成 **检测 → 登录 → 在线设备管理**。

[![Build](https://github.com/xiroic-x/wifi-login/actions/workflows/build.yml/badge.svg)](https://github.com/xiroic-x/wifi-login/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/xiroic-x/wifi-login?sort=semver)](https://github.com/xiroic-x/wifi-login/releases)
[![License](https://img.shields.io/badge/license-MIT%20%2B%20GPLv3-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-RK3562%20%7C%20CVITEK-informational)](#-设备兼容性与平台)

[功能](#-功能) · [快速开始](#-快速开始) · [连通性判定](#-连通性判定为什么会显示无需登入) ·
[常见问题](#-常见问题) · [适配器开发](ADAPTER.md) · [文档导航](#-文档导航)

</div>

---

## 📷 界面

960×266 横条屏、纯黑主题（X6PRO 真机实拍）：

| 主页面 | 日志页 |
| --- | --- |
| ![主页面](screenshots/home.png) | ![日志页](screenshots/log.png) |

| 关于页 | 关于页（作者 / 开源） |
| --- | --- |
| ![关于页](screenshots/about.png) | ![关于页-作者](screenshots/about-author.png) |

## ✨ 功能

- **认证框架 + 模块化适配器**：本体不含任何具体认证协议，协议收在
  `ui/src/services/portal-adapters/` 下的适配器模块（必选 `match` /
  `loadConf` / `login`，可选 `queryStat` / `logout` /
  `sync` / `listDevices` / `offOne` / `offAll` / `keepAlive`）；
  适配器提供 `listDevices` 才显示「设备管理」入口，声明 `keepAlive` 才在「已认证」后继续心跳。
  内置 **Panabit**（默认实现与模板）与 **H3C iMC Portal** 两个适配器。
- **认证页类型自动识别**：按跳转 URL 参数 / 页面标题 / 内容 / 响应头打分取最高分；
  认不出则回退该 WiFi 上次成功的适配器，再不行让用户手选认证类型、手填服务器地址。
- **连通性检测**：小米 / vivo / 华为三个 `generate_204` 端点并发，
  **204 只当证据**，还必须用非探测源站点复核通过才判「无需登入」（见下方专节）。
- **账号密码登录（Panabit）**：`webauth/user_login`，密码 AES-128-ECB/ZeroPadding
  （密钥 `Panabit@1024_key`，与网页端 `pa_aes_encode` 一致）。
- **账号密码登录（H3C iMC 门户）**：适配形如
  `http://<门户>:8080/portal/?userip=…&userurl=…` 的校园/企业网页认证；
  登录 `pws?t=li`（密码 `base64` 后再 URL 编码），响应 `base64→percent→JSON`，
  `630xx` 业务码本地映射中文；登录成功后按 `heartBeatCyc` 发送 `doHeartBeat.jsp` 保活
  （`keepAlive`；仅在应用主页前台运行期间发送，切后台会暂停、回前台自动恢复），
  避免网页关闭后被踢下线；支持 `pws?t=lo` 下线。
  iMC 门户页没有在线设备列表接口，故不提供设备管理入口。
  协议取证与真机排障见 [docs/h3c-imc-portal.md](docs/h3c-imc-portal.md)。
- **在线设备管理（Panabit）**：设备列表（设备名 / IP / MAC / 在线时长，自动标记「本机」）、
  单台下线（`user_offone`，`addr` 是目标设备在线 IP）、全部下线；15 秒自动刷新。
- **记住密码按 WiFi 隔离**：`$dataDir/wifi_account.json` 结构
  `{ version:2, accounts:{ "<ssid>": {...} } }`，密码 AES 密文落盘、界面只显示圆点掩码，
  换网络不会串用上一个网络的账号。
- **会话保活与自愈**：登录前刷新门户会话、30 秒状态心跳、
  会话过期类失败自动刷新重试一次（密码错 / 锁定 / 需改密等业务错误不重试）、
  切后台超 90 秒回前台自动重检、从管理页返回立即重检。
- **前后台切换不冲突**：每次重检 `abort` 上一次在途探测；系统输入法面板引起的
  onHide/onShow 被识别抑制；定时器随页面统一释放。

## 🚀 快速开始

从 [Releases](https://github.com/xiroic-x/wifi-login/releases) 下载**对应平台**的 AMR
（`-rk` = RK3562 机型，`-cvi` = CVITEK 机型），推到笔上安装：

```sh
adb push 8001865309000001.<版本>-rk.amr /data/local/tmp/
adb shell "miniapp_cli install /data/local/tmp/8001865309000001.<版本>-rk.amr"
adb shell "miniapp_cli start 8001865309000001"      # 不带 --page 才进主页
```

装好后联网即可：检测到需要认证会自动出现登录表单，填账密点「登 录」。
运行日志 `$dataDir/wifi.log`（实测 `$dataDir` =
`/userdisk/miniapp/data/mini_app/pkg/8001865309000001/data`），
机器可读状态同目录下 `status.json`。

> **1.2.0 起 RK 包内含新版 `libjsapi_panet.so`**（支持 POST 表单与自定义请求头）。
> 覆盖安装同一 appid 不会重新解包 `libs/*.so`；要让包内原生插件生效，先
> `miniapp_cli uninstall 8001865309000001` 再 install。
> 卸载会清空应用数据（含记住的账号），卸载前可先备份 `$dataDir`。

## 🔍 连通性判定：为什么会显示「无需登入」

「无需登入」是一个**结论**，不是猜测。判定分两阶段：

1. **并发探测**：三个国内连网检测端点同时请求。`204 + 空包体` 只算 **free 证据**；
   出现任何门户证据（`3xx + Location`、被改写的响应体、非 204 空包体、无有效状态码）
   立刻判 **需要认证** —— 门户证据优先，不受「谁先返回」影响。
2. **非探测源复核**：拿到 204 证据后，再用**不是探测源**的普通站点（百度 / 腾讯）复核：
   任一复核成功才报「无需登入」，并把复核站点记进结果（`confirm`）与日志
   （`confirm=` / `freeCount=`）；复核被拦截判需要认证；复核不通则如实报
   「无网络连接」并给出原因。

> **为什么要复核**：部分网关会对连网检测端点免认证放行（探测源能通、通用网络不通）。
> 只看 204 就会误报「无需登入」，而且界面还会把登录表单藏起来 —— 这正是 v1.1.3 修掉的问题。

## 📘 外部调用（给其它小程序）

```js
// 检测：结果经事件回传，默认事件名 wifiCheckResult，可用 callback 指定
$falcon.navTo('falcon://8001865309000001/index', { action: 'check' })

// 登录：预填凭据 + 自动提交
$falcon.navTo('falcon://8001865309000001/index', {
  action: 'login', server: '10.0.0.10:8080',
  username: 'xxx', password: 'xxx', remember: '1', auto: '1',
})

// 日志页
$falcon.navTo('falcon://8001865309000001/index', { action: 'log' })
```

完整参数、回调 JSON 与 `status.json` 字段见 [docs/external-api.md](docs/external-api.md)。

## 📱 设备兼容性与平台

两个硬件平台的**页面 / UI / 适配器代码完全一致**，差异全部收在
`ui/src/services/platform/` 平台实现层；CI 分别构建并区分命名。

| 平台 | 机型 | 状态 | 产物 |
| --- | --- | --- | --- |
| **RK3562**（ARM / aarch64） | 有道词典笔 X6PRO | ✅ 已实测 | `<appid>.<版本>-rk.amr` |
| **CVITEK**（RISC-V C906） | 搭载 CVI 芯片的机型 | ✅ 已实测（CVI 词典笔 / 固件 1.6.3） | `<appid>.<版本>-cvi.amr` |

| 能力 | RK 版 | CVI 版 |
| --- | --- | --- |
| 网络请求 | 自研 `panet` 原生库（随包打进 `.so`，支持 POST 表单与自定义头） | 固件原生 `$falcon.jsapi.http.request({url,method,timeout,headers:['K: v']})`（实测；只回响应体，状态码按 `resCode` 合成） |
| 账号存储 | 文件 `$dataDir/wifi_account.json` | 固件 `$falcon.jsapi.storage`（KV；原生调用带超时与多形态兜底） |
| 运行日志 | 落盘 `$dataDir/wifi.log` | 内存缓冲（应用内可看，重启清空） |
| 状态写盘 | `$dataDir/status.json` | 无文件模块，跳过 |
| WiFi 名称（按网隔离） | 原生 `panet.wifiSsid()` | `$falcon.env.custom.wifiSsid`（实测可读，实测 `360WiFi-wangwei`） |

CVI 版真机实测结论（固件 1.6.3 / api=1，详见 [docs/cvi-jsapi-http.md](docs/cvi-jsapi-http.md)）：

- 运行时**没有 `require`**（`require is not defined`），也没有 `httpbridge`/全局 `fetch`，手册里的
  “动态 require 兜底”在该固件不可用；网络只能走 `$falcon.jsapi.http`；
- `http.request` 成功返回 `{ result: '<响应体字符串>' }`，**不返回状态码/响应头**；
  204 空响应返回 `{ error: 3, result: { errorMessage: '…resCode:204' } }` —— 本版从中解析
  `resCode` 合成状态码，`detect.js` 的门户判定逻辑无需为 CVI 特殊化；
- `http.request` 的 POST body 字段固件文档未定义，本版同时传 `body`/`data`，并在
  H3C 登录时继续保留 query 双写兜底；**CVI 上的 POST 表单仍建议在真实校园网复核一次**。


## 🛠 开发与测试

- **构建走 CI**：推送 `main` 或打 `v*` 标签触发
  [build.yml](.github/workflows/build.yml) —— 交叉编译 `native/panet`（aarch64）→
  `pnpm -C ui package` → 产出 `-rk` / `-cvi` 两个平台的 AMR。
  本地通常没有 aarch64 工具链，包里的 `libs/libjsapi_panet.so` 由 CI 生成。
- **本地构建注意 Node 版本**：`aiot-vue-cli` 依赖的旧版 webpack 插件在 Node ≥ 22 上会报
  `No such module: http_parser`，请用 **Node 16/18**（CI 用 18）执行 `pnpm -C ui build`。
- **本地测试**（`test/` 不入库）：

```sh
node test/run-all.mjs      # 每个 .test.mjs 各自独立进程并行跑, 汇总结果与耗时
node test/run-h3c.mjs      # H3C iMC 适配器: 本地 mock 门户服务器 + 断言 (无需真机/真网)
```

  `run-h3c.mjs` 会起一个本地 mock iMC 门户服务器，复刻页面/登录响应/心跳/下线，
  校验识别评分、登录参数与 base64+URL 编码、Cookie 会话、63032 文案、已在线归一化、
  心跳字段与诊断日志；适配器源码原样加载（只剥 import/export），不污染仓库。
  另有一套历史用例覆盖检测 / 存储 / AES / 网关模拟（`test/sim-gateway.test.mjs`）。

```
native/panet/       自研 panet 原生库 (request(url,method,timeout,body,headers) / 文件 / wifiSsid)
ui/src/pages/       index / management / log / about
ui/src/services/    detect 检测 · net 适配层 · store 存储 · portal-adapters 适配器 · platform 平台层
profiles/           设备画像 (X6PRO 真机实测结论)
docs/               外部接口 / Panabit 与 H3C iMC 协议 / 工程说明
```

## ❓ 常见问题

<details>
<summary><b>显示「无需登入」，但实际还是上不了网？</b></summary>

v1.1.3 起「无需登入」必须先通过非探测源复核（见
[连通性判定](#-连通性判定为什么会显示无需登入)），复核不通会如实报「无网络连接」并附原因。
若仍有异常：先点顶栏「重新检测」；仍不行请附 `$dataDir/wifi.log` 与
`status.json` 提 Issue —— 日志里 `status=free` 会带 `confirm=` 与
`freeCount=`，能直接看出复核依据。

</details>

<details>
<summary><b>登录失败返回的 `code` 是什么意思？</b></summary>

Panabit：`0` 成功、`200` 该设备免认证已通过、`255` 账号或密码错误、
`3` 锁定（消息里带剩余秒数）、`2` 需在网页认证页改密。
其它 `code` 会原样显示（例如 `服务器返回 code=1`），便于对照网关侧策略排查。

H3C iMC 门户：`1` 成功、`200` 已在线（无需重复登录）；失败会显示本地映射的中文，
例如 `63018` 账号不存在、`63032` 账号或密码错误、`63025` MAC 绑定失败、
`63026` 静态 IP 绑定失败、`63027` 不在允许上网时段、`63100` 无效客户端版本。
完整 630xx 码表见 [docs/h3c-imc-portal.md](docs/h3c-imc-portal.md)。

</details>

<details>
<summary><b>H3C iMC 门户登录失败怎么排查？</b></summary>

1. 先看日志 `$dataDir/wifi.log` 中的 `[H3C]` 行：`取门户页 status=… proxy=…`、
   `登录 POST pws?t=li …`、`登录返回 … errorNumber=… code=…`——可区分「网络不通」、
   「服务器拒绝（账密/策略）」与「响应格式不符」。
2. 确认装的是 **1.2.0 及以后** 的 RK 包，且**卸载后重装**过（旧 `.so` 只发 query 串，
   登录表单参数与 Referer/Cookie 头发不出去，可能被服务器拒绝；但参数已在 query，
   部分 iMC 版本仍能通过——待真网确认）。
3. 若 `取门户页` 都失败：检查服务器地址是否正确、是否需要手填 `IP[:端口]`；
   门户为 **HTTPS** 的部署当前原生层不支持（目标网络是 `http://…:8080` 可用）。
4. 若返回 `630xx`：按上面的码表处理；出现验证码/短信/动态口令属于纯 API 无法复现的情形。

</details>

<details>
<summary><b>认不出认证类型 / 不知道服务器地址？</b></summary>

界面会显示「认证类型」选择行：先手选适配器；仍不行会出现服务器输入行，
手填 `IP[:端口]` 后点「确 定」即可继续登录。

</details>

<details>
<summary><b>为什么截图是坏的 / 页面没起来？</b></summary>

部分固件的 `miniapp_cli capture` 产出无效图（真机实测恒为 1130 字节），
排查请以日志与 `status.json` 为准。屏幕休眠时 `miniapp_cli start` 只写
`onLaunch`、不执行页面启动，唤醒屏幕后再启动才能看到「页面启动」。

</details>

## 📚 文档导航

| 文档 | 内容 |
| --- | --- |
| [ADAPTER.md](ADAPTER.md) | 适配器模块开发指南：接口契约 + 从登录页提取协议 + 全流程 |
| [SKILL.md](SKILL.md) | 配套 skill：从网站分析到做出适配器的流程要求 |
| [docs/external-api.md](docs/external-api.md) | 外部小程序调用、设备管理页拉起、`status.json`、日志 |
| [docs/panabit-api.md](docs/panabit-api.md) | Panabit Portal API（端点 / 参数 / 返回码 / 密码加密） |
| [docs/h3c-imc-portal.md](docs/h3c-imc-portal.md) | H3C iMC Portal 认证取证（端点 / 参数 / 返回码 / 心跳 / 真机实验） |
| [docs/project.md](docs/project.md) | 工程结构、构建（CI 与本地）、版本与产物命名 |
| [CHANGELOG.md](CHANGELOG.md) | 更新日志（CI 发版时按版本抽取为 Release Notes） |

## 🤝 反馈与贡献

- **提 Issue**：[Bug 反馈 / 添加认证适配器 模板](https://github.com/xiroic-x/wifi-login/issues/new/choose)
  —— Bug 请附机型 / 版本 / 复现步骤 / 日志 `$dataDir/wifi.log` / 截图；
  适配新认证系统请按 [ADAPTER.md](ADAPTER.md) 提取登录页与管理页源码后提交。
- **Pull Request** 合并前提：
  1. **不得影响 X6PRO 上已验证的现有功能** —— 这是唯一的基准机型；
  2. 机型差异用能力探测做分支（`panet` 方法是否存在、屏幕尺寸、jsapi 可用性），
     不要直接改通用逻辑；
  3. 涉及屏幕尺寸的改动必须同时适配 960×266。

## ⚖️ 开源许可

**分层许可**（完整条款见 [LICENSE](LICENSE)）：

| 范围 | 许可 |
| --- | --- |
| `ui/src/services/portal-adapters/`（认证适配器模块） | **MIT** |
| `ui/src/services/platform/`（平台实现层） | **MIT** |
| 其余全部代码（默认） | **GNU GPLv3** |

- **MIT 目录**是面向第三方开发者的扩展点：适配新认证系统、移植新硬件平台可自由复用
  （含商用），只需保留版权声明 —— 见 [ADAPTER.md](ADAPTER.md) 与 [docs/project.md](docs/project.md)；
- **GPLv3** 覆盖框架本体（页面 / 检测 / 存储 / UI / 构建），二次开发须以相同许可开源；
- 第三方依赖与资源各有其自带许可，使用时请一并遵守；提交 Issue / PR 即表示同意所贡献内容
  以上述对应许可发布。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
