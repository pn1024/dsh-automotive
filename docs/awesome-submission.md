# 提交到 DSH 插件市场（awesome-dsh-plugin）

仓库：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>

## 一、提交方式

在他们的仓库新增**一个文件**（不要改 README，README 是脚本生成的）：

```
data/plugins/pn1024__dsh-automotive.yml
```

文件内容（可直接复制）：

```yaml
url: https://github.com/pn1024/dsh-automotive
name: pn1024/dsh-automotive
category: tools
description:
  en: China automotive industry research console - 78 official policy documents with clause-level source anchors, national NEV penetration and brand shares, Chery official monthly exports, quarterly financials and analyst consensus for 10 listed automakers, plus policy-to-earnings quarterly comparison and GB/T 9704 formatted Word reports. Nothing is shown without a verifiable source.
  zh: 汽车产业研究台——78 条官方政策原文带条款级定位，全国新能源渗透率与品牌份额，奇瑞官方月度出口，10 家上市车企季度财报与机构一致预期，政策与财报季度对照，并可导出公文格式 Word 研究报告。没有可核验来源的数据不展示。
```

`category` 取值来自官方列表：`agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun`。
本插件暴露 6 个模型工具（检索/阅读/分析/出报告/库概览/行情），因此选 `tools`。

## 二、PR 前必须满足的门槛

| 门槛 | 状态 | 说明 |
|---|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ | 已有：`dsh.bundle.patch` + `dsh.client` |
| 仓库带 `dsh-plugin` topic | ⚠️ 待添加 | 仓库页 → About 右侧齿轮 → Topics 填 `dsh-plugin` |
| 仓库创建满 1 天 | ⚠️ 待满足 | 今天刚建；CI 会因这一条报红，但官方说明它会在约 16 小时后自动重跑，**不需要重新提交** |
| 描述不含夸张用语 | ✅ | 只陈述事实与数据来源 |
| README 可被脚本重新生成 | ✅ | 标准 README |

## 三、PR 描述模板

```markdown
- [x] 我在 `data/plugins/pn1024__dsh-automotive.yml` 新增了**一个文件**，这就是完整提交。
- [x] 我的仓库 `package.json` 声明了 **`dsh.bundle`**（`dsh.bundle.patch: ./cordis.patch.yml`），并带 `dsh.client` 浏览器半边。
- [ ] 仓库创建未满 1 天（今天创建），按 CI 说明会自动重跑，无需重新提交。
- [x] `category: tools` —— 插件向模型暴露 6 个工具。
- [x] 描述只陈述功能与数据来源，无夸张用语。
- [x] 仓库已添加 `dsh-plugin` topic。

插件把汽车产业研究做成一个 DSH 面板 + 6 个工具：政策库（国务院、湖南省门户/工信厅/发改委、国家法律法规数据库，78 条均带官方原文链接与正文）、
条款级证据抽取、政策强度 PSI、懂车帝零售销量与品牌份额、奇瑞官网公告口径的出口与新能源、
10 家上市车企季度财报/业绩预告/机构评级/一致预期/季报 PDF，以及政策与财报的季度对照。
报告可导出 Markdown 与公文格式（GB/T 9704）Word。原则是没有可核验来源的数据不展示、不估算、不进报告。
```

## 四、另一条路：npm 优先

如果先完成 npm 发布，市场安装会更快：

```powershell
pnpm login --registry https://registry.npmjs.org
cd auto-policy-plugin
pnpm publish --access public --no-git-checks
```

包名 `dsh-plugin-automotive` 已确认在 npm 上可用。

## 五、也可以先不上架

`dsh-plugin-automotive-1.0.0.tgz` 可直接分发给同事：DSH 插件管理器里 `install_bundle` 传 tarball 路径即可，不依赖 npm 与市场。