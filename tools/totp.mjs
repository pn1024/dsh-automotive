#!/usr/bin/env node
/**
 * 本地 TOTP 验证码生成器（不依赖手机与第三方 App）
 *
 * 用途：GitHub 强制 2FA 后，用「验证器应用」方式设置时，
 * GitHub 会显示一个二维码和一段 "setup key"（Base32 密钥）。
 * 把那段密钥存下来，之后用本脚本生成 6 位验证码即可登录，不需要装 App、不需要短信。
 *
 * 用法：
 *   node tools/totp.mjs GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ       # 打印当前验证码
 *   node tools/totp.mjs --watch GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ # 持续刷新
 *   node tools/totp.mjs --check                                  # 用 RFC 6238 测试向量自检
 *
 * 安全提示：密钥等同于第二因素，请只存在本机，不要提交到仓库或发给他人。
 */
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
  let bits = 0
  let value = 0
  const bytes = []
  for (const char of clean) {
    const index = B32.indexOf(char)
    if (index === -1) throw new Error(`不是合法的 Base32 字符：${char}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** RFC 6238：HMAC-SHA1，6 位，30 秒步长 */
export function totp(secret, { digits = 6, step = 30, at = Date.now(), algorithm = 'sha1' } = {}) {
  const key = base32Decode(secret)
  const counter = Math.floor(at / 1000 / step)
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buffer.writeUInt32BE(counter % 0x100000000, 4)
  const hmac = crypto.createHmac(algorithm, key).update(buffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(binary % 10 ** digits).padStart(digits, '0')
}

function remainingSeconds(step = 30) {
  return step - (Math.floor(Date.now() / 1000) % step)
}

function selfCheck() {
  // RFC 6238 附录 B 测试向量（种子 12345678901234567890 的 Base32）
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  const cases = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037']
  ]
  let ok = true
  for (const [epoch, expected] of cases) {
    const actual = totp(secret, { at: epoch * 1000 })
    const pass = actual === expected
    ok = ok && pass
    console.log(`  T=${epoch}  期望 ${expected}  实际 ${actual}  ${pass ? '✓' : '✗'}`)
  }
  console.log(ok ? '\n自检通过：算法与 RFC 6238 一致' : '\n自检失败')
  return ok
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--check')) {
    process.exit(selfCheck() ? 0 : 1)
  }
  const watch = args.includes('--watch')
  const secret = args.find((item) => !item.startsWith('--'))
  if (!secret) {
    console.log('用法：node tools/totp.mjs <Base32 密钥> [--watch]')
    console.log('      node tools/totp.mjs --check      # 算法自检')
    process.exit(1)
  }

  const render = () => {
    const code = totp(secret)
    const left = remainingSeconds()
    process.stdout.write(`\r验证码：${code}   剩余 ${String(left).padStart(2, ' ')} 秒   `)
    if (!watch) {
      process.stdout.write('\n')
      return false
    }
    return true
  }

  if (!render()) return
  const timer = setInterval(() => {
    if (!render()) clearInterval(timer)
  }, 1000)
  process.on('SIGINT', () => {
    clearInterval(timer)
    process.stdout.write('\n')
    process.exit(0)
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()