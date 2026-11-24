/**
 * 汽车政策研究台 —— 浏览器半边（科技风控制台）
 *
 * 入口：sidebar.footer.action（左侧栏底部，设置旁边）
 * 面板：shell.overlay —— 该层本身是点击穿透的，只有卡片本体接管指针事件，
 *       所以面板浮在对话之上时，卡片以外的区域照常可以点、可以输入。
 *
 * 数据：GET /api/auto-policy/overview?month=&region=
 *       Host 半边用与报告相同的引擎现算，行情另走东方财富公开接口并带 10 分钟缓存。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-auto-policy',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    const TOGGLE_EVENT = 'dsh-auto-policy-toggle'
    const STATE_EVENT = 'dsh-auto-policy-state'

    const CSS = `
.ap-side-entry {
  display: inline-flex; align-items: center; gap: 8px;
  height: 30px; padding: 0 8px; margin: 0;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-secondary, #6b7280);
  cursor: pointer; font: inherit; font-size: 13px; line-height: 1;
  transition: background-color .15s ease, color .15s ease;
}
.ap-side-entry:hover { background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.05)); color: var(--dsw-alias-label-primary, #111827); }
.ap-side-entry:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #2563eb); outline-offset: 2px; }
.ap-side-entry[data-active="true"] { color: #0891b2; background: rgba(34,211,238,.12); }
.ap-side-entry svg { flex: none; }

/* ---------- 点击穿透层：只有卡片接管事件 ---------- */
.ap-layer {
  position: fixed; inset: 0; z-index: 9000;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 44px 24px 20px;
  pointer-events: none;
  font-family: "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12.5px; line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

/* ---------- 卡片本体 ---------- */
.ap-shell {
  pointer-events: auto;
  position: relative;
  width: 1180px; max-width: 100%;
  max-height: calc(100vh - 70px);
  display: flex; flex-direction: column;
  border-radius: 14px; overflow: hidden;
  color: #e6eefc;
  background:
    radial-gradient(1200px 420px at 12% -10%, rgba(34,211,238,.14), transparent 62%),
    radial-gradient(900px 380px at 92% 0%, rgba(59,130,246,.16), transparent 58%),
    linear-gradient(165deg, #070b14 0%, #0a1120 46%, #060a12 100%);
  border: 1px solid rgba(56,189,248,.22);
  box-shadow:
    0 0 0 1px rgba(2,6,23,.8),
    0 28px 80px rgba(0,0,0,.62),
    0 0 46px rgba(34,211,238,.10);
  animation: ap-in .2s cubic-bezier(.2,.8,.2,1);
}
.ap-shell::before {
  content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(120,180,255,.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120,180,255,.045) 1px, transparent 1px);
  background-size: 34px 34px, 34px 34px;
  mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 78%);
  -webkit-mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 78%);
}
@keyframes ap-in { from { opacity: 0; transform: translateY(8px) scale(.995) } to { opacity: 1; transform: none } }

.ap-mono { font-family: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace; }

/* ---------- 头部 ---------- */
.ap-head {
  position: relative; z-index: 1;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px 11px;
  border-bottom: 1px solid rgba(56,189,248,.16);
  background: linear-gradient(180deg, rgba(12,22,38,.92), rgba(8,14,26,.62));
  cursor: grab;
  user-select: none;
}
.ap-head[data-dragging="true"] { cursor: grabbing; }
.ap-mark {
  width: 32px; height: 32px; flex: none; display: grid; place-items: center;
  border-radius: 9px; color: #eaf6ff;
  background: linear-gradient(140deg, #22d3ee, #2563eb 62%, #4f46e5);
  box-shadow: 0 0 18px rgba(34,211,238,.42), inset 0 0 12px rgba(255,255,255,.18);
}
.ap-brand { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ap-brand b { font-size: 14.5px; font-weight: 600; letter-spacing: .4px; }
.ap-brand span { font-size: 9.5px; letter-spacing: .18em; text-transform: uppercase; color: #6f88ab; }
.ap-live {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase;
  color: #67e8f9; padding: 2px 8px; border-radius: 999px;
  border: 1px solid rgba(34,211,238,.32); background: rgba(34,211,238,.08);
}
.ap-live i { width: 5px; height: 5px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 8px #22d3ee; animation: ap-pulse 1.8s ease-in-out infinite; }
@keyframes ap-pulse { 0%,100% { opacity: 1 } 50% { opacity: .28 } }
.ap-grow { flex: 1 1 auto; }

.ap-ctl {
  display: inline-flex; align-items: center; height: 27px; padding: 0 9px;
  border-radius: 7px; cursor: pointer; font: inherit; font-size: 11.5px;
  color: #9db4d6; background: rgba(148,190,255,.06);
  border: 1px solid rgba(120,180,255,.16);
  transition: background-color .14s ease, color .14s ease, border-color .14s ease;
}
.ap-ctl:hover { background: rgba(34,211,238,.14); color: #e6f6ff; border-color: rgba(34,211,238,.42); }
.ap-ctl:focus-visible { outline: 2px solid rgba(34,211,238,.7); outline-offset: 1px; }
.ap-ctl[data-on="true"] { color: #06202a; background: linear-gradient(180deg, #67e8f9, #22d3ee); border-color: #22d3ee; font-weight: 600; }
.ap-seg { display: inline-flex; gap: 3px; padding: 3px; border-radius: 8px; background: rgba(148,190,255,.06); border: 1px solid rgba(120,180,255,.14); }
.ap-seg .ap-ctl { border: 0; background: transparent; height: 23px; }
.ap-seg .ap-ctl[data-on="true"] { box-shadow: 0 0 14px rgba(34,211,238,.34); }
.ap-pick {
  height: 27px; border-radius: 7px; font: inherit; font-size: 11.5px; padding: 0 6px;
  color: #cfe4ff; background: rgba(148,190,255,.06);
  border: 1px solid rgba(120,180,255,.16);
}
.ap-pick option { color: #0b1220; }

/* ---------- 正文 ---------- */
.ap-body {
  position: relative; z-index: 1;
  flex: 1 1 auto; overflow: auto;
  padding: 14px 16px 18px;
  display: flex; flex-direction: column; gap: 12px;
  scrollbar-width: thin; scrollbar-color: rgba(56,189,248,.34) transparent;
}
.ap-body::-webkit-scrollbar { width: 8px; }
.ap-body::-webkit-scrollbar-thumb { background: rgba(56,189,248,.28); border-radius: 8px; }

.ap-card {
  position: relative;
  display: flex; flex-direction: column; gap: 9px;
  padding: 12px 14px 13px; border-radius: 11px;
  background: linear-gradient(180deg, rgba(16,28,46,.72), rgba(9,16,28,.55));
  border: 1px solid rgba(90,150,220,.16);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
  min-width: 0;
}
.ap-card::before, .ap-card::after {
  content: ""; position: absolute; width: 12px; height: 12px; pointer-events: none;
  border-color: rgba(34,211,238,.5); border-style: solid;
}
.ap-card::before { top: -1px; left: -1px; border-width: 1px 0 0 1px; border-top-left-radius: 4px; }
.ap-card::after { bottom: -1px; right: -1px; border-width: 0 1px 1px 0; border-bottom-right-radius: 4px; }
.ap-card-head { display: flex; align-items: center; gap: 8px; }
.ap-card-title { font-size: 11.5px; font-weight: 600; letter-spacing: .1em; color: #cfe4ff; text-transform: uppercase; }
.ap-card-sub { margin-left: auto; font-size: 10px; color: #6f88ab; letter-spacing: .04em; }
.ap-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ap-grid-3 { display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 12px; }

/* ---------- 奇瑞专区 ---------- */
.ap-chery { border-color: rgba(34,211,238,.34); background: linear-gradient(160deg, rgba(9,32,48,.9), rgba(8,16,30,.66) 58%, rgba(10,20,36,.72)); }
.ap-chery-top { display: grid; grid-template-columns: minmax(210px, 1.05fr) minmax(240px, 1.35fr) minmax(190px, .95fr); gap: 14px; align-items: stretch; }
.ap-hero-num { display: flex; flex-direction: column; gap: 2px; }
.ap-eyebrow { font-size: 9.5px; letter-spacing: .18em; text-transform: uppercase; color: #6f88ab; }
.ap-big { display: flex; align-items: baseline; gap: 6px; }
.ap-big b { font-size: 32px; line-height: 1.05; font-weight: 650; letter-spacing: -.6px; color: #eaf6ff; text-shadow: 0 0 24px rgba(34,211,238,.34); }
.ap-big span { font-size: 11.5px; color: #7f9ab8; }
.ap-facts { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 4px; }
.ap-fact { display: flex; flex-direction: column; gap: 1px; }
.ap-fact b { font-size: 13.5px; color: #d9ecff; }
.ap-fact span { font-size: 9.5px; color: #6f88ab; letter-spacing: .06em; }

.ap-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px; border-radius: 999px; font-size: 10px; letter-spacing: .04em;
  border: 1px solid rgba(120,180,255,.2); color: #9db4d6; background: rgba(148,190,255,.05);
}
.ap-tag[data-tone="up"] { color: #86efac; border-color: rgba(134,239,172,.34); background: rgba(134,239,172,.1); }
.ap-tag[data-tone="down"] { color: #fda4af; border-color: rgba(253,164,175,.34); background: rgba(253,164,175,.1); }
.ap-tag[data-tone="hot"] { color: #67e8f9; border-color: rgba(34,211,238,.4); background: rgba(34,211,238,.1); }

.ap-sens { display: flex; flex-direction: column; gap: 6px; justify-content: center; }
.ap-sens-value { display: flex; align-items: baseline; gap: 5px; }
.ap-sens-value b { font-size: 21px; font-weight: 650; color: #67e8f9; text-shadow: 0 0 18px rgba(34,211,238,.4); }
.ap-ticks { display: flex; gap: 3px; }
.ap-ticks i { flex: 1; height: 7px; border-radius: 2px; background: rgba(120,180,255,.13); }
.ap-ticks i[data-on="true"] { background: linear-gradient(180deg, #67e8f9, #0ea5e9); box-shadow: 0 0 8px rgba(34,211,238,.5); }

.ap-chery-policies { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; margin-top: 2px; }
.ap-cp {
  display: flex; flex-direction: column; gap: 3px;
  padding: 8px 10px; border-radius: 8px;
  background: rgba(6,14,26,.55); border: 1px solid rgba(90,150,220,.14);
}
.ap-cp-title { font-size: 11.5px; font-weight: 600; color: #dbeafe; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ap-cp-text { font-size: 10.5px; color: #8aa0c0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ap-cp-meta { display: flex; align-items: center; gap: 6px; font-size: 9.5px; color: #6f88ab; }

/* ---------- KPI ---------- */
.ap-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.ap-kpi { position: relative; padding: 10px 12px 9px; border-radius: 10px; background: rgba(14,26,44,.6); border: 1px solid rgba(90,150,220,.16); overflow: hidden; }
.ap-kpi::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--ap-accent, #22d3ee); box-shadow: 0 0 12px var(--ap-accent, #22d3ee); }
.ap-kpi-label { font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: #6f88ab; }
.ap-kpi-value { display: flex; align-items: baseline; gap: 4px; font-size: 23px; font-weight: 650; letter-spacing: -.4px; color: #eaf6ff; }
.ap-kpi-value small { font-size: 11px; font-weight: 500; color: #7f9ab8; }
.ap-kpi-foot { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: #7f9ab8; min-height: 16px; }

/* ---------- 图表 ---------- */
.ap-hbar { display: flex; flex-direction: column; gap: 7px; }
.ap-hbar-row { display: grid; grid-template-columns: 80px 1fr 62px; align-items: center; gap: 8px; }
.ap-hbar-name { font-size: 10.5px; color: #8aa0c0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ap-hbar-track { height: 6px; border-radius: 999px; background: rgba(120,180,255,.12); overflow: hidden; }
.ap-hbar-fill { height: 100%; border-radius: 999px; transition: width .4s cubic-bezier(.2,.8,.2,1); }
.ap-hbar-value { font-size: 10.5px; text-align: right; color: #cfe4ff; font-variant-numeric: tabular-nums; }
.ap-legend { display: inline-flex; gap: 10px; font-size: 10px; color: #7f9ab8; }
.ap-dot { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }

/* ---------- 行情表 ---------- */
.ap-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
.ap-tbl th { text-align: left; font-weight: 500; font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: #6f88ab; padding: 0 8px 6px 0; border-bottom: 1px solid rgba(90,150,220,.2); white-space: nowrap; }
.ap-tbl td { padding: 5px 8px 5px 0; border-bottom: 1px solid rgba(90,150,220,.09); color: #cfe4ff; font-variant-numeric: tabular-nums; }
.ap-tbl tr[data-focus="true"] td { background: rgba(34,211,238,.07); }
.ap-tbl tr[data-focus="true"] td:first-child { border-left: 2px solid #22d3ee; padding-left: 6px; }
.ap-tbl tr:last-child td { border-bottom: 0; }
.ap-num-up { color: #86efac; }
.ap-num-down { color: #fda4af; }
.ap-readout { font-size: 11px; color: #9db4d6; line-height: 1.7; }
.ap-readout strong { color: #e6f6ff; font-weight: 600; }

/* ---------- 条款 ---------- */
.ap-clauses { display: flex; flex-direction: column; }
.ap-clause { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 9px; align-items: start; padding: 7px 0; border-bottom: 1px dashed rgba(90,150,220,.14); }
.ap-clause > * { min-width: 0; }
.ap-clause .ap-tag { white-space: nowrap; }
.ap-clause-policy { display: block; width: 100%; max-width: 100%; border: 0; background: transparent; padding: 0; text-align: left; font-size: 11px; font-weight: 600; color: #dbeafe; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.ap-clause-policy:hover { color: #67e8f9; }
.ap-clause-text { font-size: 10.5px; color: #8aa0c0; margin-top: 2px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; cursor: pointer; word-break: break-word; }
.ap-clause-text[data-open="true"] { -webkit-line-clamp: unset; display: block; }
a.ap-quote-link { flex: none; white-space: nowrap; font-size: 10.5px; color: #7fd7f5; text-decoration: none; border-bottom: 1px dashed rgba(120,180,255,.35); align-self: start; }
a.ap-quote-link:hover { color: #22d3ee; border-bottom-color: #22d3ee; }
.ap-clause:last-child { border-bottom: 0; }
.ap-strength { display: inline-flex; gap: 2px; padding-top: 4px; }
.ap-strength i { width: 4px; height: 11px; border-radius: 1px; background: rgba(120,180,255,.16); }
.ap-strength i[data-on="true"] { background: var(--ap-accent, #22d3ee); box-shadow: 0 0 6px var(--ap-accent, #22d3ee); }

.ap-empty { padding: 18px 6px; text-align: center; color: #6f88ab; font-size: 11px; }
.ap-error { color: #fda4af; }
.ap-skeleton { display: grid; gap: 10px; }
.ap-sk { height: 68px; border-radius: 10px; background: linear-gradient(90deg, rgba(30,45,70,.7) 25%, rgba(45,70,105,.55) 37%, rgba(30,45,70,.7) 63%); background-size: 400% 100%; animation: ap-sh 1.3s ease infinite; }
@keyframes ap-sh { 0% { background-position: 100% 50% } 100% { background-position: 0 50% } }

.ap-foot {
  position: relative; z-index: 1;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 7px 16px; font-size: 10px; letter-spacing: .04em; color: #6f88ab;
  border-top: 1px solid rgba(56,189,248,.14);
  background: linear-gradient(0deg, rgba(6,12,22,.92), rgba(8,16,28,.55));
}

.ap-link {
  border: 0; background: transparent; padding: 0; margin: 0; font: inherit;
  color: #dbeafe; text-align: left; cursor: pointer;
  border-bottom: 1px dashed rgba(120,180,255,.34);
}
.ap-link:hover { color: #67e8f9; border-bottom-color: #22d3ee; }
.ap-link:focus-visible { outline: 2px solid rgba(34,211,238,.7); outline-offset: 2px; border-radius: 3px; }

.ap-doc {
  font-size: 11.5px; line-height: 1.85; color: #cfe4ff; white-space: pre-wrap;
  background: rgba(6,14,26,.55); border: 1px solid rgba(90,150,220,.14);
  border-radius: 8px; padding: 10px 12px; max-height: 260px; overflow: auto;
}
.ap-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.ap-src {
  display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px;
  border-radius: 7px; font-size: 11px; text-decoration: none;
  color: #06202a; background: linear-gradient(180deg, #67e8f9, #22d3ee);
  border: 1px solid #22d3ee; font-weight: 600;
}
.ap-src[data-off="true"] { color: #6f88ab; background: rgba(148,190,255,.06); border-color: rgba(120,180,255,.16); font-weight: 400; cursor: not-allowed; }
.ap-pre {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;
  font-size: 10.5px; line-height: 1.7; white-space: pre-wrap; color: #bcd0ea;
  background: rgba(6,14,26,.62); border: 1px solid rgba(90,150,220,.16);
  border-radius: 8px; padding: 10px 12px; max-height: 44vh; overflow: auto;
}
.ap-quality { display: flex; gap: 6px; flex-wrap: wrap; }
.ap-quality .ap-tag { font-size: 10.5px; }

.ap-src-link {
  display: inline-flex; align-items: center; gap: 4px; margin-left: 6px;
  font-size: 9.5px; letter-spacing: .04em; color: #6f88ab; text-decoration: none;
  border-bottom: 1px dashed rgba(120,180,255,.28);
}
.ap-src-link:hover { color: #67e8f9; border-bottom-color: #22d3ee; }
.ap-src-link[data-off="true"] { border-bottom: 0; color: #4b6079; cursor: default; }
.ap-src-link i { width: 5px; height: 5px; border-radius: 50%; background: #4b6079; flex: none; }
.ap-src-link[data-status="live"] i { background: #86efac; box-shadow: 0 0 6px #86efac; }
.ap-src-link[data-status="mixed"] i { background: #fbbf24; box-shadow: 0 0 6px #fbbf24; }
.ap-src-link[data-status="seed"] i { background: #fb7185; box-shadow: 0 0 6px #fb7185; }
.ap-tbl a.ap-quote-link { color: #dbeafe; text-decoration: none; border-bottom: 1px dashed rgba(120,180,255,.3); }
.ap-tbl a.ap-quote-link:hover { color: #67e8f9; border-bottom-color: #22d3ee; }

@media (max-width: 1080px) {
  .ap-chery-top { grid-template-columns: 1fr; }
  .ap-grid, .ap-grid-3 { grid-template-columns: 1fr; }
  .ap-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ap-layer { padding: 12px 8px; }
}
`

    // ── 格式化 ────────────────────────────────────────────────────────
    const num = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 }))
    const wan = (value) => (value === null || value === undefined ? '—' : (value / 10000).toFixed(1))
    const fixed = (value, digits = 1) => (value === null || value === undefined ? '—' : Number(value).toFixed(digits))
    const signed = (value, digits = 2) => {
      if (value === null || value === undefined) return '—'
      const text = Math.abs(value).toFixed(digits)
      return value > 0 ? '+' + text : value < 0 ? '-' + text : '0'
    }
    const monthLabel = (month) => (month ? month.slice(5) + '月' : '—')
    const shiftMonth = (month, delta) => {
      if (!month) return month
      const [year, mon] = month.split('-').map(Number)
      const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
      return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0')
    }

    const CYAN = '#22d3ee'
    const BLUE = '#3b82f6'
    const LIME = '#a3e635'
    const ROSE = '#fb7185'
    const AMBER = '#f59e0b'

    const DIRECTION = {
      positive: { label: '利好', tone: 'up', color: LIME },
      negative: { label: '利空', tone: 'down', color: ROSE },
      neutral: { label: '中性', tone: 'flat', color: '#8aa0c0' }
    }

    const CarIcon = (props) => {
      const size = props.size || 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true
      },
        h('path', { d: 'M3 16v-2.2c0-.7.5-1.2 1.2-1.3l1.7-.2 2-4c.3-.6.9-.9 1.5-.9h5.2c.6 0 1.2.3 1.5.9l2 4 1.7.2c.7.1 1.2.6 1.2 1.3V16' }),
        h('path', { d: 'M3 16h2.4M9.2 16h5.6M18.6 16H21' }),
        h('circle', { cx: 6.6, cy: 16, r: 1.7 }),
        h('circle', { cx: 17.4, cy: 16, r: 1.7 })
      )
    }

    const CloseIcon = () => h('svg', {
      width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 2.2, strokeLinecap: 'round', 'aria-hidden': true
    }, h('path', { d: 'M6 6l12 12M18 6L6 18' }))

    const Caret = (props) => h('svg', {
      width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      style: props.flip ? { transform: 'rotate(180deg)' } : undefined
    }, h('path', { d: 'M9 5l7 7-7 7' }))

    // ── 图表 ──────────────────────────────────────────────────────────

    /** 面积折线：奇瑞 12 个月零售。 */
    function AreaTrend(props) {
      const points = props.points || []
      if (points.length < 2) return h('div', { className: 'ap-empty' }, '样本不足两个月。')
      const width = 300
      const height = 96
      const pad = 6
      const values = points.map((point) => point.value)
      const low = Math.min(...values)
      const high = Math.max(...values)
      const span = Math.max(1, high - low)
      const x = (index) => pad + ((width - pad * 2) * index) / (points.length - 1)
      const y = (value) => height - pad - ((height - pad * 2) * (value - low)) / span
      const line = points.map((point, index) => x(index) + ',' + y(point.value)).join(' ')
      const area = `M${pad},${height - pad} L` + points.map((point, index) => x(index) + ',' + y(point.value)).join(' L') + ` L${width - pad},${height - pad} Z`
      const last = points[points.length - 1]

      return h('svg', { viewBox: '0 0 ' + width + ' ' + height, width: '100%', role: 'img', 'aria-label': '奇瑞零售走势' },
        h('defs', null,
          h('linearGradient', { id: 'ap-area-chery', x1: 0, y1: 0, x2: 0, y2: 1 },
            h('stop', { offset: '0%', stopColor: CYAN, stopOpacity: .34 }),
            h('stop', { offset: '100%', stopColor: CYAN, stopOpacity: 0 }))
        ),
        [0, .5, 1].map((ratio) =>
          h('line', {
            key: ratio, x1: pad, x2: width - pad,
            y1: pad + (height - pad * 2) * ratio, y2: pad + (height - pad * 2) * ratio,
            stroke: 'rgba(120,180,255,.12)', strokeDasharray: ratio === 1 ? undefined : '3 5'
          })),
        h('path', { d: area, fill: 'url(#ap-area-chery)' }),
        h('polyline', { points: line, fill: 'none', stroke: CYAN, strokeWidth: 1.8, strokeLinejoin: 'round', strokeLinecap: 'round' }),
        points.map((point, index) =>
          h('circle', {
            key: point.label, cx: x(index), cy: y(point.value), r: index === points.length - 1 ? 3 : 1.9,
            fill: '#0a1120', stroke: CYAN, strokeWidth: 1.6
          }, h('title', null, point.label + '：' + num(point.value) + ' 辆'))),
        h('text', {
          x: width - pad, y: y(last.value) - 8, textAnchor: 'end',
          fontSize: 10, fontWeight: 600, fill: '#eaf6ff', className: 'ap-mono'
        }, num(last.value)),
        h('text', { x: pad, y: height - 1, fontSize: 8.5, fill: '#6f88ab' }, monthLabel(points[0].label)),
        h('text', { x: width - pad, y: height - 1, textAnchor: 'end', fontSize: 8.5, fill: '#6f88ab' }, monthLabel(last.label))
      )
    }

    /** 迷你走势线：行情表行内。 */
    function Spark(props) {
      const trend = props.trend || []
      if (trend.length < 2) return h('span', { className: 'ap-mono', style: { color: '#4b6079' } }, '—')
      const width = 74
      const height = 20
      const values = trend.map((point) => point.close)
      const low = Math.min(...values)
      const high = Math.max(...values)
      const span = Math.max(0.0001, high - low)
      const points = trend.map((point, index) =>
        ((width * index) / (trend.length - 1)).toFixed(1) + ',' + (height - 2 - ((height - 4) * (point.close - low)) / span).toFixed(1)
      ).join(' ')
      const color = props.up ? LIME : ROSE
      return h('svg', { width, height, viewBox: '0 0 ' + width + ' ' + height, 'aria-hidden': true },
        h('polyline', { points, fill: 'none', stroke: color, strokeWidth: 1.3, strokeLinejoin: 'round', strokeLinecap: 'round', opacity: .9 }))
    }

    function PsiBars(props) {
      const series = props.series || []
      const width = 320
      const height = 132
      const padX = 6
      const padTop = 18
      const padBottom = 20
      const inner = width - padX * 2
      const max = Math.max(40, ...series.map((point) => point.psi))
      const slot = series.length ? inner / series.length : inner
      const barW = Math.min(28, slot * 0.46)

      return h('svg', { viewBox: '0 0 ' + width + ' ' + height, width: '100%', role: 'img', 'aria-label': '政策强度指数走势' },
        [0.25, 0.5, 0.75, 1].map((ratio) =>
          h('line', {
            key: 'g' + ratio, x1: padX, x2: width - padX,
            y1: padTop + (height - padTop - padBottom) * (1 - ratio),
            y2: padTop + (height - padTop - padBottom) * (1 - ratio),
            stroke: 'rgba(120,180,255,.12)', strokeDasharray: '3 5'
          })),
        series.map((point, index) => {
          const barH = Math.max(2, ((height - padTop - padBottom) * point.psi) / max)
          const x = padX + slot * index + (slot - barW) / 2
          const y = height - padBottom - barH
          const isLast = index === series.length - 1
          return h('g', { key: point.month },
            h('rect', {
              x, y, width: barW, height: barH, rx: 3,
              fill: isLast ? CYAN : 'rgba(34,211,238,.24)',
              style: isLast ? { filter: 'drop-shadow(0 0 8px rgba(34,211,238,.55))' } : undefined
            }),
            h('text', {
              x: x + barW / 2, y: y - 5, textAnchor: 'middle', fontSize: 9,
              fill: isLast ? '#eaf6ff' : '#7f9ab8', fontWeight: isLast ? 600 : 400, className: 'ap-mono'
            }, point.psi.toFixed(1)),
            h('text', {
              x: x + barW / 2, y: height - 6, textAnchor: 'middle', fontSize: 8.5, fill: '#6f88ab'
            }, monthLabel(point.month))
          )
        })
      )
    }

    function TrendChart(props) {
      const sales = props.series || []
      const psiRows = props.psiSeries || []
      const psiMap = new Map(psiRows.map((row) => [row.month, row]))
      const points = sales
        .filter((point) => point.national)
        .map((point) => ({
          month: point.month,
          total: point.national.total,
          share: point.national.share,
          count: (psiMap.get(point.month) || {}).count ?? 0,
          psi: (psiMap.get(point.month) || {}).psi ?? 0
        }))
      if (points.length === 0) return h('div', { className: 'ap-empty' }, '该月没有销量数据，趋势不可绘制。')

      const width = 640
      const height = 200
      const padL = 34
      const padR = 34
      const padTop = 12
      const padBottom = 34
      const innerW = width - padL - padR
      const innerH = height - padTop - padBottom

      const maxTotal = Math.max(...points.map((point) => point.total)) * 1.1
      const shares = points.map((point) => point.share)
      const lowShare = Math.max(0, Math.floor((Math.min(...shares) - 4) / 5) * 5)
      const highShare = Math.min(100, Math.ceil((Math.max(...shares) + 4) / 5) * 5)
      const shareSpan = Math.max(5, highShare - lowShare)
      const maxCount = Math.max(1, ...points.map((point) => point.count))

      const step = innerW / points.length
      const barW = Math.max(6, Math.min(26, step * 0.55))
      const xAt = (index) => padL + step * index + step / 2
      const ySales = (value) => padTop + innerH * (1 - value / maxTotal)
      const yShare = (value) => padTop + innerH * (1 - (value - lowShare) / shareSpan)

      const shareLine = points
        .map((point, index) => xAt(index) + ',' + yShare(point.share))
        .join(' ')

      const ticks = [0, 0.5, 1].map((ratio) => {
        const value = maxTotal * ratio
        return { y: ySales(value), label: (value / 10000).toFixed(0) }
      })

      return h('svg', {
        viewBox: '0 0 ' + width + ' ' + height, width: '100%', role: 'img',
        'aria-label': '月销量、新能源渗透率与政策条数走势'
      },
        ticks.map((tick, index) =>
          h('g', { key: 'tick' + index },
            h('line', { x1: padL, x2: width - padR, y1: tick.y, y2: tick.y, stroke: 'rgba(120,180,255,.10)', strokeDasharray: '3 4' }),
            h('text', { x: padL - 6, y: tick.y + 3, textAnchor: 'end', fontSize: 8.5, fill: '#6f88ab' }, tick.label))),
        h('text', { x: padL - 6, y: padTop - 2, textAnchor: 'end', fontSize: 8, fill: '#6f88ab' }, '万辆'),
        h('text', { x: width - padR + 4, y: padTop - 2, fontSize: 8, fill: '#6f88ab' }, '%'),

        points.map((point, index) =>
          h('g', { key: 'bar' + point.month },
            h('rect', {
              x: xAt(index) - barW / 2, y: ySales(point.total), width: barW,
              height: Math.max(1, padTop + innerH - ySales(point.total)),
              rx: 2, fill: 'rgba(96,165,250,.35)', stroke: 'rgba(96,165,250,.65)'
            }, h('title', null, monthLabel(point.month) + ' 销量 ' + (point.total / 10000).toFixed(2) + ' 万辆，NEV ' + point.share + '%，政策 ' + point.count + ' 条')))),

        h('polyline', { points: shareLine, fill: 'none', stroke: '#22d3ee', strokeWidth: 1.8, strokeLinejoin: 'round', strokeLinecap: 'round' }),
        points.map((point, index) =>
          h('circle', {
            key: 'pt' + point.month, cx: xAt(index), cy: yShare(point.share), r: 2.4,
            fill: '#0a1120', stroke: '#22d3ee', strokeWidth: 1.5
          }, h('title', null, monthLabel(point.month) + ' 渗透率 ' + point.share + '%'))),

        points.map((point, index) =>
          h('g', { key: 'label' + point.month },
            h('text', { x: xAt(index), y: height - padBottom + 13, textAnchor: 'middle', fontSize: 8.5, fill: '#8aa0c0' }, point.month.slice(5) + '月'),
            h('text', {
              x: xAt(index), y: height - padBottom + 25, textAnchor: 'middle', fontSize: 8.5,
              fill: point.count > 0 ? '#67e8f9' : '#3f5a7a'
            }, '政策 ' + point.count))),

        points.map((point, index) =>
          h('rect', {
            key: 'cnt' + point.month,
            x: xAt(index) - 3, y: height - padBottom + 29, width: 6,
            height: Math.max(1, (point.count / maxCount) * 5),
            fill: 'rgba(34,211,238,.55)'
          }))
      )
    }

    function ShareLines(props) {
      const series = (props.series || []).filter((point) => point.national || point.hunan)
      if (series.length === 0) return h('div', { className: 'ap-empty' }, '该月无销量数据，渗透率趋势不可绘制。')
      const width = 330
      const height = 140
      const padL = 26
      const padR = 8
      const padTop = 10
      const padBottom = 20
      const values = []
      for (const point of series) {
        if (point.national) values.push(point.national.share)
        if (point.hunan) values.push(point.hunan.share)
      }
      const low = Math.max(0, Math.floor((Math.min(...values) - 3) / 5) * 5)
      const high = Math.min(100, Math.ceil((Math.max(...values) + 3) / 5) * 5)
      const span = Math.max(5, high - low)
      const innerW = width - padL - padR
      const innerH = height - padTop - padBottom
      const xAt = (index) => padL + (series.length === 1 ? innerW / 2 : (innerW * index) / (series.length - 1))
      const yAt = (value) => padTop + innerH * (1 - (value - low) / span)

      const line = (key, color) => {
        const points = series
          .map((point, index) => (point[key] ? xAt(index) + ',' + yAt(point[key].share) : null))
          .filter(Boolean)
        if (points.length === 0) return null
        return h('g', { key },
          h('polyline', { points: points.join(' '), fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinejoin: 'round', strokeLinecap: 'round' }),
          series.map((point, index) => (point[key]
            ? h('circle', {
              key: point.month, cx: xAt(index), cy: yAt(point[key].share), r: 2.2,
              fill: '#0a1120', stroke: color, strokeWidth: 1.5
            }, h('title', null, monthLabel(point.month) + ' ' + point[key].share + '%'))
            : null))
        )
      }

      const last = series[series.length - 1]
      return h('svg', { viewBox: '0 0 ' + width + ' ' + height, width: '100%', role: 'img', 'aria-label': '新能源渗透率趋势' },
        [0, 0.5, 1].map((ratio) => {
          const value = low + span * ratio
          const y = yAt(value)
          return h('g', { key: 'y' + ratio },
            h('line', { x1: padL, x2: width - padR, y1: y, y2: y, stroke: 'rgba(120,180,255,.12)', strokeDasharray: ratio === 0 ? undefined : '3 5' }),
            h('text', { x: padL - 5, y: y + 3, textAnchor: 'end', fontSize: 8.5, fill: '#6f88ab', className: 'ap-mono' }, Math.round(value) + '%'))
        }),
        line('national', BLUE),
        line('hunan', CYAN),
        series.map((point, index) => (index % 2 === 0 || index === series.length - 1
          ? h('text', { key: 'x' + point.month, x: xAt(index), y: height - 5, textAnchor: 'middle', fontSize: 8.5, fill: '#6f88ab' }, monthLabel(point.month))
          : null)),
        last && last.national
          ? h('text', { x: width - padR, y: yAt(last.national.share) - 6, textAnchor: 'end', fontSize: 9, fontWeight: 600, fill: BLUE, className: 'ap-mono' }, last.national.share + '%')
          : null,
        last && last.hunan
          ? h('text', { x: width - padR, y: yAt(last.hunan.share) + 11, textAnchor: 'end', fontSize: 9, fontWeight: 600, fill: CYAN, className: 'ap-mono' }, last.hunan.share + '%')
          : null
      )
    }

    function HBars(props) {
      const rows = props.rows || []
      if (rows.length === 0) return h('div', { className: 'ap-empty' }, '本期无数据。')
      const max = Math.max(...rows.map((row) => row.value)) || 1
      return h('div', { className: 'ap-hbar' },
        rows.map((row) => h('div', { className: 'ap-hbar-row', key: row.name },
          row.onClick
            ? h('button', {
              type: 'button', className: 'ap-hbar-name ap-link',
              style: { border: 0, background: 'transparent', padding: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer' },
              title: '查看 ' + row.name + ' 的原始数据与来源',
              onClick: row.onClick
            }, row.name)
            : h('span', { className: 'ap-hbar-name', title: row.name }, row.name),
          h('div', { className: 'ap-hbar-track' },
            h('div', {
              className: 'ap-hbar-fill',
              style: {
                width: Math.max(2, (row.value / max) * 100) + '%',
                background: row.color || 'linear-gradient(90deg, ' + BLUE + ', ' + CYAN + ')'
              }
            })),
          h('span', { className: 'ap-hbar-value' }, row.display)
        ))
      )
    }

    // ── 数据 ──────────────────────────────────────────────────────────

    // 与宿主半边同一份候选表：重载后旧实例的路径不会被回收，按顺序探测第一个可用入口。
    const OVERVIEW_PATHS = [
      '/api/auto-policy/v4/overview',
      '/api/auto-policy/v5/overview',
      '/api/auto-policy/v6/overview',
      '/api/auto-policy/v7/overview'
    ]
    let chosenPath = null

    async function loadOverview(month, region, brand, signal) {
      const params = new URLSearchParams()
      if (month) params.set('month', month)
      if (region) params.set('region', region)
      if (brand) params.set('brand', brand)
      const query = params.toString()

      let lastError = null
      for (const path of chosenPath ? [chosenPath] : OVERVIEW_PATHS) {
        try {
          const response = await fetch(path + '?' + query, { credentials: 'same-origin', signal })
          if (!response.ok) {
            lastError = new Error('面板数据请求失败（HTTP ' + response.status + '）')
            continue
          }
          const payload = await response.json()
          if (payload && payload.ok === false) throw new Error(payload.error || '面板数据计算失败')
          chosenPath = path
          return payload
        } catch (cause) {
          if (cause && cause.name === 'AbortError') throw cause
          lastError = cause
        }
      }
      throw lastError || new Error('找不到可用的数据入口，请重新加载页面。')
    }

    /** 单篇详情：穿透到政策原文（条款、版本、邻居、官方链接）。 */
    async function loadDetail(id, signal) {
      const base = chosenPath || OVERVIEW_PATHS[0]
      const response = await fetch(base + '/policy?id=' + encodeURIComponent(id), { credentials: 'same-origin', signal })
      if (!response.ok) throw new Error('政策详情请求失败（HTTP ' + response.status + '）')
      const payload = await response.json()
      if (payload && payload.ok === false) throw new Error(payload.error === 'not-found' ? '没有这条政策：' + id : '政策详情读取失败')
      return payload
    }

    /** 面板里直接出报告：与工具同一套渲染与质检。 */
    async function loadReport(month, region, brandName, signal) {
      const params = new URLSearchParams()
      if (month) params.set('month', month)
      if (region) params.set('region', region)
      if (brandName) params.set('brand', brandName)
      const base = chosenPath || OVERVIEW_PATHS[0]
      // 与 loadOverview 一样按候选路径回退：热重载后旧路径可能还在，但子路由可能已失效。
      const candidates = chosenPath ? [base, ...OVERVIEW_PATHS.filter((path) => path !== base)] : OVERVIEW_PATHS
      let lastError = null
      for (const candidate of candidates) {
        let response
        try {
          response = await fetch(candidate + '/report?' + params.toString(), { credentials: 'same-origin', signal })
        } catch (cause) {
          if (cause && cause.name === 'AbortError') throw cause
          lastError = new Error('报告请求发送失败：' + ((cause && cause.message) || cause))
          continue
        }
        const raw = await response.text()
        if (response.status === 404 || response.status === 401 || response.status === 405) {
          lastError = new Error('报告入口不可用（' + candidate + '/report 返回 HTTP ' + response.status + '）')
          continue
        }
        if (!response.ok) {
          throw new Error('报告生成失败（HTTP ' + response.status + '）' + (raw ? '：' + raw.slice(0, 160) : ''))
        }
        let payload
        try {
          payload = JSON.parse(raw)
        } catch {
          throw new Error('报告返回的不是 JSON：' + raw.slice(0, 160))
        }
        if (!payload || payload.ok === undefined) throw new Error('报告返回结构异常：' + raw.slice(0, 160))
        if (payload.ok === false) throw new Error('报告计算失败：' + (payload.error || payload.message || '未知原因'))
        if (!payload.markdown) throw new Error('报告内容为空（返回里没有 markdown 字段）')
        chosenPath = candidate
        return payload
      }
      throw lastError || new Error('找不到可用的报告入口')
    }

    // 报告缓存：生成一次就不再重复请求，避免每次点开都重算、重消耗
    const REPORT_STORE_PREFIX = 'auto-policy-report:'

    function storeReport(key, payload) {
      try {
        window.localStorage.setItem(REPORT_STORE_PREFIX + key, JSON.stringify({
          month: payload.month,
          region: payload.region,
          words: payload.words,
          citationCoverage: payload.citationCoverage,
          ok: payload.ok,
          lintErrors: payload.lintErrors || [],
          markdown: payload.markdown
        }))
      } catch {
        /* 超出配额或隐私模式时忽略，内存缓存仍然生效 */
      }
    }

    function readStoredReport(key) {
      try {
        const raw = window.localStorage.getItem(REPORT_STORE_PREFIX + key)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && parsed.markdown ? parsed : null
      } catch {
        return null
      }
    }

    function downloadMarkdown(markdown, filename) {
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename || 'policy-report.md'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    // ── 左侧栏入口 ────────────────────────────────────────────────────

    function SidebarEntry(props) {
      const [active, setActive] = useState(false)
      useEffect(() => {
        const listener = (event) => {
          if (event && event.detail && typeof event.detail.open === 'boolean') setActive(event.detail.open)
        }
        window.addEventListener(STATE_EVENT, listener)
        return () => window.removeEventListener(STATE_EVENT, listener)
      }, [])
      return h('button', {
        type: 'button',
        className: 'ap-side-entry',
        'data-active': active ? 'true' : 'false',
        title: '汽车政策研究台',
        'aria-label': '汽车政策研究台',
        onClick: () => window.dispatchEvent(new CustomEvent(TOGGLE_EVENT))
      }, h(CarIcon, { size: 17 }), props.wide ? h('span', null, '汽车政策') : null)
    }

    // ── 奇瑞专区 ──────────────────────────────────────────────────────

function BrandStrip(props) {
      const brand = props.brand
      const month = props.month
      const onOpen = props.onOpen
      const source = props.source
      const name = (brand && brand.brand) || '品牌'

      if (!brand || !brand.latest) {
        const official = brand && brand.official
        if (!official) {
          return h('div', { className: 'ap-card ap-chery' },
            h('div', { className: 'ap-card-head' }, h('span', { className: 'ap-card-title' }, name + ' · 品牌专项')),
            h('div', { className: 'ap-empty' }, '该品牌本期没有月度序列；在 data/sales.json 的 brandMonthly 里补上即可。'))
        }
        return h('div', { className: 'ap-card ap-chery' },
          h('div', { className: 'ap-card-head' },
            h('span', { className: 'ap-card-title' }, name + ' · 官方公告'),
            h('span', { className: 'ap-card-sub' }, month + '｜该月无国内上险序列，仅有官方口径'),
            h(SourceLink, { source })),
          h('div', { className: 'ap-chery-top' },
            h('div', { className: 'ap-hero-num' },
              h('span', { className: 'ap-eyebrow' }, '官方集团销量'),
              h('div', { className: 'ap-big ap-mono' }, h('b', null, (official.groupSales / 10000).toFixed(2)), h('span', null, '万辆')),
              h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 } },
                official.export ? h('span', { className: 'ap-tag', 'data-tone': 'up' }, '出口 ' + (official.export / 10000).toFixed(2) + ' 万辆') : null,
                official.listedSales ? h('span', { className: 'ap-tag ap-mono' }, '股份公司 ' + num(official.listedSales) + ' 辆') : null)),
            h('div', { style: { display: 'flex', alignItems: 'center' } },
              h('a', { className: 'ap-src', href: official.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, '官方公告 ↗')),
            h('div', { className: 'ap-sens' },
              h('span', { className: 'ap-eyebrow' }, '口径提示'),
              h('div', { style: { fontSize: 10.5, color: '#8aa0c0', lineHeight: 1.7 } },
                '集团销量含出口，与国内上险口径不可相加或直接对比。'))
          )
        )
      }

      const latest = brand.latest
      const points = brand.months.map((item) => ({ label: item.month, value: item.retail }))
      const score = brand.sensitivity ? brand.sensitivity.score : 0
      const lit = Math.round((score / 100) * 12)
      const yoy = latest.yoy === null || latest.yoy === undefined ? null : latest.yoy

      return h('div', { className: 'ap-card ap-chery' },
        h('div', { className: 'ap-card-head' },
          h('span', { className: 'ap-card-title' }, name + ' · 品牌专项'),
          h('span', { className: 'ap-card-sub' }, month + '｜' + (brand.profileNote || '品牌零售与政策暴露')),
          h(SourceLink, { source })
        ),
        h('div', { className: 'ap-chery-top' },
          h('div', { className: 'ap-hero-num' },
            h('span', { className: 'ap-eyebrow' }, '零售量 / Retail'),
            h('div', { className: 'ap-big ap-mono' }, h('b', null, num(latest.retail)), h('span', null, '辆')),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 } },
              h('span', { className: 'ap-tag', 'data-tone': yoy === null ? 'flat' : yoy >= 0 ? 'up' : 'down' },
                yoy === null ? '— 同比' : (yoy >= 0 ? '▲ ' : '▼ ') + Math.abs(yoy) + '% 同比'),
              h('span', { className: 'ap-tag' }, '份额 ' + fixed(latest.share) + '%'),
              latest.exportShare === null || latest.exportShare === undefined
                ? null
                : h('span', { className: 'ap-tag' }, '出口占比 ' + fixed(latest.exportShare) + '%')
            ),
            h('div', { className: 'ap-facts' },
              latest.export
                ? h('div', { className: 'ap-fact' }, h('b', { className: 'ap-mono' }, num(latest.export)), h('span', null, '出口（辆）'))
                : null,
              h('div', { className: 'ap-fact' }, h('b', { className: 'ap-mono' }, signed(brand.change ? brand.change / 10000 : 0)), h('span', null, '12月零售增量（万辆）'))
            ),
            brand.official
              ? h('div', { className: 'ap-facts', style: { marginTop: 6, borderTop: '1px dashed rgba(90,150,220,.18)', paddingTop: 6 } },
                h('div', { className: 'ap-fact' },
                  h('b', { className: 'ap-mono' }, (brand.official.groupSales / 10000).toFixed(2)),
                  h('span', null, '官方集团销量（万辆）')),
                brand.official.export
                  ? h('div', { className: 'ap-fact' },
                    h('b', { className: 'ap-mono' }, (brand.official.export / 10000).toFixed(2)),
                    h('span', null, '官方出口（万辆）'))
                  : null,
                brand.official.nev
                  ? h('div', { className: 'ap-fact' },
                    h('b', { className: 'ap-mono' }, (brand.official.nev / 10000).toFixed(2)),
                    h('span', null, '官方新能源（万辆）· ' + (brand.official.nev / brand.official.groupSales * 100).toFixed(0) + '%'))
                  : null,
                h('a', {
                  className: 'ap-quote-link', style: { alignSelf: 'center', fontSize: 10 },
                  href: brand.official.sourceUrl, target: '_blank', rel: 'noopener noreferrer'
                }, '官方公告 ↗'))
              : null,
            brand.official && Array.isArray(brand.official.brands) && brand.official.brands.length > 0
              ? h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 } },
                brand.official.brands.map((item) =>
                  h('span', { key: item.brand, className: 'ap-tag ap-mono' },
                    item.brand + ' ' + (item.sales / 10000).toFixed(2) + ' 万')))
              : null
          ),
          h('div', null,
            h('div', { className: 'ap-eyebrow', style: { marginBottom: 2 } }, '近 12 个月零售'),
            h(AreaTrend, { points })
          ),
          h('div', { className: 'ap-sens' },
            h('span', { className: 'ap-eyebrow' }, '文本相关度（非因果）'),
            h('div', { className: 'ap-sens-value ap-mono' }, h('b', null, fixed(score)), h('span', { style: { fontSize: 10.5, color: '#6f88ab' } }, '/100')),
            h('div', { className: 'ap-ticks' },
              Array.from({ length: 12 }, (_, index) => h('i', { key: index, 'data-on': index < lit ? 'true' : 'false' }))),
            h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 } },
              (brand.sensitivity ? brand.sensitivity.hits : []).slice(0, 4).map((hit) =>
                h('span', { key: hit.key, className: 'ap-tag', 'data-tone': 'hot' }, hit.key + ' · ' + hit.count)))
          )
        ),
        h('div', { className: 'ap-chery-policies' },
          (brand.policies || []).slice(0, 3).map((policy) => {
            const tone = policy.clause && policy.clause.impact ? (DIRECTION[policy.clause.impact.direction] || DIRECTION.neutral) : DIRECTION.neutral
            return h('div', { className: 'ap-cp', key: policy.id },
              h('button', {
                type: 'button', className: 'ap-cp-title ap-link', title: policy.title,
                style: { border: 0, background: 'transparent', padding: 0, font: 'inherit', textAlign: 'left' },
                onClick: () => onOpen && onOpen(policy.id)
              }, policy.title),
              h('div', { className: 'ap-cp-text' }, policy.clause ? policy.clause.no + '、' + policy.clause.text : policy.topics.join(' / ')),
              h('div', { className: 'ap-cp-meta' },
                h('span', { className: 'ap-tag', 'data-tone': tone.tone }, tone.label),
                h('span', null, policy.publishDate),
                h('span', { style: { marginLeft: 'auto' }, className: 'ap-mono' }, '相关度 ' + fixed(policy.score)))
            )
          }),
          (brand.policies || []).length === 0
            ? h('div', { className: 'ap-empty' }, '本期没有命中「' + name + '」关注点的政策。')
            : null
        )
      )
    }

    // ── 行情 ──────────────────────────────────────────────────────────

    function MarketCard(props) {
      const market = props.market
      const source = props.source
      if (!market) return null
      const items = market.items || []
      if (items.length === 0) {
        return h('div', { className: 'ap-card' },
          h('div', { className: 'ap-card-head' }, h('span', { className: 'ap-card-title' }, '上市公司行情')),
          h('div', { className: 'ap-empty' }, '行情接口不可用，且本地没有快照。政策与销量部分不受影响。'))
      }
      const summary = market.summary
      const stamp = String(market.asOf || '').slice(0, 16).replace('T', ' ')

      return h('div', { className: 'ap-card' },
        h('div', { className: 'ap-card-head' },
          h('span', { className: 'ap-card-title' }, '国产汽车上市公司 · 行情与解读'),
          h('span', { className: 'ap-card-sub' },
            stamp + (market.degraded ? '｜离线快照' : '｜东方财富')),
          h(SourceLink, { source })
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14, alignItems: 'start' } },
          h('div', { style: { minWidth: 0, overflow: 'auto' } },
            h('table', { className: 'ap-tbl' },
              h('thead', null,
                h('tr', null,
                  h('th', null, '公司'),
                  h('th', null, '现价'),
                  h('th', null, '涨跌'),
                  h('th', null, '市值(亿)'),
                  h('th', null, 'PE'),
                  h('th', null, '20日')
                )),
              h('tbody', null,
                items.map((item) => {
                  const up = (item.pct ?? 0) >= 0
                  return h('tr', { key: item.code, 'data-focus': item.focus ? 'true' : 'false' },
                    h('td', null,
                      h('a', {
                        className: 'ap-quote-link', href: quoteUrlOf(item),
                        target: '_blank', rel: 'noopener noreferrer',
                        title: '在东方财富打开 ' + item.name,
                        style: { fontWeight: item.focus ? 650 : 400 }
                      }, item.name),
                      h('span', { style: { color: '#4b6079', marginLeft: 6, fontSize: 9.5 }, className: 'ap-mono' },
                        item.code + (item.market === 'HK' ? ' ·HK' : ''))),
                    h('td', { className: 'ap-mono' }, item.price === null ? '—' : fixed(item.price, 2)),
                    h('td', { className: 'ap-mono ' + (up ? 'ap-num-up' : 'ap-num-down') }, signed(item.pct)),
                    h('td', { className: 'ap-mono' }, item.mcap ? Math.round(item.mcap / 1e8) : '—'),
                    h('td', { className: 'ap-mono' }, item.pe === null ? '—' : fixed(item.pe, item.pe < 0 ? 1 : 1)),
                    h('td', null, h(Spark, { trend: item.trend, up }))
                  )
                })
              )
            )
          ),
          h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 } },
            summary
              ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                h('span', { className: 'ap-tag', 'data-tone': summary.up > summary.down ? 'up' : 'down' }, '中位数 ' + signed(summary.medianPct, 2) + '%'),
                h('span', { className: 'ap-tag', 'data-tone': 'up' }, '涨 ' + summary.up),
                h('span', { className: 'ap-tag', 'data-tone': 'down' }, '跌 ' + summary.down),
                h('span', { className: 'ap-tag' }, 'PE中位 ' + fixed(summary.medianPe)))
              : null,
            h('p', { className: 'ap-readout' },
              summary
                ? summary.readout
                : '行情样本不足，无法给出板块解读。')
          )
        )
      )
    }

    // ── 数据来源 ──────────────────────────────────────────────────────

    /** 每个数字旁边的「来源 ↗」：点开就是权威页面，悬停看口径、公式与时点。 */
    function SourceLink(props) {
      const source = props.source
      if (!source) return null
      const tip = [
        source.label,
        '口径：' + (source.formula || '—'),
        '来源：' + (source.source || '—'),
        source.asOf ? '时点：' + source.asOf : '',
        source.value ? '本期：' + source.value : ''
      ].filter(Boolean).join('\n')

      const dot = h('i')
      if (!source.url) {
        return h('span', { className: 'ap-src-link', 'data-off': 'true', 'data-status': source.status, title: tip },
          dot, h('span', null, '来源：研究先验'))
      }
      if (source.status === 'seed') {
        return h('span', { className: 'ap-src-link', 'data-off': 'true', 'data-status': 'seed', title: tip }, dot, h('span', null, '无数据'))
      }
      return h('a', {
        className: 'ap-src-link',
        'data-status': source.status,
        href: source.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: tip
      }, dot, h('span', null, '来源 ↗'))
    }

    function quoteUrlOf(item) {
      const [market, id] = String(item.secid || '').split('.')
      const code = id || item.code
      if (market === '1') return 'https://quote.eastmoney.com/sh' + code + '.html'
      if (market === '0') return 'https://quote.eastmoney.com/sz' + code + '.html'
      if (market === '116') return 'https://quote.eastmoney.com/hk' + code + '.html'
      return 'https://quote.eastmoney.com/'
    }

    // ── 政策详情（穿透到原文） ─────────────────────────────────────────

    function PolicyDetail(props) {
      const { detail, loading, error, onBack, onOpen } = props

      if (loading) return h('div', { className: 'ap-skeleton' }, h('div', { className: 'ap-sk', style: { height: 120 } }))
      if (error) {
        return h('div', { className: 'ap-card' },
          h('div', { className: 'ap-card-head' }, h('button', { type: 'button', className: 'ap-ctl', onClick: onBack }, '← 返回')),
          h('div', { className: 'ap-empty ap-error' }, error))
      }
      if (!detail || !detail.policy) return null

      const policy = detail.policy
      const related = detail.related || []
      const hasSource = typeof policy.sourceUrl === 'string' && policy.sourceUrl.length > 0
      const hasContent = typeof policy.content === 'string' && policy.content.length > 0
      const contentChip = policy.contentStatus === 'full'
        ? { label: '正文已抓取', tone: 'up' }
        : policy.contentStatus === 'short'
          ? { label: '正文不完整', tone: 'flat' }
          : hasSource
            ? { label: '正文未抓到', tone: 'down' }
            : { label: '未登记原文链接', tone: 'down' }

      return h('div', { className: 'ap-card' },
        h('div', { className: 'ap-card-head' },
          h('button', { type: 'button', className: 'ap-ctl', onClick: onBack }, '← 返回'),
          h('span', { className: 'ap-card-sub ap-mono' }, policy.id)
        ),
        h('div', { style: { fontSize: 15, fontWeight: 650, color: '#eaf6ff', lineHeight: 1.5 } }, policy.title),
        h('div', { className: 'ap-meta' },
          h('span', { className: 'ap-tag' }, policy.levelName + ' · ' + policy.regionName),
          h('span', { className: 'ap-tag' }, policy.issuer),
          h('span', { className: 'ap-tag ap-mono' }, policy.publishDate),
          policy.docNo ? h('span', { className: 'ap-tag ap-mono' }, policy.docNo) : null,
          ...policy.toolTypes.map((tool) => h('span', { key: tool, className: 'ap-tag', 'data-tone': 'hot' }, tool)),
          h('span', { className: 'ap-tag', 'data-tone': contentChip.tone }, contentChip.label),
          policy.nevSpecific ? h('span', { className: 'ap-tag', 'data-tone': 'up' }, 'NEV 专属') : null
        ),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 } },
          hasSource
            ? h('a', { className: 'ap-src', href: policy.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, '打开官方原文 ↗')
            : h('span', { className: 'ap-src', 'data-off': 'true', title: '该条目未登记官方原文链接' }, '原文链接：未登记'),
          h('span', { style: { fontSize: 10, color: '#6f88ab' } }, policy.provenance || '')
        ),
        policy.summary
          ? h('div', { style: { fontSize: 11.5, color: '#9db4d6', marginTop: 2 } }, policy.summary)
          : null,
        h('div', { className: 'ap-eyebrow' }, '正文'),
        hasContent
          ? h('div', { className: 'ap-doc' }, policy.content)
          : h('div', { className: 'ap-doc', style: { color: '#9db4d6' } },
            h('div', { style: { fontSize: 12, color: '#eaf6ff', marginBottom: 6 } },
              hasSource ? '本篇正文未抓取，点上面的「打开官方原文 ↗」看全文。' : '本篇未登记官方原文链接，未展示正文。'),
            policy.summary ? h('div', null, '摘要：' + policy.summary) : h('div', null, '—')),
        hasContent
          ? h('div', { style: { fontSize: 9.5, color: '#4b6079' } }, '正文由脚本抽取，可能含页眉页脚残留；以官方原文为准。')
          : null,
        policy.clauses.length > 0
          ? h(React.Fragment, null,
            h('div', { className: 'ap-eyebrow', style: { marginTop: 6 } }, '条款级影响'),
            h('table', { className: 'ap-tbl' },
              h('thead', null, h('tr', null, h('th', null, '条款'), h('th', null, '影响对象'), h('th', null, '方向'), h('th', null, '强度'))),
              h('tbody', null, policy.clauses.map((clause, index) => {
                const impact = clause.impact || {}
                const tone = DIRECTION[impact.direction] || DIRECTION.neutral
                return h('tr', { key: index },
                  h('td', null, clause.no + '、' + clause.text),
                  h('td', null, impact.target || '—'),
                  h('td', null, h('span', { className: 'ap-tag', 'data-tone': tone.tone }, tone.label)),
                  h('td', { className: 'ap-mono' }, (impact.magnitude || '-') + '/3'))
              }))))
          : null,
        policy.versions.length > 0
          ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } },
            h('span', { className: 'ap-eyebrow', style: { alignSelf: 'center' } }, '版本'),
            policy.versions.map((version, index) =>
              h('span', { key: index, className: 'ap-tag ap-mono' }, 'v' + version.versionNo + ' ' + version.date + ' ' + version.note)))
          : null,
        related.length > 0
          ? h('div', { style: { marginTop: 4 } },
            h('div', { className: 'ap-eyebrow' }, '同主题政策'),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 } },
              related.map((item) =>
                h('button', {
                  key: item.id, type: 'button', className: 'ap-link',
                  style: { fontSize: 11 },
                  onClick: () => onOpen(item.id)
                }, item.publishDate + ' · ' + item.title + '（' + item.levelName + '）'))))
          : null
      )
    }

    // ── 报告视图 ──────────────────────────────────────────────────────

    function ReportView(props) {
      const { report, loading, error, onBack, onDownload } = props

      if (loading) {
        return h('div', { className: 'ap-card' },
          h('div', { className: 'ap-card-head' },
            h('span', { className: 'ap-card-title' }, '正在生成报告'),
            h('span', { className: 'ap-card-sub' }, '规则计算 + 行情快照 + 质检')),
          h('div', { className: 'ap-skeleton' }, h('div', { className: 'ap-sk' }), h('div', { className: 'ap-sk', style: { height: 160 } })))
      }
      if (error) {
        return h('div', { className: 'ap-card' },
          h('div', { className: 'ap-card-head' },
            h('button', { type: 'button', className: 'ap-ctl', onClick: onBack }, '← 返回'),
            h('span', { className: 'ap-card-title' }, '报告生成失败')
          ),
          h('div', { className: 'ap-empty ap-error', style: { textAlign: 'left', lineHeight: 1.7 } }, String(error)),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
            h('button', { type: 'button', className: 'ap-ctl', onClick: props.onRetry }, '重试'),
            h('button', { type: 'button', className: 'ap-ctl', onClick: onBack }, '返回面板'))
        )
      }
      if (!report) return null

      const filename = 'policy-report-' + (report.month || 'latest') + '.md'
      const sectionCount = (String(report.markdown || '').match(/^## /gm) || []).length

      return h('div', { className: 'ap-card' },
        h('div', { className: 'ap-card-head' },
          h('button', { type: 'button', className: 'ap-ctl', onClick: onBack }, '← 返回'),
          h('span', { className: 'ap-card-title' }, '月度报告'),
          h('span', { className: 'ap-card-sub' }, report.month + '｜' + report.region)
        ),
        h('div', { className: 'ap-quality' },
          h('span', { className: 'ap-tag', 'data-tone': report.ok ? 'up' : 'down' }, report.ok ? '质检通过' : '质检未通过'),
          h('span', { className: 'ap-tag ap-mono' }, (report.words || 0) + ' 字'),
          h('span', { className: 'ap-tag ap-mono' }, '引用覆盖率 ' + (report.citationCoverage ?? '—') + '%'),
          h('span', { className: 'ap-tag' }, sectionCount + ' 个章节 + 附录'),
          props.cached ? h('span', { className: 'ap-tag', 'data-tone': 'up' }, '已缓存，不重复生成') : null
        ),
        report.lintErrors && report.lintErrors.length > 0
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            report.lintErrors.map((item, index) =>
              h('div', { key: index, style: { fontSize: 10.5, color: '#fda4af' } }, '· ' + item)))
          : null,
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('a', {
            className: 'ap-src', style: { border: 0, cursor: 'pointer', fontWeight: 600 },
            href: props.docxUrl || '#', title: '下载公文格式的 Word 研究报告',
            onClick: (event) => { if (!props.docxUrl) event.preventDefault() }
          }, '下载 Word 报告 ↓'),
          h('button', { type: 'button', className: 'ap-src', style: { border: 0, cursor: 'pointer' }, onClick: () => onDownload(report.markdown, filename) }, '下载 .md'),
          h('button', {
            type: 'button', className: 'ap-ctl',
            onClick: () => {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(report.markdown).catch(() => {})
              }
            }
          }, '复制全文'),
          h('button', {
            type: 'button', className: 'ap-ctl',
            title: '按当前月份重新计算一份报告（会覆盖缓存）',
            onClick: () => props.onRegenerate && props.onRegenerate()
          }, '重新生成'),
          h('span', { style: { fontSize: 10, color: '#6f88ab', alignSelf: 'center' } },
            props.cached ? '该报告已保存在本地，不会重复消耗' : '想要落盘到工作区，让助手跑一次 policy_report 即可')
        ),
        h('div', { className: 'ap-eyebrow' }, '预览'),
        h('div', { className: 'ap-pre' }, String(report.markdown || '').slice(0, 6000) + (String(report.markdown || '').length > 6000 ? '\n\n…（预览截断，下载查看全文）' : ''))
      )
    }

    // ── 指标下钻：所有汇总数字都能回到构成它的真实记录 ───────────────

    function MetricView(props) {
      const { data, view, month, onBack, onOpenPolicy, onDrill } = props
      const analysis = data.analysis || {}
      const evidence = analysis.evidenceIndex || []
      const metric = view.metric
      const key = view.key
      const sources = data.sources || {}
      const source = sources[metric] || sources.policies
      const salesUrl = 'https://www.dongchedi.com/sales'

      const openSource = source && source.url
        ? h('a', { className: 'ap-src', href: source.url, target: '_blank', rel: 'noopener noreferrer' }, '打开数据源 ↗')
        : null

      const back = h('button', { type: 'button', className: 'ap-ctl', onClick: onBack }, '← 返回')
      const titleMap = {
        tool: '政策工具 · ' + key,
        brand: '品牌份额 · ' + key,
        brands: '品牌份额与 CR5',
        nev: '新能源渗透率',
        psi: '政策强度 PSI',
        policies: '政策条目与官方原文',
        region: '区域政策画像'
      }

      const policyTable = (rows) => h('table', { className: 'ap-tbl' },
        h('thead', null, h('tr', null, h('th', null, '日期'), h('th', null, '政策'), h('th', null, '工具'), h('th', null, '原文'))),
        h('tbody', null, rows.map((policy) => h('tr', { key: policy.id },
          h('td', { className: 'ap-mono' }, policy.publishDate),
          h('td', null, h('button', { type: 'button', className: 'ap-link', onClick: () => onOpenPolicy(policy.id) }, policy.title)),
          h('td', null, (policy.tools || []).join(' / ')),
          h('td', null, h('a', { className: 'ap-quote-link', href: policy.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, '官方原文 ↗'))
        )))
      )

      let body = null
      if (metric === 'tool') {
        const rows = evidence.filter((policy) => (policy.tools || []).includes(key))
        body = rows.length
          ? h(React.Fragment, null,
            h('div', { className: 'ap-readout' }, '该分类由以下 ' + rows.length + ' 份真实政策构成；条数按政策条目计数，一策多工具会分别计入。'),
            policyTable(rows))
          : h('div', { className: 'ap-empty' }, '本期该工具分类没有可核验政策。')
      } else if (metric === 'brand') {
        const models = ((data.modelMonthly || {})[month] || []).filter((row) => row.brand === key)
        const brandRows = (analysis.brands.rows || []).filter((row) => row.brand === key)
        body = h(React.Fragment, null,
          brandRows[0]
            ? h('div', { className: 'ap-readout' },
              key + ' 当月零售 ' + num(brandRows[0].retail) + ' 辆，全国份额 ' + fixed(brandRows[0].share) + '%。以下车型明细之和即品牌汇总值。')
            : null,
          models.length
            ? h('table', { className: 'ap-tbl' },
              h('thead', null, h('tr', null, h('th', null, '车型'), h('th', null, '原始品牌'), h('th', null, '销量（辆）'), h('th', null, '占品牌'))),
              h('tbody', null, models.map((row) => h('tr', { key: row.model + row.rawBrand },
                h('td', null, row.model),
                h('td', null, row.rawBrand),
                h('td', { className: 'ap-mono' }, num(row.count)),
                h('td', { className: 'ap-mono' }, brandRows[0] && brandRows[0].retail ? fixed((row.count / brandRows[0].retail) * 100) + '%' : '—')
              ))))
            : h('div', { className: 'ap-empty' }, '本期没有该品牌的车型级明细。'),
          h('a', { className: 'ap-src', href: salesUrl, target: '_blank', rel: 'noopener noreferrer' }, '查看公开销量榜 ↗'))
      } else if (metric === 'brands') {
        const rows = analysis.brands.rows || []
        body = h('table', { className: 'ap-tbl' },
          h('thead', null, h('tr', null, h('th', null, '品牌'), h('th', null, '零售（辆）'), h('th', null, '全国份额'), h('th', null, '下钻'))),
          h('tbody', null, rows.map((row) => h('tr', { key: row.brand },
            h('td', null, row.brand),
            h('td', { className: 'ap-mono' }, num(row.retail)),
            h('td', { className: 'ap-mono' }, fixed(row.share) + '%'),
            h('td', null, h('button', { type: 'button', className: 'ap-link', onClick: () => onDrill('brand', row.brand) }, '车型明细 →'))
          ))))
      } else if (metric === 'nev') {
        const rows = (data.salesSeries || []).filter((point) => point.national)
        body = h(React.Fragment, null,
          h('div', { className: 'ap-readout' }, '渗透率 =（纯电 + 插混 + 增程零售）÷ 全量乘用车零售。没有有效分省数据，因此不展示湖南数值。'),
          h('table', { className: 'ap-tbl' },
            h('thead', null, h('tr', null, h('th', null, '月份'), h('th', null, '乘用车（辆）'), h('th', null, '新能源（辆）'), h('th', null, '渗透率'))),
            h('tbody', null, rows.map((point) => h('tr', { key: point.month },
              h('td', { className: 'ap-mono' }, point.month),
              h('td', { className: 'ap-mono' }, num(point.national.total)),
              h('td', { className: 'ap-mono' }, num(point.national.nev)),
              h('td', { className: 'ap-mono' }, fixed(point.national.share) + '%')
            )))),
          h('a', { className: 'ap-src', href: salesUrl, target: '_blank', rel: 'noopener noreferrer' }, '查看公开销量榜 ↗'))
      } else if (metric === 'psi') {
        body = h(React.Fragment, null,
          h('div', { className: 'ap-readout' }, 'PSI 仅比较有官方原文的政策强度，不代表销量影响。公式：100 × (1 − e^(−Σ(工具权重 × 层级系数 × 新鲜度) / 18))。'),
          policyTable(evidence))
      } else if (metric === 'policies') {
        body = policyTable(evidence)
      } else if (metric === 'region') {
        const ids = new Set((data.regionStats || {}).policyIds || [])
        body = h(React.Fragment, null,
          h('div', { className: 'ap-readout' }, '仅统计当前区域内带官方原文的政策。区域销量无有效公开数据，不在此估算。'),
          policyTable(evidence.filter((policy) => ids.has(policy.id))))
      }

      return h('div', { className: 'ap-card' },
        h('div', { className: 'ap-card-head' }, back, h('span', { className: 'ap-card-title' }, titleMap[metric] || '数据明细'), h('div', { className: 'ap-grow' }), openSource),
        h('div', { className: 'ap-meta' },
          h('span', { className: 'ap-tag', 'data-tone': 'up' }, '真实数据'),
          h('span', { className: 'ap-tag ap-mono' }, month),
          h('span', { className: 'ap-tag' }, '汇总值可追溯到下列记录')),
        body || h('div', { className: 'ap-empty' }, '没有可展示的数据。')
      )
    }

    // ── 面板 ──────────────────────────────────────────────────────────

    function Panel() {
      const [open, setOpen] = useState(false)
      const [month, setMonth] = useState(null)
      const [region, setRegion] = useState('')
      const [brand, setBrand] = useState('奇瑞')
      const [tick, setTick] = useState(0)
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(false)
      const [drag, setDrag] = useState({ x: 0, y: 0 })
      const [dragging, setDragging] = useState(false)
      const [view, setView] = useState({ kind: 'overview' })
      const [detail, setDetail] = useState(null)
      const [detailLoading, setDetailLoading] = useState(false)
      const [detailError, setDetailError] = useState('')
      const [report, setReport] = useState(null)
      const [reportCached, setReportCached] = useState(false)
      const [reportLoading, setReportLoading] = useState(false)
      const [reportError, setReportError] = useState('')
      const [auto, setAuto] = useState(() => {
        try {
          return window.localStorage.getItem('ap.auto') === '1'
        } catch {
          return false
        }
      })
      const [syncedAt, setSyncedAt] = useState(0)
      const [policyLevel, setPolicyLevel] = useState('all')
      const [policyQuery, setPolicyQuery] = useState('')
      const [libraryYear, setLibraryYear] = useState('all')
      const [openClause, setOpenClause] = useState(null)
      const dragRef = useRef(null)
      const inflight = useRef(null)
      const detailReq = useRef(null)
      const reportReq = useRef(null)
      const reportCache = useRef(new Map())

      useEffect(() => {
        const onToggle = () => setOpen((value) => !value)
        const onOpen = () => setOpen(true)
        window.addEventListener(TOGGLE_EVENT, onToggle)
        window.addEventListener('dsh-auto-policy-open', onOpen)
        return () => {
          window.removeEventListener(TOGGLE_EVENT, onToggle)
          window.removeEventListener('dsh-auto-policy-open', onOpen)
        }
      }, [])

      useEffect(() => {
        window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: { open } }))
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        if (inflight.current) inflight.current.abort()
        const controller = new AbortController()
        inflight.current = controller
        setLoading(true)
        setError('')
        loadOverview(month, region, brand, controller.signal)
          .then((payload) => {
            setData(payload)
            setSyncedAt(Date.now())
            setLoading(false)
          })
          .catch((cause) => {
            if (cause && cause.name === 'AbortError') return
            setError(String((cause && cause.message) || cause))
            setLoading(false)
          })
        return () => controller.abort()
      }, [open, month, region, brand, tick])

      // 自动刷新：面板开着且开关打开时，每 5 分钟重新拉一次（服务端另有 8 分钟预热）
      useEffect(() => {
        if (!open || !auto) return undefined
        const id = window.setInterval(() => setTick((value) => value + 1), 5 * 60 * 1000)
        return () => window.clearInterval(id)
      }, [open, auto])

      const toggleAuto = useCallback(() => {
        setAuto((value) => {
          const next = !value
          try {
            window.localStorage.setItem('ap.auto', next ? '1' : '0')
          } catch {
            // 隐私模式下写不进去也不影响本次会话
          }
          return next
        })
      }, [])

      // 拖拽：只在头部按下时生效，且不吞掉按钮与下拉的点击
      const onHeadDown = useCallback((event) => {
        if (event.button !== 0) return
        if (event.target.closest && event.target.closest('button, select, option, input, a')) return
        dragRef.current = { sx: event.clientX, sy: event.clientY, ox: drag.x, oy: drag.y }
        setDragging(true)
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }, [drag.x, drag.y])

      const onHeadMove = useCallback((event) => {
        if (!dragRef.current) return
        const nextX = dragRef.current.ox + (event.clientX - dragRef.current.sx)
        const nextY = dragRef.current.oy + (event.clientY - dragRef.current.sy)
        setDrag({ x: nextX, y: Math.max(-24, nextY) })
      }, [])

      const onHeadUp = useCallback(() => {
        dragRef.current = null
        setDragging(false)
      }, [])

      const openMetric = useCallback((metric, key) => {
        setView({ kind: 'metric', metric, key })
      }, [])

      const analysis = data && data.analysis ? data.analysis : null
      const sales = analysis && analysis.sales ? analysis.sales : {}
      const brands = analysis && analysis.brands ? analysis.brands : null
      const src = (data && data.sources) || {}
      const activeMonth = month || (data && data.month) || ''

      const toolRows = useMemo(() => {
        if (!analysis) return []
        return (analysis.counts.byTool || []).slice(0, 6).map((item) => ({
          name: item.tool,
          value: item.count,
          onClick: () => openMetric('tool', item.tool),
          display: item.count + ' 条 · ' + item.share + '%'
        }))
      }, [analysis, openMetric])

      const brandRows = useMemo(() => {
        if (!brands || !brands.rows) return []
        return brands.rows.slice(0, 8).map((row) => ({
          name: row.brand,
          value: row.retail,
          onClick: () => openMetric('brand', row.brand),
          display: row.share.toFixed(1) + '%',
          color: row.yoy < 0 ? 'linear-gradient(90deg, ' + ROSE + ', #f97316)' : undefined
        }))
      }, [brands, openMetric])

      const clauses = useMemo(() => {
        if (!analysis || !analysis.layers || !analysis.layers.micro) return []
        return (analysis.layers.micro.clauseImpacts || []).slice(0, 12)
      }, [analysis])

      const chain = useMemo(() => (analysis ? analysis.transmission || [] : []), [analysis])

      const goto = useCallback((delta) => {
        if (!activeMonth) return
        setMonth(shiftMonth(activeMonth, delta))
      }, [activeMonth])

      // 穿透：点政策 → 取详情（全文/条款/版本/官方链接）
      const openPolicy = useCallback((id) => {
        if (!id) return
        if (detailReq.current) detailReq.current.abort()
        const controller = new AbortController()
        detailReq.current = controller
        setView({ kind: 'policy', id })
        setDetail(null)
        setDetailError('')
        setDetailLoading(true)
        loadDetail(id, controller.signal)
          .then((payload) => {
            setDetail(payload)
            setDetailLoading(false)
          })
          .catch((cause) => {
            if (cause && cause.name === 'AbortError') return
            setDetailError(String((cause && cause.message) || cause))
            setDetailLoading(false)
          })
      }, [])

      // 报告：与工具同一套渲染，行情表随报告一起快照。
      // 生成一次就缓存（内存 + localStorage），再次点开直接复用，不重复请求、不重复消耗。
      const openReport = useCallback((force) => {
        const cacheKey = (activeMonth || 'latest') + '|' + brand
        if (!force) {
          const cached = reportCache.current.get(cacheKey)
          if (cached) {
            setView({ kind: 'report' })
            setReportError('')
            setReportLoading(false)
            setReportCached(true)
            setReport(cached)
            return
          }
          const stored = readStoredReport(cacheKey)
          if (stored) {
            reportCache.current.set(cacheKey, stored)
            setView({ kind: 'report' })
            setReportError('')
            setReportLoading(false)
            setReportCached(true)
            setReport(stored)
            return
          }
        }
        if (reportReq.current) reportReq.current.abort()
        const controller = new AbortController()
        reportReq.current = controller
        setView({ kind: 'report' })
        setReport(null)
        setReportError('')
        setReportCached(false)
        setReportLoading(true)
        loadReport(activeMonth, region, brand, controller.signal)
          .then((payload) => {
            reportCache.current.set(cacheKey, payload)
            storeReport(cacheKey, payload)
            setReport(payload)
            setReportLoading(false)
          })
          .catch((cause) => {
            if (cause && cause.name === 'AbortError') return
            setReportError(String((cause && cause.message) || cause))
            setReportLoading(false)
          })
      }, [activeMonth, region, brand])

      if (!open) return null

      const psi = analysis ? analysis.psi : null
      const counts = analysis ? analysis.counts : null
      const national = sales.national || null
      const hunan = sales.hunan || null
      const deltaTone = psi ? (psi.delta > 0 ? 'up' : psi.delta < 0 ? 'down' : 'flat') : 'flat'

      // 区域视图：所有 KPI 都用该地区口径，避免湖南与全国看起来一样
      const rs = data && data.regionStats ? data.regionStats : null
      const scopeName = rs ? rs.label : '全国'
      const scopePsi = region ? (rs ? rs.psi : null) : (psi ? psi.current : null)
      const scopeCount = region ? (rs ? rs.count : 0) : (counts ? counts.total : 0)
      const scopeLive = region ? (rs ? rs.live : 0) : (counts ? counts.live : 0)
      const scopeDelta = rs && rs.series && rs.series.length > 1
        ? Math.round((rs.series[rs.series.length - 1].psi - rs.series[rs.series.length - 2].psi) * 10) / 10
        : (psi ? psi.delta : 0)
      const scopeShare = region && hunan ? hunan.share : (national ? national.share : null)

      return h('div', {
        className: 'ap-layer',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) setOpen(false)
        }
      },
        h('div', {
          className: 'ap-shell',
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': '汽车政策研究台',
          style: { transform: 'translate(' + drag.x + 'px, ' + drag.y + 'px)' }
        },
          // 头部（可拖拽）
          h('div', {
            className: 'ap-head',
            'data-dragging': dragging ? 'true' : 'false',
            onPointerDown: onHeadDown,
            onPointerMove: onHeadMove,
            onPointerUp: onHeadUp,
            onPointerCancel: onHeadUp,
            onDoubleClick: () => setDrag({ x: 0, y: 0 })
          },
            h('div', { className: 'ap-mark' }, h(CarIcon, { size: 19 })),
            h('div', { className: 'ap-brand' },
              h('b', null, '汽车政策研究台'),
              h('span', { className: 'ap-mono' }, 'chery // policy desk · macro / meso / micro')
            ),
            data ? h('span', { className: 'ap-live' }, h('i'), data.dataset.mode === 'live' ? 'live' : 'empty') : null,
            h('div', { className: 'ap-grow' }),
            h('select', {
              className: 'ap-pick',
              'aria-label': '品牌',
              title: '选择要分析哪个品牌',
              value: brand,
              onChange: (event) => setBrand(event.target.value)
            }, (data && data.brands ? data.brands : ['奇瑞']).map((item) => h('option', { key: item, value: item }, item))),
            // 分省销量没有可核验来源，界面不再提供「湖南」切换，避免把全国数当湖南数看。
            h('span', {
              className: 'ap-ctl', style: { opacity: 0.55, cursor: 'default' },
              title: '公开销量榜不提供有效分省数据，湖南视图暂不可用'
            }, '全国口径'),
            h('button', { type: 'button', className: 'ap-ctl', title: '上一月', 'aria-label': '上一月', onClick: () => goto(-1) }, h(Caret, { flip: true })),
            h('select', {
              className: 'ap-pick',
              'aria-label': '月份',
              value: activeMonth,
              onChange: (event) => setMonth(event.target.value)
            }, (data ? data.months : []).slice().reverse().map((item) => {
              const hasPolicy = (data.policyMonths || []).includes(item)
              const hasSales = (data.salesSeries || []).some((point) => point.month === item)
              const mark = hasPolicy ? ' ●' : hasSales ? ' ○' : ''
              return h('option', { key: item, value: item }, item + mark)
            })),
            h('button', { type: 'button', className: 'ap-ctl', title: '下一月', 'aria-label': '下一月', onClick: () => goto(1) }, h(Caret)),
            h('button', {
              type: 'button', className: 'ap-ctl',
              title: '立即重新计算（数据文件变化会自动生效）',
              onClick: () => setTick((value) => value + 1)
            }, loading ? '…' : '刷新'),
            h('button', {
              type: 'button', className: 'ap-ctl', 'data-on': auto ? 'true' : 'false',
              title: '每 5 分钟自动刷新', 'aria-pressed': auto ? 'true' : 'false',
              onClick: toggleAuto
            }, '自动'),
            h('button', {
              type: 'button', className: 'ap-ctl ap-report-btn',
              style: { borderColor: 'rgba(34,211,238,.45)', color: '#67e8f9' },
              title: '用当前选中的月份与品牌生成一份带质检的报告',
              onClick: openReport
            }, '生成报告'),
            h('button', { type: 'button', className: 'ap-ctl', title: '关闭（Esc）', 'aria-label': '关闭', onClick: () => setOpen(false) }, h(CloseIcon))
          ),

          // 主体
          h('div', { className: 'ap-body' },
            error ? h('div', { className: 'ap-card ap-error' }, h('div', { className: 'ap-empty ap-error' }, error)) : null,

            loading && !data
              ? h('div', { className: 'ap-skeleton' }, h('div', { className: 'ap-sk', style: { height: 132 } }), h('div', { className: 'ap-sk' }))
              : null,

            view.kind === 'metric'
              ? h(MetricView, {
                data,
                view,
                month: activeMonth,
                onBack: () => setView({ kind: 'overview' }),
                onOpenPolicy: openPolicy,
                onDrill: openMetric
              })
              : view.kind === 'policy'
              ? h(PolicyDetail, {
                detail,
                loading: detailLoading,
                error: detailError,
                onBack: () => setView({ kind: 'overview' }),
                onOpen: openPolicy
              })
              : view.kind === 'report'
                ? h(ReportView, {
                  report,
                  loading: reportLoading,
                  error: reportError,
                  cached: reportCached,
                  docxUrl: (chosenPath || OVERVIEW_PATHS[0]) + '/report.docx?month=' + encodeURIComponent(report?.month || activeMonth || ''),
                  onBack: () => setView({ kind: 'overview' }),
                  onRetry: () => openReport(true),
                  onRegenerate: () => openReport(true),
                  onDownload: downloadMarkdown
                })
                : data
              ? h(React.Fragment, null,
                analysis && analysis.counts && analysis.counts.total === 0 && data.latestPolicyMonth && data.latestPolicyMonth !== activeMonth
                  ? h('div', {
                    className: 'ap-card',
                    style: { padding: '8px 12px', borderColor: 'rgba(251,191,36,.38)', flexDirection: 'row', alignItems: 'center', gap: 8 }
                  },
                    h('span', { className: 'ap-tag', 'data-tone': 'down' }, '本月无新政策'),
                    h('span', { style: { fontSize: 11, color: '#9db4d6' } },
                      activeMonth + ' 没有收录到带官方原文的政策（文件库通常滞后 1—2 个月）。最近一期是 ' + data.latestPolicyMonth + '。'),
                    h('button', {
                      type: 'button', className: 'ap-ctl', style: { marginLeft: 'auto' },
                      onClick: () => setMonth(data.latestPolicyMonth)
                    }, '跳到 ' + data.latestPolicyMonth + ' ↗'))
                  : null,
                h(BrandStrip, { brand: data.brand, month: activeMonth, onOpen: openPolicy, source: src.brand }),

                h('div', { className: 'ap-kpis' },
                  h('div', { className: 'ap-kpi', style: { '--ap-accent': CYAN, cursor: 'pointer' }, onClick: () => openMetric('psi'), title: '查看 PSI 计算依据' },
                    h('div', { className: 'ap-kpi-label' }, '政策强度 PSI · ' + scopeName),
                    h('div', { className: 'ap-kpi-value ap-mono' }, scopePsi === null ? '—' : fixed(scopePsi), h('small', null, '/100')),
                    h('div', { className: 'ap-kpi-foot' },
                      h('span', { className: 'ap-tag', 'data-tone': deltaTone }, signed(scopeDelta) + ' 环比'),
                      h('span', null, '上月 ' + (psi ? fixed(psi.previous) : '—')),
                      h(SourceLink, { source: src.psi }))
                  ),
                  h('div', { className: 'ap-kpi', style: { '--ap-accent': BLUE, cursor: 'pointer' }, onClick: () => openMetric('policies'), title: '查看本期政策与官方原文' },
                    h('div', { className: 'ap-kpi-label' }, '本期政策 · ' + scopeName),
                    h('div', { className: 'ap-kpi-value ap-mono' }, scopeCount, h('small', null, '条')),
                    h('div', { className: 'ap-kpi-foot' },
                      h('span', null, rs ? ('官方原文 ' + scopeLive + ' 份') : ('国家 ' + levelCount(counts, 1) + ' · 省 ' + levelCount(counts, 2) + ' · 市 ' + levelCount(counts, 3) + ' · 国际 ' + levelCount(counts, 0))),
                      h(SourceLink, { source: src.policies }))
                  ),
                  h('div', { className: 'ap-kpi', style: { '--ap-accent': LIME, cursor: 'pointer' }, onClick: () => openMetric('nev'), title: '查看渗透率月度构成' },
                    h('div', { className: 'ap-kpi-label' },
                      'NEV 渗透率 · ' + (region && hunan ? scopeName : '全国') +
                      (region && !hunan ? '（无湖南分省数据）' : '')),
                    h('div', { className: 'ap-kpi-value ap-mono' }, scopeShare === null ? '—' : fixed(scopeShare), h('small', null, '%')),
                    h('div', { className: 'ap-kpi-foot' },
                      h('span', null, region && !hunan
                        ? '湖南无有效分省销量，此处为全国口径'
                        : '全国 ' + (national ? fixed(national.share) + '%' : '—') + (data.dataset.salesMode === 'live' ? '（懂车帝）' : '')),
                      h(SourceLink, { source: src.nev }))
                  ),
                  h('div', { className: 'ap-kpi', style: { '--ap-accent': AMBER, cursor: 'pointer' }, onClick: () => openMetric('brands'), title: '查看品牌份额与 CR5 构成' },
                    h('div', { className: 'ap-kpi-label' }, '品牌集中度 CR5'),
                    h('div', { className: 'ap-kpi-value ap-mono' }, brands && brands.cr5 ? fixed(brands.cr5) : '—', h('small', null, '%')),
                    h('div', { className: 'ap-kpi-foot' },
                      h('span', null, brands && brands.rows && brands.rows.length
                        ? '首位 ' + brands.rows[0].brand + ' ' + fixed(brands.rows[0].share) + '%'
                        : '本期无品牌排行'),
                      h(SourceLink, { source: src.cr5 }))
                  )
                ),

                rs
                  ? h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('button', { type: 'button', className: 'ap-card-title ap-link', onClick: () => openMetric('region') }, '区域画像 · ' + rs.label + ' ↗'),
                      h('span', { className: 'ap-card-sub' }, '仅统计该地区（省 + 市州）政策'),
                      h(SourceLink, { source: src.policies })
                    ),
                    h('div', { className: 'ap-grid-3' },
                      h('div', null,
                        h('div', { className: 'ap-eyebrow' }, '政策条数'),
                        h('div', { className: 'ap-big ap-mono', style: { fontSize: 24 } }, scopeCount, h('span', null, '条')),
                        h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 } },
                          rs.levelMix.map((item) => h('span', { key: item.level, className: 'ap-tag' }, item.name + ' ' + item.count))),
                        h('div', { style: { marginTop: 6 } },
                          rs.issuers.map((item) => h('div', { key: item.name, style: { fontSize: 10.5, color: '#8aa0c0' } }, item.name + ' · ' + item.count)))
                      ),
                      h('div', null,
                        h('div', { className: 'ap-eyebrow' }, '区域政策强度 PSI'),
                        h(PsiBars, { series: rs.series })
                      ),
                      h('div', null,
                        h('div', { className: 'ap-eyebrow' }, '市州分布'),
                        rs.cities.length > 0
                          ? h(HBars, { rows: rs.cities.map((item) => ({ name: item.name, value: item.count, display: item.count + ' 条' })) })
                          : h('div', { className: 'ap-empty' }, '本期无市级政策')
                      )
                    )
                  )
                  : null,

                h('div', { className: 'ap-grid' },
                  h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('button', { type: 'button', className: 'ap-card-title ap-link', onClick: () => openMetric('psi') }, '政策强度走势 ↗'),
                      h('span', { className: 'ap-card-sub' }, '近 6 个月 PSI'), h(SourceLink, { source: src.psi })
                    ),
                    h('React.Fragment', null,
                      (data.psiSeries || []).some((point) => point.psi > 0 || point.count > 0)
                        ? h(PsiBars, { series: data.psiSeries || [] })
                        : h('div', { className: 'ap-empty' }, '近 6 个月没有收录到带官方原文的政策，无法计算 PSI。'),
                      h('div', {
                        style: { fontSize: 9.5, color: '#6f88ab', marginTop: 6, lineHeight: 1.6 },
                        title: 'PSI = 100 × (1 − e^(−Σ(工具权重 × 层级系数 × 新鲜度) / 18))；新鲜度按 90 天半衰期衰减'
                      },
                        '按月计算：只用当月政策 × 工具权重 × 层级系数 × 90 天半衰期，不做跨月累加；柱上数字是当月政策条数。')
                    )
                  ),
                  h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('button', { type: 'button', className: 'ap-card-title ap-link', onClick: () => openMetric('nev') }, '新能源渗透率 ↗'),
                      h('span', { className: 'ap-card-sub' },
                        h('span', { className: 'ap-legend' },
                          h('span', null, h('i', { className: 'ap-dot', style: { background: BLUE } }), '全国')),
                        h(SourceLink, { source: src.nev }))
                    ),
                    (data.salesSeries || []).some((point) => point.national)
                      ? h(ShareLines, { series: data.salesSeries || [] })
                      : h('div', { className: 'ap-empty' }, '所选月份没有销量数据，无法绘制渗透率。请切换到有销量的月份（2026-01 起）。')
                  ),
                  h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('button', { type: 'button', className: 'ap-card-title ap-link', onClick: () => openMetric('policies') }, '政策工具结构 ↗'),
                      h('span', { className: 'ap-card-sub' }, '按条目计数'), h(SourceLink, { source: src.policies })
                    ),
                    h(HBars, { rows: toolRows })
                  ),
                  h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('button', { type: 'button', className: 'ap-card-title ap-link', onClick: () => openMetric('brands') }, '品牌份额 TOP8 ↗'),
                      h('span', { className: 'ap-card-sub' }, '红色=同比下滑'), h(SourceLink, { source: src.brands })
                    ),
                    h(HBars, { rows: brandRows })
                  )
                ),

                h(MarketCard, { market: data.market, source: src.market }),

                (() => {
                  const financials = data.financials || {}
                  const list = Object.values(financials).filter((company) => (company.periods || []).length > 0)
                  if (list.length === 0) return null
                  const unitOf = (company) => (company.currency === 'HKD' ? '亿港元' : '亿元')
                  return h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('span', { className: 'ap-card-title' }, '主要上市车企 · 最新报告期业绩'),
                      h('span', { className: 'ap-card-sub' }, list.length + ' 家 · 东方财富数据中心')
                    ),
                    h('div', { style: { maxHeight: 320, overflowY: 'auto' } },
                      h('table', { className: 'ap-tbl' },
                        h('thead', null,
                          h('tr', null,
                            h('th', null, '公司'), h('th', null, '报告期'), h('th', null, '营业收入'),
                            h('th', null, '净利润'), h('th', null, '毛利率'), h('th', null, 'ROE'))),
                        h('tbody', null,
                          list.map((company) => {
                            const latest = company.periods[0]
                            const unit = unitOf(company)
                            const profitPositive = (latest.netProfit ?? 0) >= 0
                            return h('tr', { key: company.code },
                              h('td', null,
                                h('div', null, company.name,
                                  h('span', { style: { color: '#4b6079', marginLeft: 6, fontSize: 9.5 }, className: 'ap-mono' },
                                    company.code + (company.market === 'HK' ? ' ·HK' : ''))),
                                (() => {
                                  const forecast = (company.forecasts || [])[0]
                                  const rating = company.ratings && company.ratings.breakdown?.[0]
                                  const consensus = company.consensus
                                  const target = company.ratings && company.ratings.targetPrice
                                  const pdf = (company.reports || [])[0]
                                  if (!forecast && !rating && !consensus && !pdf) return null
                                  return h('div', { style: { marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' } },
                                    forecast
                                      ? h('span', {
                                        className: 'ap-tag',
                                        'data-tone': /预增|扭亏|续盈/.test(forecast.type) ? 'up' : /预减|首亏|续亏/.test(forecast.type) ? 'down' : undefined,
                                        title: forecast.content || ''
                                      }, '预告 ' + forecast.type)
                                      : null,
                                    rating
                                      ? h('span', { className: 'ap-tag', title: '近 ' + (company.ratings.windowDays ?? 180) + ' 天研报评级分布' },
                                        rating.name + '×' + rating.count)
                                      : null,
                                    consensus
                                      ? h('span', { className: 'ap-tag ap-mono', title: '一致预期：' + (consensus.years || []).map((item) => item.year + item.mark + ' ' + Number(item.eps).toFixed(2)).join(' / ') },
                                        '预期 ' + consensus.ratingOrgNum + '家')
                                      : null,
                                    target
                                      ? h('span', { className: 'ap-tag ap-mono', title: '目标价中位数（' + target.count + ' 份研报）' },
                                        '目标 ' + target.median)
                                      : null,
                                    pdf
                                      ? h('a', {
                                        className: 'ap-quote-link', style: { fontSize: 9.5 },
                                        href: pdf.pdfUrl, target: '_blank', rel: 'noopener noreferrer',
                                        title: pdf.title + '（巨潮资讯 PDF）'
                                      }, '季报PDF ↗')
                                      : null)
                                })()),
                              h('td', { className: 'ap-mono', style: { fontSize: 10 } }, latest.reportDate.slice(0, 7) + ' ' + latest.reportType),
                              h('td', { className: 'ap-mono' }, (latest.revenue / 1e8).toFixed(1) + ' ' + unit),
                              h('td', { className: 'ap-mono ' + (profitPositive ? 'ap-num-up' : 'ap-num-down') },
                                latest.netProfit === null ? '—' : (latest.netProfit / 1e8).toFixed(1) + ' ' + unit),
                              h('td', { className: 'ap-mono' }, latest.grossMargin === null || latest.grossMargin === undefined ? '—' : fixed(latest.grossMargin, 1) + '%'),
                              h('td', { className: 'ap-mono' }, latest.roe === null || latest.roe === undefined ? '—' : fixed(latest.roe, 1) + '%'))
                          }))
                      )),
                    h('div', { style: { fontSize: 9.5, color: '#6f88ab', marginTop: 6, lineHeight: 1.6 } },
                      'A 股为营业总收入与归母净利润，港股为营业额与股东应占溢利；各自本币，不做汇率折算。'))
                })(),

                (() => {
                  const rows = data.linkage || []
                  if (rows.length === 0) return null
                  const peak = rows.reduce((best, row) => (row.policyCount > (best?.policyCount ?? 0) ? row : best), null)
                  return h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('span', { className: 'ap-card-title' }, '政策与财报 · 季度对照'),
                      h('span', { className: 'ap-card-sub' },
                        '样本 A 股 5 家 · 只做同向观察，不做因果归因')),
                    h('table', { className: 'ap-tbl' },
                      h('thead', null,
                        h('tr', null,
                          h('th', null, '季度'), h('th', null, '政策条数'), h('th', null, '季度 PSI'),
                          h('th', null, '平均毛利率'), h('th', null, '平均营收同比'))),
                      h('tbody', null,
                        rows.map((row) =>
                          h('tr', { key: row.quarter, 'data-focus': peak && row.quarter === peak.quarter ? 'true' : 'false' },
                            h('td', { className: 'ap-mono' }, row.quarter + (peak && row.quarter === peak.quarter ? ' ●' : '')),
                            h('td', { className: 'ap-mono' }, row.policyCount + ' 条'),
                            h('td', { className: 'ap-mono' }, fixed(row.psi, 1)),
                            h('td', { className: 'ap-mono' }, row.avgGrossMargin === null ? '—' : fixed(row.avgGrossMargin, 1) + '%'),
                            h('td', { className: 'ap-mono ' + (row.avgRevenueGrowth === null ? '' : row.avgRevenueGrowth >= 0 ? 'ap-num-up' : 'ap-num-down') },
                              row.avgRevenueGrowth === null ? '—' : signed(row.avgRevenueGrowth) + '%'))))
                    ),
                    h('div', { style: { fontSize: 9.5, color: '#6f88ab', marginTop: 6, lineHeight: 1.6 } },
                      '● 表示样本期内政策最密集的季度。政策按月计、财报按季计，两者只做同向对照；毛利率与营收同比为 A 股 5 家整车企业均值。'))
                })(),

                h('div', { className: 'ap-grid' },
                  h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('span', { className: 'ap-card-title' }, '条款证据 · 原文定位'),
                      h('span', { className: 'ap-card-sub' }, '只摘录真实正文，不生成弹性')
                    ),
                    clauses.length === 0
                      ? h('div', { className: 'ap-empty' }, '本期无条款级标注。')
                      : h('div', { className: 'ap-clauses', style: { maxHeight: 340, overflowY: 'auto', paddingRight: 4 } },
                        clauses.map((clause) => {
                          const tone = DIRECTION[clause.direction] || DIRECTION.neutral
                          return h('div', { className: 'ap-clause', key: clause.policyId + '-' + clause.clauseNo },
                            h('span', { className: 'ap-tag', 'data-tone': tone.tone }, tone.label),
                            h('div', { style: { minWidth: 0 } },
                              h('button', {
                              type: 'button', className: 'ap-clause-policy ap-link', title: clause.policyTitle,
                              style: { border: 0, background: 'transparent', padding: 0, font: 'inherit' },
                              onClick: () => openPolicy(clause.policyId)
                            }, clause.policyTitle),
                              h('div', {
                                className: 'ap-clause-text',
                                'data-open': openClause === clause.policyId + clause.clauseNo ? 'true' : 'false',
                                title: '点击展开/收起条款全文',
                                onClick: () => setOpenClause((prev) =>
                                  prev === clause.policyId + clause.clauseNo ? null : clause.policyId + clause.clauseNo)
                              }, clause.clauseText),
                              h('div', {
                                style: { fontSize: 9.5, color: '#7fd7f5', marginTop: 3, lineHeight: 1.6 },
                                title: '按条款原文措辞与作用对象生成的规则解读，不是模型推断'
                              },
                                '解读：' +
                                (tone.tone === 'up' ? '对「' + clause.target + '」形成正向支持'
                                  : tone.tone === 'down' ? '对「' + clause.target + '」形成约束'
                                    : '对「' + clause.target + '」的影响需结合实施口径判断') +
                                (clause.magnitude >= 2 ? '；条款含明确量化指标，落地可追踪' : '；条款未量化，力度取决于后续执行') +
                                '（第 ' + clause.paragraph + ' 段）')),
                            h('a', {
                              className: 'ap-quote-link', href: clause.sourceUrl,
                              target: '_blank', rel: 'noopener noreferrer',
                              title: '第 ' + clause.paragraph + ' 段，打开官方原文'
                            }, '原文 ↗')
                          )
                        })
                      )
                  ),
                  h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('button', { type: 'button', className: 'ap-card-title ap-link', onClick: () => openMetric('policies') }, '国内政策全库'),
                      h('span', { className: 'ap-card-sub' },
                        (data.libraryList || []).length + ' 条 · 本期 ' + (analysis.evidenceIndex || []).length + ' 条')
                    ),
                    h('input', {
                      type: 'search',
                      value: policyQuery,
                      placeholder: '搜索标题 / 发文机构 / 工具…',
                      onChange: (event) => setPolicyQuery(event.target.value),
                      style: {
                        width: '100%', height: 28, marginBottom: 6, padding: '0 8px',
                        fontSize: 11.5, color: 'inherit', background: 'rgba(148,190,255,.06)',
                        border: '1px solid rgba(120,180,255,.16)', borderRadius: 7
                      }
                    }),
                    h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 } },
                      [['all', '全部']].concat((data.libraryYears || []).map((year) => [year, year])).map(([value, label]) => {
                        const count = value === 'all'
                          ? (data.libraryList || []).length
                          : (data.libraryList || []).filter((policy) => String(policy.publishDate).startsWith(value)).length
                        return h('button', {
                          key: value, type: 'button', className: 'ap-ctl',
                          'data-on': libraryYear === value ? 'true' : 'false',
                          onClick: () => setLibraryYear(value)
                        }, label + ' ' + count)
                      })),
                    (() => {
                      const query = policyQuery.trim().toLowerCase()
                      const visible = (data.libraryList || [])
                        .filter((policy) => libraryYear === 'all' || String(policy.publishDate).startsWith(libraryYear))
                        .filter((policy) => {
                          if (!query) return true
                          const haystack = [policy.title, policy.issuer, (policy.tools || []).join(' ')].join(' ').toLowerCase()
                          return haystack.includes(query)
                        })
                      if (visible.length === 0) {
                        return h('div', { className: 'ap-empty' },
                          query ? '没有匹配「' + policyQuery + '」的政策，清空搜索试试。' : '该年份没有政策。')
                      }
                      return h('div', { className: 'ap-clauses', style: { maxHeight: 420, overflowY: 'auto', paddingRight: 4 } },
                        visible.map((policy) =>
                          h('div', { className: 'ap-clause', key: policy.id },
                            h('span', { className: 'ap-tag' }, policy.levelName),
                            h('div', { style: { minWidth: 0 } },
                              h('button', {
                                type: 'button', className: 'ap-clause-policy ap-link', title: policy.title,
                                onClick: () => openPolicy(policy.id)
                              }, policy.title),
                              h('div', { className: 'ap-clause-text' },
                                policy.publishDate + ' · ' + (policy.issuer || '未标注机构') +
                                (policy.tools && policy.tools.length ? ' · ' + policy.tools.join('/') : ''))),
                            h('a', { className: 'ap-quote-link', href: policy.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, '原文 ↗')
                          ))
                      )
                    })()
                  )
                ),

                analysis && analysis.gaps && analysis.gaps.length
                  ? h('div', { className: 'ap-card' },
                    h('div', { className: 'ap-card-head' },
                      h('span', { className: 'ap-card-title' }, '数据缺口'),
                      h('span', { className: 'ap-card-sub' }, analysis.gaps.length + ' 项')
                    ),
                    analysis.gaps.map((gap, index) =>
                      h('div', { key: index, style: { fontSize: 10.5, color: '#8aa0c0', padding: '2px 0' } }, '· ' + gap)))
                  : null
              )
              : null
          ),

          h('div', { className: 'ap-foot' },
            h('span', null, 'MODE ' + (data ? data.dataset.mode : '—')),
            h('span', null, '·'),
            h('span', null, 'LIB ' + (data ? data.library.total : '—') + ' 条'),
            h('span', null, '·'),
            h('span', null, 'ENGINE evidence-v2'),
            h('span', null, '·'),
            h('span', null, data && data.market ? 'QUOTE ' + (data.market.degraded ? 'cache' : 'eastmoney') : 'QUOTE —'),
            h('span', null, '·'),
            h('span', null, 'SALES ' + (data && data.dataset.salesMode === 'live' ? 'dongchedi' : 'unavailable')),
            h('span', null, '·'),
            h('span', {
              title: (data && data.sourceHealth ? data.sourceHealth : []).map((item) => `${item.name}: ${item.verdict}`).join('\n') || '未做源健康检查'
            }, 'SRC ' + (data && data.sourceHealth
              ? data.sourceHealth.filter((item) => item.verdict === 'live').length + '/' + data.sourceHealth.length
              : '—')),
            h('div', { className: 'ap-grow' }),
            h('span', null, syncedAt ? 'SYNC ' + new Date(syncedAt).toLocaleTimeString('zh-CN', { hour12: false }) : 'SYNC —'),
            h('span', null, '·'),
            h('span', null, '拖动标题移动 · 双击复位 · Esc 关闭')
          )
        )
      )
    }

    function levelCount(counts, level) {
      if (!counts || !counts.byLevel) return 0
      const hit = counts.byLevel.find((item) => Number(item.level) === Number(level))
      return hit ? hit.count : 0
    }

    // ── 入口 ──────────────────────────────────────────────────────────

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: '' }
      }
      static getDerivedStateFromError(error) {
        return { error: String((error && error.message) || error) }
      }
      render() {
        if (this.state.error) {
          return h('div', { className: 'ap-layer' },
            h('div', { className: 'ap-shell', style: { height: 'auto', padding: 18 } },
              h('div', { className: 'ap-empty ap-error' }, '面板渲染出错：' + this.state.error)))
        }
        return this.props.children
      }
    }

    const GuardedPanel = () => h(Boundary, null, h(Panel))

    function apply(ctx) {
      ctx.effect(function () {
        const style = document.createElement('style')
        style.setAttribute('data-auto-policy', 'panel')
        style.textContent = CSS
        document.head.appendChild(style)
        return function () {
          if (style.parentNode) style.parentNode.removeChild(style)
        }
      }, 'auto-policy: panel styles')

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.footer.action', function () {
          return ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'auto-policy', order: 20, label: '汽车政策研究台' },
            SidebarEntry
          )
        })
      }, 'auto-policy: sidebar entry')

      ctx.effect(function () {
        return ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'auto-policy-panel', order: 40, label: '汽车政策研究台' },
            GuardedPanel
          )
        })
      }, 'auto-policy: overlay panel')
    }

    return { inject: ['slots'], apply }
  }
})