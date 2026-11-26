# -*- coding: utf-8 -*-
"""把报告的 Markdown 渲染成公文格式 DOCX（GB/T 9704 版式）。

单一来源原则：报告正文只由 lib/report.js 生成一份 Markdown，
Word 只是它的排版结果，避免出现「Word 与 MD 内容不一致」。

用法：
  python md_to_docx.py --md reports/x.md --out data/reports/x.docx
"""
import argparse
import os
import re

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Mm, Pt

TITLE_FONT = "方正小标宋简体"
TITLE_FALLBACK = "宋体"
BODY_FONT = "仿宋"
H1_FONT = "黑体"
H2_FONT = "楷体"
BODY_SIZE = 16  # 三号
LINE = 28.8


def set_font(run, name, size_pt, bold=False):
    run.font.name = name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), name)


def setup():
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
    normal.font.size = Pt(BODY_SIZE)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
    return document


def body_paragraph(document, text, size=BODY_SIZE, font=BODY_FONT, indent=True, bold=False):
    paragraph = document.add_paragraph()
    fmt = paragraph.paragraph_format
    fmt.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    fmt.line_spacing = Pt(LINE)
    fmt.space_after = Pt(0)
    if indent:
        fmt.first_line_indent = Pt(size * 2)
    # 处理 **加粗**
    for index, chunk in enumerate(re.split(r"\*\*(.+?)\*\*", text)):
        if not chunk:
            continue
        run = paragraph.add_run(chunk)
        set_font(run, font, size, bold=bold or index % 2 == 1)
    return paragraph


def title(document, text):
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(18)
    paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    paragraph.paragraph_format.line_spacing = Pt(34)
    run = paragraph.add_run(text)
    try:
        set_font(run, TITLE_FONT, 22)
    except Exception:
        set_font(run, TITLE_FALLBACK, 22, bold=True)


def h1(document, text):
    paragraph = document.add_paragraph()
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(12)
    fmt.space_after = Pt(6)
    fmt.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    fmt.line_spacing = Pt(LINE)
    fmt.first_line_indent = Pt(BODY_SIZE * 2)
    run = paragraph.add_run(text)
    set_font(run, H1_FONT, BODY_SIZE)


def h2(document, text):
    paragraph = document.add_paragraph()
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(6)
    fmt.space_after = Pt(4)
    fmt.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    fmt.line_spacing = Pt(LINE)
    fmt.first_line_indent = Pt(BODY_SIZE * 2)
    run = paragraph.add_run(text)
    set_font(run, H2_FONT, BODY_SIZE)


def table_block(document, rows):
    if not rows:
        return
    header, *rest = rows
    table = document.add_table(rows=1, cols=len(header))
    table.style = "Table Grid"
    for index, cell_text in enumerate(header):
        cell = table.rows[0].cells[index]
        cell.text = ""
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = paragraph.add_run(cell_text)
        set_font(run, H1_FONT, 10.5)
    for row in rest:
        cells = table.add_row().cells
        for index in range(len(header)):
            value = row[index] if index < len(row) else ""
            cells[index].text = ""
            paragraph = cells[index].paragraphs[0]
            run = paragraph.add_run(value)
            set_font(run, BODY_FONT, 10.5)
    document.add_paragraph()


def split_row(line):
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|"):
        text = text[:-1]
    return [cell.strip() for cell in text.split("|")]


def render(md_path, out_path):
    with open(md_path, "r", encoding="utf-8") as handle:
        lines = handle.read().split("\n")

    document = setup()
    index = 0
    while index < len(lines):
        line = lines[index].rstrip()
        stripped = line.strip()

        if not stripped:
            index += 1
            continue

        # 表格：连续的 | 行
        if stripped.startswith("|"):
            block = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                row = split_row(lines[index])
                if not all(re.fullmatch(r":?-{2,}:?", cell or "-") for cell in row):
                    block.append(row)
                index += 1
            table_block(document, block)
            continue

        if stripped.startswith("# "):
            title(document, stripped[2:].strip())
        elif stripped.startswith("## "):
            h1(document, stripped[3:].strip())
        elif stripped.startswith("### "):
            h2(document, stripped[4:].strip())
        elif stripped.startswith("---"):
            pass
        elif stripped.startswith(">"):
            body_paragraph(document, stripped.lstrip("> ").strip(), size=12, font=H2_FONT)
        elif re.match(r"^[-*]\s+", stripped):
            body_paragraph(document, stripped)
        elif re.match(r"^\d+[.、)]\s*", stripped):
            body_paragraph(document, stripped)
        else:
            body_paragraph(document, stripped)
        index += 1

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    document.save(out_path)
    return out_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--md", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    path = render(args.md, args.out)
    print("saved", path)