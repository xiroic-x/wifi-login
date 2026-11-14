# 外部调用接口与日志

> 返回 [README](../README.md) · 文档索引 [docs/README.md](README.md)

本应用无图标入口，可由其他小程序按需拉起。

## 页面入口

| 页名 | 用途 |
| --- | --- |
| `index` | 主页（检测 / 登录 / 设备管理入口） |
| `management` | 设备管理（需适配器提供 `listDevices`） |
| `diag` | 功能检测（系统信息 / 能力 / 兼容性） |
| `cleanUp` | 数据清理（系统设置「空间清理」使用此页名，大小写敏感） |
| `about` | 关于（仓库 / QQ 群二维码） |

```js
// 打开登录界面：指定服务器、预填凭据、自动提交
$falcon.navTo('falcon://8001865309000001/index', {
  action: 'login',
  server: '10.0.0.10:8080',      // 或 http://10.0.0.10:8080
  username: 'xxx',
  password: 'xxx',
  remember: '1',
  auto: '1',
  adapter: 'panabit',            // 可选：强制适配器，缺省自动识别 / 用该网络记住的
})

// 检测是否需要登入：结果经事件回传
$falcon.navTo('falcon://8001865309000001/index', { action: 'check' })
$falcon.navTo('falcon://8001865309000001/index', { action: 'check', callback: 'myEventName' })
$falcon.on('wifiCheckResult', (json) => { /* ... */ })

// 直接打开功能检测页
$falcon.navTo('falcon://8001865309000001/index', { action: 'diag' })

// 无参数：正常流程（自动检测）
$falcon.navTo('falcon://8001865309000001')
```

| 参数 | 说明 |
| --- | --- |
| `action` | `login` 登录 / `check` 检测并回调 / `diag` 功能检测页 / 缺省=自动检测 |
| `callback` | `action=check` 的结果事件名，缺省 `wifiCheckResult` |
| `server` | `IP[:端口]` 或 `http://IP[:端口]`（不支持 https） |
| `username` / `password` | 预填凭据（密码明文传递，仅限可信任调用方） |
| `remember` | `'1'` 记住密码 |
| `auto` | `'1'` 且 server/username/password 齐全时自动提交 |
| `adapter` | 适配器 ID（`panabit` / `h3c-imc`），缺省自动识别 |

`action=check` 回传字段：

```json
{ "status": "free|portal|offline", "needLogin": true, "probe": "小米",
  "serverIp": "10.0.0.10", "serverPort": "8080", "serverBase": "http://10.0.0.10:8080",
  "portalPage": "…", "pageTitle": "…", "confirm": "百度", "freeCount": 3, "error": "" }
```

> 外部调用（`check` / `login`）**不会自动跳转设备管理页**，避免打断调用方流程；
> 只有正常启动（无参数）检测到已认证时才可能自动进入管理页。
> 页面已在前台时被重新拉起，参数同样生效（走 `onNewOptions`）。

## 设备管理页

```js
$falcon.navTo('falcon://8001865309000001/management', {
  serverBase: 'http://10.0.0.10:8080',
  ip: '192.168.50.11',   // 本机在线 IP，用于标记「本机」
  adapter: 'panabit',    // 必须是提供 listDevices 的适配器
})
```

## 数据与日志位置

所有业务数据都在**应用自己的数据目录**（参与系统「空间清理」）：

```
$dataDir = /userdisk/miniapp/data/mini_app/pkg/8001865309000001/data
  wifi.log              # 运行日志(超过 512KB 自动轮转)
  wifi_account.json     # 账号(RK 版; 32 位平台走固件 KV)
  status.json           # 最后一次检测结果(RK 版)
```

```sh
adb shell "cat /userdisk/miniapp/data/mini_app/pkg/8001865309000001/data/wifi.log"
```

旧版本曾写在 `/userdisk/xiro/` 下，启动时**自动迁移**到上面的数据目录（不覆盖新数据）。

## 日志标签

| 标签 | 含义 |
| --- | --- |
| `[应用]` | 启动、页面启动 |
| `[环境]` | SKU / 词典笔 OS / 内核 / 板型 / 框架版本 |
| `[网络]` | 传输通道（`panet` 或固件 JSAPI） |
| `[检测]` | 连通性判定（`status` / `probe` / `confirm` / `freeCount` / `by`） |
| `[适配器]` | 认证类型识别与选择 |
| `[登录]` | 提交凭据、网关返回码 |
| `[心跳]` / `[下线]` | 在线保活 / 被踢下线 |
| `[配置]` | 账号保存与回读校验 |
| `[兼容性]` / `[清理]` / `[迁移]` | 兼容性判定 / 清理结果 / 数据迁移 |

