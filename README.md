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

## 日志

应用运行日志单独存储在  (目录不存在自动创建, 超过 512KB 自动截断轮转):



记录: 启动、连通性测试结果、Portal 配置解析、登录请求结果、心跳异常认证、手动服务器输入、下线。

## 测试

```sh
node test/aes.test.mjs        # AES 对照 Node crypto (aes-128-ecb zeropadding)
node test/detect.test.mjs     # 跳转解析 / URL 拆解
```
