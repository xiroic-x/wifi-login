# 文档索引

> 返回 [README](../README.md)

| 文档 | 内容 | 读者 |
| --- | --- | --- |
| [README](../README.md) | 功能、支持机型、安装、使用、常见问题、用户群 | 使用者 |
| [ADAPTER](../ADAPTER.md) | 适配器接口契约 + 从认证页到上线全流程 | 适配器开发者 |
| [SKILL](../SKILL.md) | 配套 skill：分析认证页 → 产出适配器 | 用 AI 开发时 |
| [project](project.md) | 工程结构、两平台产物、CI 构建、本地构建、测试、发版 | 维护者 |
| [external-api](external-api.md) | 外部调用参数、回调字段、数据与日志位置、日志标签 | 集成方 / 排障 |
| [panabit-api](panabit-api.md) | Panabit Portal 协议（端点 / 参数 / 返回码 / 密码加密） | 适配器开发者 |
| [h3c-imc-portal](h3c-imc-portal.md) | H3C iMC Portal 协议取证与真机实验记录 | 适配器开发者 |
| [cvi-jsapi-http](cvi-jsapi-http.md) | 32 位固件 `$falcon.jsapi.http` 实测记录 | 平台层维护者 |
| [feedback-api](feedback-api.md) | BUG 反馈服务接口契约（官网与工单） | 反馈服务维护者 |
| [CHANGELOG](../CHANGELOG.md) | 逐版本变更 | 所有人 |

## 按问题找文档

| 我想… | 看这里 |
| --- | --- |
| 装到设备上 / 从设置进清理页 | [README](../README.md) 的「安装」「使用」 |
| 新认证系统（校园网 / 企业门户） | [ADAPTER](../ADAPTER.md)、[panabit-api](panabit-api.md)、[h3c-imc-portal](h3c-imc-portal.md) |
| 排障：为什么显示「无需登入」/ 登不上 | [README](../README.md)「连通性判定」+ [external-api](external-api.md) 日志标签 |
| 32 位机型网络/存储怎么走 | [cvi-jsapi-http](cvi-jsapi-http.md) |
| 改代码 / 加页面 / 发版 | [project](project.md) |
| 从别的小程序拉起本应用 | [external-api](external-api.md) |

