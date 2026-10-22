# dsh-plugin-system-notify

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的系统通知插件：让 AI 调用一个工具给你发系统级通知，窗口在后台也能弹出，横幅归属是 **DSH 本体**。

```
AI 调用 system_notify  →  🔔 DeepSeek Harness
                          任务完成了
```

## 架构

双半部，靠一条长轮询路由协作：

- **Host**（`index.js`）注册工具，把请求放进收件箱，开 `GET /api/system-notify/inbox`
- **Client**（`client.js`）常驻一个请求，Host 一有通知立刻返回，页面用 `new Notification()` 弹出

长轮询而非定时轮询：通知几乎即时，空闲时零请求。

桌面窗口（`desktop`）优先于浏览器标签（`browser`）——只有桌面窗口能给出 DSH 身份。拿不到通知权限的客户端不发起 drain，避免通知被领走却弹不出来。

## 安装

```text
plugin_manager install_bundle /path/to/dsh-plugin-system-notify
```

或写进 profile 的 `package.json`：

```json
"dependencies": { "dsh-plugin-system-notify": "github:DRheEheAMGary/dsh-plugin-system-notify" },
"dsh": { "profile": { "bundles": ["dsh-plugin-system-notify"] } }
```

## 工具

`system_notify`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 标题，约 60 字符 |
| `body` | 是 | 正文，一句话，约 120 字符 |
| `silent` | 否 | 静音，默认 `false` |

```json
{ "ok": true, "id": 1, "delivery": "delivered", "surface": "desktop" }
```

`delivery` 为 `delivered`（有窗口接手）或 `queued`（暂无窗口，连上后补发）。单向，不切前台、不等待回应。

## 平台

| 平台 | 状态 |
| --- | --- |
| macOS | ✅ 实测，归属 `com.deepseek.dsh` |
| Windows | ✅ 实测（Toast） |
| Linux | ⚠️ 未实测 |

不含任何平台相关代码，走标准 Web Notification API，由各平台运行时翻译成本地通知。

## 限制

- 需要至少一个 DSH 页面开着；全关时通知排队（最多 2 分钟）等窗口连上
- 在浏览器标签里打开 Web GUI 时，归属是该浏览器而非 DSH
- 勿扰模式 / 专注助手会拦截通知

## License

[MIT](LICENSE)
