# 工程结构与构建

> 返回 [README](../README.md) · 文档索引 [docs/README.md](README.md)

## 工程结构

```
.github/workflows/build.yml   # CI: 交叉编译原生库 → 分别打包两平台 AMR → 打标签时发布 Release
ADAPTER.md                    # 适配器开发指南(接口契约 + 全流程)
CHANGELOG.md                  # 更新日志(发版时按版本抽取为 Release Notes)
SKILL.md                      # 配套 skill: 从认证页分析到做出适配器
docs/                         # 详细文档(见 docs/README.md 索引)
native/
  panet/panet.cpp             # 自研原生模块 panet(RK 版): 网络/文件/系统信息/wifiSsid
  panet/CMakeLists.txt        # aarch64 交叉编译
  sdk/                        # 板端 JSAPI SDK 头文件
profiles/                     # 设备画像(真机实测结论)
screenshots/                  # 截图与二维码
test/                         # 本地测试(不入库): 每套件独立进程
ui/                           # 小程序源码(aiot-vue-cli 工程)
  assets/                     # 随包发布的静态资源(构建时同步进包内 assets/)
  src/app.js                  # 启动: setViewPort(取固件配置) + 基类注册 + 兼容性/系统信息探测
  src/app.json                # 页面注册 + props(桌面入口/清理声明)
  src/base-page.js            # 页面基类: token/timer 统一释放 + 启动检查(迁移/更新提示)
  src/pages/
    index/                    # 主页: 状态卡 + 登录表单 + 认证类型 + 设备管理入口
    management/               # 设备管理: 在线列表 / 单台下线 / 全部下线
    diag/                     # 功能检测: 真实系统信息 / 固件 API / 自检 / 兼容性判定
    cleanup/ + cleanUpPage/   # 数据清理: supportCleanUp 入口页名为 cleanUp(与系统调用一致)
    migrated/                 # 迁移完成 / 更新完成提示
    about/                    # 关于: 版本 / 仓库二维码 / QQ 群二维码
  src/services/
    net.js             net-core.js      # 网络适配层 + 超时兜底/响应归一化(共享内核)
    store.js           store-core.js    # 账号存储 + 槽位/迁移逻辑(共享内核)
    detect.js          server-probe.js  # 连通性检测(并发+复核) / 认证服务器可用性
    probe.js           compat.js        # 能力探测报告 / 兼容性判定
    aes.js             ime.js           # AES-128-ECB / 系统输入法封装
    logger.js          version.js       # 运行日志 / 版本号
    qq-qr.js                           # 二维码(内联 data URI)
    platform/                          # 平台实现层(薄适配器, CI 用它覆盖同名服务文件)
      net-cvi.js  store-cvi.js  logger-cvi.js
    portal-adapters/                   # 认证适配器(MIT)
      adapter-api.js  registry.js  panabit.js  h3c-imc.js
```

**分层原则**：业务页面只消费稳定接口；协议差异在适配器，平台差异在 `platform/`；
共享内核（`net-core` / `store-core`）承载超时兜底、响应归一化、槽位与迁移逻辑。

## 两个产物

| 产物 | 覆盖机型 | 网络 | 存储 | 日志 |
| --- | --- | --- | --- | --- |
| `…-rk.amr` | X 系列（RK3562 / RK3566） | 自研 `panet` 原生库 | 文件 | 落盘 |
| `…-cvi.amr` | S / X5 / A 系列（32 位 CVITEK） | 固件 `$falcon.jsapi.http` | 固件 KV | 内存缓冲 |

CVI 版构建时用 `platform/` 实现覆盖 `services/net.js` / `store.js` / `logger.js` 并移除自研 `.so`；
页面、检测、适配器代码两平台完全一致。

## 构建（CI）

推送 `main` 或打 `v*` 标签触发 [build.yml](../.github/workflows/build.yml)：

1. 交叉编译 `native/panet`（aarch64）→ `ui/libs/libjsapi_panet.so`
2. `pnpm -C ui package`（`aiot-cli -c -q -p`）产出 RK 包
3. 覆盖平台文件 + 删 `.so` → 再打包产出 CVI 包
4. 打标签时创建 Release 并上传两个 AMR

版本号以 `ui/package.json` 与 `ui/src/services/version.js` 为准，两处需同步。

## 本地构建注意

- **Node 16/18**：`aiot-vue-cli` 依赖的旧 webpack 插件在 Node ≥ 22 会报 `No such module: http_parser`。
- 本地包**不含** `libs/*.so`（原生库由 CI 交叉编译），需要原生能力时用 CI 产物。
- 图片资源放 `ui/assets/`，构建会同步进包内 `assets/`；但 Weex `<image>` 对路径不可靠，
  界面内图片建议用内联 data URI（见 `services/qq-qr.js`）。

```sh
pnpm install -C ./ui
pnpm -C ui build      # 调试包
pnpm -C ui package    # 生产包(QuickJS)
```

## 测试

`test/` 不入库，每个 `.test.mjs` 在独立进程运行（互不干扰）：

```sh
node test/run-all.mjs     # 并行跑全部套件，时序敏感套件串行补跑
```

覆盖：连通性检测（含误报/挂起）、响应归一化（含 32 位契约）、存储槽位与迁移、
AES、模拟网关与门户、适配器参数构造与自动识别、管理页关闭流程。

## 版本与发版

1. 改 `ui/package.json` + `ui/src/services/version.js`
2. `CHANGELOG.md` 增加对应版本段
3. 打 `v<版本>` 标签推送 → CI 构建并发布 Release

