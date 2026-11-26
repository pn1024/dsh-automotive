import fs from 'node:fs'
import path from 'node:path'

// 版本后缀：插件热重载时 index.js 会重新导入，但被它引用的 lib/*.js 会命中
// Node 的 ESM 缓存。带 ?v= 的说明符让每次重载都拿到新的模块实例，
// 否则改了 lib 里的代码要重启整个应用才生效。
import { buildAnalysis } from './lib/analyze.js?v=20261124g'
import { clausesOf } from './lib/clauses.js?v=20261124g'
import { policyStrengthIndex } from './lib/indicators.js?v=20261124g'
import { COMPANIES, getMarket } from './lib/market.js?v=20261124g'
import { buildLibraryOverview, buildOverview } from './lib/overview.js?v=20261124g'
import { lintReport, renderReport } from './lib/report.js?v=20261124g'
import {
  LEVEL_NAMES,
  loadLibrary,
  latestMonth,
  monthBounds,
  policiesInWindow,
  resolveDataDir,
  searchPolicies
} from './lib/store.js?v=20261124g'

export const name = 'auto-policy'
export const inject = ['tools']

const LEVEL_ENUM = ['0', '1', '2', '3']

const TOOL_TYPES = ['补贴', '税收', '路权', '双积分', '标准', '基建', '贸易', '以旧换新', '规划']

const text = (value) => [{ type: 'text', text: value }]

const confidenceLabel = (value) => (value === 'high' ? '高' : value === 'medium' ? '中' : '低')

const directionLabel = (value) => (value === 'positive' ? '利好' : value === 'negative' ? '利空' : '中性')

const truncate = (value, max) =>
  value.length <= max ? value : `${value.slice(0, max)}\n…（已截断，共 ${value.length} 字）`

/** Join a model-supplied relative path under the session directory, refusing escapes. */
function safeJoin(base, relative) {
  const target = path.resolve(base, relative)
  const root = path.resolve(base)
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`输出路径必须位于工作目录内：${relative}`)
  }
  return target
}

function sessionDirectory(ctx, exec) {
  try {
    const service = ctx.get('workingDirectory')
    const session = exec?.agent?.session
    if (service && session) {
      const dir = service.get(session)
      if (typeof dir === 'string' && dir.length > 0) return dir
    }
  } catch {
    // fall through to the process directory
  }
  return process.cwd()
}

/** 最新有政策的月份：报告与分析默认停在这里，避免落在“销量最新但政策为空”的月份。 */
function latestPolicyMonthOf(library) {
  const months = [
    ...new Set(
      library.policies.map((policy) => String(policy.publishDate ?? '').slice(0, 7))
    )
  ].filter((value) => /^\d{4}-\d{2}$/.test(value))
  months.sort()
  return months.length > 0 ? months[months.length - 1] : ''
}

function requireMonth(library, month) {
  if (month) return month
  const fallback = latestPolicyMonthOf(library) || latestMonth(library)
  if (!fallback) throw new Error('政策与销量数据均为空，无法推断月份；请显式传入 month（YYYY-MM）。')
  return fallback
}

function buildTools(ctx, config) {
  const dataDir = resolveDataDir(config?.dataDir)
  const library = () => loadLibrary(config?.dataDir)

  const search = {
    name: 'policy_search',
    description:
      '按关键词、地区、层级、政策工具与日期范围检索汽车政策库，返回紧凑清单（id、标题、机构、日期、层级、工具标签、相关度）。用 policy_read 取全文，用 policy_analyze 做分层分析。默认只查示例种子库；库内数据模式见 policy_library_stats。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '空格分隔的关键词，例如「补贴 湖南」「智能网联 测试」。留空则按筛选条件列出。' },
        region: { type: 'string', description: '行政区划码（430000）或简称（湖南、长沙）；省略表示不限地区。' },
        level: { type: 'string', enum: LEVEL_ENUM, description: '0=国际 1=国家 2=省级 3=市级；省略表示不限层级。' },
        toolType: { type: 'string', enum: TOOL_TYPES, description: '按政策工具过滤，例如 补贴、税收、路权。' },
        nevOnly: { type: 'boolean', description: '为 true 时只返回新能源专属政策。' },
        from: { type: 'string', description: '发布日期下界，含当天，格式 YYYY-MM-DD。' },
        to: { type: 'string', description: '发布日期上界，含当天，格式 YYYY-MM-DD。' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数上限，默认 10。' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer' },
          dataMode: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                issuer: { type: 'string' },
                publishDate: { type: 'string' },
                level: { type: 'integer' },
                levelName: { type: 'string' },
                regionName: { type: 'string' },
                toolTypes: { type: 'array', items: { type: 'string' } },
                nevSpecific: { type: 'boolean' },
                summary: { type: 'string' }
              }
            }
          }
        }
      },
      render: (_args, value) => {
        if (value.total === 0) return text('未找到匹配政策。可放宽 query 或去掉 region/level 过滤。')
        const head = `命中 ${value.total} 条（显示 ${value.items.length} 条，数据模式：${value.dataMode}）`
        const body = value.items
          .map((item, index) =>
            `${index + 1}. [${item.id}] ${item.title}\n   ${item.levelName}·${item.regionName}｜${item.issuer}｜${item.publishDate}｜${item.toolTypes.join('/') || '未分类'}${item.nevSpecific ? '｜NEV专属' : ''}\n   ${item.summary}`)
          .join('\n')
        return text(`${head}\n\n${body}`)
      }
    },
    execute(args) {
      const lib = library()
      const result = searchPolicies(lib, {
        query: args.query ?? '',
        region: args.region,
        level: args.level === undefined ? undefined : Number(args.level),
        toolType: args.toolType,
        nevOnly: args.nevOnly === true,
        from: args.from,
        to: args.to,
        limit: args.limit ?? 10
      })
      return {
        total: result.total,
        dataMode: lib.meta.mode ?? 'unknown',
        items: result.items.map((policy) => ({
          id: policy.id,
          title: policy.title,
          issuer: policy.issuer,
          publishDate: policy.publishDate,
          level: Number(policy.level),
          levelName: LEVEL_NAMES[policy.level] ?? '未知',
          regionName: policy.regionName ?? '',
          toolTypes: policy.toolTypes ?? [],
          nevSpecific: policy.nevSpecific === true,
          summary: policy.summary ?? ''
        }))
      }
    }
  }

  const read = {
    name: 'policy_read',
    description:
      '按 id 读取一篇政策的完整字段：正文、条款级影响标注、文号、来源、版本历史。正文超过 6000 字时截断并标注总字数。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', description: '政策 id，来自 policy_search 结果，例如 P-HN-2026-008。' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean' },
          id: { type: 'string' },
          title: { type: 'string' },
          issuer: { type: 'string' },
          docNo: { type: 'string' },
          publishDate: { type: 'string' },
          levelName: { type: 'string' },
          regionName: { type: 'string' },
          toolTypes: { type: 'array', items: { type: 'string' } },
          supplyChain: { type: 'array', items: { type: 'string' } },
          nevSpecific: { type: 'boolean' },
          content: { type: 'string' },
          truncated: { type: 'boolean' },
          clauses: { type: 'array', items: { type: 'object', additionalProperties: true } },
          versions: { type: 'array', items: { type: 'object', additionalProperties: true } },
          provenance: { type: 'string' }
        }
      },
      render: (_args, value) => {
        if (!value.found) return text(`未找到政策 ${value.id}。先用 policy_search 确认 id。`)
        const lines = [
          `[${value.id}] ${value.title}`,
          `${value.levelName}·${value.regionName}｜${value.issuer}｜${value.docNo}｜${value.publishDate}`,
          `工具：${value.toolTypes.join('/') || '未分类'}｜产业链：${value.supplyChain.join('/') || '未标注'}｜${value.nevSpecific ? 'NEV 专属' : '非 NEV 专属'}`,
          '',
          value.content,
          '',
          `条款标注 ${value.clauses.length} 条：`,
          ...value.clauses.map((clause) => `  ${clause.no}、${clause.text} → ${clause.impact?.target ?? ''}（${directionLabel(clause.impact?.direction)}，强度 ${clause.impact?.magnitude ?? '-'}）`),
          '',
          `版本：${value.versions.map((version) => `v${version.versionNo} ${version.date} ${version.note}`).join('；') || '无'}`,
          `来源：${value.provenance}`
        ]
        return text(lines.join('\n'))
      }
    },
    execute(args) {
      const policy = library().byId.get(String(args.id ?? '').trim())
      if (!policy) {
        return { found: false, id: String(args.id ?? ''), title: '', issuer: '', docNo: '', publishDate: '', levelName: '', regionName: '', toolTypes: [], supplyChain: [], nevSpecific: false, content: '', truncated: false, clauses: [], versions: [], provenance: '' }
      }
      const content = policy.content ?? ''
      return {
        found: true,
        id: policy.id,
        title: policy.title,
        issuer: policy.issuer,
        docNo: policy.docNo ?? '',
        publishDate: policy.publishDate,
        levelName: LEVEL_NAMES[policy.level] ?? '未知',
        regionName: policy.regionName ?? '',
        toolTypes: policy.toolTypes ?? [],
        supplyChain: policy.supplyChain ?? [],
        nevSpecific: policy.nevSpecific === true,
        content: truncate(content, 6000),
        truncated: content.length > 6000,
        clauses: clausesOf(policy, 8),
        versions: policy.versions ?? [],
        provenance: policy.provenance ?? ''
      }
    }
  }

  const analyze = {
    name: 'policy_analyze',
    description:
      '对某月做宏观—中观—微观三层政策分析，返回结论、政策强度指数 PSI、湖南与全国销量指标、条款级影响、传导链与数据缺口。全部由规则引擎从库内数据计算，同一输入结果稳定，每条结论都带证据 id（P:=政策，D:=数据）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        month: { type: 'string', description: '分析月份 YYYY-MM；省略则取销量数据最新月份。' },
        region: { type: 'string', description: '侧重地区，行政区划码或简称，例如 430000、湖南；省略表示全国。' },
        brand: { type: 'string', description: '品牌专项对象，例如 奇瑞、比亚迪、吉利、特斯拉、理想；省略默认 奇瑞。' },
        topN: { type: 'integer', minimum: 1, maximum: 10, description: '每层返回的结论条数上限，默认 5。' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          meta: { type: 'object', additionalProperties: true },
          counts: { type: 'object', additionalProperties: true },
          psi: { type: 'object', additionalProperties: true },
          sales: { type: 'object', additionalProperties: true },
          brands: { type: 'object', additionalProperties: true },
          layers: { type: 'object', additionalProperties: true },
          transmission: { type: 'array', items: { type: 'object', additionalProperties: true } },
          gaps: { type: 'array', items: { type: 'string' } },
          evidenceIndex: { type: 'array', items: { type: 'object', additionalProperties: true } }
        }
      },
      render: (_args, value) => {
        const lines = [
          `汽车政策分层分析｜${value.meta.month}｜${value.meta.regionName}`,
          `政策 ${value.counts.total} 条｜PSI ${value.psi.current}（上月 ${value.psi.previous}，环比 ${value.psi.delta >= 0 ? '+' : ''}${value.psi.delta}）｜数据模式：${value.meta.dataMode}`,
          ''
        ]
        const layers = [
          ['宏观', value.layers.macro.findings],
          ['中观', value.layers.meso.findings],
          ['微观', value.layers.micro.findings]
        ]
        for (const [label, findings] of layers) {
          lines.push(`【${label}】`)
          if (findings.length === 0) lines.push('  （本期无）')
          for (const finding of findings) {
            lines.push(`  - ${finding.text}${(finding.evidence ?? []).map((id) => `〔${id}〕`).join('')}（置信度：${confidenceLabel(finding.confidence)}）`)
          }
          lines.push('')
        }
        if (value.gaps.length > 0) {
          lines.push('【数据缺口】')
          for (const gap of value.gaps) lines.push(`  - ${gap}`)
        }
        return text(lines.join('\n'))
      }
    },
    execute(args) {
      const lib = library()
      const month = requireMonth(lib, args.month)
      monthBounds(month)
      return buildAnalysis(lib, {
        month,
        region: args.region,
        brand: args.brand,
        topN: args.topN ?? 5
      })
    }
  }

  const report = {
    name: 'policy_report',
    description:
      '生成月度汽车政策分析报告（Markdown），按宏观/中观/微观结构与附录输出，写入工作目录 reports/ 下并做发布质检（章节完整性、引用覆盖率、模糊表述、篇幅）。返回文件路径与质检结果；质检不通过时文件仍会写入，但不得直接对外发布。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        month: { type: 'string', description: '报告月份 YYYY-MM；省略则取销量数据最新月份。' },
        region: { type: 'string', description: '侧重地区，默认全国（430000 表示湖南）。' },
        topN: { type: 'integer', minimum: 1, maximum: 10, description: '每层结论条数上限，默认 5。' },
        save: { type: 'boolean', description: '为 false 时只返回正文与质检结果，不落盘；默认 true。' },
        outPath: { type: 'string', description: '相对工作目录的输出路径，例如 reports/2026-10.md；默认自动命名。' },
        brand: { type: 'string', description: '品牌专项对象，例如 奇瑞、比亚迪、吉利、特斯拉、理想；省略默认 奇瑞。' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          saved: { type: 'boolean' },
          path: { type: 'string' },
          month: { type: 'string' },
          region: { type: 'string' },
          words: { type: 'integer' },
          citationCoverage: { type: 'number' },
          lintErrors: { type: 'array', items: { type: 'string' } },
          markdown: { type: 'string' }
        }
      },
      render: (_args, value) => {
        const lines = [
          `已生成 ${value.month} 报告（${value.region}）`,
          value.path ? `文件：${value.path}` : '（未落盘）',
          `篇幅：${value.words} 字｜引用覆盖率：${value.citationCoverage}%`,
          `质检：${value.ok ? '通过' : '未通过'}`,
          ...value.lintErrors.map((error) => `  - ${error}`)
        ]
        return text(lines.join('\n'))
      }
    },
    async execute(args, exec) {
      const lib = library()
      const month = requireMonth(lib, args.month)
      const overview = buildOverview(lib, { month, region: args.region, brand: args.brand })
      const analysis = overview.analysis

      // 行情是可选的锦上添花：取不到就跳过该章，不影响报告主体。
      let market = null
      try {
        market = await getMarket()
      } catch {
        market = null
      }

      const markdown = renderReport(analysis, {
        market,
        regionStats: overview.regionStats,
        libraryOverview: buildLibraryOverview(lib),
        financials: lib.financials,
        linkage: overview.linkage,
        recentPolicies: overview.recentPolicies,
        salesMonths: lib.monthly.length,
        sourceHealth: readSourceHealth()
      })
      const lint = lintReport(markdown)

      if (args.save === false) {
        return { ok: lint.ok, saved: false, path: '', month, region: analysis.meta.regionName, words: lint.words, citationCoverage: lint.citationCoverage, lintErrors: lint.errors, markdown }
      }

      const base = sessionDirectory(ctx, exec)
      const relative = args.outPath
        ? String(args.outPath)
        : path.join('reports', `auto-policy-${month}${analysis.meta.region ? '-' + analysis.meta.region : ''}.md`)
      const target = safeJoin(base, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, markdown, 'utf8')

      return { ok: lint.ok, saved: true, path: target, month, region: analysis.meta.regionName, words: lint.words, citationCoverage: lint.citationCoverage, lintErrors: lint.errors, markdown }
    }
  }

  const stats = {
    name: 'policy_library_stats',
    description:
      '查看政策库概览：数据集名称与模式、政策条数、层级/工具/地区分布、日期跨度、销量覆盖月份与最新月份、下一月报告窗口。用于确认库里有什么、是否接了真实数据。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dataset: { type: 'object', additionalProperties: true },
          policyTotal: { type: 'integer' },
          dateRange: { type: 'object', additionalProperties: true },
          byLevel: { type: 'array', items: { type: 'object', additionalProperties: true } },
          byTool: { type: 'array', items: { type: 'object', additionalProperties: true } },
          byRegion: { type: 'array', items: { type: 'object', additionalProperties: true } },
          salesMonths: { type: 'array', items: { type: 'string' } },
          latestMonth: { type: 'string' },
          psiLatest: { type: 'number' },
          dataDir: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } }
        }
      },
      render: (_args, value) => {
        const lines = [
          `政策库：${value.dataset.name}（${value.dataset.mode}）`,
          `条数 ${value.policyTotal}｜跨度 ${value.dateRange.from} ~ ${value.dateRange.to}｜数据目录 ${value.dataDir}`,
          `层级：${value.byLevel.map((item) => `${item.name} ${item.count}`).join('｜')}`,
          `工具：${value.byTool.map((item) => `${item.tool} ${item.count}`).join('｜')}`,
          `地区：${value.byRegion.map((item) => `${item.name} ${item.count}`).join('｜')}`,
          `销量月份：${value.salesMonths.join('、')}（最新 ${value.latestMonth}，PSI ${value.psiLatest}）`,
          ...value.warnings.map((warning) => `注意：${warning}`)
        ]
        return text(lines.join('\n'))
      }
    },
    execute() {
      const lib = library()
      const month = latestMonth(lib)
      const dates = lib.policies.map((policy) => policy.publishDate).sort()
      const warnings = []
      if (lib.meta.mode !== 'live') warnings.push('当前为示例种子数据，非真实抓取；接入采集器后覆盖 data/*.json 或设置 AUTO_POLICY_DATA_DIR。')
      if (!lib.policies.some((policy) => Number(policy.level) === 0)) warnings.push('库内无国际政策，宏观层国际变量将只输出缺口提示。')
      return {
        dataset: { name: lib.meta.name ?? '未命名', mode: lib.meta.mode ?? 'unknown', version: lib.meta.version ?? '', updatedAt: lib.meta.updatedAt ?? '', note: lib.meta.note ?? '' },
        policyTotal: lib.policies.length,
        dateRange: { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' },
        byLevel: LEVEL_ENUM.map((code) => ({
          level: Number(code),
          name: LEVEL_NAMES[code],
          count: lib.policies.filter((policy) => Number(policy.level) === Number(code)).length
        })).filter((item) => item.count > 0),
        byTool: countTools(lib.policies),
        byRegion: countRegions(lib.policies),
        salesMonths: lib.monthly.map((entry) => entry.month),
        latestMonth: month ?? '',
        psiLatest: month ? policyStrengthIndex(policiesInWindow(lib, { month }), { asOf: `${month}-28` }).value : 0,
        dataDir,
        warnings
      }
    }
  }

  const stock = {
    name: 'auto_stock_quotes',
    description:
      '读取国产汽车整车与生态公司行情（东方财富公开接口，服务端缓存 10 分钟）：现价、涨跌幅、总市值、PE(TTM)、近 5 个交易日收盘，附一句板块与奇瑞对比的规则解读。外网不可用时回落到本地快照并标记 degraded。行情可能延迟，仅作研究参考，不构成投资建议。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        companies: {
          type: 'array',
          items: { type: 'string' },
          description: '公司名称或代码，例如 ["奇瑞汽车","002594"]；省略则返回全部 10 家。'
        }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          asOf: { type: 'string' },
          source: { type: 'string' },
          degraded: { type: 'boolean' },
          readout: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string' },
                name: { type: 'string' },
                market: { type: 'string' },
                price: { type: 'number' },
                pct: { type: 'number' },
                pe: { type: 'number' },
                mcapYi: { type: 'number' },
                recent: { type: 'array', items: { type: 'object', additionalProperties: true } }
              }
            }
          }
        }
      },
      render: (_args, value) => {
        if (!value.ok || value.items.length === 0) {
          return text('行情暂不可用：外网接口失败且本地没有可用快照。面板里的政策与销量部分不受影响。')
        }
        const head = `行情 ${value.asOf.slice(0, 16).replace('T', ' ')}｜来源 ${value.source}${value.degraded ? '（离线快照，已降级）' : ''}`
        const rows = value.items.map((item) => {
          const price = item.price === null ? '—' : item.price
          const pct = item.pct === null ? '—' : `${item.pct > 0 ? '+' : ''}${item.pct}%`
          const pe = item.pe === null ? '—' : item.pe
          return `${item.name}(${item.code})  ${price} ${pct}｜市值 ${item.mcapYi} 亿｜PE ${pe}`
        })
        return text([head, '', ...rows, '', value.readout].join('\n'))
      }
    },
    async execute(args) {
      const market = await getMarket()
      const wanted = Array.isArray(args?.companies) ? args.companies.map((value) => String(value)) : []
      const items = wanted.length === 0
        ? market.items
        : market.items.filter((item) => wanted.some((needle) => item.name.includes(needle) || item.code === needle))

      return {
        ok: market.ok,
        asOf: market.asOf ?? new Date().toISOString(),
        source: market.source ?? 'unknown',
        degraded: market.degraded === true,
        readout: market.summary ? market.summary.readout : '暂无可解读的板块数据。',
        items: items.map((item) => ({
          code: item.code,
          name: item.name,
          market: item.market,
          price: item.price ?? 0,
          pct: item.pct ?? 0,
          pe: item.pe ?? 0,
          mcapYi: item.mcap ? Math.round(item.mcap / 1e8) : 0,
          recent: (item.trend ?? []).slice(-5).map((point) => ({ date: point.date, close: point.close }))
        }))
      }
    }
  }

  return [search, read, analyze, report, stats, stock]
}

function countTools(policies) {
  const counts = new Map()
  for (const policy of policies) {
    for (const tool of policy.toolTypes ?? ['未分类']) counts.set(tool, (counts.get(tool) ?? 0) + 1)
  }
  return [...counts.entries()].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count)
}

function countRegions(policies) {
  const counts = new Map()
  for (const policy of policies) {
    const key = policy.regionName ?? '未标注'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

export const OVERVIEW_PATH = '/api/auto-policy/v4/overview'

/**
 * 面板数据入口路径。插件热重载时旧实例注册的路由不会被回收，
 * 所以按顺序占用第一个空位：宿主与浏览器半边共用同一份候选表。
 */
const OVERVIEW_PATHS = [
  '/api/auto-policy/v4/overview',
  '/api/auto-policy/v5/overview',
  '/api/auto-policy/v6/overview',
  '/api/auto-policy/v7/overview'
]

function tryGet(ctx, key) {
  try {
    return ctx.get?.(key)
  } catch {
    return undefined
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  })
}

/** 单篇政策详情：全文 + 条款 + 版本 + 同主题邻居，供面板点开。 */
function policyDetail(config, id) {
  const library = loadLibrary(config?.dataDir)
  const wanted = String(id ?? '').trim()
  const policy = library.byId.get(wanted)
  if (!policy) return { ok: false, error: 'not-found', id: wanted }

  const tools = policy.toolTypes ?? []
  const related = library.policies
    .filter((item) => item.id !== policy.id && (item.toolTypes ?? []).some((tool) => tools.includes(tool)))
    .sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      title: item.title,
      issuer: item.issuer,
      publishDate: item.publishDate,
      levelName: LEVEL_NAMES[item.level] ?? '未知'
    }))

  return {
    ok: true,
    policy: {
      id: policy.id,
      title: policy.title,
      docNo: policy.docNo ?? '',
      issuer: policy.issuer,
      level: policy.level,
      levelName: LEVEL_NAMES[policy.level] ?? '未知',
      regionName: policy.regionName ?? '',
      publishDate: policy.publishDate,
      docType: policy.docType ?? '',
      toolTypes: tools,
      supplyChain: policy.supplyChain ?? [],
      nevSpecific: policy.nevSpecific === true,
      summary: policy.summary ?? '',
      content: policy.content ?? '',
      contentStatus: policy.contentStatus ?? (policy.content && policy.content.length > 300 ? 'full' : policy.content ? 'short' : 'none'),
      clauses: clausesOf(policy, 8),
      versions: policy.versions ?? [],
      sourceUrl: policy.sourceUrl ?? '',
      provenance: policy.provenance ?? ''
    },
    related
  }
}

/** 读取数据源健康快照（scripts/sources.mjs 生成），读不到就返回空数组。 */
function readSourceHealth() {
  try {
    const file = path.join(resolveDataDir(), 'source-health.json')
    if (!fs.existsSync(file)) return []
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(parsed.results) ? parsed.results : []
  } catch {
    return []
  }
}

/** 面板里的「生成报告」：与工具同一套渲染与质检，行情作为可选外挂数据。 */
async function buildReportPayload(config, params) {
  const library = loadLibrary(config?.dataDir)
  const region = params.get('region') || undefined
  const brand = params.get('brand') || undefined
  // 不传月份时交给 buildOverview 决定：它会取“该区域最近有政策的月份”，
  // 而不是最新销量月（否则 10 月没政策时会生成空报告）。
  const overview = buildOverview(library, { month: params.get('month') || undefined, region, brand })
  const analysis = overview.analysis

  let market = null
  try {
    market = await getMarket()
  } catch {
    market = null
  }

  const markdown = renderReport(analysis, {
    market,
    regionStats: overview.regionStats,
    libraryOverview: buildLibraryOverview(library),
    financials: library.financials,
    linkage: overview.linkage,
    recentPolicies: overview.recentPolicies,
    salesMonths: library.monthly.length,
    sourceHealth: readSourceHealth()
  })
  const lint = lintReport(markdown)
  return {
    ok: lint.ok,
    month: analysis.meta.month,
    region: analysis.meta.regionName,
    words: lint.words,
    citationCoverage: lint.citationCoverage,
    lintErrors: lint.errors,
    generatedAt: new Date().toISOString(),
    markdown
  }
}

/**
 * 返回 Word 版研究报告。文件由 scripts/build_research_docx.py 生成到 data/reports/，
 * 这里只做静态读取；找不到时返回 404 并提示生成命令。
 */
function serveReportDocx(config, month) {
  const base = resolveDataDir(config?.dataDir)
  const dir = path.join(base, 'reports')
  const candidates = month
    ? [`policy-research-${month}.docx`]
    : fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((name) => name.endsWith('.docx'))
          .sort()
          .reverse()
      : []
  const name = candidates.find((item) => fs.existsSync(path.join(dir, item)))
  if (!name) {
    return jsonResponse(
      {
        ok: false,
        error: 'docx-not-found',
        hint: '先运行 python scripts/build_research_docx.py --out data/reports/policy-research-YYYY-MM.docx'
      },
      404
    )
  }
  const buffer = fs.readFileSync(path.join(dir, name))
  return new Response(buffer, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="${name}"`,
      'content-length': String(buffer.length),
      'cache-control': 'no-store'
    }
  })
}

function createOverviewResource(config) {
  return async (request) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      const pathname = url.pathname.replace(/\/+$/, '')

      if (pathname.endsWith('/policy')) {
        return jsonResponse(policyDetail(config, url.searchParams.get('id')))
      }
      if (pathname.endsWith('/report')) {
        return jsonResponse(await buildReportPayload(config, url.searchParams))
      }
      // Word 版研究报告：直接返回 data/reports 下已生成的 docx
      if (pathname.endsWith('/report.docx')) {
        return serveReportDocx(config, url.searchParams.get('month'))
      }

      const payload = buildOverview(loadLibrary(config?.dataDir), {
        month: url.searchParams.get('month') ?? undefined,
        region: url.searchParams.get('region') ?? undefined,
        brand: url.searchParams.get('brand') ?? undefined
      })
      payload.market = await getMarket()
      payload.sourceHealth = readSourceHealth()
      payload.fetchedAt = new Date().toISOString()
      return jsonResponse(payload)
    } catch (error) {
      return jsonResponse({ ok: false, error: String(error?.message ?? error) }, 500)
    }
  }
}

export function apply(ctx, config) {
  const tools = buildTools(ctx, config)
  const disposers = tools.map((tool) => ctx.tools.register(tool))

  // The panel in the browser reads the same engine through one read-only route.
  // Absent in headless runs, so a missing web server must not fail activation.
  ctx.effect(() => {
    const webServer = tryGet(ctx, 'webServer')
    if (!webServer) return () => {}
    const resource = createOverviewResource(config)
    const disposers = []
    for (const path of OVERVIEW_PATHS) {
      try {
        disposers.push(webServer.register({ kind: 'prefix', path, resource }))
        break
      } catch {
        // 该路径被上一代实例占着（重载不回收），换下一个
      }
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'auto-policy: overview route')

  // 数据预热：政策/销量靠文件指纹自动失效，行情靠缓存到期；这里再加一层定时器，
  // 让面板在没人打开的时候也保持一份较新的行情与已解析的库。8 分钟一次，开销很小。
  ctx.effect(() => {
    const timer = tryGet(ctx, 'timer')
    if (!timer || typeof timer.interval !== 'function') return () => {}
    return timer.interval(() => {
      try {
        loadLibrary(config?.dataDir)
      } catch {
        // 数据文件缺失不应影响面板启动
      }
      getMarket().catch(() => {})
    }, 8 * 60 * 1000)
  }, 'auto-policy: warm data')

  return () => {
    for (const dispose of disposers) dispose()
  }
}