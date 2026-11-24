/**
 * 源注册表与抓取礼貌：读取 data/sources.json，提供限速、robots 检查与健康探测。
 * 目的：新增数据源只改配置，不改代码；已知抓不到的源不会反复无效重试。
 */
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.AUTO_POLICY_DATA_DIR || path.resolve(HERE, '../data')
const REGISTRY = path.join(DATA_DIR, 'sources.json')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function loadRegistry() {
  if (!fs.existsSync(REGISTRY)) return { sources: [] }
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))
}

export function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n', 'utf8')
}

export function enabledSources(registry, kind) {
  return (registry.sources ?? []).filter((source) => source.enabled && (!kind || source.kind === kind))
}

/** robots.txt 检查：返回 'allowed' | 'disallowed' | 'unknown'。只做保守判断，不做完整解析器。 */
export async function robotsVerdict(homepage, targetPath = '/') {
  try {
    const url = new URL('/robots.txt', homepage).href
    const response = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) })
    if (!response.ok) return 'unknown'
    const text = (await response.text()).toLowerCase()
    if (!text.trim()) return 'unknown'
    if (/^disallow:\s*\/\s*$/m.test(text)) return 'disallowed'
    const disallows = [...text.matchAll(/^disallow:\s*(\S+)/gm)].map((match) => match[1])
    const blocked = disallows.some((rule) => rule !== '' && targetPath.startsWith(rule))
    return blocked ? 'disallowed' : 'allowed'
  } catch {
    return 'unknown'
  }
}

/**
 * 指定曲线的 TLS GET。湖南政府网的 ECDHE 点位会让 Node/OpenSSL 报 bad ecpoint，
 * 必须把曲线钉在 prime256v1；这类站点在注册表里用 tlsProfile 标记。
 */
export function tlsGet(url, { ecdhCurve = 'prime256v1', timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const client = https.get(
      url,
      { headers: { 'user-agent': UA }, minVersion: 'TLSv1.2', ecdhCurve },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch {
            json = null
          }
          resolve({ ok: (response.statusCode ?? 0) < 400, status: response.statusCode ?? 0, text, json, bytes: text.length })
        })
      }
    )
    client.on('error', (error) => resolve({ ok: false, status: 0, text: '', json: null, bytes: 0, error: error.message }))
    client.setTimeout(timeoutMs, () => client.destroy(new Error('timeout')))
  })
}

/** 带超时与限速的 GET，返回 { ok, status, text, json }。 */
export async function politeFetch(url, { headers = {}, rateLimitMs = 1000, timeoutMs = 15000 } = {}) {
  if (rateLimitMs > 0) await sleep(rateLimitMs)
  const started = Date.now()
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': UA, ...headers },
      signal: AbortSignal.timeout(timeoutMs)
    })
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return { ok: response.ok, status: response.status, text, json, bytes: text.length, ms: Date.now() - started }
  } catch (error) {
    return { ok: false, status: 0, text: '', json: null, bytes: 0, ms: Date.now() - started, error: String(error.message ?? error) }
  }
}

/**
 * 健康探测：对每个源发一次最小请求，记录状态码、字节数与判定。
 * 判定不看“有没有报错”，而看“返回内容是否真的是可解析的数据”。
 */
export async function probe(source) {
  const started = Date.now()
  if (source.kind === 'gov-search') {
    const url = `${source.url}?t=zhengcelibrary_gw&q=%E6%B1%BD%E8%BD%A6&searchfield=title&p=1&n=1&type=gwyzcwjk&sort=pubtime&sortType=1`
    const result = await politeFetch(url, { rateLimitMs: 0 })
    const count = result.json?.searchVO?.totalCount ?? 0
    return {
      ...pick(source),
      checkedAt: new Date().toISOString(),
      httpStatus: result.status,
      bytes: result.bytes,
      verdict: result.ok && count > 0 ? 'live' : result.ok ? 'empty' : 'blocked',
      detail: result.ok ? `totalCount=${count}` : result.error ?? `HTTP ${result.status}`,
      ms: Date.now() - started
    }
  }

  if (source.kind === 'federal-register') {
    const result = await politeFetch(`${source.url}?conditions%5Bterm%5D=%22electric+vehicle%22&per_page=1&order=newest`, { rateLimitMs: 0 })
    const count = result.json?.count ?? 0
    return {
      ...pick(source),
      checkedAt: new Date().toISOString(),
      httpStatus: result.status,
      bytes: result.bytes,
      verdict: result.ok && count > 0 ? 'live' : 'blocked',
      detail: result.ok ? `count=${count}` : result.error ?? `HTTP ${result.status}`,
      ms: Date.now() - started
    }
  }

  // 需要指定 TLS 曲线的源（湖南政府网）：用 tlsGet，并按 JSONP 记录数判定。
  if (source.kind === 'cms-jsonp') {
    const result = await tlsGet(source.url, { ecdhCurve: source.tlsProfile ?? 'prime256v1' })
    const items = (result.text.match(/"pubDate"/g) ?? []).length
    return {
      ...pick(source),
      checkedAt: new Date().toISOString(),
      httpStatus: result.status,
      bytes: result.bytes,
      verdict: result.ok && items > 0 ? 'live' : result.ok ? 'empty' : 'blocked',
      detail: result.ok ? `items=${items}` : result.error ?? `HTTP ${result.status}`,
      ms: Date.now() - started
    }
  }

  // 只认 Windows Invoke-WebRequest 的政务站：Node/curl 都不行，探测也走 PowerShell。
  if (source.kind === 'winhttp-ps') {
    const text = await psFetchText(source.url)
    const rows = (text.match(/<tr[^>]*>/g) ?? []).length
    return {
      ...pick(source),
      checkedAt: new Date().toISOString(),
      httpStatus: rows > 0 ? 200 : 0,
      bytes: text.length,
      verdict: rows > 3 ? 'live' : 'blocked',
      detail: rows > 0 ? `rows=${rows}` : 'PowerShell 未取到列表',
      ms: Date.now() - started
    }
  }

  // 国家法律法规数据库：只接受 POST JSON，GET 会返回「Request method 'GET' not supported」。
  if (source.kind === 'flk-search') {
    try {
      const response = await fetch(source.url, {
        method: 'POST',
        headers: {
          'user-agent': UA,
          referer: 'https://flk.npc.gov.cn/',
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          searchRange: 1,
          searchType: 2,
          sxx: [],
          gbrqYear: [],
          flfgCodeId: [],
          zdjgCodeId: [],
          searchContent: '汽车',
          pageNum: 1,
          pageSize: 5
        }),
        signal: AbortSignal.timeout(20000)
      })
      const payload = await response.json()
      const total = payload?.total ?? 0
      return {
        ...pick(source),
        checkedAt: new Date().toISOString(),
        httpStatus: response.status,
        bytes: JSON.stringify(payload).length,
        verdict: total > 0 ? 'live' : 'empty',
        detail: `total=${total}`,
        ms: Date.now() - started
      }
    } catch (error) {
      return {
        ...pick(source),
        checkedAt: new Date().toISOString(),
        httpStatus: 0,
        bytes: 0,
        verdict: 'blocked',
        detail: error.message,
        ms: Date.now() - started
      }
    }
  }

  // 对 Node TLS 指纹不应答、只能走 curl 的源（湖南站内搜索）。
  if (source.kind === 'search-html') {
    const text = await curlText(`${source.url}?q=${encodeURIComponent('汽车')}`, 40)
    const hits = (text.match(/class="resultbox"/g) ?? []).length
    return {
      ...pick(source),
      checkedAt: new Date().toISOString(),
      httpStatus: hits > 0 ? 200 : 0,
      bytes: text.length,
      verdict: hits > 0 ? 'live' : 'blocked',
      detail: hits > 0 ? `results=${hits}` : 'curl 未返回结果块',
      ms: Date.now() - started
    }
  }

  const result = await politeFetch(source.url, { rateLimitMs: 0 })
  return {
    ...pick(source),
    checkedAt: new Date().toISOString(),
    httpStatus: result.status,
    bytes: result.bytes,
    verdict: result.bytes > 2000 ? 'partial' : 'blocked',
    detail: result.ok ? `${result.bytes} bytes` : result.error ?? `HTTP ${result.status}`,
    ms: Date.now() - started
  }
}

/** PowerShell 通道：部分政务站只对 Windows schannel 应答（Node 超时、curl 0 字节）。 */
function psFetchText(url, timeoutSec = 60, attempts = 3) {
  const command = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    `$r=Invoke-WebRequest -Uri '${url}' -UseBasicParsing -TimeoutSec ${timeoutSec} -Headers @{'User-Agent'='${UA}'}`,
    '[Convert]::ToBase64String($r.RawContentStream.ToArray())'
  ].join('; ')
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const stdout = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: (timeoutSec + 30) * 1000 }
      )
      return Buffer.from(stdout.trim(), 'base64').toString('utf8')
    } catch {
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Sleep -Seconds ${attempt * 3}`], { timeout: 20000 })
    }
  }
  return ''
}

/** curl 通道：部分政务站对 Node 的 TLS 指纹不应答，只能用系统 curl。 */
function curlText(url, timeoutSec = 40) {
  return new Promise((resolve) => {
    execFile(
      'curl.exe',
      ['-s', '--max-time', String(timeoutSec), '-A', UA, url],
      { maxBuffer: 12 * 1024 * 1024, encoding: 'utf8', timeout: (timeoutSec + 10) * 1000 },
      (error, stdout) => resolve(error && !stdout ? '' : (stdout ?? ''))
    )
  })
}

function pick(source) {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    level: source.level,
    regionName: source.regionName,
    url: source.url,
    enabled: source.enabled
  }
}

/** 把探测结果写回注册表并落一份健康报告。 */
export async function checkAll({ updateRegistry = true } = {}) {
  const registry = loadRegistry()
  const results = []
  for (const source of registry.sources ?? []) {
    const result = await probe(source)
    results.push(result)
    if (updateRegistry) {
      source.status = result.verdict
      source.verifiedAt = result.checkedAt.slice(0, 10)
      source.bytes = result.bytes
    }
    console.log(`  ${result.verdict.padEnd(8)} ${source.id.padEnd(20)} ${result.detail}`)
  }
  if (updateRegistry) {
    registry.updatedAt = new Date().toISOString().slice(0, 10)
    saveRegistry(registry)
    fs.writeFileSync(path.join(DATA_DIR, 'source-health.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n', 'utf8')
  }
  return results
}

if (process.argv[1] && process.argv[1].endsWith('sources.mjs')) {
  const mode = process.argv[2] ?? 'check'
  if (mode === 'check') {
    console.log('源健康检查：')
    checkAll({ updateRegistry: !process.argv.includes('--dry') }).then((results) => {
      const live = results.filter((item) => item.verdict === 'live').length
      console.log(`\n可用源 ${live}/${results.length}；结果已写入 data/source-health.json`)
    })
  } else {
    console.log('用法：node scripts/sources.mjs [check] [--dry]')
  }
}