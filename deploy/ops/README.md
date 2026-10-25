# 运维脚本与上线收尾记录（2026-10-22）

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 数据库每日备份 | 已上线 | `backup-nakama.sh` 安装在服务器 `~/backup-nakama.sh`；cron 每天北京时间 03:30 备份到 `~/backups/nakama/`（pg_dump 自定义格式、600 权限、保留 14 天）；每周日 04:15 自动恢复演练。首次演练：恢复 282 条游戏记录，与线上一致，56 个用户，耗时约 1 秒。 |
| 安全响应头 | 已上线 | `nginx/bencaoyou-security-headers.conf`：HSTS、nosniff、Referrer-Policy、Permissions-Policy、CSP（无内联脚本，只允许本站与 wss 本站）。 |
| 接口限流 | 已上线 | `nginx/bencaoyou-ratelimit.conf`：`/v2/` 每 IP 20 次/秒（突发 60），登录接口每 IP 30 次/分钟（突发 10），超限返回 429。 |
| 压测 | 通过延迟目标 | `loadtest.mjs` 在服务器本机直连 Nakama：50 并发、304 秒、11,852 次调用、38.9 次/秒，p50 12 ms、p95 94 ms、p99 296 ms（目标 p95 ≤ 500 ms）。2,395 次拒绝全部是单人开局频率限制（业务规则，正确行为），基础设施错误 0。压测账号已全部自注销。原始输出见 `loadtest-2026-10-22.txt`。 |

**仍需决定或采购**：Nakama 管理控制台经 `/console` 公网可访问（原有配置，文档 08 要求仅内网/跳板访问，建议改为 SSH 隧道 `ssh -L 7351:127.0.0.1:7351` 后删除这几个 location）；备份与数据库在同一块盘，需同步到对象存储做异地副本；服务器仅 1 核 / 1 GB 内存，压测期间 CPU 平均 45%、已用 365 MB 交换分区，正式上线建议至少 2 核 4 GB 并改用托管 PostgreSQL；UFW 未启用（公网还有 51823 端口的另一个服务，未改动）。

用法：`./backup-nakama.sh`（备份）、`./backup-nakama.sh --drill`（恢复演练）、`NAKAMA_SERVER_KEY=... node loadtest.mjs 50 300`（压测，在服务器上运行）。

## A7 运营导出与 provider 网关

- 反馈与遥测目前没有后台页面；用只读脚本导出（不导出联系方式、不导出用户 id）：
  ```bash
  NAKAMA_DB_URL=postgresql://... node deploy/ops/export-ops.mjs --out /tmp/bencaoyou-ops.json
  ```
  输出文件权限 0600；反馈正文可能含用户输入，按受控运营数据管理。
- `bencao-auth` 的通用 HTTP provider 契约（`AUTH_SMS_PROVIDER=http` / `AUTH_REALNAME_PROVIDER=http` / `AUTH_BEHAVIOR_PROVIDER=http`）：
  - 短信：`POST $AUTH_SMS_HTTP_URL`，Bearer `$AUTH_SMS_HTTP_TOKEN`，body `{phone, code}`，2xx 为成功；服务端不打印手机号/验证码。
  - 实名：`POST $AUTH_REALNAME_HTTP_URL`，Bearer `$AUTH_REALNAME_HTTP_TOKEN`；提交 `{action:"submit", ai, name, idNumber, birthYm}`，查询 `{action:"query", ai}`；返回 `{status:"VERIFIED", pi, birthYm}` / `{status:"PENDING", ai}` / `{status:"FAILED"}`。姓名/身份证只在内存中转，不落库。
  - 行为上报：`POST $AUTH_BEHAVIOR_HTTP_URL`，Bearer `$AUTH_BEHAVIOR_HTTP_TOKEN`，body `{events:[{eventId,pi,kind,occurredAtMs}]}`，2xx 为 SENT。
  - **这不是 NPPA 官方协议**。NPPA 正式接入仍需要游戏版号、系统接入备案和官方接口文档；`NoopBehavior` 继续作为未配置时的安全默认。
