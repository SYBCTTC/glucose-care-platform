# 检测时段改为运行时校验（去静态白名单）

> 状态：✅ **已实现**（2026-11-17 评审通过并落地，提交 `67804a4`）
> 来源：`docs/DB-MIGRATION-NOTES.md` §4 待决策第 3 项
> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 填写。属契约变更（动了 `packages/shared` 的共享 Zod），已按规格先行流程评审。
> §11 的 4 项待确认已由需求人裁定，结论见该节。

### 0. 元信息 ⭐

| 项 | 内容 |
|---|---|
| 阶段号 | **P2-10 血糖录入**的后续增强（血糖业务跟着患者走，原 P3 号段已并入 P2，见 `docs/ROADMAP.md`） |
| 模块 | `glucose` + `shared` + `time-slot` |
| 优先级 | P2 |
| 依赖 | 已落地的 `TimeSlot` 表（`4553fc6`）与 `GET /time-slots`（`e2971b9`）；无新依赖 |
| 需求人 | 项目所有者（2026-11-17 裁定 §11 四项决定） |

### 1. 目标与用户故事 ⭐

作为**系统管理员**，我要在库里新增或停用检测时段后**无需改代码、无需发版**就能让录入生效，
以便时段维护不再绑定前端发布节奏。

作为**护士**，我要提交合法时段时不被"检测时段不在字典范围内"误拒，以便录入不被无谓打断。

本次范围（做）：

- `packages/shared/src/glucose/schema.ts`：`mealContext` 由静态白名单改为格式校验
- `apps/server/src/modules/glucose/glucose.service.ts`：新增运行时校验（查 `TimeSlot` 表，须存在且 `enabled`）
- 单测：shared 契约 + server 校验分支
- 文档口径同步 4 处：`AGENTS.md` §4.4、`docs/COMMON-DATA.md`、`.codebuddy/rules/glucose-domain.md`、`docs/DB-MIGRATION-NOTES.md` §4

本次不做（明确排除，避免范围蔓延）：

- 不改 `TimeSlot` 表结构，**不产生迁移**
- 不改 `GET /time-slots` 契约与 `TimeSlotOption` 形状
- ~~不动 `TIME_SLOTS` 静态常量~~ → **评审后改为降级并移除兜底**，见 §11-3
- 不做时段管理页（新增/停用仍走 `seed.ts` 或 DBA）
- 不引入缓存层（理由见 §9）
- ~~不改前端组件~~ → 评审后 `GlucoseCreateModal` 加了一行空态提示、`store/common-data.ts` 去掉静态兜底，见 §11-3

### 2. 数据模型变更

**无。** `TimeSlot.code` 已是 `@unique @db.VarChar(32)`，`enabled` 已存在（默认 true），
`GlucoseRecord.mealContext` 仍是 `String? @db.VarChar(32)`。无迁移、无回填、不影响存量数据。

### 3. 接口契约 ⭐

| # | 方法 | 路径 | 权限点 | 数据范围(RESOURCE) | 审计动作 | 说明 |
|---|---|---|---|---|---|---|
| 1 | POST | `/patients/:id/glucose` | `PERMISSION.GLUCOSE_CREATE` | PATIENT | `GLUCOSE_CREATE` | 路径/权限/审计均不变，仅 `mealContext` 的校验位置从 shared 静态白名单移到服务端查库 |

请求（只列变更字段）：

```ts
// 变更前：mealContext 必须 ∈ TIME_SLOTS.map(s => s.code)（13 个静态值）
// 变更后：只做格式校验，与 TimeSlot.code @db.VarChar(32) 对齐
{ mealContext: string /* trim 后 1~32 字符，非空 */ }
```

响应：**完全不变**（`GlucoseCreateResult`，含 `skipped`）。

**契约变更点（评审重点）**：`createGlucoseSchema` 是前后端共享的 Zod。放宽后，
前端 `GlucoseCreateModal.handleSubmit` 里的 `safeParse` 预检（第 198 行）不再拦无效 code，
无效 code 改由服务端返回 `10001` + 字段级 `details`。

### 4. 业务规则与校验 ⭐

1. `mealContext` 必须在 `TimeSlot` 表中存在 → 否则 `10001`，
   `details = [{ field: 'mealContext', message: '检测时段不存在' }]`
2. 该时段必须 `enabled = true` → 否则 `10001`，
   `details = [{ field: 'mealContext', message: '检测时段已停用' }]`
   - 停用项仍由 `GET /time-slots` 下发（历史血糖的 `mealContext` 要展示名称，见 `time-slot.service.ts:16`），
     但**不得用于新录入**
3. 校验时机：放在 `assertOperatorExists` 之后、写库之前，与现有前置校验同层，保持"先校验后写库"
4. 幂等/并发：时段校验与唯一约束去重（`@@unique([patientId, measuredAt])`）互不影响；
   校验通过后仍可能命中 P2002 → 保持 `skipped` 语义不变
5. 竞态窗口：时段在本次校验通过后、写库前被停用 → 本次仍写入，不做二次校验（可接受，录入是人工低频操作）
6. 历史数据的 `mealContext` 不受影响：不回填、不追溯校验（旧记录可能引用已停用时段，属正常）
7. `TIME_SLOTS` 静态白名单移除后，**"code 是契约、禁止按名称匹配"这条口径不变**：
   服务端只按 `code` 查，不按 `name`

### 5. 权限与数据安全 ⭐

| 项 | 选择 |
|---|---|
| 功能权限 | 不变：`@RequirePermissions(PERMISSION.GLUCOSE_CREATE)`；不新增权限点 |
| 数据范围 | 不变：`@RequireDataScope(RESOURCE.PATIENT)` + `assertInScope`。`TimeSlot` 是**院内公共基础数据**，查它不引入新的数据权限（对照 `TimeSlotService.list` 用 `buildScopeWhere(user, RESOURCE.DICT)`，对 DICT 返回 `{}`，即全院可见） |
| 脱敏字段 | 无新增；时段名称非个人信息 |
| 加密字段 | 无 |
| 审计 | 动作仍为 `GLUCOSE_CREATE`，`AUDIT_DETAIL_ALLOW_LIST` 不变（已含 `mealContext`、`skipped`）。时段校验失败时 `AuditLogInterceptor` 会落一条 **`result='FAILED'`** 的审计（拦截器对非 `ForbiddenException` 一律记 FAILED，`ForbiddenException` 才记 DENIED），`detail` 含请求里的白名单字段 + `error:'denied_or_failed'`，**不含错误消息文本**。已实测：3 次提交（1 成功 + 2 被拒）产生 3 条 `GLUCOSE_CREATE` 审计行 |

✅ 实现方式已裁定（§11-1）：走 `TimeSlotModule` 导出的 `TimeSlotService.findByCode`，
不在 `GlucoseService` 里直查 `prisma.timeSlot`——符合 `AGENTS.md` §3「跨模块调用必须走 module 导出」。
（`GlucoseService` 现有的 `prisma.patient` / `prisma.user` 直查属存量写法，本次未一并改造。）

### 6. 前端交互 ⭐

- **下拉逻辑无需改动**。`GlucoseCreateModal` 的时段下拉已只渲染 `timeSlots.filter(slot => slot.enabled)`
  （第 88-102 行），数据来自 `useCommonDataStore().timeSlots`（`GET /time-slots`），
  正常操作**不可能**产生无效或停用的 code
- 服务端 `10001` 已被 `handleSubmit` 的 catch 映射到表单项（第 222-229 行），
  `mealContext` 的错误会挂在"检测时段"这一行，符合 `error-codes` 规则第 6 条
- 可感知变化一：极端情况（弹窗打开后时段被停用）下，错误从"提交前本地拦截"变为"提交后字段级提示"
- 可感知变化二（评审后新增，见 §11-3）：`/time-slots` 接口失败时下拉为空并提示
  「时段数据未加载，请刷新页面重试」，不再用静态清单兜底；`getTimeSlotName` 取不到名称时返回 code 本身
- 按钮级权限：不涉及
- 可访问性：无变化（空态提示走 antd `notFoundContent`）

### 7. 错误码与前端行为 ⭐

| 场景 | 错误码 | HTTP | 前端行为 |
|---|---|---|---|
| 时段 code 不存在 | `10001 VALIDATION_FAILED` | 422 | field（挂"检测时段"） |
| 时段已停用 | `10001 VALIDATION_FAILED` | 422 | field（挂"检测时段"） |
| 跨科室 | `30002` | 403 | toast（不变） |
| 无权限点 | `30004` | 403 | toast（不变） |
| 重复提交 | `code 0` + `data.skipped=true` | 200 | warning「未重复保存」（不变） |

**不新增错误码**：复用 `10001` + `details`，无需改 `docs/ERROR-CODES.md` 与 `error/codes.ts`。

### 8. 测试要求

- [ ] shared 单测：`mealContext` 空串 / 纯空格 / 超 32 字符 → 拒
- [ ] shared 单测（**行为反转的关键用例**）：格式合法但不在静态 `TIME_SLOTS` 中的 code（如 `'CUSTOM_SLOT'`）→ **通过**
- [ ] server 单测：code 不存在 → `10001` 且 `details[0].field === 'mealContext'`
- [ ] server 单测：`enabled = false` → `10001`
- [ ] server 单测：`enabled = true` → 正常写入
- [ ] server 单测：时段校验失败时**不得**调用 `glucoseRecord.create`（钉住"先校验后写库"）
- [ ] 回归：现有 server 62 项、shared 16 项、web 10 项全绿
- [ ] 手工验证：库里 upsert 一个新 code（不在 shared `TIME_SLOTS`）→ 前端下拉出现该项 → 提交成功；
      再把 `enabled` 置 false → 提交被拒且错误挂在"检测时段"

### 9. 非功能要求

| 项 | 要求 |
|---|---|
| 性能 | 每次录入多 1 次 `findUnique`（`TimeSlot.code` 有唯一索引，<1ms）。录入是低频人工操作（总账号 <2000），**不引入缓存**；将来接设备自动上报（高频）时再加进程内缓存，届时另行评审 |
| 内网 | 不引用任何公网资源，不新增依赖 |
| 等保 | 不涉及脱敏/留存/水印变化；审计动作与 `detail` 白名单不变 |
| 兼容 | 无 UI 变化；接口响应形状不变，旧前端不会崩 |

### 10. 验收标准（可勾选）⭐

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] 库里新增时段（**不改 shared、不发版**）后，前端下拉出现且可成功提交
- [ ] 停用时段后提交被 `10001` 拒，错误挂在"检测时段"表单项
- [ ] 现有静态 `TIME_SLOTS` 的 13 个 code 行为不变（含 `RANDOM` / `RETEST`）
- [ ] 共享包三步已执行并验证副本：`pnpm --filter @gc/shared build` → `pnpm sync:shared` → 清 `apps/web/node_modules/.vite` 并重启（见 `.codebuddy/rules/shared-package.md`）
- [ ] 文档同步 4 处：`AGENTS.md` §4.4 已知取舍、`docs/COMMON-DATA.md` 已知约束、`.codebuddy/rules/glucose-domain.md` BGM 节、`docs/DB-MIGRATION-NOTES.md` §4 第 3 项

### 11. 评审结论（2026-11-17 需求人裁定，均已实现）

1. **实现方式 → 走 `GlucoseModule` 模式**：`TimeSlotModule` 导出 `TimeSlotService`，
   `GlucoseModule` 导入并注入；`TimeSlotService` 新增 `findByCode(user, code)` 做单点查询
   （不复用返回全量 DTO 的 `list()`），与 `list()` 同样走 `buildScopeWhere(RESOURCE.DICT)`。
2. **停用语义 → 只有「历史可展示、新录入拒绝」**，不设第三种（不做"允许录入但警示"）。
3. **静态常量 → 降级并移除兜底**（超出本 spec 原默认的"不动"）：`TIME_SLOTS` 明确为仅 seed 数据源；
   `getFallbackTimeSlots` 与 `getTimeSlotLabel` **一并删除**。
   连带影响：`/time-slots` 接口失败时前端时段下拉为空并提示「时段数据未加载，请刷新页面重试」，
   不再回退静态清单——静态兜底会让库里已停用/已改名的时段看起来仍可选，提交后才被拒。
4. **阶段号 → P2-10**：血糖业务跟着患者走，`docs/ROADMAP.md` 已按实际代码重估，
   原 P3 号段保留不复用（避免其他文档与 `routes.tsx` 里的 P4/P5 引用失效）。
