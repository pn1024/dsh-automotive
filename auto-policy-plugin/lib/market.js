import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = path.resolve(here, '../data/market-snapshot.json')

const QUOTE_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
const KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'
const FIELDS = 'f2,f3,f9,f12,f13,f14,f20'

const TTL_MS = 10 * 60 * 1000
const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000

/** 整车与生态相关上市公司。secid 的市场前缀：0=深市 1=沪市 116=港股。 */
export const COMPANIES = [
  { secid: '116.09973', code: '09973', name: '奇瑞汽车', market: 'HK', focus: true },
  { secid: '0.002594', code: '002594', name: '比亚迪', market: 'A' },
  { secid: '116.00175', code: '00175', name: '吉利汽车', market: 'HK' },
  { secid: '0.000625', code: '000625', name: '长安汽车', market: 'A' },
  { secid: '1.600104', code: '600104', name: '上汽集团', market: 'A' },
  { secid: '1.601633', code: '601633', name: '长城汽车', market: 'A' },
  { secid: '1.601127', code: '601127', name: '赛力斯', market: 'A' },
  { secid: '116.09863', code: '09863', name: '零跑汽车', market: 'HK' },
  { secid: '116.09868', code: '09868', name: '小鹏汽车-W', market: 'HK' },
  { secid: '116.01810', code: '01810', name: '小米集团-W', market: 'HK' }
]

let cache = null

const round = (value, digits = 2) => {
  if (value === null || value === undefined) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; dsh-auto-policy/0.3; +local)',
      accept: 'application/json'
    }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** Eastmoney returns integers: A 股价格×100，港股×1000；涨跌幅与 PE 均为 ×100。 */
function normalizeQuote(row, company) {
  const scale = company.market === 'HK' ? 1000 : 100
  const price = typeof row.f2 === 'number' ? row.f2 / scale : null
  const pct = typeof row.f3 === 'number' ? row.f3 / 100 : null
  const pe = typeof row.f9 === 'number' && row.f9 !== 0 ? row.f9 / 100 : null
  const mcap = typeof row.f20 === 'number' ? row.f20 : null
  return {
    secid: company.secid,
    code: row.f12 ?? company.code,
    name: row.f14 ?? company.name,
    market: company.market,
    focus: company.focus === true,
    price,
    pct,
    pe,
    mcap,
    currency: company.market === 'HK' ? 'HKD' : 'CNY',
    trend: []
  }
}

function median(values) {
  const list = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
  if (list.length === 0) return null
  const middle = Math.floor(list.length / 2)
  return list.length % 2 === 0 ? (list[middle - 1] + list[middle]) / 2 : list[middle]
}

function summarize(items) {
  const withPct = items.filter((item) => typeof item.pct === 'number')
  if (withPct.length === 0) return null

  const up = withPct.filter((item) => item.pct > 0).length
  const down = withPct.filter((item) => item.pct < 0).length
  const sorted = [...withPct].sort((a, b) => b.pct - a.pct)
  const medianPct = median(withPct.map((item) => item.pct))
  const medianPe = median(items.filter((item) => typeof item.pe === 'number' && item.pe > 0).map((item) => item.pe))
  const chery = items.find((item) => item.focus)

  const parts = []
  parts.push(
    `样本 ${withPct.length} 家整车与生态公司：${up} 家上涨、${down} 家下跌，中位数 ${medianPct > 0 ? '+' : ''}${round(medianPct)}%。`
  )
  parts.push(`领涨 ${sorted[0].name} ${round(sorted[0].pct)}%，领跌 ${sorted[sorted.length - 1].name} ${round(sorted[sorted.length - 1].pct)}%。`)
  if (chery && typeof chery.pct === 'number' && medianPct !== null) {
    const gap = round(chery.pct - medianPct)
    parts.push(
      `奇瑞汽车报 ${chery.price} ${chery.currency === 'HKD' ? '港元' : '元'}，${chery.pct > 0 ? '+' : ''}${round(chery.pct)}%，${gap >= 0 ? '跑赢' : '跑输'}板块中位数 ${Math.abs(gap)} 个百分点。`
    )
  }
  if (chery && typeof chery.pe === 'number' && medianPe !== null) {
    parts.push(
      `奇瑞 PE(TTM) ${round(chery.pe, 1)}，同业正 PE 中位数 ${round(medianPe, 1)}，估值${chery.pe < medianPe ? '低于' : '高于'}板块中位。`
    )
  }
  parts.push('行情为公开接口报价，可能存在延迟；仅作研究参考，不构成投资建议。')

  return {
    medianPct: round(medianPct),
    medianPe: round(medianPe, 1),
    up,
    down,
    total: withPct.length,
    leader: { name: sorted[0].name, pct: round(sorted[0].pct) },
    laggard: { name: sorted[sorted.length - 1].name, pct: round(sorted[sorted.length - 1].pct) },
    readout: parts.join('')
  }
}

async function fetchKline(company) {
  const url =
    `${KLINE_URL}?secid=${company.secid}&klt=101&fqt=1&lmt=20&end=20500101` +
    '&fields1=f1,f2&fields2=f51,f53'
  const payload = await fetchJson(url, 4500)
  const rows = payload?.data?.klines
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      const [date, close] = String(row).split(',')
      return { date, close: Number(close) }
    })
    .filter((point) => Number.isFinite(point.close))
}

async function buildFresh() {
  const secids = COMPANIES.map((company) => company.secid).join(',')
  const payload = await fetchJson(
    `${QUOTE_URL}?secids=${secids}&fields=${FIELDS}`,
    6000
  )
  const rows = payload?.data?.diff
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('行情接口返回空数据')

  const items = []
  for (const company of COMPANIES) {
    const row = rows.find((entry) => String(entry.f12) === company.code)
    if (row) items.push(normalizeQuote(row, company))
  }

  const trends = await Promise.allSettled(COMPANIES.map((company) => fetchKline(company)))
  trends.forEach((result, index) => {
    if (result.status !== 'fulfilled' || result.value.length === 0) return
    const target = items.find((item) => item.secid === COMPANIES[index].secid)
    if (target) target.trend = result.value
  })

  return {
    ok: true,
    source: 'eastmoney',
    degraded: false,
    asOf: new Date().toISOString(),
    items,
    summary: summarize(items)
  }
}

function readSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT)) return null
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
    return parsed && Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed : null
  } catch {
    return null
  }
}

function writeSnapshot(payload) {
  try {
    const stat = fs.existsSync(SNAPSHOT) ? fs.statSync(SNAPSHOT) : null
    if (stat && Date.now() - stat.mtimeMs < SNAPSHOT_TTL_MS) return
    fs.writeFileSync(SNAPSHOT, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  } catch {
    // 快照只是离线兜底，写不进去不影响在线读取
  }
}

/**
 * 行情读取：10 分钟内存缓存 → 东方财富公开接口 → 本地快照 → 空结果。
 * 任何一步失败都降级返回，绝不让面板因为外网不可用而打不开。
 */
export async function getMarket() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.payload

  try {
    const payload = await buildFresh()
    cache = { at: Date.now(), payload }
    writeSnapshot(payload)
    return payload
  } catch (error) {
    const snapshot = readSnapshot()
    if (snapshot) {
      const payload = { ...snapshot, ok: true, degraded: true, error: String(error?.message ?? error) }
      cache = { at: Date.now() - TTL_MS / 2, payload }
      return payload
    }
    return {
      ok: false,
      source: 'none',
      degraded: true,
      asOf: new Date().toISOString(),
      items: [],
      summary: null,
      error: String(error?.message ?? error)
    }
  }
}

/** 测试与快照生成用：强制刷新，不受缓存影响。 */
export async function refreshMarket() {
  const payload = await buildFresh()
  cache = { at: Date.now(), payload }
  try {
    fs.writeFileSync(SNAPSHOT, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  } catch {
    // ignore
  }
  return payload
}