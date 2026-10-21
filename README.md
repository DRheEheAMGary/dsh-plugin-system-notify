# dsh-plugin-system-notify

给 DeepSeek Harness 的 AI 一个工具，让它能给你发一条**系统级通知**（macOS 通知中心 / Windows Toast / Linux 桌面提醒）——窗口在后台或最小化时也能弹出，而且通知的归属是 **DSH 本体**。

```
AI 调用 system_notify
        ↓
   通知横幅弹出
   DeepSeek Harness 🔔
```

## 为什么通知由「DSH 本体」发出

这件事不是配置问题，是 macOS 的归属规则：**通知归属发起它的那个应用**，不是它的父进程。

| 做法 | 归属 | 结论 |
| --- | --- | --- |
| `osascript display notification` | 脚本编辑器（Script Editor） | ❌ `/usr/bin/osascript` 是脚本编辑器的 shim，换父进程也没用 |
| 临时 helper `.app`（带 DSH 图标） | 无 | ❌ 未正式签名的 bundle 无权发通知，系统直接丢弃 |
| **页面里的 Web Notification API** | **承载页面的应用** | ✅ 桌面应用内即 DSH 本体 |

所以本插件不走脚本路线：Host 侧只负责「要发通知」这件事，真正弹出通知的是**渲染 DSH 页面的那个进程**。

实测归属（macOS 系统通知数据库 + 系统日志）：

```
record 22129 | com.deepseek.dsh
usernoted: id=n#dsh-app://app#dsh-system-notify-2, bundle=com.deepseek.dsh
NotificationCenter: addOrUpdate(...) listItem: com.deepseek.dsh:... alertStyle: banner
```

## 安装

```bash
# 在 DSH 里，用 plugin_manager 安装本仓库
plugin_manager install_bundle /path/to/dsh-plugin-system-notify
```

或者把依赖加进 profile 的 `package.json`：

```json
{
  "dependencies": {
    "dsh-plugin-system-notify": "github:DRheEheAMGary/dsh-plugin-system-notify"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-plugin-system-notify"]
    }
  }
}
```

## 工具

`system_notify`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 通知标题，约 60 字符以内 |
| `body` | 是 | 正文，一句话，约 120 字符以内 |
| `silent` | 否 | 静音投递，默认 `false` |

返回：

```json
{ "ok": true, "id": 1, "delivery": "delivered", "surface": "desktop" }
```

- `delivery: "delivered"` —— 有窗口正在监听并已接手
- `delivery: "queued"` —— 暂无窗口连接，连上后立即补发
- `surface: "desktop" | "browser"` —— 实际由哪种界面弹出（决定通知归属）

## 结构

双半部插件：

- **Host 半部**（`index.js`）注册 `system_notify` 工具，把每次请求放进收件箱（`lib/hub.js`），并开一条 `GET /api/system-notify/inbox` 长轮询路由（带 Host/Origin 与浏览器凭证校验）。
- **Client 半部**（`client.js`）常驻一个长轮询请求；Host 一有通知立刻返回，页面随即用 `new Notification(...)` 弹出。

用长轮询而不是定时轮询：通知几乎即时，且空闲时不产生每秒一次的请求。

**桌面窗口优先**：客户端会声明自己是 `desktop`（DSH 桌面窗口）还是 `browser`（浏览器标签）。只有桌面窗口能给出 DSH 身份，所以它优先接手；浏览器标签只在没有桌面窗口时才接。

**无权限的客户端不领通知**：拿不到通知权限的页面不会去领取，否则通知会被「领走但弹不出来」，而 Host 还误报成功。它会先申请权限，拿到后才开始领取。

## 平台支持

| 平台 | 状态 |
| --- | --- |
| macOS | ✅ 已实测（归属 `com.deepseek.dsh`） |
| Windows | ✅ 已实测 |
| Linux | ⚠️ 理论可用，未实测 |

插件本身不含任何平台相关代码（无 `osascript` / PowerShell / `notify-send`），走的是浏览器标准的 Web Notification API，由各平台的应用运行时翻译成本地通知。

Windows 上如果 Toast 不弹，先在「设置 → 系统 → 通知」里看列表中有没有出现 `DeepSeek Harness`（这取决于安装器是否注册了 **AppUserModelID**）；另外专注助手/勿扰模式会拦截 Toast。

## 限制

- 需要至少一个 DSH 页面（桌面应用窗口或浏览器标签）处于打开状态；全部关闭时通知排队（最多 2 分钟），窗口连上后补发。
- 在浏览器标签里打开 Web GUI 时，通知归属是该浏览器，不是 DSH——这是平台决定的，绕不过去。
- 通知是单向的：不会把窗口切到前台，也不会等待用户回应。

## License

MIT
