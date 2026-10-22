# Changelog

本文件记录本插件的所有重要变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-10-21

首个可用版本。

### Added

- **`system_notify` 工具**：让 AI 向用户发送系统级通知，支持 `title`、`body`、`silent` 三个参数，返回 `delivery`（`delivered` / `queued`）与 `surface`（`desktop` / `browser`）。
- **双半部架构**：Host 半部注册工具并维护收件箱，Client 半部在页面内用 Web Notification API 弹出通知。
- **长轮询投递**：`GET /api/system-notify/inbox` 保持一个请求在飞，有通知立即应答，空闲时零请求开销。
- **桌面窗口优先**：客户端声明 `desktop` / `browser` surface，只有桌面窗口能给出 DSH 本体身份，因此优先接手。
- **权限门控**：未获得通知权限的客户端不发起 drain，避免通知被「领走但弹不出」而 Host 误报成功。
- **排队与过期**：无窗口连接时最多排队 32 条、保留 2 分钟，窗口连上后补发，过期条目丢弃以免补弹陈旧通知。
- **路由鉴权**：收件箱路由复用 Connection 服务的 Host/Origin 与浏览器凭证校验；无该服务时回退为仅回环地址。
- 中英文插件管理器显示名（`locale/en.json`、`locale/zh.json`）。

### Verified

- **macOS**：通知归属 `com.deepseek.dsh`，系统日志确认 `alertStyle: banner` 真实弹出。
- **Windows**：Toast 正常送达。

### Known limitations

- 需要至少一个 DSH 页面处于打开状态；全部关闭时通知排队等待。
- 在浏览器标签中打开 Web GUI 时，通知归属为该浏览器而非 DSH。
- 通知为单向，不切前台、不等待用户回应。
- Linux 未在真机实测。

[0.1.0]: https://github.com/DRheEheAMGary/dsh-plugin-system-notify/releases/tag/v0.1.0
