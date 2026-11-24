import { percent, thousands } from './indicators.js?v=20261124g'

const REQUIRED_SECTIONS = [
  '## 一、执行摘要',
  '## 二、关键指标',
  '## 三、宏观：全国政策证据',
  '## 四、中观：区域与市场结构',
  '## 五、微观：品牌与条款证据',
  '## 六、品牌专项',
  '## 七、资本市场映射',
  '## 八、研究边界与跟踪清单',
  '## 附录'
]

const VAGUE_PHRASES = ['据了解', '有消息称', '业内人士普遍认为', '或将大幅', '有望突破', '据悉']

const policyCite = (id) => `〔${id}〕`
const findingText = (finding) => `${finding.text}${(finding.evidence ?? []).map(policyCite).join('')}`
const hasNumber = (value) => value !== null && value !== undefined && Number.isFinite(Number(value))
const numOrDash = (value) => (hasNumber(value) ? Number(value).toFixed(1) : null)
const signedOrDash = (value) => (hasNumber(value) ? percent(Number(value)) : null)

function table(lines, headers, rows) {
  lines.push(`| ${headers.join(' | ')} |`)
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`)
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`)
  lines.push('')
}

function findings(lines, items) {
  if (!items || items.length === 0) {
    lines.push('_本期没有可核验的新增证据。_')
    lines.push('')
    return
  }
  for (const finding of items) lines.push(`- ${findingText(finding)}`)
  lines.push('')
}

function quoteUrlOf(item) {
  const [market, id] = String(item.secid ?? '').split('.')
  const code = id || item.code
  if (market === '1') return `https://quote.eastmoney.com/sh${code}.html`
  if (market === '0') return `https://quote.eastmoney.com/sz${code}.html`
  if (market === '116') return `https://quote.eastmoney.com/hk${code}.html`
  return 'https://quote.eastmoney.com/'
}

/**
 * 研究报告 v2：执行摘要 → 指标 → 分层证据 → 品牌 → 市场 → 边界。
 * 所有事实必须来自 analysis 中的真实政策/销量/行情；没有数据就省略该表，
 * 不用“—”凑一张完整表，也不把文本相关度写成因果预测。
 */
export function renderReport(analysis, extras = {}) {
  const { meta, counts, psi, sales, brands, layers, gaps, evidenceIndex, brand } = analysis
  const market = extras.market ?? null
  const regionStats = extras.regionStats ?? null
  const libraryOverview = extras.libraryOverview ?? null
  const financials = extras.financials ?? null
  const national = sales?.national ?? null
  const hunan = sales?.hunan ?? null
  const month = meta.month
  const brandName = brand?.brand ?? '奇瑞'
  const lines = []

  lines.push(`# 汽车政策与产业月度研究报告｜${month}`)
  lines.push('')
  lines.push(`**研究范围**：${meta.regionName}｜**品牌专项**：${brandName}｜**数据引擎**：${meta.engine}`)
  lines.push(`**证据原则**：仅使用带官方原文的政策、公开销量榜与行情接口；未获取的数据不展示、不估算、不补写。`)
  lines.push(`**生成时间**：${meta.generatedAt}`)
  lines.push('')

  // 一、执行摘要：把事实和研判分开，避免“数字很多但没有结论”。
  lines.push('## 一、执行摘要')
  lines.push('')
  const summary = []
  if (counts.total > 0) {
    summary.push(`**政策端**：本期核验到 ${counts.total} 份有官方原文的汽车相关政策，工具结构以 ${counts.byTool.slice(0, 2).map((item) => `${item.tool}（${item.count} 份）`).join('、')} 为主。${counts.byTool[0] ? `当前首先应核对 ${counts.byTool[0].tool} 类条款的适用对象与生效时间。` : ''}〔D-POLICY-${month}〕`)
  } else {
    summary.push(`**政策端**：本期窗口内没有核验到带官方原文的新政策，因此不作“政策加码/退坡”的判断。〔D-POLICY-${month}〕`)
  }
  if (national) {
    summary.push(`**市场端**：全国乘用车零售 ${thousands(national.total)} 辆，新能源 ${thousands(national.nev)} 辆，渗透率 ${national.share}%；这是销量结构的直接观测，不用于反推单一政策的贡献。〔D-SALES-CN-${month}〕`)
  }
  if (brands?.rows?.length > 0) {
    const leader = brands.rows[0]
    summary.push(`**竞争端**：${leader.brand}以 ${thousands(leader.retail)} 辆居样本首位，份额 ${leader.share}%；前五品牌合计份额 ${brands.cr5}%。品牌分析以终端上险口径为准，不与厂商批发或出口口径混用。〔D-BRAND-${month}〕`)
  }
  if (summary.length === 0) summary.push('本期没有可核验的政策与销量证据，报告仅供数据缺口排查，不应作为月度结论发布。')
  summary.forEach((item, index) => lines.push(`${index + 1}. ${item}`))
  lines.push('')
  lines.push('> **研判纪律**：政策原文回答“规则改变了什么”；销量回答“市场发生了什么”；二者的时间先后不等于因果关系。报告中的“影响对象”仅指条款直接作用的业务环节。')
  lines.push('')

  // 二、关键指标：一行一来源。
  lines.push('## 二、关键指标')
  lines.push('')
  const indicators = []
  indicators.push(['有官方原文的政策', `${counts.total} 份`, '政策库筛选：sourceUrl 非空', `D-POLICY-${month}`])
  if (counts.total > 0) indicators.push(['政策强度 PSI', `${psi.current}`, '工具权重 × 层级系数 × 90 天新鲜度，0—100', `D-PSI-${month}`])
  if (national) {
    indicators.push(['全国乘用车零售', `${thousands(national.total)} 辆`, '公开销量榜车型汇总', `D-SALES-CN-${month}`])
    indicators.push(['全国新能源零售', `${thousands(national.nev)} 辆`, '纯电 + 插混 + 增程', `D-SALES-CN-${month}`])
    indicators.push(['全国 NEV 渗透率', `${national.share}%`, '新能源零售 ÷ 乘用车零售', `D-SALES-CN-${month}`])
  }
  if (brands?.rows?.length > 0) indicators.push(['品牌集中度 CR5', `${brands.cr5}%`, '前五品牌份额之和', `D-BRAND-${month}`])
  if (brand?.latest) indicators.push([`${brandName}品牌份额`, `${brand.latest.share}%`, `${thousands(brand.latest.retail)} 辆 ÷ 全国乘用车零售`, `D-BRAND-${month}`])
  table(lines, ['指标', '本期值', '口径', '证据'], indicators)
  if (hasNumber(sales?.momNational)) lines.push(`全国乘用车零售环比 ${percent(sales.momNational)}，按相邻两个同源月份计算。〔D-SALES-CN-${month}〕`)
  lines.push('')

  // 三、宏观：先列政策证据，再讲结构。
  lines.push('## 三、宏观：全国政策证据')
  lines.push('')
  if (evidenceIndex.length > 0) {
    table(lines, ['发布日期', '政策', '发布机构', '工具', '原文'], evidenceIndex.slice(0, 10).map((policy) => [
      policy.publishDate,
      policy.title,
      policy.issuer,
      policy.tools.join(' / ') || '未分类',
      `[官方原文](${policy.sourceUrl})`
    ]))
    lines.push(`本期共 ${evidenceIndex.length} 份政策进入分析，所有标题均可通过上表链接复核。〔D-POLICY-${month}〕`)
    lines.push('')
  }
  findings(lines, layers.macro.findings)

  // 国际政策单独成表：来源与口径和美国国内政策不同，不能混在一张表里比较。
  const intlPolicies = evidenceIndex.filter((policy) => Number(policy.level) === 0)
  if (intlPolicies.length > 0) {
    lines.push('### 国际政策（美国联邦公报）')
    lines.push('')
    table(lines, ['发布日期', '文件', '类型', '机构', '原文'], intlPolicies.slice(0, 8).map((policy) => [
      policy.publishDate,
      policy.title,
      policy.docType ?? '—',
      policy.issuer.split(' · ')[0],
      `[官方原文](${policy.sourceUrl})`
    ]))
    lines.push(`国际条目来自美国联邦公报官方 API，仅作外部制度参照；与国内政策的层级、工具口径不可直接比较。〔D-INTL-${month}〕`)
    lines.push('')
  }

  // 四、中观：有区域证据才写区域，没区域销量不填数字。
  lines.push('## 四、中观：区域与市场结构')
  lines.push('')
  findings(lines, layers.meso.findings)
  if (regionStats) {
    table(lines, ['区域指标', '值', '说明'], [
      ['区域政策条数', `${regionStats.count} 份`, '省级 + 市州官方政策'],
      ['区域政策强度', `${regionStats.psi}`, '仅按本区域政策计算，不与全国 PSI 直接比较'],
      ['区域工具首位', regionStats.toolMix[0]?.tool ?? '无', '按政策条目计数'],
      ['市州覆盖', regionStats.cities.length > 0 ? regionStats.cities.map((item) => `${item.name} ${item.count} 份`).join('、') : '无市级政策', '仅统计有官方原文的条目']
    ])
  }
  if (hunan) {
    table(lines, ['指标', '全国', '湖南'], [
      ['乘用车零售', `${thousands(national.total)} 辆`, `${thousands(hunan.total)} 辆`],
      ['新能源零售', `${thousands(national.nev)} 辆`, `${thousands(hunan.nev)} 辆`],
      ['NEV 渗透率', `${national.share}%`, `${hunan.share}%`]
    ])
  }

  // 五、微观：品牌份额 + 条款原文定位。
  lines.push('## 五、微观：品牌与条款证据')
  lines.push('')
  if (brands?.rows?.length > 0) {
    const withYoy = brands.rows.some((row) => hasNumber(row.yoy))
    table(lines, ['品牌', '零售（辆）', '全国份额', ...(withYoy ? ['同比'] : []), '证据'], brands.rows.map((row) => [
      row.brand,
      thousands(row.retail),
      `${row.share.toFixed(1)}%`,
      ...(withYoy ? [signedOrDash(row.yoy) ?? '未覆盖上年同月'] : []),
      `D-BRAND-${month}`
    ]))
  }
  const clauses = layers.micro.clauseImpacts ?? []
  if (clauses.length > 0) {
    lines.push('### 条款级证据（自动定位，需结合全文复核）')
    lines.push('')
    table(lines, ['政策', '原文位置', '条款摘录', '直接作用对象', '链接'], clauses.slice(0, 8).map((clause) => [
      clause.policyTitle,
      `第 ${clause.paragraph} 段`,
      clause.quote,
      clause.target,
      `[查看原文](${clause.sourceUrl})`
    ]))
    lines.push('说明：条款摘录取自官方正文；“直接作用对象”是文本归类，不是量化影响评估。未标定弹性的内容不进入本报告。')
    lines.push('')
  } else if (counts.total > 0) {
    lines.push('本期政策正文未达到条款定位条件，未生成条款级影响表。')
    lines.push('')
  }

  // 六、品牌专项：事实序列 + 当月政策证据，不放编的出口/同比。
  lines.push(`## 六、品牌专项：${brandName}`)
  lines.push('')
  lines.push(brandSection(brand, month))

  // 七、行情：单列，不拿股价证明政策有效。
  lines.push('## 七、资本市场映射')
  lines.push('')
  lines.push(marketSection(market, brandName))
  if (financials && Object.keys(financials).length > 0) {
    lines.push('')
    lines.push('### 主要上市车企最新报告期业绩')
    lines.push('')
    const rows = []
    for (const company of Object.values(financials)) {
      const latest = (company.periods ?? [])[0]
      if (!latest) continue
      const unit = company.currency === 'HKD' ? '亿港元' : '亿元'
      rows.push([
        company.name,
        `${latest.reportDate} ${latest.reportType}`,
        `${(latest.revenue / 1e8).toFixed(2)} ${unit}`,
        latest.netProfit === null ? '—' : `${(latest.netProfit / 1e8).toFixed(2)} ${unit}`,
        latest.grossMargin === null || latest.grossMargin === undefined ? '—' : `${latest.grossMargin.toFixed(1)}%`
      ])
    }
    if (rows.length > 0) {
      table(lines, ['公司', '报告期', '营业收入', '净利润', '毛利率'], rows)
      lines.push('A 股为营业总收入与归母净利润，港股为营业额与股东应占溢利；各自本币，不做汇率折算。季度数据以官方定期报告为准。〔D-FIN-QUARTER〕')
      lines.push('')
    }

    // 业绩预告与机构评级：只有 A 股覆盖，港股留空
    const outlook = []
    for (const company of Object.values(financials)) {
      const forecast = (company.forecasts || [])[0]
      const rating = company.ratings && company.ratings.breakdown?.length > 0 ? company.ratings.breakdown[0] : null
      if (!forecast && !rating) continue
      outlook.push([
        company.name,
        forecast ? `${forecast.type}（${forecast.reportDate}）` : '—',
        forecast && forecast.growthUpper !== null && forecast.growthUpper !== undefined
          ? `${forecast.growthLower?.toFixed(0) ?? '—'}% ~ ${forecast.growthUpper.toFixed(0)}%`
          : '—',
        rating ? `${rating.name}×${rating.count}` : '—',
        company.ratings ? `${company.ratings.recentCount}/${company.ratings.total}` : '—'
      ])
    }
    if (outlook.length > 0) {
      lines.push('### 业绩预告与机构评级')
      lines.push('')
      table(lines, ['公司', '最新预告类型', '预告同比区间', '近半年主流评级', '近半年研报数/总数'], outlook)
      lines.push('研报评级来自东方财富研报库，统计窗口为近 180 天，只覆盖 A 股；港股样本无公开一致评级数据，未列入。评级与目标价仅反映卖方观点，不构成本报告判断。〔D-FIN-OUTLOOK〕')
      lines.push('')
    }

    // 一致预期与目标价（A 股）
    const consensusRows = []
    for (const company of Object.values(financials)) {
      const consensus = company.consensus
      if (!consensus) continue
      const years = (consensus.years ?? []).filter((item) => item.mark === 'E').slice(0, 2)
      const target = company.ratings?.targetPrice
      consensusRows.push([
        company.name,
        `${consensus.ratingOrgNum ?? '—'} 家`,
        `${consensus.buy ?? 0}/${consensus.add ?? 0}/${consensus.neutral ?? 0}`,
        years.map((item) => `${item.year}E ${Number(item.eps).toFixed(2)}`).join(' · ') || '—',
        target ? `${target.median} 元（${target.count} 份）` : '—'
      ])
    }
    if (consensusRows.length > 0) {
      lines.push('### 一致预期与目标价')
      lines.push('')
      table(lines, ['公司', '覆盖机构', '买入/增持/中性', '未来两年 EPS 预期', '目标价中位数'], consensusRows)
      lines.push('一致预期来自东方财富一致预期数据，目标价取自卖方研报的非空目标价中位数。预测值不是事实，实际业绩可能偏离。〔D-FIN-CONSENSUS〕')
      lines.push('')
    }

    // 政策与财报的季度对照
    if (Array.isArray(extras.linkage) && extras.linkage.length > 0) {
      lines.push('### 政策与财报的季度对照')
      lines.push('')
      table(
        lines,
        ['季度', '政策条数', '季度 PSI', '样本平均毛利率', '样本平均营收同比'],
        extras.linkage.map((row) => [
          row.quarter,
          `${row.policyCount} 条`,
          String(row.psi),
          row.avgGrossMargin === null ? '—' : `${row.avgGrossMargin}%`,
          row.avgRevenueGrowth === null ? '—' : `${row.avgRevenueGrowth >= 0 ? '+' : ''}${row.avgRevenueGrowth}%`
        ])
      )
      const peak = extras.linkage.reduce((best, row) => (row.policyCount > (best?.policyCount ?? 0) ? row : best), null)
      const latestQ = extras.linkage[0]
      lines.push(
        `政策高峰出现在 ${peak?.quarter ?? '—'}（${peak?.policyCount ?? 0} 条，季度 PSI ${peak?.psi ?? 0}），` +
          `当季样本平均毛利率 ${peak?.avgGrossMargin ?? '—'}%；最近一个季度 ${latestQ.quarter} 政策 ${latestQ.policyCount} 条，` +
          `样本平均毛利率 ${latestQ.avgGrossMargin ?? '—'}%，营收同比 ${latestQ.avgRevenueGrowth ?? '—'}%。` +
          '样本为 A 股 5 家整车企业，季度政策与季度财务之间只做同向观察，不构成因果结论。〔D-FIN-LINKAGE〕'
      )
      lines.push('')
    }
  }

  // 八、边界与跟踪：明确哪些结论现在不能做。
  lines.push('## 八、研究边界与跟踪清单')
  lines.push('')
  const boundaries = [...gaps]
  if (brands?.rows?.length > 0 && !brands.rows.some((row) => hasNumber(row.yoy))) {
    boundaries.push('品牌同比：当前销量序列未覆盖上年同月，未计算同比；后续月度任务会逐步补齐。')
  }
  boundaries.push('分省销量：公开榜单的城市参数无效，未展示湖南销量与湖南 NEV 渗透率。')
  boundaries.push('出口销量：没有可核验的公开接口，未展示奇瑞出口量及出口占比。')
  boundaries.push('政策效果归因：未建立政策变量与销量的识别模型，本报告不输出弹性、补贴贡献度或反事实预测。')
  if (boundaries.length === 0) boundaries.push('本期无新增边界事项。')
  for (const item of [...new Set(boundaries)]) lines.push(`- ${item}`)
  lines.push('')
  lines.push(`**下期跟踪**：① 新政策是否出现正式生效条款；② 全国 NEV 渗透率是否延续同向变化；③ 品牌份额变化是否由少数车型贡献；④ 是否获得可复核的分省与出口数据。〔D-SALES-CN-${month}〕`)
  lines.push('')

  // 数据质量快照：让读者知道这份报告建立在多少条可核验记录上。
  const withContent = evidenceIndex.filter((policy) => policy.contentStatus === 'full').length
  const shortContent = evidenceIndex.filter((policy) => policy.contentStatus === 'short').length
  const noContent = evidenceIndex.length - withContent - shortContent
  lines.push('### 数据质量快照')
  lines.push('')
  table(lines, ['项目', '数值', '说明'], [
    ['政策条目', `${evidenceIndex.length} 份`, '全部带官方原文链接'],
    ['正文完整', `${withContent} 份`, '可支撑条款级定位'],
    ['正文不完整', `${shortContent} 份`, '通知类文件，正文在附件中'],
    ['无正文', `${noContent} 份`, '仅标题与摘要，需点官方原文'],
    ['销量月份', `${(extras.salesMonths ?? 0) || '—'}`, '公开销量榜覆盖月份数'],
    ['行情样本', `${market?.items?.length ?? 0} 家`, '东方财富公开接口']
  ])
  if (extras.sourceHealth?.length) {
    // 国际源已按产品要求停用，质量快照里不再列出，避免读者误以为报告含国际比较。
    const domesticSources = extras.sourceHealth.filter((item) => !/^(us-|eu-)/.test(String(item.id ?? '')))
    const live = domesticSources.filter((item) => item.verdict === 'live').length
    table(lines, ['数据源', '状态', '说明'], domesticSources.map((item) => [
      item.name,
      item.verdict === 'live' ? '可用' : item.verdict === 'partial' ? '部分可用' : '不可用',
      item.detail ?? ''
    ]))
    lines.push(`共登记 ${domesticSources.length} 个国内数据源，当前 ${live} 个可用；不可用源已标记，不参与抓取。`)
    lines.push('')
  }

  // 附录：证据可以独立复核。
  lines.push('## 附录')
  lines.push('')
  lines.push('### A. 政策证据索引')
  lines.push('')
  if (evidenceIndex.length > 0) {
    table(lines, ['证据 ID', '政策', '发布机构', '日期', '官方链接'], evidenceIndex.map((policy) => [
      policy.id,
      policy.title,
      policy.issuer,
      policy.publishDate,
      `[打开](${policy.sourceUrl})`
    ]))
  } else {
    lines.push('_本期无政策证据。_')
    lines.push('')
  }
  lines.push('### B. 国内政策全库概览')
  lines.push('')
  if (libraryOverview && libraryOverview.total > 0) {
    table(lines, ['维度', '分布'], [
      ['总条数', `${libraryOverview.total} 条（仅国内政策）`],
      ['按年份', libraryOverview.byYear],
      ['按层级', libraryOverview.byLevel],
      ['按工具', libraryOverview.byTool],
      ['时间跨度', `${libraryOverview.from} ~ ${libraryOverview.to}`]
    ])
    lines.push(`全库统计口径为国内政策（国务院政策文件库与湖南省政府文件搜索），每条都带官方原文链接。〔D-LIB-${month}〕`)
  } else {
    lines.push('_本期未提供全库概览。_')
  }
  lines.push('')
  lines.push('### C. 指标与数据口径')
  lines.push('')
  lines.push('- **PSI**：`100 × (1 − e^(−Σ(工具权重 × 层级系数 × 新鲜度) / 18))`；仅用于同一口径下的政策强度比较。')
  lines.push('- **NEV 渗透率**：纯电 + 插混 + 增程零售之和 ÷ 全量乘用车零售。')
  lines.push('- **品牌份额 / CR5**：品牌零售 ÷ 全国零售；CR5 为前五品牌份额之和。')
  lines.push('- **条款定位**：对官方正文按段落抽取，保留原文段落号与链接；不根据标题生成条款。')
  lines.push('')
  lines.push('### D. 来源与免责声明')
  lines.push('')
  lines.push('- 政策：国务院政策文件库（标题、文号、发布机构、日期与官方链接）。')
  lines.push('- 销量：懂车帝公开销量榜，车型汇总的上险/终端口径；与乘联会批发口径不同，不混用。')
  lines.push('- 行情：东方财富公开接口，可能延迟；A 股与港股按各自本币计，不做汇率折算。')
  lines.push('- 本报告用于产业研究，不构成投资建议，也不替代主管部门的正式政策解读。')
  lines.push('')

  return lines.join('\n')
}

function brandSection(brand, month) {
  if (!brand) return '_本期没有该品牌的销量序列，专项跳过。_\n'

  // 没有 2026 销量序列但有官方公告时，仍然展示官方口径（如 2025 年各月）
  if (!brand.latest) {
    if (!brand.official) return '_本期没有该品牌的销量序列，专项跳过。_\n'
    const official = brand.official
    const rows = [['官方集团销量', `${(official.groupSales / 10000).toFixed(2)} 万辆`, '奇瑞控股官网公告，含出口']]
    if (official.export) rows.push(['官方出口', `${(official.export / 10000).toFixed(2)} 万辆`, '同上，公告口径'])
    if (official.nev) rows.push(['官方新能源', `${(official.nev / 10000).toFixed(2)} 万辆（占集团 ${(official.nev / official.groupSales * 100).toFixed(0)}%）`, '同上，公告口径'])
    if (official.listedSales) rows.push(['港股上市公司销量', `${thousands(official.listedSales)} 辆`, '奇瑞汽车股份（9973.HK）口径'])
    if (Array.isArray(official.brands) && official.brands.length > 0) {
      rows.push(['分品牌销量', official.brands.map((item) => `${item.brand} ${(item.sales / 10000).toFixed(2)} 万`).join(' / '), '同一份官方公告'])
    }
    const out = [`**${official.month} 奇瑞集团官方销量 ${(official.groupSales / 10000).toFixed(2)} 万辆${official.export ? `，出口 ${(official.export / 10000).toFixed(2)} 万辆` : ''}**〔D-BRAND-OFFICIAL-${month}〕`, '']
    table(out, ['指标', '值', '说明'], rows)
    out.push(`该月没有懂车帝国内上险序列，仅有官方公告口径；两者不可相加。〔D-BRAND-OFFICIAL-${month}〕（[官方公告](${official.sourceUrl})）`)
    out.push('')
    return out.join('\n')
  }
  const latest = brand.latest
  const months = brand.months ?? []
  const previous = months.length > 1 ? months[months.length - 2] : null
  const out = []

  out.push(`**${latest.month} ${brand.brand}零售 ${thousands(latest.retail)} 辆，占全国乘用车零售 ${latest.share}%**〔D-BRAND-${month}〕`)
  out.push('')
  const rows = [
    ['当月零售', `${thousands(latest.retail)} 辆`, '公开销量榜按子品牌聚合'],
    ['全国份额', `${latest.share}%`, '品牌零售 ÷ 全国乘用车零售'],
    ['序列覆盖', `${months.length} 个月`, '仅展示已抓取的真实月份']
  ]
  if (previous) rows.push(['环比变化', `${latest.retail - previous.retail >= 0 ? '+' : ''}${thousands(latest.retail - previous.retail)} 辆`, `相对 ${previous.month}`])
  if (hasNumber(latest.yoy)) rows.push(['同比', percent(latest.yoy), '有上年同月数据时计算'])
  if (brand.official) {
    rows.push(['官方集团销量', `${(brand.official.groupSales / 10000).toFixed(2)} 万辆`, '奇瑞控股官网公告，含出口'])
    if (brand.official.export) rows.push(['官方出口', `${(brand.official.export / 10000).toFixed(2)} 万辆`, '同上，公告口径'])
    if (brand.official.nev) rows.push(['官方新能源', `${(brand.official.nev / 10000).toFixed(2)} 万辆（占集团 ${(brand.official.nev / brand.official.groupSales * 100).toFixed(0)}%）`, '同上，公告口径'])
    if (brand.official.listedSales) rows.push(['港股上市公司销量', `${thousands(brand.official.listedSales)} 辆`, '奇瑞汽车股份（9973.HK）口径'])
  if (Array.isArray(brand.official.brands) && brand.official.brands.length > 0) {
    rows.push(['分品牌销量', brand.official.brands.map((item) => `${item.brand} ${(item.sales / 10000).toFixed(2)} 万`).join(' / '), '同一份官方公告'])
  }
  }
  table(out, ['指标', '值', '说明'], rows)
  if (brand.official) {
    out.push(`官方口径与懂车帝国内上险口径不可相加：前者是集团含出口的批发/公告数，后者是终端上险数。〔D-BRAND-OFFICIAL-${month}〕（[官方公告](${brand.official.sourceUrl})）`)
    out.push('')
  }

  if (brand.policies?.length > 0) {
    out.push('### 与品牌关注点相关的政策证据')
    out.push('')
    table(out, ['政策', '命中关注点', '相关度（文本）', '原文'], brand.policies.map((policy) => [
      policy.title,
      policy.topics.join(' / '),
      policy.score,
      policy.sourceUrl ? `[打开](${policy.sourceUrl})` : '未提供'
    ]))
    out.push('相关度只表示政策文本与品牌关注点的匹配程度，不代表政策对销量或利润的贡献。')
    out.push('')
  } else {
    out.push('_本期没有命中该品牌关注点的政策证据。_')
    out.push('')
  }
  return out.join('\n')
}

function marketSection(market, brandName) {
  if (!market?.items?.length) return '_本期没有可核验的上市公司行情，资本市场章节不展开。_\n'
  const out = []
  const items = [...market.items]
    .sort((a, b) => Number(b.focus) - Number(a.focus) || (a.name === brandName ? -1 : 0))
    .slice(0, 8)
  table(out, ['公司', '现价', '涨跌幅', 'PE(TTM)', '市值（亿）', '来源'], items.map((item) => [
    item.name,
    hasNumber(item.price) ? item.price.toFixed(2) : '无数据',
    hasNumber(item.pct) ? `${item.pct > 0 ? '+' : ''}${item.pct.toFixed(2)}%` : '无数据',
    hasNumber(item.pe) ? item.pe.toFixed(1) : '无数据',
    item.mcap ? Math.round(item.mcap / 1e8) : '无数据',
    `[行情](${quoteUrlOf(item)})`
  ]))
  if (market.summary?.readout) out.push(`${market.summary.readout}〔D-QUOTE-${String(market.asOf).slice(0, 10)}〕`)
  out.push('')
  out.push(`行情时点：${String(market.asOf ?? '').slice(0, 16).replace('T', ' ')}${market.degraded ? '（离线快照）' : ''}。行情与政策、销量分列呈现，不据此推断政策效果。`)
  out.push('')
  return out.join('\n')
}

/** 发布质检：章节、引用、模糊表述、无数据报告与陈旧示例口径。 */
export function lintReport(markdown) {
  const errors = []
  for (const section of REQUIRED_SECTIONS) {
    if (!markdown.includes(section)) errors.push(`缺少章节：${section}`)
  }

  const paragraphs = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 60 && !line.startsWith('#') && !line.startsWith('|') && !line.startsWith('>') && !line.startsWith('-'))
  const cited = paragraphs.filter((line) => /〔(P|D)-/.test(line))
  const coverage = paragraphs.length === 0 ? 1 : cited.length / paragraphs.length
  if (coverage < 0.9) errors.push(`引用覆盖率 ${(coverage * 100).toFixed(0)}%，低于 90%`)

  for (const phrase of VAGUE_PHRASES) {
    if (markdown.includes(phrase)) errors.push(`出现模糊表述：${phrase}`)
  }
  if (/乘联会口径（示例数据）|示例待补|示例条目/.test(markdown)) errors.push('报告仍含示例数据口径')
  if (/〔P-P-/.test(markdown)) errors.push('政策证据 ID 重复前缀')
  if (/本期没有可核验的政策与销量证据/.test(markdown)) errors.push('本期无政策与销量证据，不应作为月度结论发布')

  const words = markdown.replace(/\s/g, '').length
  if (words < 1800) errors.push(`正文 ${words} 字，低于 1800 字下限`)

  return {
    ok: errors.length === 0,
    errors,
    citationCoverage: Math.round(coverage * 1000) / 10,
    paragraphs: paragraphs.length,
    words
  }
}
