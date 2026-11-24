/**
 * 销量入库（真实数据）：懂车帝公开销量榜
 *
 *   node scripts/sales-dongchedi.mjs               # 最近 13 个月，全国 + 新能源 + 品牌
 *   node scripts/sales-dongchedi.mjs --months=6    # 只更新最近 6 个月
 *
 * 口径说明：懂车帝的 count 是车型月度销量（零售/上险口径），与乘联会发布口径略有差异，
 * 因此写盘后 dataset.note 会标明来源。城市参数（city_name）对这个接口无效，
 * 所以分省数据仍然没有真实来源，湖南一栏保持示例并单独标注。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupBeforeWrite } from './backup.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.AUTO_POLICY_DATA_DIR || path.resolve(HERE, '../data')
const SALES_FILE = path.join(DATA_DIR, 'sales.json')

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const MONTHS = Number(option('months', '13'))
const PAGE = 100
const MAX_PAGES = 8
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const BRAND_MAP = {
  比亚迪: '比亚迪',
  吉利银河: '吉利',
  吉利汽车: '吉利',
  吉利几何: '吉利',
  领克: '吉利',
  极氪: '吉利',
  长安: '长安',
  长安启源: '长安',
  长安欧尚: '长安',
  深蓝汽车: '长安',
  阿维塔: '长安',
  奇瑞: '奇瑞',
  奇瑞QQ: '奇瑞',
  奇瑞风云: '奇瑞',
  星途: '奇瑞',
  捷途: '奇瑞',
  捷途山海: '奇瑞',
  iCAR: '奇瑞',
  智界: '奇瑞',
  特斯拉: '特斯拉',
  理想汽车: '理想',
  小米汽车: '小米',
  零跑汽车: '零跑',
  小鹏汽车: '小鹏',
  蔚来: '蔚来',
  乐道: '蔚来',
  萤火虫: '蔚来',
  上汽: '上汽',
  荣威: '上汽',
  名爵: '上汽',
  五菱汽车: '上汽',
  宝骏: '上汽',
  长城: '长城',
  哈弗: '长城',
  魏牌: '长城',
  坦克: '长城',
  欧拉: '长城',
  长城炮: '长城'
}

const TARGET_BRANDS = ['奇瑞', '比亚迪', '吉利', '长安', '上汽', '长城', '特斯拉', '理想', '小鹏', '蔚来', '零跑', '小米']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

async function fetchPage(month, nev, offset) { // nev: '' | '1' 纯电 | '2' 插混 | '3' 增程
  const params = new URLSearchParams({
    aid: '1839',
    app_name: 'auto_web_pc',
    city_name: '',
    count: String(PAGE),
    offset: String(offset),
    month: month.replace('-', ''),
    new_energy_type: nev,
    rank_data_type: '11',
    brand_id: '',
    price: '',
    manufacturer: '',
    series_type: '',
    nation: '0',
    outter_detail_type: '',
    tab_id: '10'
  })
  const response = await fetch(`https://www.dongchedi.com/motor/pc/car/rank_data?${params}`, {
    headers: { 'user-agent': UA, referer: 'https://www.dongchedi.com/' },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  const list = payload?.data?.list
  return Array.isArray(list) ? list : []
}

/** 一个月的汇总：typeList 为空串表示全量，['1','2','3'] 表示纯电+插混+增程分别取和。 */
async function fetchMonth(month, typeList) {
  let total = 0
  const byBrand = new Map()
  const models = new Map()

  for (const type of typeList) {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const list = await fetchPage(month, type, page * PAGE)
      if (list.length === 0) break
      for (const item of list) {
        const count = Number(item.count) || 0
        total += count
        const mapped = BRAND_MAP[item.brand_name]
        if (mapped) byBrand.set(mapped, (byBrand.get(mapped) ?? 0) + count)
        if (typeList.length === 1 && typeList[0] === '' && mapped) {
          const key = `${mapped}|${item.series_name}`
          models.set(key, {
            model: item.series_name,
            rawBrand: item.brand_name,
            brand: mapped,
            count: (models.get(key)?.count ?? 0) + count
          })
        }
      }
      await sleep(110)
      if (list.length < PAGE) break
    }
  }

  return { total, byBrand, models: [...models.values()].sort((a, b) => b.count - a.count) }
}

function percent(current, previous) {
  if (!previous) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

async function main() {
  const sales = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'))
  const latest = sales.monthly[sales.monthly.length - 1].month
  const months = []
  for (let delta = MONTHS - 1; delta >= 0; delta -= 1) months.push(shiftMonth(latest, -delta))

  console.log(`目标月份：${months[0]} ~ ${months[months.length - 1]}（共 ${months.length}）`)

  const national = new Map()
  const nevTotal = new Map()
  const brandSeries = new Map()
  const modelMonthly = new Map()

  for (const month of months) {
    try {
      const all = await fetchMonth(month, [''])
      // 新能源 = 纯电(1) + 插混(2) + 增程(3)
      const nev = await fetchMonth(month, ['1', '2', '3'])
      national.set(month, all.total)
      nevTotal.set(month, nev.total)
      modelMonthly.set(month, all.models)
      for (const brand of TARGET_BRANDS) {
        const series = brandSeries.get(brand) ?? []
        series.push({ month, retail: all.byBrand.get(brand) ?? 0 })
        brandSeries.set(brand, series)
      }
      const share = all.total ? ((nev.total / all.total) * 100).toFixed(1) : '—'
      console.log(`  ${month} 全国 ${all.total.toLocaleString()} / NEV ${nev.total.toLocaleString()} (${share}%)`)
    } catch (error) {
      console.log(`  ${month} 失败：${error.message}`)
    }
  }

  // 合并进 sales.json：全国与品牌用真实值，湖南保持原样
  for (const entry of sales.monthly) {
    if (!national.has(entry.month)) continue
    const prevYear = shiftMonth(entry.month, -12)
    entry.national = {
      total: national.get(entry.month),
      nev: nevTotal.get(entry.month),
      yoyTotal: national.has(prevYear) ? percent(national.get(entry.month), national.get(prevYear)) : null,
      yoyNev: nevTotal.has(prevYear) ? percent(nevTotal.get(entry.month), nevTotal.get(prevYear)) : null
    }
    const cheryRetail = (brandSeries.get('奇瑞') ?? []).find((row) => row.month === entry.month)?.retail
    if (cheryRetail) {
      const prev = (brandSeries.get('奇瑞') ?? []).find((row) => row.month === prevYear)?.retail
      entry.chery = { ...(entry.chery ?? {}), retail: cheryRetail, yoy: prev ? percent(cheryRetail, prev) : null }
    }
  }

  // 只保留真实抓到的月份：更早的示例月份不参与图表，避免真假混排
  const kept = sales.monthly.filter((entry) => national.has(entry.month))
  if (kept.length > 0) sales.monthly = kept

  const brandMonthly = {}
  for (const brand of TARGET_BRANDS) {
    brandMonthly[brand] = brandSeries.get(brand) ?? []
  }
  sales.brandMonthly = brandMonthly

  // 车型级原始明细：面板“品牌份额”下钻时用，全部来自同一次真实抓取。
  sales.modelMonthly = Object.fromEntries(modelMonthly)

  // 当月品牌榜：按真实零售排序，份额 = 品牌 / 全国
  const lastMonth = months[months.length - 1]
  const lastTotal = national.get(lastMonth) ?? 0
  const prevYear = shiftMonth(lastMonth, -12)
  sales.brands = sales.brands ?? {}
  sales.brands[lastMonth] = TARGET_BRANDS
    .map((brand) => {
      const retail = (brandSeries.get(brand) ?? []).find((row) => row.month === lastMonth)?.retail ?? 0
      const prev = (brandSeries.get(brand) ?? []).find((row) => row.month === prevYear)?.retail
      return { brand, retail, yoy: prev ? percent(retail, prev) : null, nevRatio: null }
    })
    .filter((row) => row.retail > 0)
    .sort((a, b) => b.retail - a.retail)

  sales.dataset = {
    ...sales.dataset,
    mode: 'live',
    hunanMode: 'seed',
    updatedAt: new Date().toISOString().slice(0, 10),
    source: '懂车帝公开销量榜（rank_data_type=11）',
    note:
      '全国与品牌零售来自懂车帝公开销量榜（零售/上险口径，与乘联会发布口径不同；仅覆盖本次抓取月份）；' +
      '接口不提供有效分省销量，湖南销量与渗透率不展示；奇瑞出口量无公开接口，不展示。'
  }

  backupBeforeWrite('SALES_FILE');
  fs.writeFileSync(SALES_FILE, JSON.stringify(sales, null, 2) + '\n', 'utf8')
  console.log(`\n写入 ${path.relative(process.cwd(), SALES_FILE)}`)
  console.log('最新月品牌 Top5：', sales.brands[lastMonth].slice(0, 5).map((row) => `${row.brand} ${row.retail}`).join(' / '))
}

main().catch((error) => {
  console.error('销量入库失败：', error)
  process.exit(1)
})