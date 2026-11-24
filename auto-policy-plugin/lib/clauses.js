const AUTO_WORDS = /汽车|车辆|乘用车|新能源|电动|充电|换电|电池|整车|购置税|车船税|积分|出口|置换|补贴|智驾|自动驾驶|召回|排放标准/

// 国际政策是英文正文，中文规则抽不到条款，这里补一套英文口径。
const AUTO_WORDS_EN =
  /electric vehicle|zero[- ]emission|fuel economy|emission standard|charging infrastructure|charging station|battery electric|automobile|light[- ]duty|heavy[- ]duty|motor vehicle safety|clean vehicle|plug-in/i

const NEGATIVE_WORDS = /不得|禁止|严禁|退坡|取消|加征|处罚|收紧|不予|暂停|不得低于|提高至|不得高于/
const POSITIVE_WORDS = /支持|鼓励|补贴|补助|免征|减免|优惠|奖励|放宽|便利|试点|推广|加快|完善|提高.*比例/

const NEGATIVE_WORDS_EN = /repeal|rescind|withdraw|prohibit|must not|deny|penalt|revoke|tighten|phase[- ]out|reject|disapprove/i
const POSITIVE_WORDS_EN = /credit|grant|incentive|allow|permit|expand|provide|establish|require standards|final rule|approve/i

const TARGETS = [
  [/出口|海外|关税|贸易|export|tariff|import/i, '整车出口与海外市场'],
  [/购置税|车船税|减免|tax credit|excise/i, '新能源乘用车购置成本'],
  [/以旧换新|报废更新|置换更新|trade[- ]in/i, '置换与报废更新需求'],
  [/充电|换电|补能|charging/i, '充换电运营与补能体验'],
  [/动力电池|电池|电芯|battery/i, '动力电池及回收产业'],
  [/智能网联|自动驾驶|车路云|智驾|automated driving|autonomous/i, '智能网联整车与供应商'],
  [/双积分|燃料消耗量|积分|fuel economy|CAFE/i, '整车企业积分与油耗合规'],
  [/排放|污染物|国七|国六|emission/i, '燃油车合规成本'],
  [/汽车|乘用车|整车|新能源|vehicle|automobile/i, '新能源与乘用车市场']
]

const directionOf = (text) => {
  if (NEGATIVE_WORDS.test(text) || NEGATIVE_WORDS_EN.test(text)) return 'negative'
  if (POSITIVE_WORDS.test(text) || POSITIVE_WORDS_EN.test(text)) return 'positive'
  return 'neutral'
}

const targetOf = (text) => TARGETS.find(([pattern]) => pattern.test(text))?.[1] ?? '汽车产业链'

/**
 * 从官方正文提取可复核的条款证据。
 * 只返回原文中确实存在的句子；方向只按明确措辞标注，其他一律“中性”，
 * 不生成弹性、不做无来源的影响判断。
 */
export function clausesOf(policy, limit = 5) {
  if (!policy?.sourceUrl || !policy?.content) return []

  const lines = String(policy.content)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 18)

  const candidates = []
  const seen = new Set()
  const normalizedTitle = String(policy.title ?? '').replace(/\s+/g, '')
  lines.forEach((line, index) => {
    const text = line.slice(0, 360)
    const normalized = text.replace(/\s+/g, '')
    // 标题、文号、主送机关、印发语和附件名不是“条款”。宁可少抽，也不把它们包装成影响。
    if (normalizedTitle && normalized.includes(normalizedTitle.slice(0, Math.min(24, normalizedTitle.length)))) return
    if (/^(现将|附件[:：]|各省、自治区|国务院各部门|请结合实际|特此通知|现印发)/.test(text)) return
    if (/^(现将|附件[:：])/.test(text)) return
    if (seen.has(normalized)) return
    seen.add(normalized)

    const heading = text.match(/^([一二三四五六七八九十百]+、|（[一二三四五六七八九十百]+）|第[一二三四五六七八九十百零]+条)/)?.[1] ?? ''
    const autoHit = AUTO_WORDS.test(text) || AUTO_WORDS_EN.test(text)
    const dirHit = NEGATIVE_WORDS.test(text) || POSITIVE_WORDS.test(text) || NEGATIVE_WORDS_EN.test(text) || POSITIVE_WORDS_EN.test(text)
    const relevance = (autoHit ? 3 : 0) + (/\d/.test(text) ? 2 : 0) + (dirHit ? 1 : 0)
    if (relevance < 3) return

    const direction = directionOf(text)
    candidates.push({
      no: heading || `第${index + 1}段`,
      text,
      quote: text,
      paragraph: index + 1,
      relevance,
      impact: {
        target: targetOf(text),
        direction,
        magnitude: /\d/.test(text) ? 2 : 1,
        note: direction === 'neutral' ? '仅摘录原文，方向需结合上下文研判' : '依据原文明确措辞标注'
      }
    })
  })

  return candidates
    .sort((a, b) => b.relevance - a.relevance || a.paragraph - b.paragraph)
    .slice(0, limit)
    .map((item) => ({
      no: item.no,
      text: item.text,
      quote: item.quote,
      paragraph: item.paragraph,
      sourceUrl: policy.sourceUrl,
      impact: item.impact
    }))
}
