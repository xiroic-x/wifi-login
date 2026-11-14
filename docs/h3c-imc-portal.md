# H3C iMC Portal 网页认证协议取证

> 返回 [README](../README.md) · 文档索引 [docs/README.md](README.md)

> 返回 [README](../README.md)

本文是 **H3C iMC Portal 网页认证** 的协议取证报告, 面向 `ui/src/services/portal-adapters/h3c-imc.js`
的实现者与真机排障者。所有结论标注来源与证据等级; **没有来源的内容一律标为推测**。

## 取证范围与证据等级

- 取证时间: 2026-11-13; 仓库基线 `67d8799` (v1.1.4) + 当时工作区未提交改动。
- 目标网络: SSID `<校园网SSID>`, 劫持后门户页
  `http://10.65.x.x:8080/portal/?userip=10.65.x.x&userurl=http://connect.rom.miui.com/generate_204`
  (词典笔真机日志; 另一条日志为 `userip=10.65.x.x`, 属不同 DHCP 租约)。
  **该网络的门户服务器版本未知, 本文没有任何一条来自该服务器的实测响应。**
- 证据等级标签:
  - **[证]** 已由 H3C 官方文档或多份相互独立、可用的公开实现交叉证实;
  - **[推]** 推测/单点观测/语义未证实, 必须真机验证 (见第 7 节)。
- 用到的公开实现 (均为独立第三方, 互相印证):

| 代号 | 来源 | 时间 | 贡献的协议事实 |
|---|---|---|---|
| BLOG | [暨南大学珠海校区有线网认证分析及Golang实现](https://0x2a.in/blog/posts/jnu_network/) | 2021 | 完整浏览器抓包参数表、`errorNumber`/`portServ*` 返回样例、成功 JSON 全字段 |
| GO | [Steve0x2a/JNU_ZH_Network](https://github.com/Steve0x2a/JNU_ZH_Network) (`utils/login.go`、`utils/heartbeat.go`) | 2021 | 登录超集参数、解码容错、心跳成功判据 `v_failedTimes=0`、已在线处理 |
| SH | [Howard20181/Shell-H3C-Portal](https://github.com/Howard20181/Shell-H3C-Portal) (main / Openwrt 分支) | 2022 | 最小可行参数集、`portalLink` 解码、心跳 Referer/Cookie、**630xx 码表** |
| BYOD | [Howard20181/Shell-H3C-BYOD](https://github.com/Howard20181/Shell-H3C-BYOD) | 2022 | 同一 iMC 的 BYOD 分支协议 (对比用, 非本适配器范围) |
| TUN | [yaoing/iMC-Tunnel](https://github.com/yaoing/iMC-Tunnel) (`src/core/tunnel.js`) | 2021 | 登录/下线/心跳三接口、心跳参数可放 query、`errorNumber=-1` 的 `errorDescription` |
| OLD | [disassembly/H3c_Portal-login-logout](https://github.com/disassembly/H3c_Portal-login-logout) | 2016 | 老版登录 `pws?t=li` + 在线 `pws?t=gpurl`, 下线 `pws?t=lo` |
| OLD2 | [xiyouant/H3C_Auto_regist](https://github.com/xiyouant/H3C_Auto_regist) (`final.cpp`) | 2015 | 更老版本: `index_default.jsp` 取 Cookie、心跳 `pws?t=hd`、`manualUrlEncryptKey` |

---

## 0. 触发链路: 为什么会走到 `/portal/`

**[证]** H3C 接入设备 (AC/交换机) 把用户 HTTP 请求重定向到门户页时, 按
`url-parameter` 配置把参数拼在门户 URL 上。iMC 门户服务器认的参数名是
`userurl` / `userip` / `usermac`, 分别对应接入设备的 `original-url` / `source-address` /
`source-mac`:

> “When you configure the `param-name` argument in this command, you must use the URL
> parameter name supported by the actual portal server. … the IMC server supports
> parameter names `userurl`, `userip`, and `usermac` for the keywords `original-url`,
> `source-address`, and `source-mac`, respectively.”
> — [H3C 命令参考 08-Portal commands (EN)](https://www.h3c.com/en/Support/Resource_Center/EN/Home/Wireless/00-Public/Reference_Guides/Command_References/H3C_Access_Controllers_CR-R5456/13/202211/1714837_294551_0.htm)

> “param-name 这个URL参数名必须与具体应用环境中的Portal服务器所支持的URL参数名保持一致 … 例如
> iMC服务器支持的URL参数名如下：· userurl：表示 original-url · userip：表示 source-address ·
> usermac：表示 source-mac”
> — [H3C 命令参考 Portal 命令 `url-parameter` (CN)](http://www.h3c.com/cn/d_202212/1742755_30005_0.htm)

所以对适配器来说:

- **[证]** `?userip=<本机IP>&userurl=<原始URL>` 是 iMC 门户页的典型跳转形态, 可作为
  `match()` 的强特征; `usermac`/`basip`/`wlannasid`/`wlanssid` 是可选附加特征。
- **[证]** 门户页 URL 形如 `http://<portal-server>[:port]/portal/?<参数>`;
  `serverBase = scheme://host[:port]` (本网络 `http://10.65.x.x:8080`),
  **`appRootUrl = serverBase + "/portal/"`** (登录/心跳/下线端点都挂在 `appRootUrl` 下)。
- **[推]** `/portal/` 的具体页面 (默认 `index_default.jsp`) 与 iMC 版本/自定义模板有关,
  端点路径本身在全部 5 份实现中一致, 可信度高。

---

## 1. 完整认证流程

```
[被劫持]  GET http://connect.rom.miui.com/generate_204
            └─ 302 / 200+跳转 → http://10.65.x.x:8080/portal/?userip=..&userurl=..
[建会话]  GET  {appRootUrl}?<userip/userurl...>            ← 拿页面 + Set-Cookie + 运行时配置
[登录]    POST {appRootUrl}pws?t=li   (x-www-form-urlencoded)
            └─ 200 text/plain, body = base64(percent-encoded JSON)
                 ├─ errorNumber=1  → 成功, 存 userDevPort/userStatus/serialNo/portalLink/heartBeatCyc
                 ├─ errorNumber=7  → 认证失败(带 portServIncludeFailedCode/portServErrorCode)
                 └─ errorNumber=-1 → 门户侧异常(带 errorDescription 或 e_c/e_d)
[保活]    POST {appRootUrl}page/doHeartBeat.jsp   (每 heartBeatCyc 毫秒量级; 框架每 30s 一次)
[下线]    POST {appRootUrl}pws?t=lo
```

### 1.1 步骤 0: 被劫持 (框架层, 适配器无需实现)

**[证]** 检测层从探测响应里拿到门户 URL 与查询参数, 得到
`ctx = { portalPage, serverBase, params:{userip,userurl,...}, pageTitle, snippet, headers }`
(见 `ui/src/services/detect.js` 的 `checkPortal` / `portalResult` / `parsePortalUrl`)。
**注意 `snippet` 是探测响应体的前 400 字节, 不是门户页源码** —— `match()` 不能指望在其中
读到 iMC 登录页文案, 应主要看 `params`/`portalPage`。

### 1.2 步骤 1: 取门户页 (建会话 + 读运行时配置)

```
GET {appRootUrl}?<检测到的全部参数> HTTP/1.1
Host: 10.65.x.x:8080
User-Agent: Mozilla/5.0 (...) Chrome/...
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language: zh-CN,zh;q=0.9
```

- **[证]** 老实现明确先 GET `http://<portal>:8080/portal/index_default.jsp` 并保存 Cookie
  (`COOKIEFILE`), 再 POST 登录 — 见 OLD2 `final.cpp` 的 `get_cookies(b, COOK)` + `post_id_key(c, ...)`;
  SH 直接把 `Referer` 写成 `{appRootUrl}index_default.jsp`。
- **[证]** 该响应通常 `Set-Cookie` 下发 `JSESSIONID` 一类会话 Cookie。但 **Cookie 是否被严格校验不重要**:
  GO 只带 UA/Accept/Accept-Language 三个头 (无 Referer/Cookie) 即登录成功; TUN 同样不带 Cookie 成功。
  → **[推]** 本协议对 Cookie 的依赖很弱, Cookie 只作 best-effort 带上。
- **[推]** 门户页 HTML/JS 里带着登录表单要用的运行时配置 (`portalProxyIP`、`portalProxyPort`、
  `appRootUrl`、`customPageId`、`pwdMode`、`dcPwdNeedEncrypt`、`assignIpType`、`manualUrlEncryptKey` 等)。
  **本仓库没有拿到目标网络的门户页源码**, 变量名/正则见 §2.3, 全部待真机核对。

### 1.3 步骤 2: 登录请求

```
POST {appRootUrl}pws?t=li HTTP/1.1
Host: 10.65.x.x:8080
Content-Type: application/x-www-form-urlencoded
Referer: {appRootUrl}index_default.jsp        (或带参数的 portal 页 URL)
Origin: http://10.65.x.x:8080
Cookie: hello1=<账号>; hello2=false; i_p_c_op=false; i_p_c_un=<账号>
User-Agent: Mozilla/5.0 (...) Chrome/...
Accept: text/plain, */*;                (SH)  或 text/html,...   (GO/BLOG)

userName=<账号>
&userPwd=<base64(密码) 的 URL 编码值>
&language=Chinese
&customPageId=1
&pwdMode=0
&portalProxyIP=10.65.x.x
&portalProxyPort=50200
&dcPwdNeedEncrypt=1
&assignIpType=0
&appRootUrl=http%3A%2F%2F10.65.x.x%3A8080%2Fportal%2F
&userip=            (参考实现多为空, 见 §2)
&userurl=http%3A%2F%2Fconnect.rom.miui.com%2Fgenerate_204
&basip=
&usermac=
&...
```

- **[证]** 端点 `POST /portal/pws?t=li` 在 BLOG/GO/SH/TUN/OLD/OLD2 六份实现中完全一致。
- **[证]** 密码 = `base64(明文密码)` (UTF-8 字节), 且 **base64 结果必须再 URL 编码**
  (`+` → `%2B`、`=` → `%3D`、`/` → `%2F`)。证据: BLOG 抓包 `userPwd: base64编码的密码`;
  SH 用 `encodeURIComponent` 包 base64; GO 用 form 提交自动编码; OLD 手工把 `=` 替换成 `%3D`。
  不编码时 `+` 会被服务端解成空格, 密码错误 — **[推]** 这是最常见的实现错误。
- **[证]** `portalProxyPort=50200` 在 BLOG/GO/SH/TUN/OLD2 五份实现中一致 (是门户协议端口,
  **不是** HTTP 的 8080)。H3C 侧的旁证: iMC 场景需放通 “UDP 50100、50200、2000”
  — [H3C KMS 案例](https://kms.h3c.com/questions/dispcont/292878)。
- **[推]** `Referer`/`Origin`/`Cookie` 的必需性未做对照实验 (GO/TUN 不带也成功),
  但带上无副作用、可提高对“更严格版本”的兼容性, 建议保留。

### 1.4 步骤 3: 响应解码 (模型见 §3)

**[证]** 响应 body 是 **base64(percent-encoded JSON)**:
BLOG 给出原始 base64 与解码后的 JSON; SH 是 `base64 -d` 再 urldecode; GO 是
`base64.StdEncoding.DecodeString` 再 `url.QueryUnescape` (并额外尝试补 `=`/`==` padding);
TUN 是 `Buffer.from(msg,'base64')` 再 `unescape`。四份实现解码链一致。

### 1.5 步骤 4: 登录成功后的两份数据

**[证]** `errorNumber=1` 时, 顶层 JSON 与其中的 `portalLink` 字段都携带保活所需信息:

- 顶层: `userDevPort`、`userStatus`、`serialNo`、`heartBeatCyc`、`heartBeatTimeoutMaxTime`、
  `clientLanguage`、`ifNeedModifyPwd`、`portalLink` 等 (BLOG 给出完整样例; GO 直接反序列化顶层字段);
- `portalLink` 自身是 **base64(percent-encoded JSON)**, 解出来是同一组字段 (SH 从 `portalLink`
  解出 `userDevPort`/`userStatus`/`serialNo`/`heartBeatCyc`/`clientLanguage`/`ifNeedModifyPwd`;
  `portalLink` 原值还要原样放进心跳的 `Referer` 的 `pl=` 参数)。

→ 实现建议: **优先用顶层字段, 缺失时回退到解码后的 `portalLink`**; `portalLink` 解码失败
不影响保活 (顶层字段够用), 只是 `Referer.pl` 退化为原值。

### 1.6 步骤 5: 心跳保活 (详见 §4)

```
POST {appRootUrl}page/doHeartBeat.jsp HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Referer: {appRootUrl}page/online_heartBeat.jsp?pl=<portalLink 原值>&custompath=&uamInitCustom=0&uamInitLogo=H3C
Cookie: hello1=<账号>; hello2=false
User-Agent: Mozilla/5.0 (...) Chrome/...

userip=&basip=&userStatus=99&userDevPort=<URL编码的 userDevPort>&serialNo=<serialNo>&language=Chinese&e_d=&t=hb
```

- **[证]** 端点/表单字段/Referer 形态在 SH、GO、TUN 三份实现中一致 (细节见 §4)。
- **[证]** 心跳成功判据: GO 判 `HTTP 200 && body 含 "v_failedTimes=0"`; TUN 只判 `HTTP 200`。
  → **[推]** “含 `v_failedTimes=0`” 更严格, 建议同时接受两者 (先日志记录, 再决定)。

### 1.7 步骤 6: 下线 (详见 §5)

```
POST {appRootUrl}pws?t=lo      (表单字段版本差异见 §5)
```

### 1.8 版本差异的额外步骤 (实现需容忍)

| 变体 | 证据 | 说明 |
|---|---|---|
| 先 `GET portal/index_default.jsp` 取 Cookie | OLD2 / SH | 建议每次登录前都做 (见 §1.2) |
| 登录后再 `POST pws?t=gpurl` (带在线信息) | OLD (2016) | “取跳转 URL”步骤; 其余实现没有。**[推]** 老版本/特定部署才有, 若登录返回里已有 `portalLink` 则不需要 |
| 心跳走 `pws?t=hd` 而非 `page/doHeartBeat.jsp` | OLD2 (2015) | 更老版本的心跳形态; 请求体字段与 `doHeartBeat.jsp` 相同 |
| 心跳参数放 query 而非 body | TUN | `POST .../doHeartBeat.jsp?userip=&basip=&userDevPort=...` 空 body 也能成功 → **[推]** iMC 服务端 (Java Servlet) 会合并 query 与 body 参数 |

---

## 2. 登录请求参数的超集与版本差异

### 2.1 参数表

必需性评级: **必** = 5 份实现都发/或缺失必失败; **推** = 多数实现发但未证明必需;
**选** = 可选, 只在特定部署出现。

| 参数 | 观测取值 | 必需性 | 来源与说明 |
|---|---|---|---|
| `userName` | 账号 | **必** | 全部实现 |
| `userPwd` | `base64(密码)` 再 URL 编码 | **必** | 全部实现; 编码规则见 §1.3 |
| `language` | `Chinese` | **必** | 全部实现 (服务端可能用于选语言包/文案) |
| `portalProxyIP` | 门户服务器 IP, 如 `10.65.x.x` | **必** | 全部实现; BLOG 抓包 `192.168.11.34`; 是 **IP 不是 URL**, 不带端口 |
| `portalProxyPort` | `50200` | **必** | 全部实现; 门户协议端口 (UDP), 非 HTTP 端口 |
| `appRootUrl` | `http://host:port/portal/` (URL 编码) | **必** | BLOG/GO/SH/TUN/OLD2 全部; 注意结尾 `/` |
| `pwdMode` | `0` | **必** | BLOG/SH/TUN/GO; 语义未公开 **[推]** 0=普通密码 |
| `dcPwdNeedEncrypt` | `1` | **必** | BLOG/SH/TUN/GO/OLD2; 观测形态下密码仍只是 base64 (见 §2.4) |
| `assignIpType` | `0` | **必** | BLOG/SH/TUN/GO/OLD2; **[推]** 0=自动分配/不校验静态 IP |
| `customPageId` | `1` (BLOG) / `0` (TUN) / `105` (GO) / `H3C` (SH) | **推** | 自定义模板 ID, **部署相关**; 四份实现各不相同却都能登录 → 服务端容错度高。建议从页面变量取, 回退 `1` |
| `userip` | 空 (BLOG/GO/TUN) / `null` (OLD) / 不发 (SH) | 选 | **[推]** 登录表单里通常留空, NAS 从报文源地址识别用户; 目标页 URL 里的 `userip` 是该参数来源, 可原样带回 |
| `userurl` | 空或原始 URL | 选 | BLOG 抓包为空; 页面 URL 里有 `userurl`; 回带无害 |
| `basip` | 空 | 选 | 全部实现发空; 无线场景可带 AC 地址 |
| `usermac` | `null` 字面量 (BLOG/GO/TUN) 或空 (SH) | 选 | **[推]** 有 MAC 免认证/绑定策略才有意义; `"null"` 字符串在抓包里就是服务端模板产物 |
| `wlannasid` / `wlanssid` | 空 | 选 | BLOG/GO 有; 无线场景 (本网络是 WiFi) 可能由页面填真值 |
| `entrance` | `null` 字面量 | 选 | BLOG/GO; 入口/场景参数 |
| `loginVerifyCode` | 空 | 选 | BLOG/GO; 门户开验证码时必须填 → **[推]** 若目标网络出现验证码, 属 ADAPTER.md 的“阻塞条件” |
| `userDynamicPwd` / `userDynamicPwdd` / `userDynamicPwddd` | 空 | 选 | 动态口令/短信认证场景 |
| `serviceType` (`serviceTypeHIDE`) | 空 | 选 | GO 多一个 `serviceTypeHIDE`; 都是空 |
| `isSavePwd` | `on` (BLOG/OLD2) 或空 (SH) | 选 | 记住密码; 适配器把 `remember` 映射成 `on`/空 |
| `manualUrl` | 空 | 选 | 手动认证跳转 URL; 配合 `manualUrlEncryptKey` |
| `manualUrlEncryptKey` | 如 `rTCZGLy2wJkfobFEj0JF8A==` | 选 | **[推]** 页面按部署生成的 key; 手动认证才用, 适配器不需要 |
| `isQuickAuth` / `browserFinalUrl` | `false` / 空 | 选 | 仅老版本 OLD/OLD2 抓包出现 |

### 2.2 最小可行集 vs 超集

- **[证] 最小可行集 (10 个参数) 真机可用**: SH 的登录请求只发
  `userName, userPwd, language, customPageId, pwdMode, portalProxyIP, portalProxyPort,
  dcPwdNeedEncrypt, assignIpType, appRootUrl` —— 且脚本作者标注在 OpenWrt 实网跑通。
- **[证] 全量集也可用**: BLOG 的浏览器抓包 (25 个字段) 与 GO 实现 (26 个字段) 同样成功。
- **建议**: 发 **超集** (iMC 对多余/空参数容忍, 5 份实现取值互不相同仍成功), 并保证
  §2.1 里标 **必** 的 9 个参数永远正确; `customPageId` 用页面值、回退 `1`。
  **[推]** 超集的风险是某个版本的严格校验, 但 5 份实现的反例说明风险低。

### 2.3 `portalProxyIP` / `portalProxyPort` / `appRootUrl` 如何从页面提取

**没有拿到目标网络门户页源码, 以下正则全部是 [推]**, 只能作为“尽力而为 + 日志留证”:

1. **直接变量** (最优先; 变量名来自各实现注释与 iMC 门户页模板习惯):
   - `portalProxyIP\s*[:=]\s*["']?(\d{1,3}(?:\.\d{1,3}){3})`
   - `portalProxyPort\s*[:=]\s*["']?(\d{2,5})`
   - `appRootUrl\s*[:=]\s*["'](https?://[^"']+)`
   - `customPageId` / `pwdMode` / `dcPwdNeedEncrypt` / `assignIpType` / `language` 同理
2. **BYOD 服务地址函数** (SH 脚本里的注释就指向这里, 说明其门户页有类似函数):
   - `imc_portal_function_readByodServerAddress()` → IP
   - `imc_portal_function_readByodServerHttpPort()` → 端口 (注意这是 **HTTP 端口**, 不是 `portalProxyPort`)
   - 兜底: `byodserverip\s*[:=]\s*["']?IP` / `byodserverhttpport\s*[:=]\s*["']?(\d+)`
     (SH/BYOD 脚本把这两个值硬编码为 `10.0.15.101` / `8080`, 注释即上述函数名)
3. **回退链** (取不到时):
   - `portalProxyIP` ← `serverBase` 的 host; 再不行 ← 页面上的 IP 字面量; 最后 ← 本机 IP 的网关
     **[推]** 同网段门户/网关常常同址, 但不保证。
   - `portalProxyPort` ← `50200` (5 份实现一致), 失败时再试 `2000`、`50100`
     (H3C KMS 提到 iMC 相关 UDP 端口 50100/50200/2000 — [KMS 292878](https://kms.h3c.com/questions/dispcont/292878))。
   - `appRootUrl` ← `serverBase + "/portal/"` (**证**: 全部实现都用这个形态)。
4. **必须做的取证**: 把抓到的页面长度、提取结果 (IP/端口/`customPageId`) 写日志;
   提取失败不阻断登录 (用回退值), 只在失败信息里注明。

### 2.4 密码编码的版本风险

- **[证]** 观测到的唯一形态是 `base64(明文密码)`; `dcPwdNeedEncrypt=1` 并未改变它
  (SH/GO/TUN 都只发 base64)。
- **[推]** 某些 iMC 版本/策略下 (页面 JS 里出现 AES/`pwdMode` 非 0/`dcPwdNeedEncrypt=0`),
  密码可能要求 AES 等其它编码。**判定方法**: 浏览器 F12 抓一次真实登录, 对比
  `userPwd` 与 `base64(密码)`; 若不等, 说明该部署做了额外加密 → 按 ADAPTER.md 的阻塞条件上报,
  不要猜。本仓库已有 `ui/src/services/aes.js` (AES-128-ECB) 可复用, 但**没有证据**表明
  iMC 用 AES-128-ECB 处理 `userPwd`。

### 2.5 `t=li` 的 query 与 body 双写

- **[证]** 心跳 `doHeartBeat.jsp` 的参数放在 query 也能成功 (TUN)。
- **[推]** 登录 `pws?t=li` 同理可能接受 query 参数 (iMC 门户是 Java 应用, `getParameter`
  会合并 query 与 body)。工作区实现把登录参数**同时**放 query 和 body, 目的:
  让“只发 query 的旧版 `libjsapi_panet.so`”也有机会成功。**这是待真机验证的兼容策略**, 不是协议事实。

---

## 3. 响应解码、返回码与错误码表

### 3.1 解码算法

```
raw = response.body (latin1 字符串, 保留原始字节)
1) 若 raw 本身能 trim 后 JSON.parse → 直接用 (部分版本/代理返回明文 JSON)
2) 去空白后 base64 解码 (容错: 缺省 '=' padding, 忽略换行; 可容忍 -/_ URL-safe 变体)
3) 对解码结果 percent-decode (`%XX` → 字节; 注意 '+' 在表单上下文表示空格, 但在
   percent-encoded JSON 里通常不会出现 '+', 两种都试一次)
4) JSON.parse(percent 解码后的字符串); 中文按 UTF-8 还原 (JSON 里也可能是 \uXXXX)
```

- **[证]** padding 容错: GO 明确重试 `msg+"="` 与 `msg+"=="`。
- **[证]** 服务端可能返回空 body (网络/会话异常): SH/GO 都先判空再解码。
- **[推]** 解码失败 ≠ 登录失败: 先看 HTTP 状态码与 body 前若干字节, 把原始头部写日志。

### 3.2 `errorNumber` 语义

| `errorNumber` | 含义 | 伴随字段 | 处理 |
|---|---|---|---|
| `1` | 登录成功 | `portalLink`、`userDevPort`、`userStatus`、`serialNo`、`heartBeatCyc`、`heartBeatTimeoutMaxTime`、`clientLanguage`、`ifNeedModifyPwd` | 保存心跳参数 → 进入保活 |
| `7` | 认证被拒 (设备/AAA 侧) | `portServIncludeFailedCode`+`portServIncludeFailedReason`, 或 `portServErrorCode`+`portServErrorCodeDesc`, 以及 `e_c`/`e_d` (间接字段名) | 按 §3.3 / §3.4 分类, 不盲目重试 |
| `-1` | 门户侧异常/业务失败 | TUN 直接读 `errorDescription`; SH 通过 `e_c`/`e_d` 间接取 | 提示文案; 无业务错误码时刷新会话重试一次 (实现如此) |
| 其它/缺失 | 未知/解析失败 | — | 视为失败; 允许刷新会话后重试一次 |

- **[证]** `errorNumber` 可能是字符串 (`"7"`) 也可能是数字 (`1`), 统一按字符串比较更稳。
- **[证]** BLOG 的四组实测返回: 成功=`1`; 已登录/用户名错/密码错全部是 `7`
  (靠 `portServErrorCode` 或 `portServIncludeFailedCode` 区分)。
- **[证]** `-1` 由 SH/TUN 两处独立处理; TUN 用的是 `errorDescription` 字段
  (说明该版本把描述直接放在这里, 而不是 `e_c`/`e_d` 间接索引)。
- **[推]** `e_c`/`e_d` 机制: `e_c` 是“存放错误码的字段名”, `e_d` 是“存放描述的字段名”,
  真正内容在 `json[e_c]` / `json[e_d]` —— SH 就是这么取的。适配器应同时支持三种取法:
  `portServ*Reason/Desc` → `e_c/e_d` 间接 → `errorDescription`。

### 3.3 `portServErrorCode` (设备侧通用错误)

| 码 | BLOG 文案 | SH 脚本行为 | 最终实现 |
|---|---|---|---|
| `1` | 设备拒绝请求 | 落到“未知”分支 (SH 提前按 `portServIncludeFailedCode` 分支, 该码另有逻辑) | **[证]** 多出现在**已在线**时 (BLOG: 已登录返回它; GO: 判定为已登录并尝试重新登录) → 归一化为“已在线” (`ok:true`, code 200) **[推]** |
| `2` | — | 视为已连接 (`CONNECT_TIME=now`, 继续心跳) | 语义**未证实**: 不据此判成功, 也不判永久失败; 文案降级为“含义未证实, 可稍后重试”, 刷新会话重试一次 |
| `3` | — | 重新登录 (`restart_auth`) | 语义**未证实**: 文案“会话已失效, 请重试”, 刷新会话重试一次 |
| 其它 | — | 未知错误, 退出 | 失败, 提示错误码 |

> 这三个码没有找到任何公开的官方码表, 语义全部是 **[推]** — 以真机返回文案 (`portServErrorCodeDesc`)
> 为准, 用日志留证。最终实现刻意不对 2/3 做“成功/永久失败”的强断言, 避免误导用户。

### 3.4 `portServIncludeFailedCode` 常见码表

**来源**: SH main 分支脚本里内嵌的 `portServFailedReason_json`
([autoauth.sh](https://github.com/Howard20181/Shell-H3C-Portal/blob/main/autoauth.sh));
BLOG 抓包独立证实 63018/63032 的文案; H3C KMS 案例间接证实 63025/63100 的英文含义。
**这是社区整理的码表, 不是官方发布** → 标 **[推]**, 真机以 `portServIncludeFailedReason` 原文为准。

| 码 | 含义 | 证据 |
|---|---|---|
| 63013 | 用户已被加入黑名单 | SH |
| 63015 | 用户已失效 | SH |
| 63018 | 用户不存在或者用户没有申请该服务 | SH + BLOG |
| 63024 | 端口绑定检查失败 | SH |
| 63025 | MAC 地址绑定检查失败 | SH + [KMS 87474](https://kms.h3c.com/questions/dispcont/87474) (标题 `E63025:Failed to Check MAC address binding`) |
| 63026 | 静态 IP 地址绑定检查失败 | SH |
| 63027 | 接入时段限制 | SH (SH 对此码特殊处理: 非允许时段休眠到 07:00 再试) |
| 63031 | 用户密码错误，该用户已经被加入黑名单 | SH |
| 63032 | 密码错误，密码连续错误次数超过阈值将会加入黑名单 | SH + BLOG |
| 63048 | 设备 IP 绑定检查失败 | SH |
| 63073 | 用户在对应的场景下不允许接入 | SH |
| 63100 | 无效认证客户端版本 | SH + [KMS 292019](https://kms.h3c.com/questions/dispcont/292019) (标题 `E63100:无效认证客户端版本`) |
| 63634 | 当前场景下绑定终端数量达到限制 | SH |

### 3.5 失败分类 (供 `login()` 决定是否重试)

| 类别 | 判据 | 行为 |
|---|---|---|
| 账密类永久失败 | `portServIncludeFailedCode` ∈ {63018, 63032, 63031} | **不重试** (重试会累计错误次数/触发黑名单); 直接返回失败文案 |
| 策略/绑定/版本类永久失败 | {63013, 63015, 63024, 63025, 63026, 63048, 63100, 63073, 63634} | 不重试; 提示用户联系管理员 |
| 时段限制 | 63027 | 不循环重试; 提示“当前不在允许上网时段” |
| 会话/网络类可重试 | 无响应、空 body、解码失败、`portServErrorCode=2` 或 `3` (语义未证实) | 刷新门户页会话后**重试一次** |
| 已在线 | `portServErrorCode=1` / `errorNumber=7`+“设备拒绝请求” / `-1`+描述含“已在线” | 归一化为成功 (`ok:true`, code 200); **不**用页面在线标志判定 |

### 3.6 “已在线 / 无需重复登录”的判定

优先级从高到低 (前两条有实现证据, 后两条是补充手段):

1. **[证] `errorNumber=7` + `portServErrorCode=1` (+ `portServErrorCodeDesc` 含“设备拒绝请求”)**
   → BLOG 明确把它列为“已经登录”; GO 收到后 `log.Println("用户已经登录, 尝试强制下线后重新登录")`。
   适配器**不要**像 GO 那样递归重登, 直接当成“已在线”。
2. **[推] 登录前 GET 门户页, 页面已出现在线态标志** (`pws?t=lo`、`online_heartBeat`、
   `portalLink`、`heartBeatCyc`, 或“已在线/已认证/在线时长”字样) → 可据此认为已在线。
   **最终实现刻意不采用**: 登录页的 JS 里也可能出现同名字样, 误判会隐藏登录表单
   (v1.1.3 修过同类事故); 适配器只在日志里记录该标志, 是否已在线交给登录返回
   (§3.6-1) 与框架连通性检测 (§3.6-4) 判定。
3. **[推] `errorNumber=-1` + 描述含“已在线/已经在线/already online”** → 视为已在线。
4. **[证] 框架层连通性证据**: `generate_204` 返回真 204 说明已放行 (由 `detect.js` 负责,
   适配器不重复判断)。

---

## 4. `portalLink` 解码与心跳保活

### 4.1 解码

```
portalLink = 登录成功 JSON 的 portalLink 字段 (base64 字符串)
json2 = JSON.parse(percentDecode(base64decode(portalLink)))
```

- **[证]** SH: `printf "%s" "$portalLink" | base64 -d` 再 `urldecode`;
  BLOG: “其一样是一个 json 字符串的 base64 编码后的内容”;
  GO/TUN 不解 `portalLink` (直接用顶层字段), 但都把原值塞进心跳 Referer 的 `pl=`。
- **[推]** 解码失败 ⇒ 心跳仍可用顶层字段; `pl=` 用原值。

### 4.2 字段

| 字段 | 观测值 | 用途 |
|---|---|---|
| `userDevPort` | `ZH-Campus-Core_SW-vlan-00-0409@vlan` | 心跳必填; 含 `@`/`-`, **发送时必须 URL 编码** (`%40`) |
| `userStatus` | `99` | 心跳必填 (固定 99 的形态在 4 份实现中都出现) |
| `serialNo` | `11328` / `11226` 等整数 | 心跳必填; BLOG 称“观察后发现其实只需要更改 serialNo 即可” **[推]** 可能需递增, 但 SH/GO/TUN 都复用登录返回值也能保活 → 先用固定值 |
| `heartBeatCyc` | `60000` (毫秒) | **心跳周期**; `>0` 表示必须心跳。60000ms = 60s |
| `heartBeatTimeoutMaxTime` | `5` | 语义未证实 **[推]**; BLOG 据此认为“最大间隔不超过 5 分钟” |
| `clientLanguage` | `Chinese` | 心跳 `language` 字段来源 |
| `ifNeedModifyPwd` | `false` | `true` 时提示用户去网页改密 (仍算登录成功) |
| `browserUrl` / `clientPrivateIp` / `nasIp` / `triggerRedirectUrl` 等 | 空 | 无需处理 |

### 4.3 心跳请求

```
POST {appRootUrl}page/doHeartBeat.jsp HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Origin: http://10.65.x.x:8080
Referer: {appRootUrl}page/online_heartBeat.jsp?pl=<portalLink 原值>&custompath=&uamInitCustom=0&uamInitLogo=H3C
Cookie: hello1=<账号>; hello2=false
User-Agent: Mozilla/5.0 (Linux; Android; wv)     (SH 的 UA; 用哪个 UA 不敏感)
Accept: text/html,application/xhtml+xml,application/xml;

userip=&basip=&userStatus=99&userDevPort=<urlencoded>&serialNo=11328&language=Chinese&e_d=&t=hb
```

- **[证]** 端点与字段: SH/GO/TUN 三份一致; `t=hb` 是 SH/BLOG 的表单尾字段。
- **[证/推]** 心跳参数放 query 也能成功 (TUN 的实测形态); 最终实现**同时**放 query 与 body,
  这样"只发 query"的旧版 `.so` 也能把 `serialNo`/`userDevPort` 送到服务器 (2026-11-13 真机模拟已证)。
- **[证]** SH 的 Cookie 比登录多两个: `hello1=<账号>; hello2=false; i_p_c_op=false; i_p_c_un=<账号>`;
  BLOG 只强调 `hello1`/`hello2` 两个值。
- **[证]** 旧的 2015 版本有心跳 `pws?t=hd`, 字段同上 (无 `t=hb`), 间隔约 10 分钟 —
  说明心跳端点/周期随版本变化, **以登录返回的 `heartBeatCyc` 为准**。

### 4.4 频率与超时

- **[证]** 以 `heartBeatCyc` (毫秒) 为准: 60000 → 60s 一次; SH 取 `heartBeatCyc/1000` 作周期,
  GO 默认 1 分钟; TUN 未显式定时但注释/行为是周期发。
- **[证]** 心跳必须连续: 网页关掉几分钟就会被踢 (BLOG 前言: “保持认证网页存在, 否则就会被断开”),
  GO readme: “默认一分钟发送一次心跳包 … 不建议超过五分钟”。
- **[推]** `heartBeatTimeoutMaxTime=5` 与“5 分钟上限”的对应关系未证实。
- **本仓库框架**: `index.vue` 的心跳定时器**固定 30 秒**调一次 `queryStat`
  (见 `startHeartbeat`), 适配器不需要自己起定时器。最终实现按 `heartBeatCyc * 0.6`
  在 `queryStat` 内节流 (60000ms → 实际约每 60s 一次), 并用 `keepAlive` 让框架在
  “已认证”后继续调; 若目标网络 `heartBeatCyc` < 30s, 会在日志里给出告警 (框架周期不够短)。

### 4.5 心跳成功的判定与失败处理

- **[证]** GO: `res.StatusCode()==200 && strings.Contains(resp.String(), "v_failedTimes=0")` 才算成功;
  TUN: 只判 200。
- **[推]** 建议: 200 + (body 为空 **或** 含 `v_failedTimes=0`) 视为成功; 其它记日志。
  心跳响应可能是 HTML 片段/明文, **不一定** 是 base64 JSON — 不要按登录响应的解码链强解。
- **[推]** 连续失败 (如 3 次) 后应清掉 `state.hb` 并提示“需要重新认证”; 框架的
  `queryStat` 语义是 `{ok:false}` 时静默重试, 不会自动重新登录, 所以适配器自己决定要不要
  在 `queryStat` 内部重登 (不建议: 会与框架状态机打架)。

---

## 5. 下线与设备管理

### 5.1 本机下线: `POST {appRootUrl}pws?t=lo`

**[证]** 两份独立实现都实现了它, 端点一致:

- OLD `NsINodeLogout.py`: `POST /portal/pws?t=lo`, body 与登录同形
  `userName=..&userPwd=base64..&isQuickAuth=false&language=Chinese&browserFinalUrl=&userip=null`,
  Cookie `hello1=<账号>; hello2=true` (注意 `hello2=true` 与登录的 `false` 相反);
  判据只有 HTTP 200。
- TUN `logout()`: `POST /portal/pws?t=lo`, 最小集 `{language:'Chinese', userip:'', basip:''}`,
  `errorNumber=1` 视为成功。

→ **建议**: 优先发最小集 `language=Chinese&userip=&basip=` (+ `appRootUrl`), 失败再退回
“登录参数形态 + `hello2=true`”; 成功判据 `errorNumber=1`。
**[推]** 登录成功返回里若带 `portalLink`, 下线是否要带 `pl` 未知; 都试一遍并留日志。

### 5.2 在线设备列表 / 单机下线 / 全部下线

**结论: iMC 门户页没有设备管理接口, 适配器不实现 `listDevices` / `offOne` / `offAll`。**

证据与推断:

- **[证]** 本次检索到的 7 份实现 (BLOG/GO/SH/BYOD/TUN/OLD/OLD2) **没有任何一份**实现设备列表;
  BLOG 作者明确列出未实现功能: “1. 退出功能（不需要）; 2. 验证被顶出自动重连 (可以实现…)”
  — 即连下线/踢人都没有, 门户页侧只有本机登录/心跳。
- **[推]** iMC 的“在线用户/终端管理”属于 iMC 平台的自服务 (self-service) 或运维界面, 需要独立
  地址与账号权限, 不在 `{appRootUrl}` 这套门户协议里。门户页最多展示本机在线时长/流量。
- **实现约定**: `registry.js` 只在适配器导出对应成员时才显示入口, 所以 h3c 适配器**不要**导出
  `listDevices`/`offOne`/`offAll`; 页面不会出现“设备管理”按钮, 属于预期行为。
- **真机复核方法**: 登录后 GET 门户页, 搜 `设备管理|在线终端|自助服务|selfservice|offline`
  等字样; 若出现指向**另一个 host/端口**的管理页, 再单独评估 (见 §7-12)。

---

## 6. 运行环境与传输层能力

### 6.1 设备侧运行环境 (本仓库约束)

- **[证]** 运行时是 **QuickJS**, 无 Node.js / 无 OpenSSL; 原生能力只有自研 `libjsapi_panet.so`
  (`native/panet/panet.cpp`) 与固件 `$jsapi` 模块。见 [ADAPTER.md](../ADAPTER.md) 的阻塞条件说明
  与 [docs/project.md](project.md)。
- **[证]** 仓库内置纯 JS 工具: `ui/src/services/aes.js` (AES-128-ECB/ZeroPadding);
  **没有现成的 base64 编码器** (`net.js` 只有解码 `b64ToBytes`)。
  工作区 `h3c-imc.js` 自带 `b64Encode`/`b64Decode`/`percentDecode`/`utf8*`, 这是正确做法。

### 6.2 本协议需要/不需要的密码学能力

| 能力 | 是否需要 | 说明 |
|---|---|---|
| base64 编码 (密码) | **需要** | 纯 JS 约 40 行, 已实现 |
| percent 编解码 (参数/响应) | **需要** | `encodeURIComponent` 在 QuickJS 可用; 自定义 percentDecode 更稳 (保留字节) |
| AES / RSA / SM 系 | **不需要** (观测形态) | 除非 §2.4 的版本风险成真 (届时只有 AES-128-ECB 可用) |
| JSON | 需要 | QuickJS 原生 |

### 6.3 传输层能力对照 (关键)

| 能力 | 基线 `67d8799` | 取证时工作区 (未提交) | 对本协议的影响 |
|---|---|---|---|
| POST 表单 body | ❌ `panet.cpp::httpFetch` 硬编码 `Content-Length: 0`, body 恒空 | ✅ `request(url, method, timeout, body, headerText)`, 支持表单 body (≤64KB) | **登录/心跳/下线都必须 POST 表单** → 基线不可能实现, 必须改原生 |
| 自定义请求头 | ❌ 只有硬编码 `User-Agent`/`Accept` | ✅ `headerText` 传 `"Name: value\r\n"` 多行, 过滤 Host/Content-Length/Connection 与 CRLF 注入 | `Referer`/`Origin`/`Cookie` 需要它 (虽非严格必需, 建议带) |
| Cookie 自动保持 | ❌ 无 cookie jar | ❌ 无 (仍是每次独立请求) | 适配器自己从响应 `headerLines` 抠 `set-cookie`, 合并进 `state.cookie` 后逐请求手动带 |
| 读取响应头 | ✅ `headers:["Name: value"...]`, `net-core` 归一成小写 map + `headerLines` | 同 | 取 `Set-Cookie`/`Content-Type`/`Location` 没问题 |
| HTTPS/TLS | ❌ `panet.cpp` 直接 `throw "https not supported, use http"` | ❌ 未变 | **目标网络是 `http://…:8080`, 可用**; 其它 iMC 用 HTTPS 的部署 (BLOG 就是 `https://…:8443` 自签证书) 当前**不支持** |
| 跟随 302 | ❌ 设计上不跟随 (连通性检测要看 `Location`) | ❌ 未变 | 登录/心跳需直回 200; **[推]** 若某版本登录后 302, 需按 `Location`+`Set-Cookie` 另判成功 |
| gzip/deflate | ❌ 不发送 `Accept-Encoding`, 不解压 | ❌ 未变 | **保持不发送** `Accept-Encoding`; 不要加, 否则可能拿到压缩体 |
| keep-alive | ❌ 每次 `Connection: close` | ❌ 未变 | 性能可接受; 心跳 30s 一次, 每次新建 TCP |
| 超时 | `timeoutSec` 3–60, 越界回落 8 | 同 | 登录给 10s, 心跳 8s 足够 |
| 并发/abort | 由 `net-core.raceTimeout` 兜底, 适配器层无 abort | 同 | 迟到结果由框架 generation token 拦截 |

- **CVI 平台** (`services/platform/net-cvi.js`): 该平台走固件 `$falcon.jsapi.http/net`
  之类的探测式调用, 已经会把 `headers`/`body` 透传 (`payload.headers` / `payload.data`),
  但**固件是否真的支持 POST body/自定义头未知** (探测注释明确写了“没有 http 模块, 能力在
  falcon 运行时里”) → 需要真机验证。
- **纯 JS 能完成的步骤**: 取门户页 (GET)、页面配置提取、参数构造、所有编解码、响应解析、
  状态归一。**必须靠原生传输层**: 登录/心跳/下线的 POST 表单 + 自定义头。
  结论: **本协议适配器 = 纯 JS 逻辑 + “POST body/自定义头”这一项原生能力**;
  该能力已在本工作区补上, 但**只有在目标固件实际加载到新版 `.so` 后才可用**。
  **[推]** 旧 `.so` 会静默忽略第 4/5 个参数 (新 `net.js` 确实传 5 参, 但旧 `.so` 的 `request()`
  只读前 3 个), 因此登录时表单 body 与 Referer/Cookie 头发不出去, 只剩 query 串;
  目标 iMC 是否接受 query 传参**未在真机验证**, 见 §7-15。

### 6.4 960×266 界面

**[证]** 不需要 UI 改动: 登录表单/状态/日志都是框架通用组件, 适配器只提供协议。
唯一可见差异: 没有 `listDevices` 时不显示“设备管理”入口 (符合预期)。

---

## 7. 不确定性清单 (必须真机/真网验证)

以下每一条都可在适配器日志/抓包中判定。建议按顺序做, 一次只改一个变量。

| # | 待验证点 | 默认假设 (当前实现) | 可判定的观测方法 |
|---|---|---|---|
| 1 | 目标 iMC 版本的登录参数 (尤其 `customPageId`/`pwdMode`/`dcPwdNeedEncrypt`/`assignIpType`) | 发超集, `customPageId` 取页面值回退 `1` | 在电脑浏览器打开同一门户页, F12 抓一次真实登录, 逐字段对比适配器请求; 差异写进日志 |
| 2 | `portalProxyIP` / `portalProxyPort` 的真实值 | 页面提取, 回退 `serverBase` host + `50200` | 对比 §7-1 抓包值; 日志打印“提取值/回退值” |
| 3 | `Referer` / `Origin` / `Cookie` 是否必需 | 都带上, 但缺了也能成功 | 对照实验: 去掉某一头再登录, 看 `errorNumber` |
| 4 | 密码是否就是 `base64(密码)` | 是 | 抓包 `userPwd` vs `base64(密码)` 字节级对比 |
| 5 | 登录响应是否 200 + base64 JSON | 是 | 日志打印 `statusCode`、`Content-Type`、body 前 64 字节 |
| 6 | 失败时 `errorNumber` 是 `7` 还是 `-1` | 两者都处理 | 故意错密码/错账号, 记录完整解码 JSON |
| 7 | “已在线”返回形态 | `7`+`portServErrorCode=1`/“设备拒绝请求” | 已在线状态下再点登录, 记录返回。**最终实现不依据页面在线标志隐藏表单** (只写日志), 避免重演 v1.1.3 误藏表单事故 |
| 8 | 心跳成功判据 | 200 + (空 或 含 `v_failedTimes=0`) | 抓一次心跳响应原文; 停心跳 5–10 分钟看是否被踢 |
| 9 | `serialNo` 是否需要每次递增 | 固定用登录返回值 | 固定值保活 10 分钟正常即假设成立; 若被踢, 改为每次 `+1` 重试 |
| 10 | 心跳周期上限 | `heartBeatCyc` (60s); 框架 30s | 看 `heartBeatTimeoutMaxTime` 与服务端踢线时间; 30s 稳定即可 |
| 11 | 下线参数最小集 | `language/userip/basip` (+`appRootUrl`) | 下线后立刻访问外网确认被拦; 失败再换“登录参数形态 + `hello2=true`” |
| 12 | 是否有独立设备管理/自服务页 | 没有 | 登录后门户页搜“设备管理/在线终端/自助服务”, 抓链接 host/端口 |
| 13 | 门户是否 HTTPS | 本网络 HTTP | 看 `portalPage` scheme; `https` 则当前原生层直接不支持 |
| 14 | 是否出现验证码 / 动态口令 / 短信 | 没有 | 门户页出现 `<img …captcha>`、`loginVerifyCode` 非空、动态密码输入框 → 属阻塞条件, 上报 |
| 15 | 旧 `.so` 是否被替换 | 新版 `.so` 生效 | 首条网络日志 `传输通道=panet` 之外, 看登录请求服务端是否收到 body (拿不到服务端日志时: 用 §7-5 的响应区分) |
| 16 | 页面编码 (GB2312/UTF-8) | 只解析 ASCII 变量名 | 页面 `charset` 与中文是否乱码; 变量名/数字都是 ASCII, 不受影响 |

**建议的真机取证命令** (在能连该 WiFi 的电脑上跑, 值按目标网络替换):

```bash
# 1) 取门户页 + 响应头 (看 Set-Cookie / 页面里 portalProxyIP 等)
curl -sv "http://10.65.x.x:8080/portal/?userip=10.65.x.x&userurl=http://connect.rom.miui.com/generate_204" \
     -o /tmp/portal.html 2>/tmp/portal.hdr
grep -Eo 'portalProxyIP[^,;]{0,40}|portalProxyPort[^,;]{0,20}|appRootUrl[^,;]{0,80}|customPageId[^,;]{0,20}|imc_portal_function_[A-Za-z]+' /tmp/portal.html

# 2) 登录 (密码 base64 后必须 URL 编码; 下面用 --data-urlencode 自动处理, 注意顺序)
PWD_B64=$(printf '%s' '你的密码' | base64)
curl -s "http://10.65.x.x:8080/portal/pws?t=li" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Referer: http://10.65.x.x:8080/portal/index_default.jsp' \
  -H 'Origin: http://10.65.x.x:8080' \
  -H 'Cookie: hello1=你的账号; hello2=false; i_p_c_op=false; i_p_c_un=你的账号' \
  --data-urlencode "userName=你的账号" \
  --data-urlencode "userPwd=$PWD_B64" \
  --data-urlencode 'language=Chinese' \
  --data-urlencode 'customPageId=1' \
  --data-urlencode 'pwdMode=0' \
  --data-urlencode 'portalProxyIP=10.65.x.x' \
  --data-urlencode 'portalProxyPort=50200' \
  --data-urlencode 'dcPwdNeedEncrypt=1' \
  --data-urlencode 'assignIpType=0' \
  --data-urlencode 'appRootUrl=http://10.65.x.x:8080/portal/' \
  -o /tmp/login.b64
base64 -d /tmp/login.b64 | python3 -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read()))'

# 3) 心跳 (用登录返回的 userDevPort/userStatus/serialNo 与 portalLink)
curl -s "http://10.65.x.x:8080/portal/page/doHeartBeat.jsp" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H "Referer: http://10.65.x.x:8080/portal/page/online_heartBeat.jsp?pl=<portalLink原值>&custompath=&uamInitCustom=0&uamInitLogo=H3C" \
  -H 'Cookie: hello1=你的账号; hello2=false' \
  --data-urlencode 'userip=' --data-urlencode 'basip=' \
  --data-urlencode 'userStatus=99' \
  --data-urlencode 'userDevPort=<userDevPort>' \
  --data-urlencode 'serialNo=<serialNo>' \
  --data-urlencode 'language=Chinese' \
  --data-urlencode 'e_d=' --data-urlencode 't=hb'

# 4) 下线
curl -s "http://10.65.x.x:8080/portal/pws?t=lo" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'language=Chinese' --data-urlencode 'userip=' --data-urlencode 'basip='
```

---

## 8. 适配器接口映射建议

接口契约见 [ADAPTER.md](../ADAPTER.md)。本协议的映射:

| 适配器成员 | 本协议行为 | 请求 | 归一化 |
|---|---|---|---|
| `id` / `name` | `h3c-imc` / `H3C iMC 认证` | — | — |
| `keepAlive` | **`true`** (本协议独有: 登录成功后必须持续心跳) | — | 框架据此在“已认证”后继续跑 `queryStat`。**仅应用在主页前台时有效**: `onHide` 会暂停心跳, 回前台 (`onShow`, 状态仍为已认证) 自动恢复; 从日志/关于页返回也恢复。适配器无设备管理能力时框架不会自动跳管理页 (避免跳转停心跳且误报)。 |
| `match(ctx)` | 评分 | — | `params.userip`+`params.userurl` 同时存在 **+70**; 只有一个 +25; `portalPage` 含 `/portal/` **+10**; 附加参数 `basip/usermac/wlannasid/wlanssid` 各 +5 (上限 15); `snippet/pageTitle` 含 `h3c|imc` **+15**; 响应头 `server/x-powered-by` 含 `imc|h3c` **+10**。不用“门户认证/上网认证”等泛词; 按 params 的 key 判 `userip`, 避免 `wlanuserip=` 子串把 Panabit 误判成 H3C |
| `loadConf(serverBase, p, state)` | 取门户页 + 解析运行时配置 | `GET {serverBase}/portal/?<p 的全部参数>` | **只返回 `ready` / `manual`**: 能取到正常 HTML (非 4xx、长度≥32) → `ready`; 连不上/HTTP 4xx/内容过短 → `manual` (不校验“像门户页”的特征, 只做可达性判断)。**刻意不返回 `free`** (能走到这里说明网络正被门户拦截; 真免认证时框架连通性检测已判 free; 误报 free 会隐藏登录表单)。`state` 写入 `referer`、`cookie`、`conf{portalProxyIP,portalProxyPort,customPageId,pwdMode,dcPwdNeedEncrypt,assignIpType,appRootUrl,language}`、`pageUserip` |
| `login(serverBase, o)` | ① 刷门户页 (会话/Cookie/配置) ② POST `pws?t=li` ③ 解码判定 | 见 §1.3 | `errorNumber=1` → `{ok:true, code:1}`, 写 `state.hb`, 停 800ms 让框架复查连通性; 已在线 (§3.6) → `{ok:true, code:200}`; 永久失败 → `{ok:false, msg: §3.4 文案, code: 失败码}`; 可重试类 → 刷新页面后重试一次, 仍失败返回 `{ok:false}`。登录表单 `userip` 发空值 (NAS 按源地址识别) |
| `queryStat(serverBase, {params,state})` | 心跳 `doHeartBeat.jsp` | 见 §4.3 | **成功返回 `{ok:true, stat:0}`**; 失败 `{ok:false}`; 无 `state.hb` 时 `{ok:false}`。按 `heartBeatCyc*0.6` 节流。⚠️ 不要返回非 0 的 `stat`: 框架把 `stat!=0` 解释为“已在别处认证”并**停心跳** |
| `logout(serverBase, {params,state})` | `pws?t=lo` | 见 §5.1 | `errorNumber=1` → `ok:true`; `errorNumber=7` → 视为“已下线/无需下线” `ok:true` **[推]**; 清 `state.hb` |
| `sync(serverBase, {ip}, state)` | 服务器可用性探测 | `GET` 门户页 | `ok`/失败, 无副作用 |
| `listDevices` / `offOne` / `offAll` | **不实现** (§5.2) | — | 不导出, 界面不显示入口 |
| `authType/sceneStr` 写回 | 不需要 | — | 本协议没有类似 Panabit `scene_str` 的会话参数; `state` 只需 `hb`/`conf`/`cookie`/`referer` |

`state` 生命周期提醒: 框架持有 `state` 对象, 适配器**不要**在模块级保存可变状态 (跨登录残留)。
`state.hb` 是登录与心跳之间唯一的纽带, 登录失败/下线/心跳连续失败时要清掉它。

### 8.1 与本协议无关的框架项

- 迟到结果由框架 generation token 拦截, `login()` 不需要自己防抖。
- 心跳间隔由框架固定 30s (`index.vue::startHeartbeat`), 适配器不建定时器;
  实际发送间隔由适配器按 `heartBeatCyc` 节流 (见 §4.4)。
- 页面/UI 不出现协议分支, 文案由适配器归一成中文。

---

## 9. 最终实现对照 (已按本文修正)

> 取证期间工作区已有一份 `h3c-imc.js` 草稿; 本文完成后已按 **[证]** 结论修正。
> 下面是最终代码与本文的对照, 后续维护者改协议前请先读本节。

**已落实的修正**:

1. `failMsg` 码表按 §3.4 全量对齐 (63013 黑名单 / 63015 用户失效 / 63018 用户不存在 /
   63024 端口绑定 / 63025 MAC 绑定 / 63026 静态 IP 绑定 / 63027 时段限制 /
   63031 密码错+黑名单 / 63032 密码错 / 63048 设备 IP 绑定 / 63073 场景不允许 /
   63100 无效客户端版本 / 63634 绑定数超限); 服务器原文可取到时优先原文。
2. 登录表单 `userip` 发**空值** (参考实现 BLOG/GO/TUN 均空, NAS 按报文源地址识别);
   `portalProxyIP` 回退门户 host 而不是本机 IP; `portalProxyPort` 回退 `50200`。
3. **不再依据页面在线标志判已在线**: 在线标志只写日志 (`pageLooksOnline` 仅用于诊断),
   `loadConf` 只返回 `ready`/`manual`, 不隐藏登录表单 (§3.6-2 / §7-7, 规避 v1.1.3 同类事故)。
4. 心跳: 按 `heartBeatCyc*0.6` 节流; 参数 **query+body 双写** (兼容旧 `.so`);
   `Referer` 带
   `page/online_heartBeat.jsp?pl=<portalLink>&custompath=&uamInitCustom=0&uamInitLogo=H3C`;
   `Cookie` 带 `hello1=<账号>`; body 含 `e_d=`; 成功恒返回 `stat:0`;
   失败**连续 3 次**才清 `state.hb` (单次网络抖动不清, 与 §4.5 一致) (§4.3~§4.5)。
5. `logout()` 走 `POST pws?t=lo`; 失败只提示不阻断; `errorNumber=7 → ok` 仍是 **[推]** (§5.1)。
6. 登录参数 **query+body 双写**, 密码 `base64` 后再 URL 编码; `usermac` 发送空值
   (未使用 `"null"` 字面量, 待真网对比, §2.1)。
7. 诊断日志写入 `wifi.log`: `[H3C] 取门户页 … / 登录 POST pws?t=li … / 登录返回 … errorNumber=… /
   心跳失败 … / 下线返回 …`, 可按 §7 逐项取证。
8. “已在线”判定: 登录返回 `errorNumber=7 + portServErrorCode=1`、或描述含
   `设备拒绝请求|already|online|已在线|已经在线|已认证` (含 `errorNumber=-1` 形态) 均归一化为
   `code 200`; 其余 `-1` 按失败提示 (见 §3.6)。
9. `sync()` (服务器可用性探测) 只发门户页 GET; 无设备管理能力, 不导出
   `listDevices`/`offOne`/`offAll`。
10. **中文解码**: percent 解码后的字节按 UTF-8 还原 (`utf8Decode(latin1ToBytes(...))`),
    避免 JSON 结构合法但中文乱码; 适配器测试覆盖 base64+percent 中文链路。
11. **Cookie 规范化**: 只取 `Set-Cookie` 的 `name=value`, 过滤 `Path/Expires/HttpOnly/...`
    属性; `headerLines` 已取到时不追加 map 里的整条 (避免把属性当 Cookie 发送)。
12. **`portServErrorCode` 2/3**: 语义未证实 → 不判成功、不判永久失败; 文案降级为
    “含义未证实/会话已失效”, 刷新会话重试一次 (§3.3)。
13. `failMsg` 兼容 `errorDescription` 字段 (SH/TUN 形态) 与 `e_c/e_d` 间接索引;
    心跳/下线的请求结果都写 `[H3C]` 诊断日志。
14. `logout()` 用最小参数集 (`language/userip(空)/basip/appRootUrl`), 与 §5.1 建议一致。
15. **心跳只在主页前台有效**: `onHide` 暂停, 回前台 (`onShow`, 状态仍已认证) 自动恢复;
    适配器无设备管理能力时框架不自动跳管理页, 从而不会在登录成功后误停心跳。

**仍属 [推] / 必须真网验证** (与 §7 一致): 页面变量名与
`portalProxyIP`/`portalProxyPort`/`customPageId` 的提取正则; `Referer`/`Origin`/`Cookie`
是否必需; 心跳成功判据是否需 `v_failedTimes=0`; `serialNo` 是否递增; 下线最小参数集;
旧 `.so` 只发 query 时能否被目标 iMC 接受 (兼容兜底, 未验证)。

**明确不在本适配器范围**: `listDevices`/`offOne`/`offAll` (iMC 门户无该接口, §5.2);
HTTPS 门户 (原生层不支持 TLS, §6.3); 验证码/短信/动态口令 (ADAPTER.md 的阻塞条件)。

---

## 10. 本地模拟真机验证 (2026-11-13)

**目的**: 在不进入校园网的前提下, 用本地 mock 门户在 X6PRO 真机上跑通适配器全流程
(旧版 `.so` 的兼容路径 + QuickJS 运行时 + 框架集成)。

**拓扑**:
- PC 跑 `_work/mock-h3c-portal.mjs` (监听 `<本机IP>:80`): 未认证时对三个 `generate_204`
  探测域名返回 302 → `http://<本机IP>/portal/?userip=..&userurl=..`; 认证后返回 204/200 模拟放行。
  门户端点: `GET /portal/` (含 `portalProxyIP` 等运行时配置) / `POST /portal/pws?t=li` /
  `POST /portal/page/doHeartBeat.jsp` / `POST /portal/pws?t=lo`。
- 笔: 临时把 `/etc/hosts` 的探测域名指向 PC (`/etc/hosts` 是独立 ext4 可写分区), 测完已还原。
- 安装包: 本地构建的 1.2.0 RK AMR (含旧版 `libjsapi_panet.so`)。

**实测结果 (真机日志 + 服务端日志)**:

| 步骤 | 观测 | 结论 |
|---|---|---|
| 检测 | `[检测] status=portal page=http://<本机IP>/portal/?userip=..&userurl=..` | 302 门户识别正常 |
| 自动识别 | `[适配器] 自动识别 h3c-imc score=80` | match 评分生效, 未误判 |
| 取门户页 | `[H3C] 取门户页 status=200 len=610 cookie=无 proxy=<本机IP> ip=-` | loadConf + 页面配置提取正常 |
| 登录 | 服务端收到 `POST /portal/pws?t=li&userName=..&userPwd=..` (**仅 query**, body 空、无 Cookie/Referer) | 旧 `.so` 兼容路径成立, 参数双写有效 |
| 登录响应 | `[H3C] 登录返回 status=200 errorNumber=1` → `[登录] 结果 code=1 msg=认证成功` → `[复查] free` | 解码/归一化/框架流程正确 |
| 失败文案 | 错误账密时真机显示 `账号或密码错误 (E63032:密码错误，您还可以重试4次。)` | 63032 映射 + 中文还原正确 |
| 心跳 | 服务端每 30s 收到 `POST /portal/page/doHeartBeat.jsp?userip=&basip=&userStatus=99&userDevPort=..&serialNo=1001&language=Chinese&e_d=&t=hb` | `keepAlive` 生效; 心跳 query 双写补丁已验证 |
| 下线 | `POST /portal/pws?t=lo` → `[H3C] 下线返回 status=200 errorNumber=1` → 重新检测回 portal | 下线链路正确 |
| 设备管理 | 成功页无"设备管理"入口, 日志无管理页跳转 | `_autoManage` 修复 (无 listDevices 不跳页) 真机确认 |
| 心跳失败降级 | 停掉 mock 后日志出现 `[H3C] 心跳失败 ... errno=111`, 3 次后停止保活 | 失败计数/清理逻辑生效 |

**这次模拟未覆盖**:
- 新版 `libjsapi_panet.so` (POST body + Referer/Cookie): 本机无 aarch64 交叉工具链, 无法编译;
  真机模拟跑的是旧 `.so` 的 query 兜底路径。
- 真实 iMC 的门户页变量名/参数值/心跳判据: 需在校园网真机按 §7 验证。
- 认证后的真实放行: mock 只模拟 204/200, 未验证校园网真实 ACL。

**证据文件** (`_work/`, 不入库): `mock-h3c-portal.mjs`、`mock-portal.log`、
`pen-wifi.log`、`pen-shot*.png`。

## 11. 参考来源

官方文档 / 厂商知识库:

- H3C Portal 命令参考 (EN, `url-parameter` / `if-match` / `portal web-server`):
  [08-Portal commands](https://www.h3c.com/en/Support/Resource_Center/EN/Home/Wireless/00-Public/Reference_Guides/Command_References/H3C_Access_Controllers_CR-R5456/13/202211/1714837_294551_0.htm)
- H3C Portal 命令参考 (CN, `1.1.164 url-parameter`, 明确 iMC 支持 `userurl`/`userip`/`usermac`):
  [Portal 命令](http://www.h3c.com/cn/d_202212/1742755_30005_0.htm)
- H3C KMS: Portal 认证报文/端口与 iMC 部署排查 (提到 UDP 50100/50200/2000):
  [Portal认证报错向设备发送请求超时](https://kms.h3c.com/questions/dispcont/292878)
- H3C KMS: `E63100:无效认证客户端版本`:
  [链接](https://kms.h3c.com/questions/dispcont/292019)
- H3C KMS: `E63025:Failed to Check MAC address binding`:
  [链接](https://kms.h3c.com/questions/dispcont/87474)

公开实现 (本文的主要交叉验证材料):

- 抓包分析博客 + 完整参数表/返回样例:
  [暨南大学珠海校区有线网认证分析及Golang实现](https://0x2a.in/blog/posts/jnu_network/)
- Go 实现 (登录/心跳/解码容错/已在线处理):
  [Steve0x2a/JNU_ZH_Network](https://github.com/Steve0x2a/JNU_ZH_Network)
- Shell 实现 (最小参数集、`portalLink` 解码、心跳 Referer/Cookie、630xx 码表):
  [Howard20181/Shell-H3C-Portal](https://github.com/Howard20181/Shell-H3C-Portal)
- Shell BYOD 版本 (同一 iMC 的 BYOD 协议, 对比用):
  [Howard20181/Shell-H3C-BYOD](https://github.com/Howard20181/Shell-H3C-BYOD)
- Electron 工具 (登录/下线/心跳三接口、`errorDescription`):
  [yaoing/iMC-Tunnel](https://github.com/yaoing/iMC-Tunnel)
- 老版登录/下线脚本 (`pws?t=gpurl`、`pws?t=lo`):
  [disassembly/H3c_Portal-login-logout](https://github.com/disassembly/H3c_Portal-login-logout)
- 更老版本 (`index_default.jsp` 取 Cookie、心跳 `pws?t=hd`):
  [xiyouant/H3C_Auto_regist](https://github.com/xiyouant/H3C_Auto_regist)

本仓库相关文件:

- 适配器接口契约 / 阻塞条件: [ADAPTER.md](../ADAPTER.md)
- 传输层归一化: [`ui/src/services/net-core.js`](../ui/src/services/net-core.js)、
  [`ui/src/services/net.js`](../ui/src/services/net.js)、
  [`native/panet/panet.cpp`](../native/panet/panet.cpp)
- 门户识别: [`ui/src/services/detect.js`](../ui/src/services/detect.js)
- 本协议适配器: [`ui/src/services/portal-adapters/h3c-imc.js`](../ui/src/services/portal-adapters/h3c-imc.js)
- 心跳驱动的框架逻辑: [`ui/src/pages/index/index.vue`](../ui/src/pages/index/index.vue) (`startHeartbeat` / `_keepAlive`)
