/**
 * 上市公司季度财报入库（东方财富数据中心）
 *
 *   node scripts/ingest-financials.mjs               # 抓最近 8 个报告期
 *   node scripts/ingest-financials.mjs --quarters=12
 *   node scripts/ingest-financials.mjs --dry
 *
 * A 股走 RPT_LICO_FN_CPD，港股走 RPT_HKF10_FN_MAININDICATOR，两者字段不同，统一归一化后写 data/financials.json。
 * 口径说明：A 股 TOTAL_OPERATE_INCOME 为营业总收入、PARENT_NETPROFIT 为归母净利润；
 * 港股 OPERATE_INCOME 为营业额、HOLDER_PROFIT 为股东应占溢利。币种均按各自本币，不做汇率折算。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { backupBeforeWrite } from './backup.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.AUTO_POLICY_DATA_DIR || path.resolve(HERE, '../data')
const OUT_FILE = path.join(DATA_DIR, 'financials.json')

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const option = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const QUARTERS = Number(option('quarters', '8'))

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const ENDPOINT = 'https://datacenter-web.eastmoney.com/api/data/v1/get'

const COMPANIES = [
  { code: '002594', secucode: '002594.SZ', name: '比亚迪', market: 'A' },
  { code: '000625', secucode: '000625.SZ', name: '长安汽车', market: 'A' },
  { code: '600104', secucode: '600104.SH', name: '上汽集团', market: 'A' },
  { code: '601633', secucode: '601633.SH', name: '长城汽车', market: 'A' },
  { code: '601127', secucode: '601127.SH', name: '赛力斯', market: 'A' },
  { code: '09973', secucode: '09973.HK', name: '奇瑞汽车', market: 'HK' },
  { code: '00175', secucode: '00175.HK', name: '吉利汽车', market: 'HK' },
  { code: '09863', secucode: '09863.HK', name: '零跑汽车', market: 'HK' },
  { code: '09868', secucode: '09868.HK', name: '小鹏汽车-W', market: 'HK' },
  { code: '01810', secucode: '01810.HK', name: '小米集团-W', market: 'HK' }
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 业绩预告：只在 A 股有，港股接口不返回。 */
async function fetchForecast(company) {
  const rows = await query({
    reportName: 'RPT_PUBLIC_OP_NEWPREDICT',
    columns: 'ALL',
    filter: `(SECURITY_CODE="${company.code}")`,
    pageNumber: '1',
    pageSize: '4',
    sortColumns: 'NOTICE_DATE',
    sortTypes: '-1'
  })
  return rows
    .map((row) => ({
      noticeDate: String(row.NOTICE_DATE ?? '').slice(0, 10),
      reportDate: String(row.REPORT_DATE ?? '').slice(0, 10),
      type: row.PREDICT_TYPE ?? '',
      item: row.PREDICT_FINANCE ?? '',
      lower: row.PREDICT_AMT_LOWER ?? null,
      upper: row.PREDICT_AMT_UPPER ?? null,
      growthLower: row.ADD_AMP_LOWER ?? null,
      growthUpper: row.ADD_AMP_UPPER ?? null,
      content: String(row.PREDICT_CONTENT ?? '').slice(0, 160),
      reason: String(row.CHANGE_REASON_EXPLAIN ?? '').slice(0, 220)
    }))
    .filter((row) => row.noticeDate)
}

/** 巨潮资讯：先查 orgId，再取季度报告 PDF 链接（只有 A 股）。 */
async function fetchCninfoReports(company) {
  const searchResponse = await fetch('http://www.cninfo.com.cn/new/information/topSearch/query', {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      referer: 'http://www.cninfo.com.cn/',
      accept: 'application/json'
    },
    body: new URLSearchParams({ keyWord: company.code, maxNum: '10' }).toString(),
    signal: AbortSignal.timeout(20000)
  })
  if (!searchResponse.ok) throw new Error(`topSearch HTTP ${searchResponse.status}`)
  const hits = await searchResponse.json()
  const hit = (Array.isArray(hits) ? hits : []).find((item) => item.code === company.code)
  if (!hit?.orgId) throw new Error('cninfo 未找到 orgId')

  const column = company.secucode.endsWith('.SH') ? 'sse' : 'szse'
  const listResponse = await fetch('http://www.cninfo.com.cn/new/hisAnnouncement/query', {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      referer: 'http://www.cninfo.com.cn/',
      accept: 'application/json'
    },
    body: new URLSearchParams({
      pageNum: '1',
      pageSize: '8',
      column,
      tabName: 'fulltext',
      stock: `${company.code},${hit.orgId}`,
      searchkey: '季度报告',
      seDate: '',
      sortName: '',
      sortType: '',
      isHLtitle: 'true'
    }).toString(),
    signal: AbortSignal.timeout(25000)
  })
  if (!listResponse.ok) throw new Error(`公告查询 HTTP ${listResponse.status}`)
  const payload = await listResponse.json()
  return (payload.announcements ?? []).map((item) => ({
    title: String(item.announcementTitle ?? '').replace(/<[^>]+>/g, ''),
    date: item.announcementTime ? new Date(item.announcementTime).toISOString().slice(0, 10) : '',
    pdfUrl: item.adjunctUrl ? `http://static.cninfo.com.cn/${item.adjunctUrl}` : ''
  }))
    .filter((item) => item.pdfUrl)
    .slice(0, 6)
}

/** 东财一致预期：机构数与未来三年 EPS 预测。 */
async function fetchConsensus(company) {
  const rows = await query({
    reportName: 'RPT_WEB_RESPREDICT',
    columns: 'ALL',
    filter: `(SECURITY_CODE="${company.code}")`,
    pageNumber: '1',
    pageSize: '1',
    source: 'WEB',
    client: 'WEB'
  })
  const row = rows[0]
  if (!row) return null
  return {
    ratingOrgNum: row.RATING_ORG_NUM ?? null,
    buy: row.RATING_BUY_NUM ?? 0,
    add: row.RATING_ADD_NUM ?? 0,
    neutral: row.RATING_NEUTRAL_NUM ?? 0,
    reduce: row.RATING_REDUCE_NUM ?? 0,
    sale: row.RATING_SALE_NUM ?? 0,
    years: [1, 2, 3, 4]
      .map((index) => ({
        year: row[`YEAR${index}`],
        mark: row[`YEAR_MARK${index}`],
        eps: row[`EPS${index}`]
      }))
      .filter((item) => item.year && item.eps !== null && item.eps !== undefined)
  }
}
async function fetchRatings(company) {
  const url = `https://reportapi.eastmoney.com/report/list?${new URLSearchParams({
    cb: '',
    industryCode: '*',
    pageSize: '30',
    industry: '*',
    rating: '*',
    ratingChange: '*',
    beginTime: '2025-01-01',
    endTime: new Date().toISOString().slice(0, 10),
    pageNo: '1',
    fields: '',
    qType: '0',
    orgCode: '',
    code: company.code,
    rcode: '',
    p: '1',
    pageNum: '1'
  })}`
  const response = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://data.eastmoney.com/report/', accept: '*/*' },
    signal: AbortSignal.timeout(25000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  const parsed = JSON.parse(text.replace(/^[^({]*\(/, '').replace(/\);?\s*$/, ''))
  const rows = parsed?.data ?? []
  const recent = rows.filter((row) => {
    const day = String(row.publishDate ?? '').slice(0, 10)
    if (!day) return false
    const diff = (Date.now() - new Date(day).getTime()) / 86400000
    return diff <= 180
  })
  const counts = {}
  for (const row of recent) {
    const name = row.emRatingName || row.sRatingName || '未评级'
    counts[name] = (counts[name] ?? 0) + 1
  }
  // 目标价：只有部分研报给出，取非空值的中位数
  const aims = rows
    .map((row) => Number(row.indvAimPriceT || row.indvAimPriceL || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  const aimMedian = aims.length > 0 ? aims[Math.floor(aims.length / 2)] : null
  const aimMean = aims.length > 0 ? Math.round((aims.reduce((sum, value) => sum + value, 0) / aims.length) * 100) / 100 : null
  return {
    total: rows.length,
    recentCount: recent.length,
    windowDays: 180,
    breakdown: Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    targetPrice: aims.length > 0 ? { count: aims.length, median: aimMedian, mean: aimMean } : null,
    latest: rows.slice(0, 3).map((row) => ({
      date: String(row.publishDate ?? '').slice(0, 10),
      org: row.orgSName ?? '',
      rating: row.emRatingName || row.sRatingName || '',
      title: String(row.title ?? '').slice(0, 80)
    }))
  }
}

async function query(params) {
  const url = `${ENDPOINT}?${new URLSearchParams({ ...params, source: 'WEB', client: 'WEB' })}`
  const response = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://data.eastmoney.com/', accept: 'application/json' },
    signal: AbortSignal.timeout(25000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  return payload?.result?.data ?? []
}

const reportTypeOf = (dateText) => {
  const month = String(dateText ?? '').slice(5, 7)
  if (month === '03') return '一季报'
  if (month === '06') return '中报'
  if (month === '09') return '三季报'
  if (month === '12') return '年报'
  return '其他'
}

function normalizeRow(row, company) {
  const isHK = company.market === 'HK'
  const reportDate = String(row.REPORT_DATE ?? row.REPORTDATE ?? '').slice(0, 10)
  if (!reportDate) return null
  const revenue = isHK ? row.OPERATE_INCOME : row.TOTAL_OPERATE_INCOME
  const netProfit = isHK ? row.HOLDER_PROFIT : row.PARENT_NETPROFIT
  if (revenue === null || revenue === undefined) return null
  return {
    reportDate,
    reportType: row.REPORT_TYPE ? String(row.REPORT_TYPE).replace(/^\d{4}年?/, '') : reportTypeOf(reportDate),
    revenue: Number(revenue),
    netProfit: netProfit === null || netProfit === undefined ? null : Number(netProfit),
    grossMargin: isHK && row.GROSS_PROFIT_RATIO !== undefined ? Number(row.GROSS_PROFIT_RATIO) : null,
    roe: !isHK && row.WEIGHTAVG_ROE !== undefined ? Number(row.WEIGHTAVG_ROE) : null,
    eps: row.BASIC_EPS === null || row.BASIC_EPS === undefined ? null : Number(row.BASIC_EPS),
    noticeDate: String(row.NOTICE_DATE ?? row.UPDATE_DATE ?? '').slice(0, 10)
  }
}

async function fetchCompany(company) {
  const isHK = company.market === 'HK'
  const params = isHK
    ? {
        reportName: 'RPT_HKF10_FN_MAININDICATOR',
        columns: 'ALL',
        filter: `(SECUCODE="${company.secucode}")`,
        pageNumber: '1',
        pageSize: String(QUARTERS),
        sortColumns: 'REPORT_DATE',
        sortTypes: '-1'
      }
    : {
        reportName: 'RPT_LICO_FN_CPD',
        columns: 'ALL',
        filter: `(SECURITY_CODE="${company.code}")`,
        pageNumber: '1',
        pageSize: String(QUARTERS),
        sortColumns: 'REPORTDATE',
        sortTypes: '-1'
      }
  const rows = await query(params)
  const periods = rows.map((row) => normalizeRow(row, company)).filter(Boolean)

  // A 股的业绩报表不带毛利率，补一次 f10 主要指标，按报告期合并 XSMLL/ROEJQ
  if (!isHK && periods.length > 0) {
    try {
      const indicators = await query({
        reportName: 'RPT_F10_FINANCE_MAINFINADATA',
        columns: 'ALL',
        filter: `(SECUCODE="${company.secucode}")`,
        pageNumber: '1',
        pageSize: String(QUARTERS),
        sortColumns: 'REPORT_DATE',
        sortTypes: '-1',
        source: 'HSF10',
        client: 'PC'
      })
      const byDate = new Map(
        indicators.map((row) => [
          String(row.REPORT_DATE ?? '').slice(0, 10),
          { grossMargin: row.XSMLL, roe: row.ROEJQ }
        ])
      )
      for (const period of periods) {
        const extra = byDate.get(period.reportDate)
        if (!extra) continue
        if (extra.grossMargin !== null && extra.grossMargin !== undefined) period.grossMargin = Number(extra.grossMargin)
        if (extra.roe !== null && extra.roe !== undefined) period.roe = Number(extra.roe)
      }
    } catch {
      /* 补指标失败不影响主表 */
    }
  }

  return { ...company, periods }
}

async function main() {
  const results = []
  for (const company of COMPANIES) {
    try {
      const data = await fetchCompany(company)
      // 业绩预告与机构评级只有 A 股覆盖，港股跳过
      if (company.market === 'A') {
        try {
          data.forecasts = await fetchForecast(company)
        } catch (error) {
          data.forecasts = []
        }
        await sleep(500)
        try {
          data.ratings = await fetchRatings(company)
        } catch (error) {
          data.ratings = null
        }
        await sleep(500)
        try {
          data.consensus = await fetchConsensus(company)
        } catch (error) {
          data.consensus = null
        }
        await sleep(500)
        try {
          data.reports = await fetchCninfoReports(company)
        } catch (error) {
          data.reports = []
        }
        await sleep(500)
      }
      results.push(data)
      const latest = data.periods[0]
      const forecast = (data.forecasts || [])[0]
      const rating = data.ratings && data.ratings.breakdown.length > 0 ? data.ratings.breakdown[0] : null
      console.log(
        `  ${company.name.padEnd(10, ' ')} ${latest ? `${latest.reportDate} ${latest.reportType} 营收 ${(latest.revenue / 1e8).toFixed(2)} 亿，净利 ${latest.netProfit === null ? '—' : (latest.netProfit / 1e8).toFixed(2) + ' 亿'}` : '无数据'}` +
          (forecast ? `｜预告 ${forecast.type}` : '') +
          (rating ? `｜评级 ${rating.name}×${rating.count}` : '')
      )
    } catch (error) {
      console.log(`  ${company.name} 失败：${error.message}`)
    }
    await sleep(700)
  }

  const withData = results.filter((item) => item.periods.length > 0)
  console.log(`\n成功 ${withData.length}/${COMPANIES.length} 家`)

  if (DRY) {
    console.log('--dry：未写入')
    return
  }

  const payload = {
    source: '东方财富数据中心（业绩报表 / 港股主要指标）',
    endpoint: ENDPOINT,
    updatedAt: new Date().toISOString(),
    note: 'A 股为营业总收入与归母净利润，港股为营业额与股东应占溢利；各自本币，不做汇率折算；季度数据以官方定期报告为准。',
    companies: results.map((item) => ({
      code: item.code,
      secucode: item.secucode,
      name: item.name,
      market: item.market,
      currency: item.market === 'HK' ? 'HKD' : 'CNY',
      periods: item.periods,
      forecasts: item.forecasts ?? [],
      ratings: item.ratings ?? null,
      consensus: item.consensus ?? null,
      reports: item.reports ?? []
    }))
  }

  backupBeforeWrite('financials')
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(`写入 ${path.relative(process.cwd(), OUT_FILE)}：${withData.length} 家公司`)
}

main().catch((error) => {
  console.error('财报入库失败：', error.message ?? error)
  process.exit(1)
})