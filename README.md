# WiFi 网络认证 (有道词典笔)

面向有道词典笔 (Falcon mini-app 运行时) 的 WiFi captive portal 登录应用。
从 Panabit 上网认证系统的 Portal 页面 (`登入/index.html` + `assert/portal.js|panabit.js|crypto.js`)
提取的协议, 仅实现**账号密码登录**。

## 功能

- **连通性测试 (国内探测源)**: 小米 `connect.rom.miui.com/generate_204`、vivo `wifi.vivo.com.cn/generate_204`、华为 `connectivitycheck.platform.hicloud.com/generate_204`, 辅以百度标记页双确认。
  - 网络直连正常 → 大字提示 **"无需登入"**
  - 被强制门户劫持 → 解析跳转页面 (302 Location 透传 / meta refresh / location.href / 带 `wlanuserip`、`paip` 参数的链接), 展示 **Portal 服务器 IP:端口** 与跳转页面 URL
  - 全部探测失败 → 提示无网络连接
- **账号密码登录** (Panabit `webauth/user_login`, 密码 AES-128-ECB/ZeroPadding 加密, 密钥 `Panabit@1024_key`, 与网页端 `pa_aes_encode` 一致)
- **记住密码**: storage-kv 落盘, 密文存储; 支持一键下线 (`ucenter/user_offall`)
- **会话过期自动处理**: 网页认证页靠 5 秒一次的 `query_auth_stat` 心跳维持服务器侧会话,
  页面静止几分钟后 token 过期会提示"无法登入需刷新"。本应用:
  1. 每次登录前自动重新 `load_portal_conf` 刷新会话 (等价网页端刷新页面);
  2. 认证页停留期间 30 秒心跳保活, 同时探测是否已在别处完成认证;
  3. 会话过期类失败自动刷新重试一次 (密码错误 255 / 锁定 3 / 需改密 2 不重试);
  4. 切后台超过 90 秒回前台自动重新检测。
- **系统输入法**: 账号/密码通过 `global.startTextEdit` 唤起系统级"有道输入法"面板
  (单例 Global、textEditFinished on/off 成对、UUID 校验、仅 editConfirmed 写回、页面销毁清理)。

## 工程

```
.github/workflows/build.yml   # GitHub Actions: Node 18 + pnpm + aiot-vue-cli 打包 AMR
ui/                           # 小程序源码 (aiot-vue-cli 工程)
  src/app.js                  # setViewPort(960) + BasePage 注册
  src/base-page.js            # 页面基类: token/timer 统一释放
  src/pages/index/index.vue   # 主页面 (960x266 横条屏)
  src/services/net.js         # http JSAPI 适配 (返回值归一化)
  src/services/detect.js      # 连通性测试 + portal 劫持解析
  src/services/portal.js      # Panabit Portal API 客户端
  src/services/aes.js         # AES-128-ECB/ZeroPadding 纯 JS 实现
  src/services/ime.js         # 系统输入法 (global.startTextEdit) 封装
  src/services/store.js       # storage-kv 记住密码
test/                         # 本地纯逻辑测试 (node test/*.test.mjs)
profiles/                     # 设备画像
```

## 提取的 Panabit Portal API

端点: `http://<portal服务器>[:端口]/api?<查询参数>`, 响应 JSON, `code==0` 成功, `code==200` 为 MAC 免认证已通过。

| route | action | 参数 | 说明 |
|---|---|---|---|
| portal | load_portal_conf | ip, vlan, mac, device | 加载配置/策略; 建立会话 |
| webauth | user_login | auth_type, ip, mac, username, password(AES), remember_me | 账号密码登录; code 3=锁定(带 left), 2=需改密, 255=账密错误 |
| webauth | query_auth_stat | scene_str, ip, type | 认证状态/心跳; data.stat!=0 即已认证 |
| ucenter | user_offall | ip | 下线所有 |
| ucenter | load_user_list | ip | 在线设备列表 (管理页提取, 未使用) |

## 构建与安装

GitHub Actions (wifi 分支) 云端打包, 不走本地构建:

```sh
git push origin wifi          # 触发 Build WiFi Login AMR
gh run download -n wifi-login-amr
adb push wifi-login/*.amr /userdisk/wifi-login.amr
adb shell "miniapp_cli install /userdisk/wifi-login.amr"
adb shell "miniapp_cli start 8001865309000001"
```

> 该固件 `miniapp_cli start <appid>` 不带 `--page` 才进主页。

## 外部小程序调用接口

无图标应用, 供其他小程序按需拉起。调用方:

```js
// 打开登录界面 (指定服务器, 预填账号密码, 自动提交)
$falcon.navTo('falcon://8001865309000001/index', {
  action: 'login',
  server: '192.168.64.199:8080',   // 或 http://192.168.64.199:8080
  username: '15180484996',
  password: 'xxxx',
  remember: '1',
  auto: '1',
})

// 检测网络是否需要登入 (结果 JSON 经 $falcon.trigger('wifiCheckResult') 回传:
//   $falcon.on('wifiCheckResult', json => { ... })
//   { status: 'free'|'portal'|'offline', needLogin: bool, probe, serverIp,
//     serverPort, serverBase, portalPage, pageTitle, error }
$falcon.navTo('falcon://8001865309000001/index', { action: 'check' })
$falcon.navTo('falcon://8001865309000001/index', { action: 'check', callback: 'myEventName' })

// 仅打开日志页
$falcon.navTo('falcon://8001865309000001/index', { action: 'log' })

// 无参数 = 正常流程 (自动连通性检测)
$falcon.navTo('falcon://8001865309000001')
```

| 参数 | 说明 |
|---|---|
| action | `login` 登录 / `check` 检测并回调结果 / `log` 日志页 / 缺省 = 自动连通性检测 |
| callback | `action=check` 时结果回调的事件名, 缺省 `wifiCheckResult` |
| server | `IP[:端口]` 或 `http://IP[:端口]`, 提供则跳过自动探测 (https 不支持) |
| username / password | 预填凭据 (密码明文传输, 仅限调用方可信场景) |
| remember | `'1'` 记住密码 |
| auto | `'1'` 且 server/username/password 齐全时自动提交登录 |

页面已在前台时被重新拉起, 参数同样生效 (走 `onNewOptions`)。

检测结果同时机器可读落盘 `/userdisk/xiro/status.json` (每次检测后更新):
`{"time":"09-06 14:00:00","status":"free","probe":"小米","server":"","portalPage":"","message":"网络直连正常，无需登入"}`

## 日志

应用运行日志单独存储在 `/userdisk/xiro/wifi.log` (目录不存在自动创建, 超过 512KB 自动截断轮转):

```
adb shell "cat /userdisk/xiro/wifi.log"
```

记录: 启动、连通性测试结果、Portal 配置解析、登录请求结果、心跳异常认证、手动服务器输入、下线。
应用内「日志」按钮可打开日志页 (新日志在上, 3 秒自动刷新, 支持刷新/清空/返回)。

## 测试

```sh
node test/aes.test.mjs        # AES 对照 Node crypto (aes-128-ecb zeropadding)
node test/detect.test.mjs     # 跳转解析 / URL 拆解
```
