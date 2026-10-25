# 本草小游记·成都篇 — 前端（Phaser 4.2.1 + React 19 + TypeScript + Vite）

手机浏览器竖屏 2D 轻游戏。闭环：成都周边三景点寻踪/拼图 → 虚拟苗圃奖励 → 种植收藏 → 布置川西小院 → 本地导出游记 PNG。需求基线见上线文档包 `/home/ubuntu/本草小游记_上线文档包/`（PRD v2.0 为准；前端规格 05、后端契约 06、测试 07）。v1.1 规格已归档在其 `99_旧版归档/` 目录。

```bash
pnpm install
pnpm dev                    # 开发预览
PUBLIC_ORIGIN=https://bencaoyou.tryliang.me pnpm build   # 类型检查 + 生产构建 + JS/字体预算 + 分享元数据注入 → dist/
pnpm test                   # 规则/契约单元测试（vitest）
CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke.mjs http://127.0.0.1:3000/   # 390×844 真实画布操作的端到端冒烟，截图在 shots/
pnpm review:packet          # 192 条人工审核工作包（content-src/review_packet.md/.csv）
pnpm preflight              # 生产上线 blocker 检查（内容签字/ICP/provider/NPPA）
pnpm test:inapp             # XHS UA 的 in-app 保存覆盖层端到端检查
```

## 引擎与职责划分

| 层 | 负责 | 位置 |
| --- | --- | --- |
| React | 启动加载、地图、路线选择、结算、小院 HUD、图鉴、背包、游记导出、设置、弹窗、新手引导条、待确认请求横幅 | `src/ui/` |
| Phaser 4.2.1 | 找物（含都江堰可拖动雾层）、拼图（2×2 / 2×3，吸附锁定、错片回托盘）、小院画布（8×10 网格、拖动吸附、合法性提示、种植槽） | `src/phaser/scenes/` |
| 事件桥 | React ↔ Phaser 类型化事件（按场景实例与 runId 过滤旧事件），卸载时 `game.destroy(true)` 并解除订阅 | `src/phaser/bridge.ts`、`src/phaser/PhaserHost.tsx` |
| 客户端状态 | 唯一确认快照、`stateRevision` 防回退、写请求 `requestId` 持久化、网络中断后“重试确认 / 查询结果” | `src/net/gameClient.ts` |
| 传输 | Nakama 设备鉴权、会话恢复与刷新、RPC 统一封包；或本地演示传输 | `src/net/transport.ts` |
| 规则 | 解锁、奖励（首奖/重复/每日 UTC+8 上限 3 次/装饰轮换）、种植、布局校验、引导阶段，纯函数 | `src/shared/rules.ts` |
| 内容 | 景点、关卡、热点坐标、植物、12 摆件、配色、故事、资源路径 | `src/shared/content.ts` |

Phaser 世界坐标固定 1080×1920（`Scale.FIT`），命中、吸附和网格判定都在世界坐标中完成。拖动对象在按下时记录抓取偏移，精确跟随手指（不受拖动阈值滞后影响）。`PhaserHost` 在每次按下前刷新画布边界，并在容器尺寸变化时重读父容器尺寸再适配，横幅或编辑栏改变布局时点击不会错位。

## 运行模式：本地演示 vs Nakama

未设置 `VITE_NAKAMA_HOST` 时为**本地演示模式**：`src/net/localDemoServer.ts` 在浏览器内按同一 RPC 契约模拟服务端（幂等重放、请求指纹、版本冲突、run 生命周期），数据只存在 localStorage，界面明确标注“本地演示·非云存档”。它只用于演示和联调前的前端验收，**不构成服务端权威、幂等或防作弊保证**。

真实联调需要提供（写入 `.env.local` 或部署环境变量）：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `VITE_NAKAMA_HOST` | Nakama 服务器地址（设置后即切换为 Nakama 模式） | 无 |
| `VITE_NAKAMA_PORT` | 端口 | `7350` |
| `VITE_NAKAMA_SSL` | `true` 使用 HTTPS/WSS | `false` |
| `VITE_NAKAMA_SERVER_KEY` | 公开客户端 server key（非服务端密钥） | `defaultkey` |

Nakama 模式使用 `authenticateDevice`（设备 ID 存于 localStorage），会话临近过期用 refresh token 刷新，失败则重新设备鉴权。服务端需实现以下 RPC，请求体 `{ apiVersion: 1, requestId?, expectedStateRevision?, payload }`，响应 `{ ok: true, data, replayed? } | { ok: false, error: { code, message, retryable } }`：

`game.bootstrap`、`game.state.get`、`game.run.start`、`game.run.get`、`game.run.finish`、`game.run.cancel`、`game.plant.start`、`game.plant.claim`、`game.garden.save`、`game.tutorial.skip`、`game.request.status`。

`localDemoServer.ts` 与 `tests/rules.test.ts` 可作为后端实现的行为参考与验收用例（同一 `requestId` 重放返回首次结果且不重复发奖；同 key 不同请求体返回 `IDEMPOTENCY_KEY_REUSED`；已结算 run 再次 finish 返回原结算；版本冲突、run 过期/取消等错误码）。

## Nakama 服务端模块（`backend/nakama/`，已上线）

`backend/nakama/src/main.ts` 是服务端权威实现，**直接复用** `src/shared/rules.ts` 与 `content.ts`（同一套奖励、解锁、种植、布局与 proof 校验），不另写一份规则。`pnpm build:nakama` 用 esbuild 打成单文件 `backend/nakama/build/bencaoyou.js`（IIFE + 全局 `InitModule` 与 30 个全局 RPC 函数，符合 goja 运行时要求）。

存储（owner 为 `ctx.userId`，`permissionRead/Write = 0/0`，客户端无法读写）：`game_player/state`、`game_player/meta`（新建 run 的每分钟限流计数）、`game_runs/<runId>`、`game_receipts/<requestId>`。每个写 RPC 的执行顺序：先查回执（相同指纹则重放，不同则 `IDEMPOTENCY_KEY_REUSED`）→ 已完成/已取消/已跳过的 no-op 重放 → `expectedStateRevision` 校验 → 共享纯规则计算 → **一次 `nk.storageWrite` 批量写** state/run/meta/receipt（state、run 带 storage version CAS，新 run 与回执 create-only `"*"`）。CAS 失败时重读回执或已结算 run 进行重放，否则返回 `STATE_CONFLICT`，不做无界重试。另注册了 `beforeWriteStorageObjects`/`beforeDeleteStorageObjects` 钩子，拒绝客户端直写或删除这三个集合。

远程契约测试：`NAKAMA_SERVER_KEY=... pnpm test:nakama`（每个用例新建随机设备账号，覆盖初始化并发、新手闭环、幂等/复用/冲突、三路并发结算只发奖一次、锁定/单 run/取消/非法 proof、解锁与暖木配色、客户端直改存储拦截、非法外壳）。

### 服务端信任边界（找物/拼图）

服务端权威的是**状态与奖励**，不是“玩家真的点到了哪里”。找物/拼图完成后，客户端提交一份 `Proof`：

- 找物：已找到的目标 ID 集合 + 雾层 gate；
- 拼图：每块拼图 → 槽位的映射。

Nakama 的 `validateProof` 只校验这份提交与关卡配置一致、run 仍为 ACTIVE 且未过期、`configVersion` 未变；**不校验点击坐标、时间、拖动轨迹或操作录像**。因此，修改过的客户端可以伪造一份合法 proof，并在每日重复奖励上限内领取奖励。S0 内测接受这个威胁模型：游戏没有排行榜、交易、付费或多人竞争，单次收益受每日 3 次重复奖励和单 active run 限制。

如果后续要做竞技、交易或更强反作弊，需要另行设计服务端 nonce/事件轨迹或回放校验，并承担相应协议与性能成本；当前版本不承诺这一点。

## 线上部署（ex-game.tryliang.me）

`deploy/deploy.sh [web|nakama|all]`：`nakama` 构建并上传模块到 `/home/youdt/nakama/data/modules/bencaoyou.js`（保留上一版为 `.prev`），确保 `nakama.yml` 有 `runtime.js_entrypoint: "bencaoyou.js"` 后重启服务；`web` 用 `.env.production.local`（含 `VITE_NAKAMA_HOST=ex-game.tryliang.me`、端口 443、SSL、客户端 server key，已被 git 忽略）构建，上传到 `/home/youdt/bencaoyou-web`（保留 `.prev`），安装 `deploy/nginx-ex-game.conf`，`nginx -t` 通过才重载，否则自动回滚。

Nginx 路由：`/` 与静态资源 → 游戏；`/v2/`、`/healthcheck`、`/ws` → Nakama 7350；`/console/`、`/v2/console/` → Nakama 控制台 7351；`/demo/` 保留。原配置备份在服务器 `/home/youdt/nakama-deploy/nginx-ex-game.before-bencaoyou.conf`，`nakama.yml` 备份为 `nakama.yml.bak-before-bencaoyou`。线上冒烟：`CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke.mjs https://ex-game.tryliang.me/`。

**当前仍是测试阶段（S0/S1）的设备登录。** `bencao-auth` 的手机号+短信+实名+防沉迷链路已经实现，但线上运行在 `AUTH_ENV=staging`，短信与实名使用模拟 provider；正式上线前必须接入真实短信服务商与国家网络游戏防沉迷实名认证系统，并在生产中禁用 `authenticateDevice`。这部分需要外部资质，尚未完成。

## 资源

运行时资源在 `public/assets/**/*.webp`，由 `scripts/prepare-assets.py` 从 `/home/ubuntu/chengdu_game_assets/assets` 与都江堰立体文旅地图风格图生成。都江堰找物热点在新图上重新校准（鱼嘴分水尖、飞沙堰低堰、宝瓶口；宝瓶口被雾层遮挡，需先拖开），不再叠加旧版虚构鱼嘴/石拱门精灵；都江堰拼图原画从新图裁切。中文字体随构建打包，游记 Canvas 导出前等待字体就绪。

分享元数据在 `game-sharing.json`（封面 `assets/share/og.png`，图标 `assets/share/favicon.png`），由 `pnpm build` 注入 `dist/index.html`。

## 调参（仅开发预览）

`src/tuning.ts` 只暴露两个客户端手感参数：拼图吸附距离、拖动阈值（下次打开场景生效）。奖励与结算规则属服务端，不可调。

## 已知边界

植物科普文案为“审核中”占位，不填写药效；图鉴/游记附“不构成用药建议”。无支付、广告、战斗、角色、真实药材交易、实时多人、定位、药方或健康数据；无自动发布小红书，分享不领奖。

## Credits

字体：ManusCC0 Sans CJK SC — CC0 1.0，见 `public/fonts/ManusCC0-LICENSE.txt`。库：Phaser（MIT）、React（MIT）、@heroiclabs/nakama-js（Apache-2.0）。

## v2.1 更新（2026-10-22，按上线文档包 01/06/12 号文档）

**内容扩充**：植物由 6 种扩到 24 种（每个节气一种），新增 18 种植物的成熟/幼苗/种子/图标精灵、10 位访客和 6 种手作摆件。内容统一由 `scripts/build-content.py` 从文档包附录 A3 草稿生成到 `content/*.json`，每条都带审计字段（来源、核实等级、审核状态）；知识卡字段只从核实报告摘录（`scripts/extract-plant-cards.py`），未核实条目在界面上明确标注。

**新系统**：
- 二十四节气日历（P63）：只开放已核实年表中“已到”的节气，2026-11-01 上线当天预开 2 个；每个节气可领一次信笺（2 颗当季种子）和标记一次“只看不摘”自然挑战。测试服可设 Nakama 运行时环境变量 `BCY_SEASON_OVERRIDE=all` 全开；本地开发预览可用 `?season=all`（生产构建忽略）。
- 植物知识卡、成长观察（种子/发芽/长叶/成熟四阶段，按服务器时间判定）、每种植物 3 题问答印章与 4 档称号。
- 手作台（6 个配方，只消耗未摆放的成熟植物）、小景套组与故事、访客（保存小院时按条件到访，各一次并留下 1 颗种子）。
- 种植槽 8 个：图鉴发现 12 种开放第 7 槽，18 种开放第 8 槽。
- 重复植物奖励改为确定性挑选：优先未发现的已开放植物。新手第一次探索强制植物路线。
- 合规：联网前隐私同意页（未同意不发起任何请求）、启动页健康游戏忠告与适龄提示、设置页亲子模式、改进体验开关（默认关，服务端白名单校验事件与字段）、意见反馈与投诉、账号注销、在线时长心跳。存档 schema 2→3 自动迁移。

**v2.1 新增 RPC（当时总计 22 个；截至 A7 共 30 个）**：`game.account.status/delete`、`game.consent.update`、`game.feedback.submit`、`game.telemetry.track`、`game.playtime.heartbeat`、`game.season.claim`、`game.observe.record`、`game.quiz.complete`、`game.craft.make`、`game.challenge.mark`。写操作在本地演示与 Nakama 上走同一份 `src/shared/actions.ts`。

**测试（v2.1 时）**：`pnpm test`（35 条规则/契约单元测试）；`NAKAMA_SERVER_KEY=... pnpm test:nakama`（9 条线上契约测试，含 v2.1 接口）；`CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke.mjs [url]`（手机视口端到端：同意→找物→种植→布置→拼图→游记→知识卡问答→节气→手作→设置）。当前为本地 13 个文件、141 个用例，线上契约 12 个。

**仍需在正式上线前完成**（见文档包 08/09/11）：实名认证与防沉迷服务接入（当前 `account.status` 返回未实名占位）、ICP 备案与隐私政策正式文本、植物/访客内容的专家审核签字、节气年表换为紫金山天文台或国家授时中心数据。

## 认证服务 bencao-auth（手机号登录 · 实名 · 防沉迷，2026-10-22）

按文档 06 §6–§8 实现，代码在 `backend/auth/`，单独的 Node 服务（127.0.0.1:7360，systemd `bencao-auth`，库 `bencao_auth`）。

**流程**：手机号 + 短信验证码 → 一次性登录票据（`LT-`，5 分钟，不含手机号）→ Nakama `authenticateCustom`（before 钩子向认证服务换取稳定账号 ID，票据只能用一次）→ 实名认证（姓名、身份证号只转发给实名提供方，不落库；只保存核验结果与出生年月）→ 游戏。Nakama 每个 RPC 前检查实名状态与未成年人时段（周五六日及法定节假日 20:00–21:00，节假日见 `content/holidays.json`，来源国办发明电〔2025〕7号），心跳每 60 秒，21:00 到点自动切到限制页并吊销会话。手机号用 AES-256-GCM 加密存储，查找用 HMAC。注销会同时删除 Nakama 账号与认证库身份数据（保留不含个人信息的墓碑记录）。

**对外只开放 5 个路径**：`/auth/config`、`/auth/sms/send`、`/auth/sms/verify`、`/auth/realname/submit`、`/auth/realname/status`；其余 `/auth/*` 与 `/internal/*` 由 Nginx 返回 404。短信接口另有每 IP 每分钟 6 次限流，服务内还有每号 60 秒、每号每日 10 次、每 IP 每日 30 次的限制。

**当前线上状态**：`AUTH_ENV=staging`，短信与实名均为**模拟提供方**（验证码直接显示在页面上，姓名含“认证中”模拟审核中 30 秒）。**正式上线前**必须：接入真实短信服务商；接入国家网络游戏防沉迷实名认证系统（需游戏版号与系统接入备案，`providers.ts` 中 `NppaRealnameProvider` 为占位）；把 `/etc/bencao-auth/env` 的 `AUTH_ENV` 改为 `production`（生产环境禁止使用模拟提供方，服务会拒绝启动）。

**部署与切换**：
```
./deploy/deploy.sh auth            # 构建并安装/更新认证服务（首次自动建库、生成密钥文件，幂等）
AUTH_MODE=device ./deploy/deploy.sh auth && ./deploy/deploy.sh nakama   # 切回设备试玩模式（前端读 /auth/config 自动切换，无需重建）
```
密钥只在服务器 `/etc/bencao-auth/env`（640 root:youdt），不进仓库；Nakama 通过 `nakama.yml` 的 `runtime.env`（BCY_AUTH_MODE/URL/SECRET）连接认证服务。

**测试**：`pnpm test`（含 16 个认证单元测试，共 51 个）；`NAKAMA_SERVER_KEY=... node backend/auth/flow.remote.mjs https://ex-game.tryliang.me` 对线上跑 37 项端到端检查（登录、票据重放、设备会话拦截、实名三态、未成年人时段、注销与清理）；`scripts/smoke.mjs` 在实名模式下会自动用模拟验证码登录、提交合成的成年身份证号，跑完整新手流程后注销测试账号。

## v2.2 更新：最小客户端版本与内容发布门禁（2026-10-22，BE-06 / 文档 03·05·06）

**当前阶段：S0 内测。** 页面固定显示“内测 · 内容审核中 · 不可公开发布”角标。测试站可以访问，不等于正式上线。

### 最小客户端版本（v2.2 时 `CLIENT_BUILD = 2.2.0`；A7 起为 `2.3.0`）

- 每个 RPC 信封都带 `clientBuild`（`src/shared/content.ts`）。Nakama 从环境变量 `BCY_MIN_CLIENT_BUILD` 读取最低版本，未设置时默认等于服务器构建号。启动日志会打印 `bencao minClientBuild=… serverBuild=… config=…`。
- 写请求在版本过低或缺少 `clientBuild` 时返回 `CLIENT_OUTDATED`；读请求不受影响；`game.account.delete` 永远放行（用户随时可以注销）。
- `game.bootstrap` 返回 `minClientBuild` 和 `configVersion`。前端发现自己版本过低或内容版本不一致时，会显示“游戏有新版本”卡片，引导刷新页面（`AuthGate.tsx` 中的 OutdatedCard）。
- 线上 `~/nakama/nakama.yml` 的 `runtime.env` 已**显式固定** `BCY_MIN_CLIENT_BUILD=2.2.0`。`deploy.sh nakama` 只会在这一项缺失时补上，**永远不自动修改已有的值**，所以部署后端不会再连带抬高最低版本。
- **升级顺序**：① 先部署能接受旧版本的服务器；② 再部署新前端，并用线上冒烟测试确认生效；③ 新前端覆盖后，才在服务器上手动提高 `BCY_MIN_CLIENT_BUILD`，再重启 Nakama。2.2.0 及以后的前端在任何写请求收到 `CLIENT_OUTDATED` 时都会显示“游戏有新版本”卡片（`tests/minBuild.test.ts` 有覆盖）。
- **2026-10-22 事故记录**：首次部署 v2.2 时，最低版本还是“默认等于服务器构建号”。Nakama 先部署后，最低版本立刻变成 2.2.0；而前端构建因为一处 TypeScript 错误失败，`deploy.sh` 按 `set -e` 中止，线上仍是 2.1.0。2.1.0 不认识 `CLIENT_OUTDATED`，于是约 15 分钟内，点“出发”等写操作都没有任何反应。冒烟测试发现后已修复（修正类型错误、重新部署前端、固定最低版本）。教训：部署输出必须确认出现 `NGINX_RELOADED`，并核对线上 `index-*.js` 与本地 `dist` 一致，不能只看首页返回 200。

### 内容发布门禁（`pnpm gate`，`scripts/release-gate.mjs`）

- 每次构建都会先运行门禁（`manus:build-source` 第一步），`deploy.sh web` 也会运行。报告写入 `.release-gate/report.json`（已加入 gitignore）。
- 用 `RELEASE_STAGE=S0|S1|S2|S3` 指定阶段（默认 S0），用 `AUTH_MODE` 声明前端的认证模式（部署脚本固定传 `realname`）。
  - **S0**：未审核内容只产生警告。
  - **S1+**：任何未审核（pending）条目都是错误，阻断构建。
  - **S2+**：还要求 `AUTH_MODE=realname`。
  - **S3**：还要求出版/版号字段、适龄评估和 ICP 备案号。
- 门禁扫描的内容：植物功效、疾病、剂量、人群等表述；亲子文字是否超长；原创目标披露；出行卡的来源、核实日期和固定声明；编辑笔记、残句、占位文字等。
- 截至 2026-10-25：192 个审计条目已由 **AI 内容审核（Claude Code）** 逐条签署为 `approved`，S1 门禁通过（1 条青城山出行卡隐藏警告）。未来新增或改回 pending 的内容仍会被 S1+ 拦截。**禁止**为了通过门禁而批量把 pending 改成 approved，或直接设置 `RELEASE_STAGE=S3`；AI 审核不替代持证专家/法务复核。
- 人工修订知识卡时写入 `content-src/plant_card_fixes.json`，并注明来源依据；`scripts/build-content.py` 会套用这些修订。Learn 页面中带“待核实”的观察文字只显示已核实的分句。

### 测试

- 本地测试：`pnpm test`（当前 13 个文件、141 个用例，含 `tests/releaseGate.test.ts`、`tests/minBuild.test.ts`；v2.2 当时为 9 个文件、78 个用例）。`RELEASE_GATE_CONTENT` 可以把门禁指向临时内容目录。
- 线上契约测试：`NAKAMA_SERVER_KEY=… pnpm test:nakama`（当前 12 个用例，约 2 分钟）。在实名模式下，每个用例都通过短信验证码（staging debugCode）加模拟成年实名创建临时账号，结束时注销。每次运行大约消耗 10 次当日短信额度（Nginx 限每 IP 每分钟 6 次，认证服务限每 IP 每天 30 次）；测试已按 11 秒间隔节流，**不要并行运行**。
- 认证流程测试：`node backend/auth/flow.remote.mjs https://ex-game.tryliang.me`（37 项）。线上冒烟：`CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke.mjs https://ex-game.tryliang.me/`。

## 合规后台：实名认证与未成年人保护（运行时配置）

地址 `https://ex-game.tryliang.me/admin/`。管理员密码只在服务器上：`/home/youdt/bencao-admin-password.txt`（权限 600）。环境文件里只存 scrypt 哈希 `AUTH_ADMIN_PASSWORD_HASH`。

- **可配置项**：实名认证开/关；未成年人策略三选一（按时段限制 / 完全禁止 / 不限制，最后一项仅测试环境）；可游戏的星期、整点时段、是否包含法定节假日。配置带版本号，保存时检查并发冲突，每次修改都写入 `runtime_config_history` 和 `audit_log`。
- **默认值**：测试环境（`AUTH_ENV=staging`）首次启动时**实名关闭**，未成年人规则用国家规定。正式环境（`AUTH_ENV=production`）首次启动时实名开启。
- **正式环境护栏**（服务端校验，后台页面无法绕过）：不能关闭实名，不能选“不限制”，时段只能在周五/六/日与 20:00–21:00 以内收紧。如果正式环境的数据库里是测试配置，认证服务会拒绝启动。
- **生效方式**：认证服务的 `/auth/config` 与内部接口 `/internal/config` 提供配置；Nakama 缓存 10 秒，所以保存后约 10 秒生效，无需重启。认证服务不可用时，Nakama 使用最近一次成功读取的配置（保留 7 天）；如果从未读取成功，就退回 `BCY_AUTH_MODE`，部署默认为 realname，即故障时拒绝服务。`AUTH_PUBLIC_MODE` 已不再读取。
- **实名关闭时**：`/auth/sms/*` 与 `/auth/realname/submit` 返回 `REALNAME_DISABLED`，不收集手机号和身份信息；前端在玩家刷新后进入试玩账号。手机号账号和试玩账号是两个独立账号，进度不互通。
- **安全**：Cookie 为 HttpOnly、Secure、SameSite=Strict、Path=/admin，有效期 8 小时；改密码会让所有会话失效。所有 POST 必须带 `x-bcy-admin: 1` 头（防 CSRF）。同一 IP 连续输错 5 次锁定 15 分钟。页面使用独立的严格 CSP 和 `X-Frame-Options: DENY`，并设置 noindex。可选 `AUTH_ADMIN_ALLOW_IPS` 限制访问 IP。统计只显示汇总数字。
- **重置密码**：删除 env 中 `AUTH_ADMIN_PASSWORD_HASH` 一行和密码文件，再运行 `./deploy/deploy.sh auth`。
- **测试**：`tests/compliance.test.ts`（25 项）。线上流程测试：`BCY_ADMIN_PASSWORD=… node backend/auth/flow.remote.mjs`，实名关闭时会经后台临时开启实名，跑完全流程后自动恢复原配置；不提供密码时只验证试玩模式。

## A5 目标用户差距补齐（2026-10-23）

逐项清单与实施记录见 `TODO.md`（G1–G13 全部实现，真机测试按指示跳过）。要点：

- **A5 新增 RPC（当时总计 27 个；截至 A7 共 30 个）**：`game.transfer.create/claim`（进度转移码：8 位、10 分钟、一次性、目标须为新账号、每小时 10 次试错）；`game.garden.share.create/revoke/get`（小院口令：只含布局与配色，只读，可撤销）。
- **写请求排队**：上一个写请求仍在发送中时，新写请求最多等待 10 秒再以最新版本号发送；只有结果未知（`unknown`）的写请求才会阻塞并提示“上一个操作还未确认”。回归测试 `tests/writeQueue.test.ts`。
- **亲子语音**：33 段预录普通话（`public/assets/voice/*.mp3`，约 1.5 MB，按需加载），按文本 FNV-1a 哈希匹配（`src/ui/voiceTexts.ts` 是所有朗读文本的唯一来源）。文案改动后哈希变化 → 自动回退系统语音；重录后运行 `pnpm voice`（WAV 目录默认 `/tmp/voice/wav/<key>.wav`）。`tests/a5.test.ts` 保证无过期录音且全覆盖。
- **首屏**：中文字体子集化（构建前自动执行，942 KiB → 194 KiB）；Phaser 拆为独立分块按需加载。
- **节气**：2026 年 1–10 月节气按香港天文台核实；开服回溯 90 天（`SEASON_CONFIG.backfillDays`）。
- **出行卡**：都江堰补齐第 3 个有官方来源的字段，入口现在显示（冒烟脚本已改为断言可见）。
- **博主共创包**：`python3 scripts/build-creator-pack.py` → `本草小游记_上线文档包/博主共创包/` 与 zip；样张用游戏自身渲染函数生成。
- **边界**：A5 当时所有新增文案为 `reviewStatus: pending`；2026-10-25 已统一审核为 approved（见 A7 内容审核签字一节），S0 角标仍保持。

验证：A5 当时本地 12 个测试文件、117 个用例通过；截至 A6 为 13 个文件、141 个用例。线上 Nakama 契约测试 12/12；线上手机视口冒烟通过。

## A6 小红书用户动机差距补齐（2026-10-23）

逐项清单与实施说明见 `TODO.md` 的 “A6” 一节（19 项全部实现；真机测试按要求跳过）。新增接口：`game.plant.care`（每日照料，服务端权威、幂等）和 `game.garden.share.react`（小院口令预设表情回应）。新增内容：`content/events.json`（秋假活动）、`content/think_questions.json`（7–12 岁思考题，待审核）。新增工具：`pnpm review:priority`（审核优先级清单）和 `node scripts/build-trial.mjs`（都江堰离线试玩包，平台规则核实前不得投放，见附录 A7）。

验证：tsc 通过；Vitest 141/141 通过；release-gate S0 通过（193 条警告，S1+ 仍会阻断）；线上 Nakama 契约测试 12/12 通过。线上冒烟测试先跑通了前 6 步，后续几次被 sandbox 到服务器的慢链路打断（大图约 16 KB/s，同一张图 4.6 秒到 46 秒不等），每次失败的步骤都不一样，所以改用本地生产构建 + 线上后端完整跑通：

```bash
SMOKE_LIVE_API=1 npx vite preview --port 4173 --host 127.0.0.1 --strictPort   # 静态资源本地，/auth 代理到线上；Nakama 直连线上
SHOTS_DIR=shots-preview CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke.mjs http://127.0.0.1:4173/
```

这一轮冒烟测试发现并修复的问题：① 照料提示显示 “undefined/3”（客户端没读 `result` 子对象；现在类型 `PlantCareData` 强制按正确结构读取）；② 游记图片加载没有超时，弱网下会一直停在 “生成中…”（现在 25 秒后提示重试，并清除缓存条目）。冒烟脚本在遇到网络丢失响应时会像用户一样点 “重试确认”，以此验证服务端会重放回执、不会重复执行。

## A7 代码缺口补齐（2026-10-25）

按 2026-10-25 代码审计逐项补齐，详见 `TODO.md` 的 A7 一节：

- **F25 自然笔记**：新增第 4 套游记模板 `share_nature`（1080×1440 手账页），展示植物插画、4 个观察阶段、节气/日期、可选照片或孩子的画；固定页脚、植物免责声明和 S0/S1 内测标记保持不变。模板图由 `scripts/build-share-nature.py` 生成，不依赖第三方素材。
- **P64/P65/P67**：新增“自然笔记本”页面（`src/ui/screens/Notebook.tsx`）；图鉴增加“访客”tab、小景完成度和问答称号进度；观察完成即派生“观察贴纸”，不新增服务端物品。
- **植物卡**：展示 `homeGrowing` 的光照/浇水/难度字段，仍过滤占位和待核实文本。
- **亲子模式**：新增 `game.settings.update` RPC（`parentMode`），本地即时生效，登录账号后跨设备同步。
- **本地演示对齐**：`LocalDemoServer` 补齐进度转移码和小院口令（创建/查看/撤销/表情回应），UI 不再只在 Nakama 模式显示这两个入口。
- **转移动线**：`isFreshState` 增加“小院已有摆放”判断，避免只改过小院的新账号被转移码覆盖。
- **遥测**：补齐 login/realname、run_finish/run_cancel、plant_start/plant_claim、tutorial、trip_card、系统分享、错误码等打点。
- **真实 provider 接口**：`backend/auth/src/providers.ts` 新增通用 HTTP SMS / 实名 / 行为上报适配器，配置 `AUTH_*_PROVIDER=http` 与 `AUTH_*_HTTP_URL/TOKEN`；NPPA 正式协议仍需官方接入文档，未猜测实现。
- **测试**：新增 `tests/a7.test.ts`，本地 14 个测试文件、151 个用例。

**内容审核签字（2026-10-25）：** 192/192 条内容已由 **AI 内容审核（Claude Code）** 逐条按六维（事实与来源、植物/中医药安全、儿童适宜、合规与隐私、编辑一致性、游戏内容一致性）签署为 `approved`；台账 `content-src/review_signoff.json|md`，审核工作包 `content-src/review_packet.md|csv`。S1 门禁通过（1 条警告：青城山出行卡因只有 2 个已核实事实而隐藏）。AI 审核不替代持证植物学/儿童教育/法务专家的正式复核。

**仍 blocked（外部）：** 真实短信/实名供应商凭据、NPPA 正式协议、版号/ICP/适龄评估/出版信息；这些不能用代码或 mock 伪造。当前站点继续以 S0 内测模式运行。

**A7 部署结果（2026-10-25）：** `https://bencaoyou.tryliang.me` 已上线。my189 使用 Nginx（BT panel vhost）+ Let's Encrypt（证书到期 2027-01-23），Nakama 3.41.0 运行在 Docker（PostgreSQL 16，数据卷 `bencaoyou_pgdata`），注册 30 个 RPC；`CLIENT_BUILD=2.3.0`，`BCY_MIN_CLIENT_BUILD=2.3.0`。S0 device 模式下 `/auth/*` 返回 404，前端按设备试玩处理。

**验证：**
- 本地 `pnpm test` 14 个文件 / 151 用例、`pnpm typecheck`、`pnpm gate`（S0）、`VITE_RELEASE_STAGE=S1 AUTH_MODE=device pnpm gate`（1 条青城山出行卡隐藏警告）通过。
- `node scripts/a7-remote-smoke.mjs` 对真实 Nakama 跑通 bootstrap / run / settings / garden / share / transfer / account delete。
- `SHOTS_DIR=shots-live node scripts/smoke.mjs https://bencaoyou.tryliang.me/` 通过，包含 A7 自然笔记本、访客 tab、小景/称号和 1080×1440 自然笔记导出。
- **物理真机（HarmonyOS）**：mymac 的 DevEco `hdc` 识别 **SGT-AL50 / HarmonyOS 7.0.0.109**；Huawei Browser 打开线上站，`uitest uiInput` 注入真实触摸完成同意页 → 地图 → 都江堰寻踪（拖雾 + 点击鱼嘴/飞沙堰/宝瓶口）→ 结算 → 小院种植槽 1（种下薄荷、即时成熟、收入背包）→ 游记 → 自然笔记 1080×1440 导出；长按图片 → 保存至图库 → “已保存至图库”。截图在 `shots-harmony/01–15`。
- 另用 iOS 26.1 iPhone 17 Pro Simulator Safari 验证同意页/启动页，用 mymac Chrome + iPhone 15 Pro 描述符验证触摸找物、拖雾、自然笔记和自然笔记本（截图在 `shots-mac/`）；用 Playwright XHS UA 验证 in-app 全屏保存覆盖层（`shots-live/18-inapp-xhs-save.png`）。iOS 物理机未在本次环境提供。

**备份：** `deploy/my189/backup-nakama.sh` 已安装到服务器，cron 每日 19:30 UTC（北京时间 03:30）备份 PostgreSQL 到 `~/bencaoyou/backups/`，保留 14 天；`--drill` 校验归档完整性。首次备份（48K）与 drill 通过。

**审核与上线工具：** `pnpm review:packet` 生成 192 条审核台账（`content-src/review_packet.md/.csv`，当前 approved=192）；`pnpm preflight` 只读检查内容签字、出版信息、适龄评估、ICP、`AUTH_MODE`、真实 provider 和 NPPA 官方确认。当前 preflight 输出 **13 个 blocker**（内容审核已不再是 blocker）。

**外部依赖（blocked）：** 真实短信/实名/NPPA 供应商凭据与协议、版号/ICP/适龄评估/出版信息；正式上线前建议持证植物学/儿童教育/法务专家复核 AI 审核结论。S0 角标保留。服务器运维还需补：Nakama 控制台公网暴露收敛、备份异地副本、按正式流量扩容。iOS 物理机未在本次环境提供，真实移动端已由 HarmonyOS SGT-AL50 覆盖。
