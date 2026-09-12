// 本地验证: detect.js 的 extractRedirect / parsePortalUrl 纯逻辑
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
let src = readFileSync(join(here, '..', 'ui', 'src', 'services', 'detect.js'), 'utf8')
// 去掉依赖固件 http 模块的 import 与联网函数 (checkPortal), 只测纯逻辑
src = src.replace(/^import .*$/m, '')
const start = src.indexOf('export async function checkPortal')
const end = src.indexOf('/* 单个响应分类')
if (start < 0 || end < 0 || end < start) throw new Error('strip markers not found')
src = src.slice(0, start) + src.slice(end)
const { extractRedirect, parsePortalUrl } = await import(
  'data:text/javascript;base64,' + Buffer.from(src).toString('base64')
)

let fail = 0
function expect(name, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`}`)
}

// Panabit 302 Location 透传形态 (出现在 body 里的完整 URL)
const pa302 = extractRedirect(
  `<html><body>Redirecting... <a href="http://192.168.3.12:8080/portal.html?wlanuserip=192.168.50.11&clientip=192.168.50.11&wlanacname=Panabit&clientmac=aa:cc:09:c5:19:be&paip=192.168.3.12&vlan=0.0&iarmdst=cits.panabit.com/">go</a></body></html>`
)
expect('panabit href url', pa302, 'http://192.168.3.12:8080/portal.html?wlanuserip=192.168.50.11&clientip=192.168.50.11&wlanacname=Panabit&clientmac=aa:cc:09:c5:19:be&paip=192.168.3.12&vlan=0.0&iarmdst=cits.panabit.com/')
const info = parsePortalUrl(pa302)
expect('host', info.host, '192.168.3.12')
expect('port', info.port, '8080')
expect('base', info.base, 'http://192.168.3.12:8080')
expect('wlanuserip', info.params.wlanuserip, '192.168.50.11')
expect('clientmac', info.params.clientmac, 'aa:cc:09:c5:19:be')
expect('paip', info.params.paip, '192.168.3.12')
expect('vlan', info.params.vlan, '0.0')

// meta refresh 形态
const meta = extractRedirect(`<head><meta http-equiv="refresh" content="1;URL=http://10.0.0.55/portal.html?wlanuserip=10.0.0.9&paip=10.0.0.55"></head>`)
expect('meta refresh', meta, 'http://10.0.0.55/portal.html?wlanuserip=10.0.0.9&paip=10.0.0.55')
expect('meta host', parsePortalUrl(meta).base, 'http://10.0.0.55')

// JS 跳转形态
const js = extractRedirect(`<script>window.location.href='http://portal.school.edu.cn:80/auth.html?wlanuserip=172.16.1.20';</script>`)
expect('js location', js, 'http://portal.school.edu.cn:80/auth.html?wlanuserip=172.16.1.20')
expect('default port base', parsePortalUrl(js).base, 'http://portal.school.edu.cn')

// 无端口/默认80
expect('no port', parsePortalUrl('http://1.2.3.4/x').base, 'http://1.2.3.4')
expect('no port param', parsePortalUrl('http://1.2.3.4/x').port, '80')

// 空内容
expect('empty body', extractRedirect(''), '')
expect('no url body', parsePortalUrl(''), { host: '', port: '', base: '', params: {} })

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`)
process.exit(fail === 0 ? 0 : 1)
