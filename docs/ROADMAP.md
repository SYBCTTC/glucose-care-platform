# 开发路线图（ROADMAP）

> 本文件是**进度总览**。功能规格见 `docs/specs/`，错误码见 `docs/ERROR-CODES.md`，
> 权限与数据范围见 `docs/PERMISSION-DESIGN.md`，领域口径见 `AGENTS.md` §4，公共数据见 `docs/COMMON-DATA.md`。
> 接口契约**没有独立文档**，以 `apps/server/src/modules/*/**.controller.ts` 的路由与 `packages/shared/src/**/schema.ts` 的 Zod 为准。
>
> 最后核对：**2026-11-17**，按实际代码逐项复核（后端 9 个模块 / 17 个路由、前端 17 个页面文件、
> 12 个迁移、12 个数据模型）。每项都标了依据，便于复核。
>
> **本次重估的两个结构性调整**
>
> 1. **血糖业务跟着患者走**：血糖不再是独立阶段。录入已实现并挂在患者下
>    （`POST /patients/:id/glucose`、前端 `pages/inpatient/patients/GlucoseCreateModal.tsx`），
>    因此原 P3 的已完成部分并入 P2；**P3 号段保留不复用**，避免其他文档与代码里的 P4/P5 引用失效
>    （如 `routes.tsx` 的 Placeholder 文案、`ERROR-CODES.md` 的 P5 导出依赖）。
> 2. 原「P3 已整体移除（2026-10-22）」的说明**作废**：`GlucoseRecord` 表、`glucose` 模块、
>    `GLUCOSE_CREATE` 权限点均已存在。当时移除的是旧设计里的**独立血糖模块**
>    （查询/汇总/导出/数据管理），那部分仍未实现，转入下方「待立项」。

## 阶段总览

| 阶段 | 名称 | 状态 | 完成度 |
|---|---|---|---|
| P1 | 基础框架与安全 | ✅ 已完成 | 100% |
| P2 | 患者管理（**含血糖录入**） | 🔄 进行中 | 75% |
| P3 | ~~血糖（独立阶段）~~ | ⚪ 已并入 P2，号段保留 | — |
| P4 | 设备与实时数据 | 🔄 起步 | 10% |
| P5 | 系统管理 | 🔄 起步（仅只读下发） | 10% |
| P6 | 审计日志与合规 | 🔄 写入已落地，查询未开始 | 10% |
| P7 | 部署与交付 | ⚪ 未开始 | 0% |

图例：✅ 已完成 · 🔄 进行中 · ⚠️ 部分完成 · ❌ 未开始 · ⚪ 不适用

---

## P1. 基础框架与安全 —— ✅ 100%

| 编号 | 功能 | 状态 | 依据 |
|---|---|---|---|
| P1-1 | Monorepo 脚手架 | ✅ | `apps/server`（NestJS）+ `apps/web`（Vite/React）+ `packages/shared` |
| P1-2 | 数据库与 Prisma | ✅ | 12 个迁移、12 个模型；嵌入式 PostgreSQL 本地开发 |
| P1-3 | 认证与会话 | ✅ | `POST /auth/login`、`/auth/logout`、`GET /auth/profile`、`POST /auth/change-password` |
| P1-4 | 权限与数据范围 | ✅ | `PermissionsGuard` + `@RequirePermissions` / `@RequireDataScope`；前端 `PermissionRoute` |

---

## P2. 患者管理（含血糖录入）—— 🔄 75%

| 编号 | 功能 | 状态 | 依据 / 缺口 |
|---|---|---|---|
| P2-1 | 患者查询（住院/出院） | ✅ | `GET /patients/inpatient`、`GET /patients/discharged`；`PatientTable` / `PatientCardGrid` / `PatientFilter` |
| P2-2 | 患者详情 | ⚠️ 部分完成 | `GET /patients/:id`（`PATIENT_VIEW` + 审计，出参补 `nurseName`）；**前端独立详情页已落地**（`/inpatient/patients/:id`，守卫 `PATIENT_VIEW`，脱敏基本信息摘要 + 列表姓名/卡片整卡入口 + C1 方式B 返回还原 + 住院「添加血糖」）；血糖报告/记录/趋势图、基本信息 Tab、出入院记录 Tab 仍为 `Empty` 占位（依赖「血糖查询/图表」与「患者出院」立项）。规格见 `docs/specs/patient-detail.md` |
| P2-3 | 患者建档 | ✅ | `POST /patients`（`PATIENT_CREATE` + 审计）；`PatientCreateModal` |
| P2-4 | 患者编辑 | ✅ | `PATCH /patients/:id`（`PATIENT_UPDATE` + 审计，`detail.changedFields` 记变更字段名）；`PatientEditModal` |
| P2-5 | 入院办理 | ✅ | `POST /patients/:id/admit`（`PATIENT_MANAGE` 审计）。**原 ROADMAP 未列此项** |
| P2-6 | 患者出院 | ❌ | 无出院接口。`PatientStatus` 已有 `DISCHARGED`，出院列表查询已可用，只差状态流转接口 |
| P2-7 | 批量导入 | ❌ | — |
| P2-8 | 虚拟病区 | ✅ | `VirtualWardRecord`（一条=一次进出，历史全留，部分唯一索引 `virtual_ward_record_one_active` 保证至多一条在区）；`GET /ward/patients`（CURRENT/HISTORY 双 Tab）+ `POST/DELETE /ward/patients/:id`（`WARD_VIEW`/`WARD_MANAGE` + 审计 `PATIENT_WARD_JOIN`/`PATIENT_WARD_REMOVE`）；数据权限沿用 `RESOURCE.PATIENT`（跨科室 30002、NONE 档 30006）；并发兜底 44001/44002；前端复用 `PatientTable`/`PatientCardGrid`（判别联合 props），当前 Tab 卡片滚动加载、历史 Tab 仅列表；`useVirtualWardQuery` 命令式双路径 + `removeItem` 局部更新。规格见 `docs/specs/virtual-ward.md` |
| P2-9 | 卡片视图 | ✅ | `PatientCardGrid` |
| P2-10 | **血糖录入**（原 P3-1） | ✅ | `POST /patients/:id/glucose`（`GLUCOSE_CREATE` + 审计）；`GlucoseCreateModal` + `LastGlucose`；结果类型 `0/1/2` 服务端判定；唯一约束 `(patientId, measuredAt)` 幂等去重（`data.skipped`）；检测时段查 `TimeSlot` 表运行时校验 |

> 完成度按 10 项计：7 项 ✅ + 1 项 ⚠️（计半）+ 2 项 ❌ = **75%**。
> （P2-8 虚拟病区 2026-11-18 转 ✅ 后本行未同步，此次核对修正；P2-2 患者详情仍为 ⚠️，
> 前端框架已落地，「血糖报告」子页 2026-11-19 起为真实数据（见 P3-2），记录/趋势图仍占位。）

---

## P3. 血糖 —— ⚪ 已并入 P2（号段保留，不复用）

血糖业务**跟着患者走**，不再作为独立阶段：

- **已实现**（计入 P2-10）：手工录入，含结果类型判定、试纸数量、记录者校验、
  时段查库校验、唯一约束幂等去重、`GLUCOSE_CREATE` 审计。
- **已实现**（P3-2 第一步，2026-11-19）：**血糖报告**（患者详情 · 日期 × 时段矩阵），
  规格见 `docs/specs/glucose-report.md`。
- **未实现，转入「待立项」**（原 P3-2 剩余 ~ P3-7）：

| 原编号 | 功能 | 状态 | 缺口 |
|---|---|---|---|
| P3-2 | 血糖查询 | ⚠️ | **血糖报告已落地**：`GET /patients/:id/glucose/report`（本地时区按日分组、分页单位=日期、强化时段归组、`GLUCOSE_REPORT_VIEW` 审计）+ 详情页 5 内容页全路由化。剩余：血糖记录列表页、趋势图仍为占位（`DetailPlaceholder`），日期范围选择器未做（契约已预留 `startDate`/`endDate`） |
| P3-3 | 日内血糖汇总 | ❌ | `GlucoseDailySummary` 表未建 |
| P3-4 | 数据管理 | ❌ | 无作废/更正流程 |
| P3-5 | 异常值复核 | ❌ | `GlucoseRecord` 无 `status` 字段；越界值当前由 `createGlucoseSchema` 直接拒为 `10001`，不入库 |
| P3-6 | 血糖导出 | ❌ | 依赖 P5 导出框架（异步任务 + 水印 + 审批留痕） |
| P3-7 | 血糖图表 | ❌ | — |

> 旧设计的 `GLUCOSE_VIEW` / `GLUCOSE_INPUT` / `GLUCOSE_EXPORT` 三个**权限点未恢复**；
> 它们作为 `AuditAction` 的**历史枚举值**保留在 schema 中（旧审计行仍在引用，
> 见 `docs/DB-MIGRATION-NOTES.md` §2.3）。错误码 `41xxx` 号段的现状见 `docs/ERROR-CODES.md` §D5。

---

## P4. 设备与实时数据 —— 🔄 10%

| 编号 | 功能 | 状态 | 依据 / 缺口 |
|---|---|---|---|
| P4-1 | 设备注册与绑定 | ⚠️ 起步 | `GET /devices` 只读列表已有；`Device` / `PatientDeviceBinding` 表已建；注册/绑定/解绑接口与前端页面（Placeholder）均未做 |
| P4-2 | 设备数据接收 | ❌ | — |
| P4-3 | 设备状态监控 | ❌ | — |
| P4-4 | 设备校准管理 | ❌ | — |
| P4-5 | 质控液管理 | ❌ | — |
| P4-6 | 试纸管理 | ❌ | 录入时的 `testStrip`（试纸数量）已落库，但无批次/有效期管理 |

---

## P5. 系统管理 —— 🔄 10%

> 本阶段目前只完成「**只读下发**」这一半：公共数据接口已通，管理（增删改）功能全部未做。

| 编号 | 功能 | 状态 | 依据 / 缺口 |
|---|---|---|---|
| P5-1 | 时段设置 | ⚠️ | `GET /time-slots` 已实现（含停用项，供历史血糖回显）；`TimeSlot` 表 + seed 已有；**无维护接口**，前端「目标时段设置」是 Placeholder |
| P5-2 | 字典管理 | ⚠️ | `GET /dicts/:dictType` 已实现；`DictItem` 表已有；无维护接口 |
| P5-3 | 系统参数 | ⚠️ | `SystemConfig` 表已建；**血糖阈值已落地读取**（2026-11-17，`f97fe85`）：新增 `modules/system/SystemConfigService`，`DEFAULT_ALERT_RANGE` 占位常量已删除，配置缺失/非法时拒绝写入。仍**无维护接口与管理页面**（改阈值目前只能改库或改 seed） |
| P5-4 | 人员管理 | ⚠️ | `GET /staff`、`GET /departments` 只读下发已实现；无管理页面（Placeholder） |
| P5-5 | 角色与权限管理 | ❌ | 角色与权限点是代码内静态定义（`@gc/shared` `roles.ts`），无配置界面 |

---

## P6. 审计日志与合规 —— 🔄 10%

| 编号 | 功能 | 状态 | 依据 / 缺口 |
|---|---|---|---|
| P6-1 | 审计日志查询 | ⚠️ | **写入链路已全面落地**：`AuditLogInterceptor` + `@Audit` 覆盖 auth / patient / glucose 各动作，`detail` 走 `AUDIT_DETAIL_ALLOW_LIST` 白名单（不含患者身份信息与自由文本）；**查询接口与页面未做**（`/system/logs` 是 Placeholder） |
| P6-2 | 审计报表 | ❌ | — |
| P6-3 | 数据导出 | ❌ | — |
| P6-4 | 数据留存 | ⚠️ | `AuditLog` 表已建且按 append-only 使用；≥180 天留存/归档/清理策略未实现 |

---

## P7. 部署与交付 —— ⚪ 0%

| 编号 | 功能 | 状态 | 依据 / 缺口 |
|---|---|---|---|
| P7-1 | Docker 化部署 | ❌ | 仓库有 `docker-compose.yml`，**无 `Dockerfile`** |
| P7-2 | CI/CD | ❌ | **无 `.github/workflows`**；目前靠 husky 预提交钩子 + 本地 `pnpm lint/typecheck/test` |
| P7-3 | 验收测试 | ❌ | 已有单测（server 181 / shared 59 / web 10，2026-11-17），无端到端验收用例集 |

> 已具备但不计入本阶段：本地开发环境已脚本化（嵌入式 PostgreSQL + `pnpm dev:up` / `dev:down`）。

---

## 整体进度

**约 41%**（按 32 个功能项加权：P1 4/4、P2 7.5/10、P4 0.2/6、P5 0.8/5、P6 0.5/4、P7 0/3）

- ✅ 已完成：P1 全部；P2 的查询/建档/编辑/入院/卡片视图/**血糖录入**/**虚拟病区**
- 🔄 进行中：P2 详情（前端框架/基本信息/入口已落地，血糖数据等 Tab 占位）、P4 设备列表、P5 只读下发、P6 审计写入
- ⚪ 未开始：患者出院与批量导入、设备数据链路、系统管理（增删改）、审计查询与报表、导出、部署与 CI

> 与上一版（约 35%）的差异来自**按代码复核**而非新增功能：P2 补上了此前漏记的入院办理与血糖录入，
> P5/P6 从 0%/5% 上调（只读下发接口与审计写入链路其实已落地），P2 详情从「已完成」下调为「部分」。
> 2026-11-18：P2-8 虚拟病区后端 + 前端全量落地（进出记录、双 Tab 列表、权限与审计、并发兜底 44001/44002），由「部分」上调为「已完成」。
> 2026-11-18：P2-2 患者详情**前端独立详情页落地**（路由 `/inpatient/patients/:id`、脱敏基本信息摘要、列表姓名/卡片整卡入口、C1 方式B 返回还原、住院「添加血糖」），后端详情出参补 `nurseName`；血糖数据/基本信息/出入院记录 Tab 仍占位，状态维持「⚠️ 部分完成」。规格见 `docs/specs/patient-detail.md`。

---

## 待立项（原 P3 剩余项 + 跨阶段依赖）

| 项 | 依赖 | 备注 |
|---|---|---|
| 血糖查询（剩余）/ 图表 / 日内汇总 | 无 | 原 P3-2、P3-3、P3-7；P3-2 的血糖报告已落地（2026-11-19，`docs/specs/glucose-report.md`），剩余记录列表/趋势图/日期范围选择器；汇总需先定口径与是否建 `GlucoseDailySummary` |
| 血糖数据管理（作废/更正） | 审计 | 原 P3-4；医疗记录不得物理删除，需设计作废留痕 |
| 异常值复核 | schema 评审 | 原 P3-5；需给 `GlucoseRecord` 加状态字段，并登记 `41002`。`41006 GLUCOSE_RECORD_LOCKED` 已提前占位（`8e22a4b`）但无代码抛出 |
| 导出框架（异步任务 + 水印 + 审批留痕） | P5、P6 | 原 P3-6 与 P5 导出共用；需登记 `41008` |
| ~~血糖阈值改为读 `SystemConfig`~~ | ~~P5-3~~ | ✅ **已完成**（2026-11-17，`f97fe85`）：`SystemConfigService` 读取并校验，`DEFAULT_ALERT_RANGE` 已删除 |
| ~~审计 `targetId` 支持从响应体取（建档留痕）~~ | ~~审计~~ | ✅ **已完成**（2026-11-17，方案 A）：`@Audit` 支持 `targetType` / `targetIdFrom`，建档审计已能落到新患者 ID |
| ~~统一两套脱敏实现~~ | ~~安全~~ | ✅ **已完成**（2026-11-17）：统一到 `@gc/shared` 的 `mask`，删除 `field-crypto` 副本，并修掉 shared 原有的明文回显与复姓误判缺陷；存量 `*Masked` 已用 `pnpm db:remask` 刷新 |
| 详情页明文回显（含访问留痕） | 安全 | `decryptField` 已具备解密能力但无接口调用；按 `AGENTS.md` §5.3 必须同时加审计，需单独出规格 |
| ~~换强随机密钥~~ | ~~安全 / 运维~~ | ✅ **已完成**（2026-11-17）：8 位纯小写弱钥已换为 43 位 base64url（`randomBytes(32)`），并同步实现 re-key 能力、在 1013 个真实密文上完成双向轮换演练（往返后逐字节相同）。详见 `docs/DB-MIGRATION-NOTES.md` §6 |
| ~~密钥强度校验~~ | ~~安全~~ | 🚫 **需求人 2026-11-17 裁定不做**：`assertFieldCryptoReady` 保持只判非空，不加"生产环境短于 32 位拒绝启动"。密钥强度改由**流程**保障（`.env.example` 已注明 `randomBytes(32).toString('base64url')` 生成命令与长度要求，生产由运维注入）。**残留风险已知悉并接受**：弱钥不会被任何测试发现，只会在等保测评或库文件泄漏后暴露；若将来改主意，加校验属启动行为变更，需同步更新部署文档 |
| ~~清理不可恢复的历史行~~ | ~~数据~~ | ✅ **已完成**（2026-11-17，需求人裁定删除）：`patientNo=123456`（2026-10-26 手工测试档，不在 seed 覆盖范围内）因换钥时旧钥未备份，`nameCipher`/`idCardCipher` 明文永久不可恢复，已删除。关联数据：血糖记录 0、设备绑定 0；**审计日志 1 条引用按 append-only 要求保留未删**（等保三级：只增不改不删，留存 ≥180 天）。删除后患者 1000 行、1011 个 AES 字段往返校验 0 失败 |
