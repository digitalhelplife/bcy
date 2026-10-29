# 本草小游记 · 运营后台部署

对应设计：`docs/superpowers/specs/2026-10-27-admin-console-design.md`
代码：`backend/admin/`（服务）、`src/admin/` + `admin.html`（SPA）、`src/shared/adminContract.ts`（权限契约）。

## 架构

```
浏览器 /admin/
  ├── 静态 SPA            dist-admin/
  └── /admin/api/  ──►  bencao-admin 127.0.0.1:7361
                           ├── bencao_admin       读写（后台自有）
                           ├── bencao_auth        只读视图 + 内部代理（合规配置 / 手机号查询）
                           └── Nakama Postgres    只读视图（用户、存档、反馈、遥测、对局）
```

- 运行时只连接 **只读角色** 读取游戏与认证库；读角色设置 `default_transaction_read_only=on`。
- 合规配置写入仍由 `bencao-auth` 执行（`/internal/admin/config`），后台只代理，生产护栏不下放。
- 快照 `admin-snapshot.json` 由 `scripts/build-admin-snapshot.mjs` 生成，包含 192 条审核台账、131 条资产、版本与 preflight 阻塞项。

## 本地演示（真实 Postgres + 真实浏览器）

```bash
# 1. 三库 + 120 个用户 + 反馈/遥测/推广数据
node scripts/admin-demo-setup.mjs

# 2. 构建
node backend/auth/build.mjs
pnpm build:admin

# 3. 启动（两个终端，或后台运行）
set -a; source .env.admin-demo; set +a; node backend/auth/build/bencao-auth.mjs
set -a; source .env.admin-demo; set +a; node backend/admin/build/bencao-admin.mjs

# 4. 浏览器端到端
node scripts/admin-smoke.mjs
```

演示账号（密码均为 `BencaoDemo2026!`）：`owner` / `ops` / `support` / `reviewer` / `viewer`。
截图输出到 `shots-admin/`，报告在 `shots-admin/report.json`。

## 点击日志导入

```bash
# 只统计带 ?l=<链接代码> 的请求；未知代码与 4xx/5xx 会被跳过
ADMIN_DATABASE_URL=... node scripts/admin-ingest-clicks.mjs /var/log/nginx/access.log
zcat access.log.1.gz | ADMIN_DATABASE_URL=... node scripts/admin-ingest-clicks.mjs -
# 先看效果，不写库
ADMIN_DATABASE_URL=... node scripts/admin-ingest-clicks.mjs /var/log/nginx/access.log --dry-run
```

同一 (链接, 日期) 取 `max(已有, 本次观测)`，重复导入完整日志不会重复计数；按天轮转日志时请把当天全部文件一次传入。

## 生产部署

1. **数据库**
   ```bash
   # 用迁移角色执行（不是运行时只读角色）
   ADMIN_DATABASE_URL=... NAKAMA_DATABASE_URL=... AUTH_DATABASE_URL=... \
     bash deploy/admin/migrate.sh
   psql ... -f deploy/admin/roles.sql   # 按库分别执行，替换 CHANGE_ME
   ```
2. **服务**
   ```bash
   pnpm build:admin            # 服务 bundle + 快照 + SPA
   install -d /opt/bencao/admin-dist /var/lib/bencao-admin
   cp -r dist-admin/* /opt/bencao/admin-dist/
   cp backend/admin/build/bencao-admin.mjs /opt/bencao/backend/admin/build/  # 或整仓 rsync
   install -m 600 deploy/admin/env.example /etc/bencao-admin/env   # 然后填写
   install -m 644 deploy/admin/bencao-admin.service /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now bencao-admin
   ```
3. **nginx**：把 `nginx-admin.conf` 放进 `bencaoyou.tryliang.me` 的 server 块，替换 IP 白名单后 `sudo nginx -s reload`。
4. **首次登录**：`owner` 用 `ADMIN_BOOTSTRAP_PASSWORD` 登录，立即改密并启用 TOTP；随后从 env 删除该变量。

## 安全清单

- [ ] `ADMIN_ALLOW_IPS` + nginx `allow/deny` 双重限制，生产走 VPN / 固定出口 IP。
- [ ] `ADMIN_COOKIE_SECURE=1`，`ADMIN_TRUST_PROXY=1`，只由本机 nginx 反代。
- [ ] 只读角色 `default_transaction_read_only=on`；后台代码没有游戏/认证库写路径。
- [ ] `AUTH_INTERNAL_SECRET` ≥ 32 字符，仅 bencao-auth 与 bencao-admin 共享。
- [ ] `/console/`（Nakama Console）不公网暴露；建议 SSH 隧道。
- [ ] 审计日志保留 1 年；`admin_audit` 不含 PII。
- [ ] 手机号查询、联系方式揭示、导出、权限拒绝都会写审计。

## 已实现范围

- 总览：阶段、13 项 preflight 阻塞、192/192 AI 审核、资产覆盖、KPI、漏斗、留存、待办、服务健康。
- 用户：ID / bcy- / 手机号精确查询、筛选、详情、进度、对局、会话、反馈、审计、脱敏导出。
- 反馈：收件箱、状态流转、分派、备注、联系方式揭示（审计）、保留期提示。
- 内容与资产：条目、审核台账、资产台账（真实缩略图与缺口报告）、版本与发布。
- 指标：90 天 ETL、7/30/90 天看板、口径抽屉、聚合 CSV（无用户 ID）。
- 合规：实名/未成年人配置代理、变更历史、节假日/节气/版本只读。
- 推广：渠道/活动/链接/二维码、点击统计、CSV 报表导入（幂等）。
- 设置：管理员与角色、密码、TOTP、会话撤销、环境与版本。
- 权限：owner / ops / support / reviewer / viewer，服务端逐路由校验。

## 尚未实现（设计 Phase 3）

- 游戏内渠道归因：链接点击可统计，进游戏后的转化尚不能按渠道拆分。
- 用户写操作：冻结、补偿、强制下线、管理员发起注销。
- 广告平台 API 直连（当前只支持 CSV 导入）。
- 多游戏切换（表已带 `game_id`，UI 只接一个游戏）。
- 内容在后台编辑/审批（内容仍以文件和 release gate 为准）。
