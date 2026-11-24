# GitHub 2FA 认证：没有中国区短信、装不了扫码 App 怎么办

GitHub 已强制开启双因素认证（2FA）。你遇到的两个限制是真实的：

- 短信验证码不支持中国大陆号码（+86）
- GitHub Mobile App 在中国区应用商店无法下载，无法扫码

下面三条路都能绕开「手机 + GitHub App」，按推荐顺序排列。

## 方案一：Passkey（最推荐，完全不用手机）

Windows 10/11 自带 Windows Hello，可以当 passkey 用。

1. 打开 GitHub → Settings → Password and authentication
2. 找到 **Passkeys** → Add a passkey
3. 浏览器弹出 Windows 安全窗口，用 Windows Hello 验证（PIN / 指纹 / 人脸）
4. 之后登录 GitHub 时选「Sign in with a passkey」，按一下指纹或输 PIN 即可

优点：不要手机、不要 App、不要短信，验证在本机完成。
前提：这台电脑有 Windows Hello（PIN 也算），且浏览器支持 WebAuthn（Edge / Chrome 都支持）。

## 方案二：TOTP 验证器 + 本仓库自带的本地生成器

GitHub 的「Authenticator app」方式会给出一段 **setup key**（Base32 字符串），
拿到这段密钥后**不需要任何 App**，用本仓库的脚本就能出验证码。

1. GitHub → Settings → Password and authentication → **Authenticator app** → Set up
2. 页面会显示二维码，点「setup key」或「enter this text code」拿到形如
   `ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567` 的密钥
3. 保存这段密钥，运行：

```powershell
node tools/totp.mjs "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"          # 打印当前 6 位码
node tools/totp.mjs --watch "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"  # 持续刷新，带倒计时
```

4. 把脚本输出的 6 位数字填进 GitHub，完成绑定

脚本用 Node 内置 crypto 实现 RFC 6238，已通过标准测试向量自检：

```powershell
node tools/totp.mjs --check
```

> ⚠️ 这段密钥等同于第二因素。只存本机（记事本、密码管理器私密条目），
> 不要提交到仓库、不要发到聊天工具里。

如果更习惯图形界面，国内应用商店里能装到的验证器（任选其一，均支持 TOTP）：

- Microsoft Authenticator（国区 App Store / 安卓应用商店有）
- Bitwarden / 1Password / KeePassXC（Windows 桌面版也能生成 TOTP，不需要手机）

## 方案三：先存恢复码

无论用方案一还是二，绑定完成后 GitHub 会给 **recovery codes**（10 个一次性码）。
把它们下载或抄下来离线保存——这是设备丢失时唯一的后路。

## 补充：如果 GitHub 这条路实在走不通

上架 DSH 插件市场需要「npm 发布 + GitHub PR」。两条都不通时，还有替代分发方式：

| 方式 | 说明 |
|---|---|
| 直接发 tarball | `dsh-plugin-automotive-1.0.0.tgz`，对方在 DSH 插件管理器里安装本地包即可，不需要 npm 与 GitHub |
| 内网 npm 私服 | 用 Verdaccio 在局域网起一个 registry，`pnpm publish --registry http://<内网IP>:4873`，团队内可 `install` |
| 国内代码托管 | Gitee / GitCode 支持手机号或微信登录，可作为代码备份；但 DSH 市场只认 npm + GitHub，不能替代上架 |

## 相关命令速查

```powershell
# 算法自检
node tools/totp.mjs --check

# 生成验证码
node tools/totp.mjs "<你的 Base32 密钥>"

# 持续刷新（带倒计时，Ctrl+C 退出）
node tools/totp.mjs --watch "<你的 Base32 密钥>"
```