/**
 * 奇瑞官方月度销量/出口入库
 *
 *   node scripts/ingest-chery.mjs          # 抓奇瑞控股官网公告，写 data/chery-official.json
 *   node scripts/ingest-chery.mjs --dry
 *
 * 来源：奇瑞控股官网新闻中心 /api/article/paginate（需要 appId + md5 签名，已复现）。
 * 只取正文里能明确对应到月份的数字，做区间校验，避免把“累计/连续突破”当成单月。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.AUTO_POLICY_DATA_DIR || path.resolve(HERE, '../data')
const OUT = path.join(DATA_DIR, 'chery-official.json')

const DRY = process.argv.includes('--dry')
const APP_ID = 'MyAPPID'
const SECRET = '5D5ZuS@GhsXOZU8IBxuOc@vH%@cEymX0'
const ENDPOINT = 'https://www.cheryholding.com/api/article/paginate'

const md5 = (value) => crypto.createHash('md5').update(value, 'utf8').digest('hex')

/** 官方前端签名：参数按字母序拼接，再拼密钥取 md5。 */
function signedUrl(base) {
  const data = { ...base, t: Date.now() }
  let key = 'appId' + APP_ID
  for (const name of Object.keys(data).sort()) key += name + data[name]
  data.sign = md5(key + SECRET)
  data.appId = APP_ID
  return `${ENDPOINT}?${new URLSearchParams(data).toString()}`
}

const stripTags = (value) =>
  String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

async function fetchPage(page) {
  const response = await fetch(signedUrl({ pageNumber: page, pageSize: 100, orderBy: 'created desc,id desc' }), {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  if (payload?.state !== 'ok') throw new Error(payload?.message ?? '接口返回异常')
  return payload.page?.list ?? []
}

/**
 * 从公告正文抽月度数据。正文写的是「281,161 辆」这种带千分位的数字，
 * 且同一段里既有集团、也有港股上市公司（9973.HK）和出口，需要分别匹配。
 * 任何数字都要通过区间校验，避免把累计/新能源/单品牌当成集团总量。
 */
function parseArticle(article) {
  const raw = String(article.content ?? '')
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
  const created = String(article.created ?? '')

  const monthMatch = text.match(/(\d{1,2})月份?[，,]?\s*(?:奇瑞控股)?集团销售汽车\s*([\d,]+)\s*辆/)
  // 早期公告写成「X月销售汽车20.6万辆」，补一套「万辆」写法
  const wanMatch = monthMatch
    ? null
    : text.match(/(\d{1,2})月份?[，,]?[^。]{0,16}?(?:集团)?(?:销售汽车|销量)\s*([\d.]+)\s*万辆/)
  if (!monthMatch && !wanMatch) return null

  const month = Number((monthMatch ?? wanMatch)[1])
  if (!(month >= 1 && month <= 12)) return null

  const groupSales = monthMatch
    ? Number(monthMatch[2].replace(/,/g, ''))
    : Math.round(Number(wanMatch[2]) * 10000)
  if (!(groupSales >= 50000 && groupSales <= 450000)) return null

  let year = Number(created.slice(0, 4))
  const createdMonth = Number(created.slice(5, 7))
  if (Number.isFinite(createdMonth) && month > createdMonth) year -= 1

  // 港股上市公司（9973.HK）单月销量
  const listedMatch = text.match(/9973\.HK[）)]\s*(\d{1,2})月份?销售汽车\s*([\d,]+)\s*辆/)
  const listedSales = listedMatch ? Number(listedMatch[2].replace(/,/g, '')) : null

  // 出口：只在集团那句话附近找，排除“累计出口”
  const exportMatch = text.match(/出口\s*([\d,]+)\s*辆(?!\s*[，,]\s*并实现累计)/)
  let exportVolume = exportMatch ? Number(exportMatch[1].replace(/,/g, '')) : null
  if (exportVolume !== null && !(exportVolume >= 10000 && exportVolume <= groupSales)) exportVolume = null

  // 新能源：公告里写法不统一（新能源汽车销售 / 新能源销量 / 新能源销售），逐个试
  const nevPatterns = [
    /新能源(?:汽车)?(?:销量|销售)[^0-9]{0,8}([\d,]+)\s*辆/,
    /新能源(?:汽车)?[^0-9]{0,6}([\d,]+)\s*辆/,
    /新能源汽车\s*(?:销量|销售)\s*([\d,]+)/,
    /新能源[^0-9]{0,10}([\d.]+)\s*万辆/
  ]
  let nevSales = null
  for (const pattern of nevPatterns) {
    const match = text.match(pattern)
    if (!match) continue
    const value = match[1].includes('.') ? Math.round(Number(match[1]) * 10000) : Number(match[1].replace(/,/g, ''))
    if (value > 0 && value <= groupSales) {
      nevSales = value
      break
    }
  }

  // 分品牌：正文常写「奇瑞品牌 10月份销售169,696辆」
  const brandSales = []
  const brandPattern = /(奇瑞|星途|捷途|iCAR|智界|纵横)\s*品牌\s*\d{1,2}月份?销售\s*([\d,]+)\s*辆/g
  for (const match of text.matchAll(brandPattern)) {
    const value = Number(match[2].replace(/,/g, ''))
    if (value > 0 && value <= groupSales) brandSales.push({ brand: match[1], sales: value })
  }

  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    groupSales,
    listedSales: listedSales !== null && listedSales <= groupSales ? listedSales : null,
    export: exportVolume,
    nev: nevSales !== null && nevSales <= groupSales ? nevSales : null,
    brands: brandSales.length > 0 ? brandSales : null
  }
}

async function main() {
  const pages = []
  for (let page = 1; page <= 3; page += 1) {
    const list = await fetchPage(page)
    pages.push(...list)
    if (list.length < 100) break
  }
  console.log(`公告 ${pages.length} 条`)

  const byMonth = new Map()
  for (const article of pages) {
    const parsed = parseArticle(article)
    if (!parsed) continue
    const existing = byMonth.get(parsed.month)
    // 同一月份多条公告时，优先保留带出口量、且集团销量更大的那条
    if (!existing || (parsed.export && !existing.export) || parsed.groupSales > existing.groupSales) {
      byMonth.set(parsed.month, {
        ...parsed,
        title: stripTags(article.title).slice(0, 80),
        sourceUrl: `https://www.cheryholding.com/article/${article.id}.html`,
        publishedAt: article.created
      })
    }
  }

  const months = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1))
  console.log(`解析出 ${months.length} 个月的官方数据`)

  // 年度交叉校验：公告里 2025 年集团销量 280.6 万辆，各月之和不应偏离太多
  const knownAnnual = { 2025: 2806000 }
  for (const [year, expected] of Object.entries(knownAnnual)) {
    const rows = months.filter((row) => row.month.startsWith(year))
    const sum = rows.reduce((total, row) => total + row.groupSales, 0)
    if (rows.length > 0) {
      const gap = Math.abs(sum - expected) / expected
      const verdict = gap < 0.15 ? '吻合' : '偏差偏大'
      console.log(`  ${year} 年 ${rows.length} 个月合计 ${(sum / 10000).toFixed(1)} 万辆，官方口径 ${(expected / 10000).toFixed(1)} 万辆（${(gap * 100).toFixed(0)}%，${verdict}）`)
    }
  }

  for (const row of months.slice(-8)) {
    console.log(`  ${row.month} 集团 ${(row.groupSales / 10000).toFixed(2)} 万辆 · 出口 ${row.export ? (row.export / 10000).toFixed(2) + ' 万辆' : '—'}`)
  }

  const payload = {
    source: '奇瑞控股官网新闻中心',
    endpoint: ENDPOINT,
    updatedAt: new Date().toISOString(),
    note: '集团销量含出口；出口为公告口径。与懂车帝国内上险口径不可直接相加或对比。部分月份公告未抓到，序列不完整。',
    months
  }

  if (DRY) {
    console.log('\n--dry：未写入')
    return
  }
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(`\n写入 ${path.relative(process.cwd(), OUT)}：${months.length} 个月`)
}

main().catch((error) => {
  console.error('奇瑞官方销量入库失败：', error.message ?? error)
  process.exit(1)
})