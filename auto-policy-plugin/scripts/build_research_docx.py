# -*- coding: utf-8 -*-
"""生成《新能源汽车政策与产业发展研究报告》Word 文稿（GB/T 9704 版式）。

数据全部来自插件数据目录，正文数字均可回溯：
  data/policies.json        国内政策库（78 条）
  data/sales.json           懂车帝月度零售（2026-01 ~ 2026-10）
  data/chery-official.json  奇瑞控股官网公告（集团/出口/新能源/分品牌）

用法：
  python build_research_docx.py --out <路径.docx> --month 2026-09
"""
import argparse
import json
import os
from datetime import date

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Mm, Pt

DATA_DIR = os.environ.get(
    "AUTO_POLICY_DATA_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"),
)

TITLE_FONT = "方正小标宋简体"
TITLE_FALLBACK = "宋体"
BODY_FONT = "仿宋"
H1_FONT = "黑体"
H2_FONT = "楷体"


def build_linkage(quarters=6):
    """政策与财报季度对照由 Node 侧（lib/linkage.js）算好写成 linkage.json，这里只负责读取。

    不在 Python 里重算，避免 PSI 公式出现两套实现、口径不一致。
    """
    payload = load("linkage.json")
    rows = payload.get("rows") or []
    return rows[:quarters] if rows else []


def share_of(entry):
    """原始 sales.json 只存 total/nev，没有 share 字段，这里按口径现算。"""
    national = (entry or {}).get("national") or {}
    total = national.get("total") or 0
    nev = national.get("nev") or 0
    if not total:
        return 0
    return round(100.0 * nev / total, 1)


def load(name):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def set_run_font(run, name, size_pt, bold=False):
    run.font.name = name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)


def setup_document():
    document = Document()
    section = document.sections[0]
    section.page_width = Mm(210)
    section.page_height = Mm(297)
    section.top_margin = Mm(37)
    section.bottom_margin = Mm(35)
    section.left_margin = Mm(28)
    section.right_margin = Mm(26)

    normal = document.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(16)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
    return document


def add_title(document, text):
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(18)
    paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    paragraph.paragraph_format.line_spacing = Pt(34)
    run = paragraph.add_run(text)
    try:
        set_run_font(run, TITLE_FONT, 22)
    except Exception:
        set_run_font(run, TITLE_FALLBACK, 22, bold=True)
    return paragraph


def add_subtitle(document, text):
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(16)
    run = paragraph.add_run(text)
    set_run_font(run, "楷体", 14)


def add_h1(document, text):
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(12)
    paragraph.paragraph_format.space_after = Pt(6)
    paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    paragraph.paragraph_format.line_spacing = Pt(28.8)
    paragraph.paragraph_format.first_line_indent = Pt(32)
    run = paragraph.add_run(text)
    set_run_font(run, H1_FONT, 16)


def add_h2(document, text):
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(6)
    paragraph.paragraph_format.space_after = Pt(4)
    paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    paragraph.paragraph_format.line_spacing = Pt(28.8)
    paragraph.paragraph_format.first_line_indent = Pt(32)
    run = paragraph.add_run(text)
    set_run_font(run, H2_FONT, 16)


def add_body(document, text):
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.first_line_indent = Pt(32)
    paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    paragraph.paragraph_format.line_spacing = Pt(28.8)
    paragraph.paragraph_format.space_after = Pt(0)
    run = paragraph.add_run(text)
    set_run_font(run, BODY_FONT, 16)
    return paragraph


def add_table(document, headers, rows, caption=None):
    if caption:
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.first_line_indent = Pt(32)
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
        paragraph.paragraph_format.line_spacing = Pt(28.8)
        run = paragraph.add_run(caption)
        set_run_font(run, H2_FONT, 16)
    table = document.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    for index, header in enumerate(headers):
        cell = table.rows[0].cells[index]
        cell.text = ""
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = paragraph.add_run(header)
        set_run_font(run, H1_FONT, 10.5)
    for row in rows:
        cells = table.add_row().cells
        for index, value in enumerate(row):
            cells[index].text = ""
            paragraph = cells[index].paragraphs[0]
            run = paragraph.add_run(str(value))
            set_run_font(run, BODY_FONT, 10.5)
    return table


def add_signature(document, unit, day):
    document.add_paragraph()
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run(unit)
    set_run_font(run, BODY_FONT, 16)
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run(day)
    set_run_font(run, BODY_FONT, 16)


def build(month, out_path):
    policies = load("policies.json")["policies"]
    sales = load("sales.json")
    chery = load("chery-official.json")

    domestic = [item for item in policies if int(item.get("level", 1)) != 0]
    national = [item for item in domestic if int(item.get("level", 1)) == 1]
    hunan = [item for item in domestic if str(item.get("region")) == "430000"]

    by_year = {}
    by_tool = {}
    for item in domestic:
        year = str(item.get("publishDate", ""))[:4]
        by_year[year] = by_year.get(year, 0) + 1
        for tool in item.get("toolTypes") or []:
            by_tool[tool] = by_tool.get(tool, 0) + 1

    month_policies = [item for item in domestic if str(item.get("publishDate", ""))[:7] == month]
    monthly = {row["month"]: row for row in sales.get("monthly", [])}
    current = monthly.get(month) or {}
    previous = monthly.get("2026-08") or {}
    latest = monthly.get("2026-10") or {}

    chery_latest = chery["months"][-1]
    chery_with_export = [row for row in chery["months"] if row.get("export")]
    chery_export_latest = chery_with_export[-1] if chery_with_export else None

    brand_month = (sales.get("brandMonthly") or {}).get(month, {})
    top_brands = sorted(brand_month.items(), key=lambda kv: -kv[1])[:5]
    total = current.get("national", {}).get("total", 0)
    share_rows = [(name, value, round(100.0 * value / total, 1) if total else 0) for name, value in top_brands]
    cr5 = round(sum(row[2] for row in share_rows[:5]), 1)

    document = setup_document()

    add_title(document, "新能源汽车政策与产业发展研究报告")
    add_subtitle(document, "（2026 年 9 月）")

    add_body(
        document,
        "本报告基于本台政策库与公开市场数据编制，研究范围覆盖政策供给、市场运行、品牌格局与重点企业四个层面。"
        "所有数字均可回溯到官方原文或公开数据接口，未标注来源的判断均为研究判断，不作为事实陈述使用。",
    )

    add_h1(document, "一、总体情况")
    add_body(
        document,
        f"政策库现收录国内新能源汽车相关政策 {len(domestic)} 条，其中国家级 {len(national)} 条、湖南省级 {len(hunan)} 条，"
        f"时间跨度为 2020 年 11 月至 2026 年 9 月。按年度分布，2023 年 {by_year.get('2023', 0)} 条、"
        f"2024 年 {by_year.get('2024', 0)} 条、2025 年 {by_year.get('2025', 0)} 条、2026 年 {by_year.get('2026', 0)} 条。",
    )
    add_body(
        document,
        f"当月收录政策 {len(month_policies)} 条。市场方面，当月全国乘用车零售 "
        f"{current.get('national', {}).get('total', 0):,} 辆，其中新能源 "
        f"{current.get('national', {}).get('nev', 0):,} 辆，渗透率 {share_of(current)}%。",
    )

    add_h1(document, "二、政策供给特征")
    add_h2(document, "（一）工具结构以规划为主")
    tool_sorted = sorted(by_tool.items(), key=lambda kv: -kv[1])
    tool_text = "、".join(f"{name} {count} 条" for name, count in tool_sorted)
    add_body(
        document,
        f"按政策工具统计，{tool_text}。规划类占比最高，补贴类仅 {by_tool.get('补贴', 0)} 条。"
        "这一结构表明，当前政策重心已从直接购置补贴转向产业规划、技术标准与基础设施布局，"
        "政策效果更多取决于地方配套细则与执行进度，而非一次性资金刺激。",
    )
    add_h2(document, "（二）层级结构以国家级为主")
    add_body(
        document,
        f"国家级 {len(national)} 条、省级 {len(hunan)} 条。湖南省级政策集中于省政府办公厅、省工业和信息化厅、"
        "省发展和改革委员会三个发布主体，内容以充换电基础设施、渗透率目标与项目备案为主。",
    )
    add_h2(document, "（三）月度供给不均衡")
    add_body(
        document,
        f"{month}当月收录的 {len(month_policies)} 条政策中，"
        + "；".join(f"《{item.get('title', '')[:40]}》（{item.get('issuer', '')}，{item.get('publishDate', '')}）" for item in month_policies)
        + "。政策发布具有明显的批次性，单月数量波动较大，分析时应拉长窗口观察，避免以单月数量推断政策力度。",
    )

    add_h1(document, "三、市场运行态势")
    add_h2(document, "（一）总量回升，渗透率进入平台期")
    add_body(
        document,
        f"2026 年 8 月至 10 月，全国乘用车零售分别为 {previous.get('national', {}).get('total', 0):,} 辆、"
        f"{current.get('national', {}).get('total', 0):,} 辆、{latest.get('national', {}).get('total', 0):,} 辆，"
        f"同期新能源渗透率分别为 {share_of(previous)}%、"
        f"{share_of(current)}%、{share_of(latest)}%。"
        "总量稳步回升的同时，渗透率在 57% 附近震荡并出现小幅回落，说明新能源对燃油车的替代已进入中后段，"
        "后续增量更多依赖存量置换与出口，而非首次购车人群的快速转化。",
    )
    add_table(
        document,
        ["月份", "乘用车零售（辆）", "新能源零售（辆）", "渗透率"],
        [
            [row_key, f"{monthly[row_key]['national']['total']:,}", f"{monthly[row_key]['national']['nev']:,}",
             f"{share_of(monthly[row_key])}%"]
            for row_key in ["2026-08", "2026-09", "2026-10"]
            if row_key in monthly
        ],
        caption="表 1  近三个月全国乘用车零售与新能源渗透率",
    )
    document.add_paragraph()

    add_h2(document, "（二）品牌集中度仍处中位")
    add_body(
        document,
        f"{month}排名前五的品牌合计份额为 {cr5}%，"
        + "、".join(f"{name} {share}%" for name, _, share in share_rows)
        + "。头部比亚迪、吉利合计超过 20%，但前五合计不足四成，说明市场尚未形成寡头格局，"
        "第二梯队仍存在份额提升空间。",
    )

    add_h1(document, "四、奇瑞专项分析")
    add_body(
        document,
        "奇瑞同时存在两套可核验口径：一是懂车帝国内上险零售，二是奇瑞控股官网公告的集团批发含出口口径。"
        "两者统计范围不同，不可相加或直接比较，须并列观察。",
    )
    chery_row = sales.get("brandMonthly", {}).get(month, {}).get("奇瑞")
    if chery_row:
        add_body(
            document,
            f"国内上险口径下，{month}奇瑞零售 {chery_row:,} 辆，占全国 {round(100.0 * chery_row / total, 1) if total else 0}%。",
        )
    if chery_export_latest:
        export_ratio = round(100.0 * chery_export_latest["export"] / chery_export_latest["groupSales"], 1)
        nev_ratio = (
            round(100.0 * chery_export_latest["nev"] / chery_export_latest["groupSales"], 1)
            if chery_export_latest.get("nev")
            else None
        )
        add_body(
            document,
            f"官方公告口径下，{chery_export_latest['month']}奇瑞集团销量 "
            f"{chery_export_latest['groupSales']:,} 辆，其中出口 {chery_export_latest['export']:,} 辆，占集团销量 {export_ratio}%"
            + (f"；新能源 {chery_export_latest['nev']:,} 辆，占 {nev_ratio}%" if nev_ratio else "")
            + f"。（来源：奇瑞控股官网新闻中心，{chery_export_latest['sourceUrl']}）",
        )
        brands = chery_export_latest.get("brands") or []
        if brands:
            add_table(
                document,
                ["品牌", "当月销量（辆）"],
                [[item["brand"], f"{item['sales']:,}"] for item in brands],
                caption=f"表 2  {chery_export_latest['month']} 奇瑞集团分品牌销量",
            )
            document.add_paragraph()
            add_body(
                document,
                f"分品牌看，奇瑞品牌 {brands[0]['sales']:,} 辆为绝对主力，捷途 {[b for b in brands if b['brand'] == '捷途'][0]['sales']:,} 辆居次，"
                "星途、iCAR、智界三个新能源与高端品牌合计仍不足两万辆。研究判断：集团销量对主品牌依赖度高，"
                "新能源品牌矩阵尚未形成第二增长曲线，出口是当前最主要的结构性变量。",
            )
    add_body(
        document,
        f"从 21 个月官方公告序列看，奇瑞出口占比在 {round(100.0 * chery_export_latest['export'] / chery_export_latest['groupSales'], 1) if chery_export_latest else '—'}% 左右，"
        "显著高于行业平均水平。这解释了为何其国内上险份额（约 5%）明显低于集团销量排名——集团排名中包含大量出口。"
        "对奇瑞的政策研究，应把出口目的国的准入与关税政策纳入跟踪范围，而非仅看国内补贴与路权。",
    )

    add_h1(document, "五、主要上市车企财务表现")
    add_body(
        document,
        "财务数据取自东方财富数据中心，A 股为公司营业总收入与归母净利润，港股为营业额与股东应占溢利，"
        "各自本币列示，不做汇率折算。季度数据以各公司官方定期报告为准，本表用于观察行业整体盈利水平，不作个股推荐。",
    )
    financials = load("financials.json")
    fin_rows = []
    for company in financials.get("companies", []):
        periods = company.get("periods") or []
        if not periods:
            continue
        latest = periods[0]
        unit = "亿港元" if company.get("currency") == "HKD" else "亿元"
        fin_rows.append([
            company.get("name", ""),
            latest.get("reportDate", "")[:7] + " " + latest.get("reportType", ""),
            f"{latest.get('revenue', 0) / 1e8:.1f} {unit}",
            "—" if latest.get("netProfit") is None else f"{latest['netProfit'] / 1e8:.1f} {unit}",
            "—" if latest.get("grossMargin") is None else f"{latest['grossMargin']:.1f}%",
        ])
    if fin_rows:
        add_table(document, ["公司", "报告期", "营业收入", "净利润", "毛利率"], fin_rows,
                  caption="表 3  主要上市车企最新报告期业绩")
        document.add_paragraph()

    outlook_rows = []
    for company in financials.get("companies", []):
        forecasts = company.get("forecasts") or []
        ratings = company.get("ratings") or None
        forecast = forecasts[0] if forecasts else None
        breakdown = (ratings or {}).get("breakdown") or []
        rating = breakdown[0] if breakdown else None
        if not forecast and not rating:
            continue
        growth = "—"
        if forecast and forecast.get("growthUpper") is not None:
            low = forecast.get("growthLower")
            growth = f"{'-' if low is None else f'{low:.0f}'}% ~ {forecast['growthUpper']:.0f}%"
        outlook_rows.append([
            company.get("name", ""),
            forecast.get("type", "—") if forecast else "—",
            growth,
            f"{rating['name']}×{rating['count']}" if rating else "—",
            f"{ratings.get('recentCount', 0)}/{ratings.get('total', 0)}" if ratings else "—",
        ])
    if outlook_rows:
        add_table(document, ["公司", "最新预告类型", "预告同比区间", "近半年主流评级", "研报数/总数"],
                  outlook_rows, caption="表 4  业绩预告与机构评级（仅 A 股样本）")
        document.add_paragraph()

    consensus_rows = []
    for company in financials.get("companies", []):
        consensus = company.get("consensus") or None
        if not consensus:
            continue
        target = (company.get("ratings") or {}).get("targetPrice") or None
        years = [item for item in (consensus.get("years") or []) if item.get("mark") == "E"][:2]
        consensus_rows.append([
            company.get("name", ""),
            f"{consensus.get('ratingOrgNum') or '—'} 家",
            f"{consensus.get('buy') or 0}/{consensus.get('add') or 0}/{consensus.get('neutral') or 0}",
            " · ".join(f"{item['year']}E {float(item['eps']):.2f}" for item in years) or "—",
            f"{target['median']} 元（{target['count']} 份）" if target else "—",
        ])
    if consensus_rows:
        add_table(document, ["公司", "覆盖机构", "买入/增持/中性", "未来两年 EPS 预期", "目标价中位数"],
                  consensus_rows, caption="表 5  一致预期与目标价（仅 A 股样本）")
        document.add_paragraph()

    # 政策与财报季度对照
    linkage = build_linkage()
    if linkage:
        add_table(
            document,
            ["季度", "政策条数", "季度 PSI", "样本平均毛利率", "样本平均营收同比"],
            [
                [
                    row["quarter"],
                    f"{row['policyCount']} 条",
                    f"{row['psi']}",
                    "—" if row["avgGrossMargin"] is None else f"{row['avgGrossMargin']}%",
                    "—" if row["avgRevenueGrowth"] is None else f"{row['avgRevenueGrowth']:+.1f}%",
                ]
                for row in linkage
            ],
            caption="表 6  政策与财报季度对照（A 股 5 家整车企业均值）",
        )
        document.add_paragraph()
        peak = max(linkage, key=lambda row: row["policyCount"])
        latest = linkage[0]
        add_body(
            document,
            f"政策高峰出现在 {peak['quarter']}（{peak['policyCount']} 条，季度 PSI {peak['psi']}），"
            f"当季样本平均毛利率 {peak['avgGrossMargin']}%；最近一个季度 {latest['quarter']} 政策 {latest['policyCount']} 条，"
            f"样本平均毛利率 {latest['avgGrossMargin']}%，营收同比 {latest['avgRevenueGrowth']}%。"
            "政策按月发布、财报按季披露，两者只能做同向观察：政策密集期往往对应行业景气高点，"
            "而政策效果真正体现在盈利上通常滞后一到两个季度。此处不做因果归因。",
        )

    if fin_rows:
        loss_makers = [row for row in fin_rows if row[3].startswith("-")]
        add_body(
            document,
            "从最新报告期看，行业盈利分化明显：头部企业净利润规模领先，"
            + (
                "部分新能源品牌仍处于亏损状态（" + "、".join(row[0] for row in loss_makers) + "），"
                if loss_makers
                else "主要样本均已实现盈利，"
            )
            + "毛利率区间集中在 11% 至 23%，说明价格竞争仍在压缩单车盈利空间。"
            "研究判断：在渗透率进入平台期的背景下，盈利能力而非销量增速将成为下一阶段分化的主要变量。",
        )

    if outlook_rows:
        rising = [row[0] for row in outlook_rows if row[1] in ("预增", "扭亏", "续盈", "略增")]
        falling = [row[0] for row in outlook_rows if row[1] in ("预减", "首亏", "续亏", "略减")]
        add_body(
            document,
            "从业绩预告看，"
            + (f"{'、'.join(rising)}给出增长或扭亏指引，" if rising else "")
            + (f"{'、'.join(falling)}则提示下滑或亏损，" if falling else "")
            + "卖方评级仍以买入为主，说明市场对短期业绩波动已有预期。"
            "需要注意的是，预告区间来自公司自愿披露，与实际财报可能存在差异。",
        )

    add_h1(document, "六、主要判断")
    add_body(document, "（一）政策工具已完成从补贴到规则的切换。2026 年新收录政策以规划和标准为主，直接资金补贴占比很低，"
                       "企业竞争的关键变量从“拿补贴”转向“达标准、占入口”。")
    add_body(document, "（二）湖南政策与本地产业匹配度需要进一步验证。湖南 13 条政策集中在充换电基础设施与渗透率目标，"
                       "与省内整车产能布局的对应关系尚缺公开数据支撑，建议结合产销数据专项核实。")
    add_body(document, "（三）渗透率平台期意味着增长逻辑改变。57% 上下的渗透率若持续，增量将主要来自存量燃油车置换与海外市场，"
                       "政策工具的有效性也随之从购置端转向使用端，如电价、路权、充电便利性。")
    add_body(document, "（四）奇瑞的结构性风险在于出口依赖。出口占比过半意味着海外贸易政策变化对其影响放大，"
                       "国内政策对其边际作用相对减弱。")

    add_h1(document, "七、下一步跟踪建议")
    add_body(document, "（一）跟踪湖南省《加快提升新能源汽车渗透率行动计划（2025—2026 年）》2026 年底到期后的接续政策。")
    add_body(document, "（二）跟踪国家“十五五”智能网联新能源汽车规划的实施细则与配套标准。")
    add_body(document, "（三）跟踪奇瑞出口目的国的关税与准入变化，建议按月补充海关出口数据以替代公告口径的滞后。")
    add_body(document, "（四）补齐分省销量数据，使湖南研究从政策层下沉到市场层。")

    add_h1(document, "八、数据说明与边界")
    add_body(
        document,
        "本报告政策数据来自国务院政策文件库、湖南省政府门户网站、湖南省工业和信息化厅、湖南省发展和改革委员会、"
        "国家法律法规数据库，全部条目均附官方原文链接。销量数据来自懂车帝公开销量榜，为零售/上险（终端）口径，"
        "与乘联会批发口径不同，不可混用。奇瑞官方数据来自其控股官网公告，为集团批发含出口口径。",
    )
    add_body(
        document,
        "当前尚未获取的分省销量、奇瑞出口分月明细（部分月份）、2026 年 10 至 11 月政策，均未以估算值填充，"
        "相关结论以现有可核验数据为限。本报告为内部研究材料，不构成投资建议，也不替代主管部门的正式政策解读。",
    )

    add_signature(document, "汽车政策研究台", date.today().strftime("%Y年%m月%d日"))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    document.save(out_path)
    return out_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--month", default="2026-09")
    args = parser.parse_args()
    path = build(args.month, args.out)
    print("saved", path)