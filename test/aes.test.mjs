// 本地验证: paAesEncode/paAesDecode 与 Node crypto aes-128-ecb (ZeroPadding) 对照
import { createCipheriv, createDecipheriv } from 'crypto'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
let src = readFileSync(join(here, '..', 'ui', 'src', 'services', 'aes.js'), 'utf8')
// 把 ESM export 转成可在 Node 直接 eval 的形式
src = src.replace(/export function/g, 'function').replace(/export var/g, 'var')
const mod = new Function(src + '\nreturn { paAesEncode, paAesDecode, utf8Encode, utf8Decode };')()

const KEY = Buffer.from('Panabit@1024_key', 'utf8')

function nodeZeroPad(buf) {
  const rem = buf.length % 16
  if (rem === 0) return buf
  return Buffer.concat([buf, Buffer.alloc(16 - rem)])
}
function nodeEncryptZero(text) {
  const data = nodeZeroPad(Buffer.from(text, 'utf8'))
  const c = createCipheriv('aes-128-ecb', KEY, null)
  c.setAutoPadding(false)
  return Buffer.concat([c.update(data), c.final()]).toString('hex')
}
function nodeDecryptZero(hex) {
  const d = createDecipheriv('aes-128-ecb', KEY, null)
  d.setAutoPadding(false)
  const out = Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()])
  let end = out.length
  while (end > 0 && out[end - 1] === 0) end--
  return out.subarray(0, end).toString('utf8')
}

const cases = [
  'abc',
  '',
  '1234567890123456',
  '17bytes_password',
  '中文密码123',
  'user@example.com:P@ss w0rd!"#$%',
  'a'.repeat(100),
]

let fail = 0
for (const text of cases) {
  const mine = mod.paAesEncode(text)
  const ref = nodeEncryptZero(text)
  const okEnc = mine === ref
  const dec = mod.paAesDecode(mine)
  const okDec = dec === text
  const refDec = nodeDecryptZero(ref) === text
  if (!okEnc || !okDec || !refDec) fail++
  console.log(
    `${okEnc && okDec ? 'PASS' : 'FAIL'} len=${Buffer.byteLength(text, 'utf8')} enc=${okEnc} dec=${okDec} text=${JSON.stringify(text.length > 24 ? text.slice(0, 24) + '…' : text)}`
  )
  if (!okEnc) {
    console.log('  mine:', mine.slice(0, 48))
    console.log('  ref :', ref.slice(0, 48))
  }
}

// 图形验证码解码路径: node 加密 -> 我们解密
const captcha = 'a7X9'
const encCaptcha = nodeEncryptZero(captcha)
const decCaptcha = mod.paAesDecode(encCaptcha)
console.log(`${decCaptcha === captcha ? 'PASS' : 'FAIL'} captcha roundtrip: ${decCaptcha}`)
if (decCaptcha !== captcha) fail++

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`)
process.exit(fail === 0 ? 0 : 1)
