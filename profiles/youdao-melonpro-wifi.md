# 设备画像: youdao-melonpro-wifi

profile_id: youdao-rk3562-melonpro-wifi
model: 有道词典笔 (RK3562, 主机名 YoudaoDictionaryPen-215, 项目代号 melon_pro)
firmware: Buildroot 2021.11, 内核 Linux 5.10.160 (aarch64), miniapp 运行时 2.3.4 系
adb 标识: product:occam / model:Nexus_4 / device:mako (伪装, 勿依赖)

runtime:
  falcon: libfalcon.so 6.1MB (内置 http / storage 模块)
  quickjs: 20200705
  jsapi 扩展: /etc/miniapp/jsapis/libjsapi_export.so
    - global (JSGlobalProxy: startTextEdit / closeTextEdit / textEditFinished) ✔ 已验证存在于固件
    - wifi (JSWifiProxy: isConnected / getWifiQual / 断开等, 无 IP 查询)
    - camera / bluetooth / volume / brightness / systemInfo / batteryInfo ...
    - 无 misc (gbk_to_utf8 不可用 → 服务端 GB2312 中文用错误码本地映射代替)
    - 无 nm (设备 IP 不可查询 → portal 参数以服务器下发的跳转参数为准)
  输入法: 系统级 mini-app "有道输入法" (appid 8001666679481944, category IM_PANEL_DICT)

screen:
  physical: { width: 960, height: 266, direction: 270, xoffset: 0, yoffset: 107 }
  design: { width: 960 }
  touch: { tp_direction: 270, tp_xoffset: 113, tp_yoffset: 0 }
  触控换算 (display → send_event): touchX = displayY + 107, touchY = 959 - displayX

package:
  appid: "8001865309000001"
  version: 0.1.0
  start_page: index  (固件实测: miniapp_cli start <appid> 不带 --page 才进主页)
  安装: adb push <app>.amr /userdisk/ && miniapp_cli install /userdisk/<app>.amr

validation:
  tested_at: ""
  evidence:
    - /etc/miniapp/resources/cfg.json (960x266, direction 270)
    - miniapp_cli --help (14 子命令, 无 injectKey/setRenderConfig)
    - strings libjsapi_export.so → startTextEdit/textEditFinished 存在
    - strings libfalcon.so → http / storage 模块名存在
    - AES 实现对照 Node crypto ALL PASS; detect 解析 ALL PASS (test/)
  untested:
    - http JSAPI 实际返回包装形态 (ArrayBuffer vs {statusCode,headers,data})
    - http 是否自动跟随 302 / 是否暴露 Location
    - global.startTextEdit 返回 UUID 形态与 textEditFinished 回调字段
    - 真实 Panabit portal 的 user_login 全流程
