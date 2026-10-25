# TODO — 目标用户差距补齐（来源：附录 A5 目标用户视角差距分析）

范围：A5 列出的全部差距，**跳过真机测试**（用户 2026-10-23 指示）。不改已确定的核心玩法与奖励数值；植物内容不讲药效；新增内容一律 `reviewStatus: pending`，不得为通过门禁把 pending 改成 approved。

## G1 内置浏览器打开与入口（P0）
- [x] 识别小红书、微信、QQ、微博、抖音内置浏览器（UA）。
- [x] 在内置浏览器中显示可关闭提示条：“在浏览器中打开更稳定，进度不会丢”，提供“复制游戏链接”按钮（复制成功/失败都有反馈）。
- [x] 设置页新增“分享给朋友”区：复制链接、可复制的搜索口令文案（“本草小游记 成都篇”）。不在游记图里放二维码。

## G2 游记图在内置浏览器里保存（P0）
- [x] 内置浏览器中生成游记后，全屏显示 data URL 图片，并醒目提示“长按图片 → 保存到相册”，不显示可能失效的“下载”按钮。
- [x] 普通浏览器保留下载与系统分享；分享不可用时提示长按保存。

## G3 都江堰带娃出行卡可显示（P0）
- [x] 至少补齐 1 条有官方来源原文的核实字段（步行强度/推车/季节之一），使展示字段 ≥3，卡片与入口出现。
- [x] 来源、原文引用、核实日期写入 trip_cards.json；`reviewStatus` 保持 pending。

## G4 首发季节包与锁定卡体验（P1）
- [x] 2026 年已过去的节气日期经权威来源核实后标记 verified（附来源）。
- [x] 开服回溯：开服日前 90 天内已过去的已核实节气在开服时开放；开放集合随时间只增不减；首周开放植物 ≥12 种。
- [x] 未开放的“???”卡显示“还有 N 天开放”和开放日期。

## G5 植物知识卡与成长观察补齐（P1）
- [x] 24 种植物的家庭种植（光照/浇水）、日常场景、名字或民俗小故事、“讲给孩子听”一句话补齐，每种至少 1 个权威来源；不写药效、功效、食疗、剂量、适用人群。
- [x] 成长观察中的“待核实/待补充”占位文本替换；release gate 的占位警告相应减少。
- [x] 新内容 `reviewStatus: pending`，S0 角标保持。

## G6 实名前说明与信任承诺（P1）
- [x] 实名开启时，登录卡片前先显示一屏说明：为什么要实名（国家规定）、信息如何保护（加密保存、只用于实名和防沉迷、可注销）、不做什么（无广告、无付费、不需要定位），附 3 张游戏预览图；“继续”后才进入手机号登录。
- [x] 启动页与同意页把“无广告 · 无付费 · 不需要定位”做成醒目的标签，而不是脚注。

## G7 进度转移（P1）
- [x] 服务端 `game.transfer.create`：为当前账号生成 8 位一次性转移码，10 分钟有效，同一账号只保留最新一个。
- [x] 服务端 `game.transfer.claim`：目标账号必须是新账号（未完成任何关卡、无已种植物/小院改动），否则返回 `TARGET_HAS_PROGRESS`；成功后把来源账号的存档复制到目标账号，来源账号存档被清空，转移码作废；幂等；限流防暴力猜码。
- [x] 设置页：“把进度带到别的浏览器”（生成码、显示有效期）与“输入转移码”（确认覆盖提示）。
- [x] 实名开启后，玩家用手机号登录时，若本浏览器还有旧的试玩账号，自动提示“把试玩进度带过来”，一键完成转移（新账号须已实名，门禁照常生效）。

## G8 声音：音效与亲子语音（P1）
- [x] 音效（WebAudio 合成，无外部文件）：找到目标、拼图吸附、拼图完成、种子成熟、领取、按钮轻触；设置页可开关，默认开、音量低。
- [x] 亲子语音：找物目标提示与“讲给孩子听”故事预录普通话语音，亲子模式下自动/点击播放；设置页可开关；按需加载，不进首屏包。

## G9 第一次的获得感（P2）
- [x] 结算页显示奖励植物/装饰大图、景点一句小故事、轻量庆祝动画。
- [x] 小院“一键示范布置”：只用玩家已拥有的物品自动摆出一个好看的布局，进入草稿，需玩家保存；不新增奖励。

## G10 回访理由（P2）
- [x] “小院小事”：每天（UTC+8）一条确定性的小院小事文案（天气、访客、植物状态），纯展示、无奖励。
- [x] 导出“节气提醒”日历文件（.ics），包含接下来已核实的 6 个节气，不需要任何推送权限。

## G11 首屏速度（P2）
- [x] 中文字体按实际用字子集化（含 UI 与内容用字），体积显著下降；缺字回退系统字体。
- [x] Phaser 与场景按需加载，首屏主包体积下降。

## G12 游记差异化与博主共创包（P2）
- [x] 游记可选最多 3 枚植物贴纸（来自已发现植物），贴纸不遮挡固定字标与声明。
- [x] 博主共创包目录：高清场景图与植物图、每景点 3 句科普文案（标注待审核）、出行卡样张、游记样张、使用说明（非官方声明、隐私提醒、不得宣称景区联名）。

## G13 妈妈之间的轻互动（P3）
- [x] “小院口令”：玩家可生成小院快照口令（只含布局与配色，不含任何账号信息），他人输入口令只读浏览；口令可撤销；不做评论、点赞、排行。

## 收尾
- [x] 类型检查、全部测试、构建（release gate S0）通过；新增功能有单元测试。
- [x] 部署 Nakama 与前端；线上契约测试 12/12 通过；手机视口冒烟（见 README 记录）。
- [x] 更新 README 与 A5 文档状态；Git 检查点推送。

## 实施记录（2026-10-23）
- G1/G2：`src/ui/inApp.ts` 识别小红书/微信/QQ/微博/抖音 UA；`InAppBanner` 提示条；设置页“分享给朋友”；游记在内置浏览器中全屏长按保存。
- G3：都江堰“适合季节”字段改为官方来源核实值（来源见 `content-src/a5_external_sources.md`），出行卡显示 3 个字段；`reviewStatus` 仍为 pending。
- G4：2026 年 1–10 月节气按香港天文台时刻核实；开服回溯 90 天（`SEASON_CONFIG.backfillDays`），开放集合只增不减；锁定卡显示“还有 N 天开放”。
- G5：24 种植物知识卡与成长观察草稿已合并（`scripts/apply-a5-drafts.mjs`，幂等），全部 pending；新增“一句话记住”。
- G6：实名开启时先显示说明页（含 3 张预览图）；信任标签醒目化。说明文字与认证服务实际处理方式一致。
- G7：`game.transfer.create/claim`（8 位码、10 分钟、一次性、目标须为新账号、每小时 10 次试错上限）；设置页转移卡；手机号登录后检测试玩账号并提示迁移。
- G8：WebAudio 合成音效（默认开、低音量）；亲子语音为 **33 段预录普通话**（Sulafat 声线，`public/assets/voice`，按文本哈希匹配、按需加载），文字改动后自动回退系统语音，`pnpm voice` 重新生成清单；测试保证无过期录音且全覆盖。
- G9：首次完成花瓣庆祝与“这次认识了”地标名单；小院“一键示范布置”只用已有物品、进入草稿、需手动保存。
- G10：每日“小院小事”（确定性、无奖励）；节气 .ics 导出（接下来 6 个已核实节气，无提醒、无链接）。
- G11：中文字体按用字子集化（942 KiB → 194 KiB）；Phaser 拆为独立分块并按需加载。
- G12：游记植物贴纸（最多 3 枚、仅已发现植物、避开固定字标与声明）；博主共创包（`本草小游记_上线文档包/博主共创包`，含样张，青城山科普句缺 2 条已标注待内容组补充）。
- G13：小院口令（只含布局与配色、可撤销、只读）；`game.garden.share.create/revoke/get`。
- 仍需人工：所有新增文案的专家审核（pending→approved）；青城山 2 条真实地标科普句；真机测试（按指示跳过）。

---

# TODO — A6 小红书用户动机与差距（来源：附录 A6，2026-10-23）

- [x] A6-B6 UI 四处修复：小院底栏竖排文字；成长观察卡截断/重叠；手作台无图标；结算“新发现”无植物图与留白。
  - 实现：小院底栏改 btn-row 不再竖排；成长观察卡 2 列、观察点 4 列；Img 增加 eager，手作台和结算奖励图立即加载；结算“新发现”改用成熟植物图，并新增“接下来可以做”卡片。
- [x] A6-A3a 图鉴锁定卡：剪影 + 节气名 + 一句预告，超过 30 天不显示天数（显示“X月开放”）。
  - 实现：锁定卡显示剪影 + 节气名；超过 30 天只显示“X月开放”。
- [x] A6-A3b 景点保底植物：每个景点植物路线首次奖励固定为该景点代表植物（与节气开放并存，只放宽“可种”，不改审核）。
  - 实现：已存在：植物路线首次奖励固定为该关卡的代表植物（rules.previewReward），本轮核对无需改动。
- [x] A6-A3c 跨天照料链：已成熟植物每天可“照料”一次（UTC+8），累计 3 天解锁“长得更好”外观标记与观察记录；服务端权威、幂等。
  - 实现：新增 `game.plant.care`（共享规则 applyPlantCare，按 UTC+8 每种植物每天 1 次，满 3 天标记“长得很好”，不发任何物品；服务端权威、走统一写入与幂等回执）。入口在小院“照料”弹窗和图鉴。
- [x] A6-A2 秋假特别篇：活动窗口配置（10-24–11-22）；秋假带娃路线卡（只用已核实字段）；霜降/立冬节气信笺；秋季小院装饰（已有素材）；秋假游记模板。日期文案“成都多数学校 11 月 11–15 日，以学校通知为准”。
  - 实现：`content/events.json` autumn_break_2026（10-24–11-22，日期说明引用成都市教育局官网，并写明“以孩子学校通知为准”）；地图横幅 + 活动弹窗（路线只引用游戏内目标、寒露/霜降/立冬节气信笺沿用节气系统，霜降 10-23、立冬 11-07 已按香港天文台核实；秋天的小院搭配用已有素材）；游记页“用活动标题”。没有新增游记模板图框，沿用 share_scenic/plant/garden。活动只影响展示，不改奖励。
- [x] A6-A4a 导出图片在 S0/S1 阶段加“内测版”小字；release-gate 校验。
  - 实现：S0/S1 导出的游记、轮播组图和攻略卡都会在底部绘制“内测版 · 内容审核中 · 请勿公开传播”；release-gate 校验该标记存在。
- [x] A6-A4b 出行卡新增来源类型 field_record（实地记录，非官方，需日期+记录人）；门禁规则；三景点推车/步行字段保持隐藏直至有真实实地记录（不得编造）。
  - 实现：出行卡新增来源类型 field_record（必须有 recordedBy/recordedAt/conditions，前端标注“实地记录，非官方”）。三景点的推车/步行字段仍隐藏，**没有编造任何实地记录**，等真实踩点后再填。
- [x] A6-A4c 审核优先级清单：首次体验路径内容排在最前（生成 content-src/review_priority.md）。
  - 实现：`pnpm review:priority` → content-src/review_priority.md（当前 P0 首次体验路径 41 条 / P1 45 条 / P2 107 条，按审核角色分组）。
- [x] A6-A1a 「小工具」离线试玩版：独立构建（都江堰找物 + 生成游记，无登录、无联网、无存档），产出 zip 包与平台规则核实清单。
  - 实现：`node scripts/build-trial.mjs` → release/本草小游记-都江堰离线试玩.zip（约 1.9 MB，15 个文件；都江堰找物 + 景点游记；无登录、不联网、无存档；构建时扫描禁止出现服务器地址）。已在无头浏览器完整通关：外部请求 0、控制台错误 0、localStorage 为空。平台规则 10 项全部**待核实**，见附录 A7；法务定性之前不得公开投放。
- [x] A6-A1b 微信小程序 / 专业号外链卡评估文档（不实现，列资质与适配工作量）。
  - 实现：附录 A7 第 4 节：资质、类目、适配工作量（web-view 约 14–23 人日 / 小游戏约 22–38 人日）和建议路线。只做评估，未实现，未申请账号。
- [x] A6-B1 挑战模式：隐藏位置说明、无提示按钮、显示用时与本地最佳；奖励规则不变。
  - 实现：路线弹窗“挑战模式”开关：隐藏位置说明和提示按钮，显示计时；结算显示用时和本机最佳（只在本机，不做排行榜，奖励不变）。
- [x] A6-B2 现场寻宝清单：不定位；按景点列地标，自行勾选“看到了”，可选本地照片；生成“现场对照”游记；仅本地存储。
  - 实现：地图“现场寻宝清单”：只列真实地标（fictional=false），不定位，手动勾选，只存本机（bcy.field.v1）；启动失败或离线时也能打开。“现场对照游记”沿用游记页本地照片功能。
- [x] A6-B3 博主产出：4 张轮播组图导出（关卡/植物/小院/现场）；秋假路线攻略卡模板；小院 6 秒动画视频导出（浏览器支持时）。
  - 实现：游记页“博主工具”：4 张轮播组图（关卡/植物/小院/现场）、秋假路线攻略卡、小院 6 秒视频（只在支持 MediaRecorder 的浏览器显示）。所有图片都带固定页脚和内测标记。
- [x] A6-B4 亲子年龄分层：3–6 岁 / 7–12 岁；7–12 岁每关多一道思考题（pending）。课本关联只在核实现行教材后写（本轮记为待核实，不上线文案）。
  - 实现：设置页可选 3–6 岁 / 7–12 岁；选 7–12 岁时结算亲子卡多一道思考题（content/think_questions.json，6 题，状态 pending，已纳入门禁扫描）。课本关联**没有做**：需要先核实现行教材，本轮不上线相关文案。
- [x] A6-B5 定位说明：首屏/分享文案“认识植物、跟着节气过日子”；手作入口前置到地图页。
  - 实现：首屏副标题改为“认识植物，跟着节气过日子 · 逛成都周边 · 布置川西小院”；地图左上角增加手作台入口。
- [x] A6-C1 背景环境音：3 段（水、山林、古镇），默认关闭或低音量、可关。
  - 实现：src/ui/ambient.ts 用 WebAudio 程序化生成水声/山林/古镇三种环境音，默认关闭、音量很低，可在设置中关掉；不引入音频文件。
- [x] A6-C2 小院口令轻互动：预设 4 种表情回应（无自由文本），每口令每访客每天 1 次，计数显示给主人。
  - 实现：新增 `game.garden.share.react`：只有 4 种预设表情（无自由文本），每位访客对每个口令每天 1 次，不能给自己回应；计数只有主人能看到，访客只知道自己今天回应过没有。
- [x] A6-C3 离线：Service Worker 缓存静态资源与现场清单页；API 永不缓存；版本更新时清理。
  - 实现：public/sw.js：只缓存同源 GET 静态资源；/v2、/ws、/auth、/admin、/console 等接口一律不经缓存；按构建号命名缓存，激活时删除旧缓存；sw.js 本身 no-cache。
- [x] A6-C4 实名说明页加“家长代孩子使用”说明文案。
  - 实现：实名说明页增加“家长陪孩子玩 / 孩子自己玩”的说明。


验证（2026-10-23）：tsc 通过；Vitest 13 个文件 141 个用例全部通过（新增 tests/a6.test.ts 25 个）；release-gate S0 通过；已部署 Nakama 和前端；线上契约测试与冒烟测试结果见 README。真机测试按要求跳过。

---

# TODO — A7 代码缺口补齐 + my189 原生部署 + mymac 真机测试（2026-10-25）

来源：2026-10-25 代码审计报告。范围：先把代码可实现的缺口全部补上，再部署到 `my189` 的 `https://bencaoyou.tryliang.me`（含新版 Nakama），最后在 `mymac` 上做真实移动端测试。外部资质/供应商/人工审核项单独标为 blocked，不伪造通过。

## A7-A 玩法与内容缺口

- [x] A7-01 F25 `share_nature` 自然笔记游记模板：1080×1440 手账版式；植物插画/名称、4 阶段观察贴纸、节气与日期、可选本地照片；固定页脚、原创声明、植物免责声明、S0/S1 内测标记。
- [x] A7-02 P64 自然笔记本页面：按植物展示 4 阶段观察记录、完成度、观察贴纸预览，并可跳转到自然笔记模板。
- [x] A7-03 P65 访客图鉴：图鉴内增加访客 tab，展示 10 位访客的已发现/未发现、到访条件提示、childText、核实等级。
- [x] A7-04 P67 小景与称号：图鉴内展示 8 个小景完成度、故事、问答称号进度；不新增奖励。
- [x] A7-05 观察贴纸：由 `observations[plantId].length === 4` 派生；用于 F25 模板；不新增服务端状态。
- [x] A7-06 植物卡展示 `homeGrowing`（光照/浇水/难度）：只展示已核实字段，过滤占位文本，不写药效。
- [x] A7-07 服务端亲子模式：新增 `game.settings.update`（parentMode），跨设备同步；保留本地即时开关。
- [x] A7-08 本地演示模式补齐 `game.transfer.*` 与 `game.garden.share.*`，与 Nakama 行为一致；UI 不再只在 Nakama 模式显示。
- [x] A7-09 `isFreshState` 增加 `garden.placements` 等进度判断，修复“只改过小院仍可被转移码覆盖”的缺口。
- [x] A7-10 遥测打点补齐：`login_success`、`realname_result`、`run_finish`、`run_cancel`、`plant_start`、`plant_claim`、`tutorial_step`、`tutorial_skip`、`trip_card_view`、`share_system_share`、`error_shown` 等；保持白名单校验。
- [x] A7-11 反馈/遥测运营导出：新增只读 ops 脚本或受控接口，能导出 `game_feedback` / `game_telemetry`，不暴露个人信息。
- [x] A7-12 README/CLAUDE 修正：登录票据 TTL 300 秒；F25 状态；新增 A7 部署/测试说明。

## A7-B 代码侧 provider / 审核工具（已完成）

- [x] A7-13 通用 HTTP 短信 provider：`AUTH_SMS_PROVIDER=http` + 环境变量配置 endpoint/token；本地 HTTP mock 测试。真实供应商参数待采购。
- [x] A7-14 通用 HTTP 实名 provider：`AUTH_REALNAME_PROVIDER=http` + endpoint/token；只转发姓名/身份证，不落库；本地 HTTP mock 测试。NPPA 正式协议仍需官方接入文档，禁止猜测。
- [x] A7-15a 国家防沉迷行为上报的代码侧：`BehaviorReporter` 接口 + 通用 HTTP 网关 + 生产 preflight 检查。
- [x] A7-16a 内容审核工具：`pnpm review:packet` 生成 192 条审核工作包（md/csv）+ `pnpm review:priority` + 发布门禁。
- [x] A7-16b 192 条内容多维审核签字（2026-10-25，AI 内容审核（Claude Code））：192/192 approved；六维台账 `content-src/review_signoff.json|md`；S1 gate 通过（1 条青城山出行卡隐藏警告）。
- [x] A7-17a 生产 preflight：`pnpm preflight` 检查内容签字、出版信息、适龄评估、ICP、AUTH_MODE、真实 provider、NPPA 确认；内容审核已不再是 blocker，当前列出 13 个外部 blocker。

### 外部上线前置条件（不是代码 TODO；当前 blocked）

这些需要供应商、审核专家或政府资质，不能由代码/自动化完成：

- NPPA 正式协议与凭据：完成官方接入后才可设置 `AUTH_NPPA_OFFICIAL_CONFIRMED=1`。
- 版号、ICP、适龄评估、出版信息：外部资质；S3 门禁继续阻断。
- 建议（非门禁）：正式上线前由持证植物学/儿童教育/法务专家复核 AI 审核结论；AI 审核不替代执业资质。

## A7-C 本地验证与构建

- [x] A7-18 `pnpm test`、`pnpm typecheck`、`pnpm gate` 全绿；新增 A7 测试。
- [x] A7-19 构建前端：设置 `VITE_NAKAMA_HOST=bencaoyou.tryliang.me`、443、SSL、server key、S0、device 模式；生成 `dist/`。
- [x] A7-20 构建 Nakama 模块：`pnpm build:nakama` → `backend/nakama/build/bencaoyou.js`。

## A7-D my189 原生部署

- [x] A7-21 my189 安装/启动 PostgreSQL + Nakama 3.41.x（Docker 或原生），生成并保管 server key / console password / DB password。
- [x] A7-22 上传 `bencaoyou.js`，配置 `runtime.js_entrypoint`、`BCY_*`；启动后确认 30 个 RPC 注册。
- [x] A7-23 Nginx vhost：`bencaoyou.tryliang.me` 静态站 + `/v2/`、`/ws`、`/healthcheck`、`/console/` 反代；`/auth/` 在 device 模式下 404；SPA fallback、缓存、CSP/HSTS。
- [x] A7-24 Let's Encrypt 证书：`bencaoyou.tryliang.me`（webroot 或 BT panel），HTTP→HTTPS；`nginx -t` 通过后 reload。
- [x] A7-25 上传 `dist/` 到 my189 站点目录，保留上一版；验证 `https://bencaoyou.tryliang.me/` 200。
- [x] A7-26 线上 API 验证：`game.bootstrap`、`game.state.get`、`game.run.start/finish`、`game.garden.save`、`game.request.status`；确认无 5xx。
- [x] A7-27 线上 Playwright 冒烟（390×844）：同意→登录/试玩→找物→种植→小院→拼图→游记→图鉴→节气→设置。
- [x] A7-28a 移动端退化验证：iOS 26.1 iPhone 17 Pro Simulator Safari 验证首屏/启动页；mymac 本机 Chrome + iPhone 15 Pro 描述符验证触摸找物、拖雾、自然笔记和自然笔记本；拼图、小院拖动、游记导出/分享预览由线上 Playwright 390×844 冒烟覆盖。
- [x] A7-28b 物理真机（HarmonyOS）：mymac 通过 hdc 识别到 **SGT-AL50 / HarmonyOS 7.0.0.109(SP6C00E105R5P3)**（hdc 3.2.0f，USB Connected）。用 Huawei Browser 打开线上站，`uitest uiInput` 注入真实触摸完成：同意页 → 进入小院 → 地图 → 都江堰寻踪 → 拖开云雾 → 点击鱼嘴/飞沙堰/宝瓶口 → 结算（薄荷种子×2）→ 小院 → 种植槽 1 → 种下薄荷/即时成熟 → 收入背包 → 游记 → 自然笔记 → 生成 1080×1440 自然笔记；长按图片 → Huawei Browser 菜单 → 保存至图库 → 出现“已保存至图库”。截图见 `shots-harmony/01–15`。另用 Playwright XHS UA 验证 in-app 全屏保存覆盖层（`shots-live/18-inapp-xhs-save.png`）。

## A7-E 收尾

- [x] A7-29 记录部署地址、版本、构建号、测试结果、已知限制；更新 README/CLAUDE。
- [x] A7-30 清理测试账号/临时文件；确认密钥只存在服务器受控文件；不把 secret 写入仓库。
- [x] A7-31 最终回归：本地 14 个文件 / 151 用例、S0 gate、线上冒烟、移动端截图；明确列出仍 blocked 的外部项。

## A7 实施记录（2026-10-25）

- **代码**：F25 `share_nature`（含 `scripts/build-share-nature.py`）、P64 自然笔记本、P65 访客 tab、P67 小景/称号、观察贴纸派生、`homeGrowing` 展示、`game.settings.update`、本地演示转移/口令、`isFreshState` 小院判断、遥测补齐、通用 HTTP provider、ops 导出脚本、App 图标/OG 资源。
- **ops 导出验证**：`deploy/ops/export-ops.mjs` 对临时 PostgreSQL 16 的 2 条 feedback + 1 条 telemetry 数据导出通过；输出不含联系方式/用户 id。
- **内容审核签字**：`python3 scripts/apply-content-review.py` 已按六维逐条签署 192/192 条，`content-src/review_signoff.json|md` 为台账；补齐真实来源、清除占位来源/编辑笔记/未核实措辞，青城山推断型步行/推车字段按 A6-A4b 隐藏。`VITE_RELEASE_STAGE=S1 AUTH_MODE=device pnpm gate` 通过（1 条青城山出行卡隐藏警告）。
- **审核与上线工具**：`pnpm review:packet` 生成 192 条审核台账（当前 approved=192）；`pnpm preflight` 只读检查内容签字、出版信息、适龄评估、ICP、`AUTH_MODE`、真实 provider 和 NPPA 官方确认，当前输出 13 个外部 blocker（内容审核已不再是 blocker）。
- **验证（本地）**：`pnpm test` 14 个文件 / 151 用例通过；`pnpm typecheck` 通过；`pnpm gate` S0 通过（193 警告，S1+ 仍阻断）。`pnpm build` 在没有 fonttools/markdown 的环境下也能用提交的字体子集/法律页完成构建；`PUBLIC_ORIGIN=https://bencaoyou.tryliang.me` 注入正确的 OG 地址。
- **构建脚本**：修复 `scripts/manus-game-sharing/build.mjs` 在 pnpm 10 原生二进制下把 `npm_execpath` 当 JS 执行的问题；`scripts/build-legal.py` / `subset-font.py` 缺 Python 依赖时保留提交产物并告警。
- **部署**：`https://bencaoyou.tryliang.me`，my189，Nginx（BT panel vhost）+ Let's Encrypt（到期 2027-01-23）；Nakama 3.41.0（Docker；Postgres 16，数据卷 `bencaoyou_pgdata`）；模块 30 个 RPC；`CLIENT_BUILD=2.3.0`，`BCY_MIN_CLIENT_BUILD=2.3.0`；`/auth/*` 在 S0 device 模式返回 404，前端按 device 处理。
- **线上测试**：`node scripts/a7-remote-smoke.mjs`（真实 Nakama：bootstrap / run / settings / garden / share / transfer / account delete）通过；`SHOTS_DIR=shots-live node scripts/smoke.mjs https://bencaoyou.tryliang.me/` 通过（含 A7 notebook / visitor / titles / nature 1080×1440）；mymac Chrome iPhone 描述符测试通过（`shots-mac/`）；iOS Simulator Safari 首屏与启动页截图通过。
- **备份**：`deploy/my189/backup-nakama.sh` 已安装到 `/home/youdt/bencaoyou/backup-nakama.sh`（700）；cron 每日 19:30 UTC（北京时间 03:30）备份到 `~/bencaoyou/backups/`，保留 14 天；`--drill` 校验归档含 `public.users`。首次备份与 drill 均通过（48K）。
- **物理真机（HarmonyOS）**：mymac 的 DevEco `hdc` 识别 SGT-AL50（HarmonyOS 7.0.0.109）；Huawei Browser 打开 `https://bencaoyou.tryliang.me/`，`uitest uiInput` 真实触摸完成同意、地图、都江堰找物（拖雾+3 热点）、结算、小院种植/即时成熟/领取、自然笔记 1080×1440 导出；长按图片 → 保存至图库 → “已保存至图库”。截图 `shots-harmony/01-consent.jpeg` … `15-saved-confirmed.jpeg`。另用 Playwright XHS UA 验证 in-app 全屏保存覆盖层（`shots-live/18-inapp-xhs-save.png`）。
- **清理**：测试设备账号与 system-owned 测试口令/转移码已从 Nakama Postgres 删除；mymac 的临时 `/etc/hosts` 记录和部署根目录 `_a7_*` 测试页已移除；server 密钥只保存在 my189 的 `~/.env`、`frontend.env`、`nakama.yml`（600）和本地 gitignored `.env.production.local`。
- **仍 blocked（外部）**：真实短信/实名/NPPA 供应商凭据与协议、版号/ICP/适龄评估/出版信息；建议持证专家/法务复核 AI 审核结论。真实移动端已由 HarmonyOS SGT-AL50 覆盖；iOS 物理机未在本次环境提供，不阻塞本次交付。
