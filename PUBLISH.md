# 发布到 DSH 插件市场

DSH 插件的上架链路是：**先发布到 npm → 再向 `awesome-dsh-plugin` 精选列表提 PR**。
市场（`dshmarket`）每次打开会实时读取 [awesome-dsh-plugin.com/plugins.json](https://awesome-dsh-plugin.com/plugins.json)，
条目合并后通常一天内生效。不需要向 dshmarket 仓库本身提 PR。

> 当前状态：包已打好（`dsh-plugin-automotive-1.0.0.tgz`，0.42 MB），
> 本机 **npm 未登录、GitHub token 已过期**，所以最后两步（发 npm、提 PR）需要你先授权。

## 0. 打包（已完成，可重复执行）

```powershell
cd auto-policy-plugin
pnpm pack            # 生成 dsh-plugin-automotive-1.0.0.tgz
```

包内只包含运行所需文件：`index.js`、`client.js`、`lib/`、`data/*.json`、
`scripts/`、`locale/`、`cordis.patch.yml`、`icon.svg`、`README.md`、`LICENSE`。
**不含** `data/archive/`（快照）与 `data/reports/`（生成的 Word），避免包体膨胀。

## 1. 发布到 npm

```powershell
# 一次性登录（浏览器回调）
pnpm login --registry https://registry.npmjs.org

# 发布（包名已确认可用：dsh-plugin-automotive）
cd auto-policy-plugin
pnpm publish --access public --no-git-checks
```

发布前检查：

- `package.json` 的 `name` 为 `dsh-plugin-automotive`，`version` 为 `1.0.0`
- `private` 必须为 `false`（已改）
- `dsh.bundle.patch` 指向 `./cordis.patch.yml`，且该文件在包内
- `dsh.client.inject` 列出的两个包由宿主提供，不作为依赖

> 若 `dsh-plugin-automotive` 被别人抢注，改用 `@<你的scope>/dsh-automotive`，
> 并把下面 PR 条目里的 `name` 改成同一个 npm 包名。

## 2. 提交精选列表 PR

仓库：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>

在插件列表里加一条（按其 README 的字段格式），内容大致如下：

```json
{
  "name": "dsh-plugin-automotive",
  "title": "汽车产业研究台",
  "description": "国内汽车政策库（78 条官方原文）、懂车帝销量、奇瑞官方公告、上市公司财报与一致预期；带条款级原文定位、政策-财报季度对照、Markdown 与公文格式 Word 报告。没有可核验来源的数据不展示。",
  "author": "pn1024",
  "repo": "https://github.com/pn1024/dsh-automotive",
  "npm": "dsh-plugin-automotive",
  "tags": ["汽车", "政策", "研究", "数据", "报告", "dashboard"],
  "screenshots": []
}
```

PR 通过后，DSH 内置的「插件市场」里就能搜到并一键安装。

## 3. 不上架也能分发（立即可用）

把 tarball 发给别人，或在本机其他 profile 安装：

```powershell
# 方式一：安装本地打包产物
# 插件管理器 install_bundle，target 传 tgz 的绝对路径

# 方式二：从本地目录安装（开发态）
# 插件管理器 install_bundle，target 传 auto-policy-plugin 目录
```

目录形式适合持续开发；tarball 适合一次性分发。

## 4. 后续版本发布

```powershell
cd auto-policy-plugin
# 改 package.json 版本号（语义化：修 bug 补丁位、加数据源次版本位）
pnpm pack
pnpm publish --access public --no-git-checks
```

市场会对比 npm 版本，检测到新版本后提示用户更新。

## 常见报错

### 403 Forbidden - PUT https://registry.npmjs.org/<包名>

含义：当前 token 能读、但没有**发布**权限。判定方法：

`powershell
# 能返回用户名 → token 有效
Invoke-WebRequest https://registry.npmjs.org/-/whoami -Headers @{Authorization="Bearer <token>"}
# 返回 403 → token 是只读的，不能发布
Invoke-WebRequest https://registry.npmjs.org/-/npm/v1/user -Headers @{Authorization="Bearer <token>"}
`

解决：重新生成一个有写权限的 token。

- npmjs.com → 右上头像 → **Access Tokens** → Generate New Token
- 选 **Classic Token → Automation**（可绕过 2FA，具备发布权限）；或
- 选 **Granular Access Token**：Packages 权限设为 **Read and write**，勾选 Bypass 2FA

然后写入本机配置：

`powershell
npm config set //registry.npmjs.org/:_authToken=<新token>
`

### 镜像源不能发布

本机默认 registry 若是 https://registry.npmmirror.com/（淘宝镜像，只读），发布必须显式指定官方源：

`powershell
pnpm publish --access public --no-git-checks --registry https://registry.npmjs.org/
`

## 5. 发布前自检清单

- [ ] `node scripts/smoke.mjs 2026-09 100000 奇瑞` 通过
- [ ] `node scripts/sources.mjs check` 源状态符合预期
- [ ] `data/*.json` 中没有伪造数据（无 `hunanMode: seed`、无示例条目）
- [ ] `client.js` 引用的字段与 `lib/overview.js` 返回一致
- [ ] `README.md` 的数据源表与 `data/sources.json` 一致
- [ ] 版本号已递增