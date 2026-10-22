# dsh-plugin-system-notify

[![License: MIT](https://img.shields.io/github/license/DRheEheAMGary/dsh-plugin-system-notify)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-3c873a)](package.json)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)]()

仓库地址：<https://github.com/DRheEheAMGary/dsh-plugin-system-notify>

当前版本：**0.1.0**（见 [CHANGELOG.md](CHANGELOG.md)）。

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的系统通知插件：让 AI 调用一个工具，给你发一条**真正的系统级通知**——窗口在后台或最小化时也会弹出，而且横幅的归属是 **DSH 本体**（带 DSH 名称与图标），不是某个脚本宿主。

```
AI 调用 system_notify
        ↓
   ┌─────────────────────────────┐
   │ DeepSeek Harness        now │
   │ 任务完成了                   │
   │ 已生成 12 个文件，可以查看了。 │
   └─────────────────────────────┘
```

## 为什么通知由「DSH 本体」发出

这是本插件存在的唯一理由，也是它和「调一句 `osascript`」的本质区别。

**通知的归属者，是发起它的那个应用，而不是它的父进程。** macOS 上实测：

| 做法 | 通知归属 | 结论 |
| --- | --- | --- |
| `osascript -e 'display notification …'` | 脚本编辑器 `com.apple.scripteditor2` | ❌ `/usr/bin/osascript` 是脚本编辑器的 shim，换父进程（包括从 DSH 二进制启动）也无效 |
| 临时 helper `.app`（DSH 图标 + `com.deepseek.dsh.*` 标识） | 无（通知被系统丢弃） | ❌ 未正式签名的 bundle 无权发通知，沙盒直接拒绝 |
| **页面里的 Web Notification API** | **承载页面的应用** | ✅ 桌面应用内即 `com.deepseek.dsh` |

所以本插件**不走脚本路线**：Host 侧只负责「要发通知」这件事，真正弹出通知的是**渲染 DSH 页面的那个进程**。

macOS 实测归属（系统通知数据库 + 统一日志）：

```text
record 22129 | com.deepseek.dsh
usernoted: id=n#dsh-app://app#dsh-system-notify-2, bundle=com.deepseek.dsh
NotificationCenter: addOrUpdate(record: ABDEEF79, present: true):
    listItem: com.deepseek.dsh:ABDEEF79:FA2D-9051, alertStyle: banner
```

`alertStyle: banner` 说明横幅真的显示出来了，`bundle=com.deepseek.dsh` 说明归属是 DSH 本身。

## 架构

插件是**双半部**（Host + Client）包，两半通过一条长轮询路由协作：

```text
┌──────────────────────────────────────────────────────────────┐
│ Host 进程                                                     │
│                                                              │
│   system_notify (工具)                                        │
│        │                                                     │
│        ▼                                                     │
│   NotificationHub ── 收件箱（队列 + 等待中的 drain）            │
│        │                                                     │
│        ▼                                                     │
│   GET /api/system-notify/inbox  ←── 长轮询（带鉴权）           │
└──────────────────────────────┬───────────────────────────────┘
                               │  有通知就立刻返回
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Client 进程（渲染 DSH 页面的那个）                              │
│                                                              │
│   fetch(...) 常驻一个请求 ──► new Notification(title, {body})  │
└──────────────────────────────────────────────────────────────┘
```

几个关键设计决定：

**为什么用长轮询而不是定时轮询**——通知要几乎即时送达，但又不能每秒发一次请求。长轮询让客户端保持一个请求在飞，Host 一有通知立刻应答，空闲时零开销。

**为什么桌面窗口优先**——客户端会声明自己是 `desktop`（DSH 桌面窗口，协议 `dsh-app:`）还是 `browser`（浏览器标签）。只有桌面窗口能给出 DSH 身份，所以它优先接手；浏览器标签只在没有桌面窗口时才接。同一 surface 的多个窗口都会收到，横幅重复一次好过被看不到的那个窗口吞掉。

**为什么无权限的客户端不领通知**——如果客户端拿到批次却弹不出来（权限未授予），通知就永久丢失，而 Host 还回报 `delivered`。所以客户端在拿到通知权限之前**根本不发起 drain**，拿到后才开始领取。

**投递语义**——一个条目只会被一个 drain 取走；批次一次性交付，避免两个窗口各拿到半批。超过 2 分钟未取走的条目会被丢弃，避免几小时后开窗口时突然补弹一堆旧通知。

## 安装

### 方式一：plugin_manager（推荐，本地开发）

```text
plugin_manager install_bundle /path/to/dsh-plugin-system-notify
```

### 方式二：profile 依赖

在 `~/.dsh/profiles/<profile>/package.json` 中声明：

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

安装后 Loader 行 id 为 `include:system-notify`。

## 工具

### `system_notify`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 横幅标题，建议 60 字符以内 |
| `body` | string | 是 | 正文，建议一句话、120 字符以内 |
| `silent` | boolean | 否 | 静音投递，默认 `false` |

返回：

```json
{ "ok": true, "id": 1, "delivery": "delivered", "surface": "desktop" }
```

| 字段 | 说明 |
| --- | --- |
| `delivery: "delivered"` | 有窗口正在监听并已接手 |
| `delivery: "queued"` | 暂无窗口连接，连上后立即补发（附 `note`） |
| `surface: "desktop" \| "browser"` | 实际由哪种界面弹出，决定通知归属 |
| `ok: false` + `code` | 参数非法时为 `invalid-notification` |

工具是**单向**的：不会把窗口切到前台，也不会阻塞等待用户回应。

## 平台支持

| 平台 | 状态 | 归属 |
| --- | --- | --- |
| macOS | ✅ 已实测 | `com.deepseek.dsh`（DeepSeek Harness） |
| Windows | ✅ 已实测 | DeepSeek Harness（Toast） |
| Linux | ⚠️ 理论可用，未实测 | 取决于桌面环境与 libnotify |

插件**不含任何平台相关代码**（没有 `osascript` / PowerShell / `notify-send`），走的是浏览器标准的 Web Notification API，由各平台的应用运行时翻译成本地通知。这也是它能跨平台的原因。

排障提示：

- **Windows**：如果 Toast 不弹，先看「设置 → 系统 → 通知」列表里有没有出现 `DeepSeek Harness`（取决于安装器是否注册了 **AppUserModelID**）；专注助手 / 勿扰模式会拦截 Toast。
- **macOS**：首次可能需要在「系统设置 → 通知」里允许 DeepSeek Harness。
- **Linux**：需要桌面环境提供通知守护进程（多数发行版自带）。

## 自测

安装后按顺序验证（本机 macOS 与 Windows 均实测通过）：

```text
# 1) 确认工具已注册
cordis_inspect_query host/Tool/listTools        # 应能看到 system_notify

# 2) 让 AI 调用一次
system_notify {title:"DSH 通知测试", body:"这条通知由 DeepSeek Harness 本体发出。"}
# 期望返回: {"ok":true,"id":1,"delivery":"delivered","surface":"desktop"}

# 3) 确认横幅真的弹出（macOS）
log show --last 2m --predicate 'process == "NotificationCenter"' | grep deepseek
# 期望看到: addOrUpdate(...) listItem: com.deepseek.dsh:... alertStyle: banner
```

第 3 步是关键：`delivery: delivered` 只说明有客户端接手了，**系统日志才能证明它真的弹出来了**。

## 限制

- **需要至少一个 DSH 页面开着**（桌面应用窗口或浏览器标签）。全部关闭时通知会排队（最多 2 分钟），窗口连上后补发。这是「由页面发通知」这一设计的必然代价，也是它能拿到 DSH 身份的原因。
- **在浏览器标签里打开 Web GUI 时，通知归属是该浏览器**，不是 DSH。这是平台决定的，绕不过去——想要 DSH 身份就用桌面应用窗口。
- **单向**：不会把窗口切到前台，也不会等待用户回应。
- 通知的送达还受系统勿扰模式、专注助手、应用通知权限影响，这些都不在插件控制范围内。

## 文件结构

```text
dsh-plugin-system-notify/
├── index.js            Host 半部：注册工具 + 收件箱路由 + 鉴权
├── client.js           Client 半部：长轮询 + Web Notification
├── lib/
│   ├── hub.js          收件箱：队列、等待中的 drain、surface 优先级
│   └── tool.js         system_notify 工具定义与参数校验
├── cordis.patch.yml    bundle patch（插入 include:system-notify）
├── locale/
│   ├── en.json         插件管理器显示名（英文）
│   └── zh.json         插件管理器显示名（中文）
├── icon.svg
├── package.json        含 dsh.bundle / dsh.client 声明
├── CHANGELOG.md
├── LICENSE
└── README.md
```

## 开发

无构建步骤、无第三方依赖。profile 里用 `link:` 安装时改代码即时生效；`dsh.client` 声明的 `client.js` 由 DSH 直接作为浏览器 bundle 提供，无需打包。

```bash
# 语法检查
node --check index.js && node --check client.js && \
node --check lib/hub.js && node --check lib/tool.js
```

改动 `client.js` 后需重载插件行（关掉再打开，或重启 DSH 窗口）才会重新加载浏览器 bundle。

## License

[MIT](LICENSE)
