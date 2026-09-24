# 微信步数修改同步助手 (Zepp Life / Vercel 版)

轻量、现代化的微信步数修改工具，基于 Zepp Life 官方云端接口协议，专为 Vercel Serverless Function 架构设计。

---

## 🌟 特性

- **零依赖 (0 Dependencies)**：使用原生 Node.js 与内置 `fetch`，无需安装任何 npm 第三方依赖，Vercel 部署 **秒级完成**，彻底告别旧版 Next.js 因依赖冲突导致的部署失败。
- **现代化 Web UI**：深色玻璃拟态设计，自适应手机和电脑屏幕，支持步数快捷预设与本地记住账号。
- **支持 API / 快捷指令**：支持 `GET` 和 `POST` 请求，轻松接入 iOS 快捷指令（Shortcuts）或定时脚本。
- **完整手环协议模拟**：包含心率数据与活动区间模拟，通过率高，不易被风控判定为异常包。

---

## 📁 目录结构

```text
├── api/
│   ├── step.js         # Vercel Serverless Function 接口 (免依赖)
│   └── template.js     # 真实手环全天活动与心率数据载荷模板
├── public/
│   └── index.html      # 现代化响应式 Web 前端
├── package.json        # 项目基础配置
├── vercel.json         # Vercel 路由与重写配置
├── server.js           # 本地免安装测试服务 (可选)
└── .gitignore
```

---

## 🚀 部署步骤

### 第一步：将代码推送到 GitHub

1. 在 GitHub 上新建一个仓库（例如命名为 `wechat-step`），建议设置为 **Private（私有）**。
2. 在本地项目根目录下打开终端，依次执行：

```bash
git init
git add .
git commit -m "feat: initial commit"
git branch -M main
git remote add origin https://github.com/你的用户名/wechat-step.git
git push -u origin main
```

---

### 第二步：在 Vercel 中导入并部署

1. 打开并登录 [Vercel 官网](https://vercel.com)。
2. 点击右上角的 **Add New...** -> **Project**。
3. 在 GitHub 列表中找到刚才创建的 `wechat-step` 仓库，点击 **Import**。
4. 部署设置页面：
   - **Framework Preset**：保持默认（`Other`）。
   - **Root Directory**：保持默认（`./`）。
   - **Build and Output Settings**：无需修改任何命令。
   - **Environment Variables**：无需配置环境变量。
5. 点击 **Deploy**，约 5~10 秒即可部署完成！

---

### 第三步：绑定个人自定义域名

因为 Vercel 默认提供的 `*.vercel.app` 域名在部分国内网络可能访问不稳定，强烈推荐绑定自己的域名：

1. 进入 Vercel 控制台中的项目页面，点击顶部的 **Settings** -> **Domains**。
2. 在输入框输入你打算使用的二级域名（如：`step.yourdomain.com`），点击 **Add**。
3. 根据页面提示，前往你的域名 DNS 服务商（如 阿里云、腾讯云、Cloudflare 等）：
   - 添加一条解析记录：
     - **记录类型**：`CNAME`
     - **主机记录**：`step`（即你配置的域名前缀）
     - **记录值**：`cname.vercel-dns.com`（若使用国内 CDN 或自建节点可按需配置）
4. 解析生效后，Vercel 会自动签发 SSL 证书（HTTPS），等待状态变成绿色对勾即可通过你的域名访问。

---

## 💡 API 调用与 iOS 快捷指令

除了直接访问网页，你还可以将接口加入 iOS 快捷指令，实现点一下图标自动刷步数：

### GET 请求示例：

```http
GET https://你的域名/api/step?user=你的账号&password=你的密码&steps=23888
```

- `user`：Zepp Life 注册账号（**强烈建议使用邮箱**）
- `password`：账号密码
- `steps`：目标步数（可选，留空则随机生成 18,000 ~ 26,000 之间的合理步数）

### 返回结果：

```json
{
  "code": 200,
  "success": true,
  "message": "步数修改成功！微信可能需要几分钟同步",
  "data": {
    "account": "user@example.com",
    "steps": 23888,
    "date": "2026-09-24",
    "time": "2026-09-24 18:50:00"
  }
}
```

---

## ⚠️ 避坑提醒

1. **必须绑定微信**：使用前必须先在手机安装 **Zepp Life** App，进入「我的」->「第三方接入」中扫码绑定微信运动。
2. **账号推荐**：强烈推荐使用**邮箱注册**的 Zepp Life 账号，手机号容易遭遇短信验证码或接口风控拦截。
3. **微信刷新延迟**：若提交成功但微信排行榜未即时更新，可在微信中打开 **“华米科技”** 或 **“Zepp Life”** 公众号，点击菜单栏的「排行榜」手动触发同步。
