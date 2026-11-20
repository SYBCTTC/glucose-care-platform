# R25 血糖报告表格上直接添加 / 编辑 / 作废血糖（设计稿）

> 状态：📝 **设计稿，待人工评审**（含 schema 变更与唯一约束调整，属 AGENTS.md §6.5 人工审查项）。
> 裁定记录：2026-11-20 需求人对 Q1~Q16 全部裁定（见 §11 裁定摘录）。本轮**未改任何代码**。
> 对应 ROADMAP：**P3-4 血糖数据管理（作废/更正）**——「医疗记录不得物理删除，需作废留痕」在本需求落地。

---

### 0. 元信息 ⭐

| 项 | 内容 |
|---|---|
| 阶段号 | P3-4（血糖数据管理：作废/更正）+ 血糖报告交互增强（R25） |
| 模块 | glucose（server）/ inpatient-patient-detail（web）/ shared |
| 优先级 | P1 |
| 依赖 | R20~R24 血糖报告（列下发、展示勾选、全屏、表单查询）；`GlucoseCreateModal`（复用） |
| 需求人 | 用户（2026-11-20 提出并裁定 16 项） |

### 1. 目标与用户故事 ⭐

作为**医护（医生/护士/护士长）**，我要**直接在血糖报告表格上点击单元格添加血糖、点击已有记录查看/编辑/删除血糖**，以便不离开报表页就能更正与补录数据。

本次做：
- 单元格 entry 块可点击 → **review 弹框**（只读）→ 编辑模式（回填）→ 保存 / 删除（作废）
- 空白单元格可点击 → 复用**添加血糖弹框**，预填该行日期 + 该列时段
- 删除按**软删除（作废）**实现（裁定 Q1a）：库内保留行 + 审计留痕，报表/统计/最新血糖不再展示
- 患者无任何血糖 → 表格维持「暂无数据」空态，不可点击（裁定 Q14）

本次不做：血糖统计口径改动、R24 表单查询改动、R23 全屏改动（三者照常叠加工作）；异常值复核（P3-5，41006 维持预留）；物理删除。

### 2. 数据模型变更（⚠️ 需人工评审）

| 模型 | 字段 | 类型 | 说明 | 迁移 |
|---|---|---|---|---|
| `GlucoseRecord` | `voidedAt` | `DateTime? @db.Timestamptz(3)` | 作废时间；**NULL = 有效**。不建通用 `status` 枚举（裁定 Q2，与 P3-5 复核状态语义分离） | 是（可空，无回填） |
| `GlucoseRecord` | `voidedById` | `String? @db.Uuid` | 作废操作人（留痕）；建议外键 `User` **Restrict**（同 `operator` 口径：删用户不得抹掉留痕），`User` 侧加反向关系 `voidedGlucoseRecords @relation("GlucoseVoidedBy")` | 是 |
| `AuditAction` 枚举 | `GLUCOSE_UPDATE` / `GLUCOSE_VOID` | — | **必须与列变更同一迁移登记**（`GLUCOSE_REPORT_VIEW` 漏登记教训：PG 拒写非法枚举值 → 审计行静默丢失） | 是 |

#### 2.1 ⚠️ 唯一约束调整（重点评审项，契约变更）

现行 `@@unique([patientId, measuredAt])` 与软删除**冲突**：记录作废后仍占用时间戳，
用户在同一 `measuredAt` 补录新记录会命中唯一约束 → 幂等 `skipped=true`「未重复保存」，
但表格里根本看不到那条已作废记录——**用户视角是"加不进去也找不到原因"**。

方案（建议）：全量唯一约束改为**部分唯一索引**（仅约束有效记录）：

```sql
ALTER TABLE "GlucoseRecord" DROP CONSTRAINT "GlucoseRecord_patientId_measuredAt_key";
CREATE UNIQUE INDEX "glucose_record_active_unique"
  ON "GlucoseRecord" ("patientId", "measuredAt")
  WHERE "voidedAt" IS NULL;
```

- Prisma 表达不了部分索引，落 `prisma/sql/glucose_record_active_unique.sql`（先例：`ward_one_active.sql`），迁移内手工补
- schema.prisma 移除 `@@unique([patientId, measuredAt])`（AGENTS.md §4.5 明言改此约束属契约变更，需评审）
- **连带改动**：`createOrSkipDuplicate` 命中 P2002 后的回读不能再走 `findUnique`（唯一键没了），
  改 `findFirst({ where: { patientId, measuredAt, voidedAt: null } })`；
  部分索引下命中 P2002 必然存在**有效**重复行，幂等语义不变
- 不加 `voidedAt` 普通索引：当前规模小，读路径按 `patientId + measuredAt` 既有索引过滤后再判 `voidedAt`

#### 2.2 读路径全量梳理（作废记录一律不可见）

以下 `GlucoseRecord` 读路径**全部**叠加 `voidedAt: null`（实施时逐一核对，防漏）：
`buildReportRows`（单元格 + 行分组 + 分页）、报表统计 `stats`、患者列表 `lastGlucose`（LastGlucose 展示）、
create 幂等回读、本需求新增的单条详情接口。审计表不动（append-only）。

### 3. 接口契约 ⭐

| # | 方法 | 路径 | 权限点 | 数据范围 | 审计动作 | 说明 |
|---|---|---|---|---|---|---|
| 1 | GET | `/patients/:id/glucose/:recordId` | `patient:view` | PATIENT | **无**（裁定 Q4：报表查询已逐条留痕，避免重复噪音） | 编辑回填详情 |
| 2 | PATCH | `/patients/:id/glucose/:recordId` | `glucose:update` | PATIENT | `GLUCOSE_UPDATE`（detail 记 `changedFields` 字段名，裁定 Q5） | 编辑保存 |
| 3 | DELETE | `/patients/:id/glucose/:recordId` | `glucose:delete` | PATIENT | `GLUCOSE_VOID`（detail 记 `glucoseRecordId`） | 作废（软删除） |

三个路由均 `@RequireDataScope(RESOURCE.PATIENT)`（患者子资源复用 PATIENT，虚拟病区/报表同例）；
`targetId` 取 `params.id`（患者 ID），`targetType: 'PATIENT'` 显式声明（`:id` 是患者、`:recordId` 是血糖，防误记）。

**契约变更（shared）**：`GlucoseReportEntry` 加 `id: string`（GlucoseRecord.id）——没有它前端无法定位点的是哪条记录。

#### 3.1 GET 详情

响应 `data`：

```ts
{
  id: string;
  measuredAt: string;        // YYYY-MM-DD HH:mm:ss 本地时间（同报表口径）
  mealContext: string | null;
  resultType: string;        // '0'~'9'
  valueMmolL: number | null;
  testStrip: number | null;
  operatorId: string | null;
  operatorName: string | null; // 服务端下发（操作人可能不在本科室 staff 下拉里，同报表 nurseName 口径）
  remark: string | null;
}
```

时段名称前端按 `mealContext` code 查 `useCommonDataStore().timeSlots`（含停用项，`GET /time-slots` 已下发停用项供回显）。
记录不存在 / 已作废 / `patientId` 不匹配 → `41001`。

#### 3.2 PATCH 编辑

请求体**复用 `createGlucoseSchema`**（字段与校验和添加完全一致，不造第二份契约）：
`{ measuredAt, mealContext, resultType, valueMmolL?, testStrip?, operatorId, remark? }`。

响应 `data`：`{ id, changedFields: string[], resultType, valueMmolL, measuredAt }`
（`changedFields` 已在 `AUDIT_DETAIL_ALLOW_LIST`，拦截器自动从信封提取，**无需改白名单**——update 路径）。

#### 3.3 DELETE 作废

响应 `data`：`{ glucoseRecordId: string, voided: true }`。
`AUDIT_DETAIL_ALLOW_LIST` **新增 `glucoseRecordId`**（先例 `wardRecordId`；审计逻辑改动，需人工评审）。

### 4. 业务规则与校验 ⭐

1. **前置校验（三接口一致，同 create 口径）**：患者存在且未归档（`40001`）→ `assertInScope(PATIENT)`（跨科室 `30002` + DENIED 审计）→ 患者状态 INPATIENT（`40004`，见 §11 待确认 1）→ 记录存在、属该患者、未作废（`41001`）。
2. **编辑校验同 create**：`assertOperatorExists`（记录者在职）、血糖范围 Zod（`10001` 字段级）、结果类型 0/1/2 一律服务端按 `SystemConfig` 阈值重判（裁定 Q11；配置缺失/非法 `10000` 拒绝写入）、非检测类型（3~9）强制清空 `valueMmolL`/`testStrip`。
3. **时段可用性豁免（裁定 Q12）**：`mealContext` 与原值**相同** → 跳过 `assertTimeSlotUsable`（否则停用时段的历史记录永远无法编辑）；**改为**其他 code → 照常校验存在且 enabled（`10001` + `details[{field:'mealContext'}]`）。
4. **检测时间撞唯一约束（裁定 Q6）**：另一条**有效**记录已占该 `(patientId, measuredAt)` → `41003`（先查后写 + 捕获 P2002 兜底并发），前端字段级挂 `measuredAt`。
5. **并发冲突**：PATCH/DELETE 用 `updateMany({ where: { id, patientId, voidedAt: null } })`，受影响 0 行 → 记录已被他人作废/不存在 → `10008 CONCURRENT_CONFLICT`（toast-refresh，报表刷新后用户看到最新状态）。
6. **作废幂等**：重复 DELETE 已作废记录 → 同上 `10008`（不是成功，避免误导）。
7. **changedFields 计算**：服务端逐字段对比新旧值（`measuredAt`/`mealContext`/`valueMmolL`/`resultType`（重判后）/`testStrip`/`operatorId`/`remark`），只记**字段名数组**入审计（裁定 Q5；remark 自由文本绝不入 detail，白名单既有口径）。无实际变更 → `changedFields: []`，照常返回成功（不报错）。
8. **记录者可改为他人**（裁定 Q10，与添加口径一致）；编辑人留痕靠审计行 `operatorId`，**不加** `updatedById` 列。
9. **入录方式**：无 `channel` 字段（AGENTS.md §4.5），review 弹框显示**固定文案「手动入录」**，纯展示不落库（裁定 Q13）。
10. **添加（空白格）走既有 POST 接口**，服务端零改动（除 §2.1 回读方式）；预填只是前端默认值。

### 5. 权限与数据安全 ⭐

| 项 | 内容 |
|---|---|
| 新权限点 | `PERMISSION.GLUCOSE_UPDATE = 'glucose:update'`、`PERMISSION.GLUCOSE_DELETE = 'glucose:delete'`（裁定 Q7 拆两个，不合并 manage） |
| 角色授予（裁定 Q8） | `glucose:update` → DOCTOR / NURSE / NURSE_HEAD / SYS_ADMIN（同 create 四角色）；`glucose:delete` → **仅 NURSE_HEAD / SYS_ADMIN** |
| 数据范围 | 三接口 `@RequireDataScope(RESOURCE.PATIENT)` + `assertInScope`；设备管理员（NONE 档）天然拒绝 `30006` |
| 前端按钮（裁定 Q9） | entry 点击 → review：有 `patient:view` 即可（只读）；「编辑」按钮按 `glucose:update` 显隐；「删除」按钮按 `glucose:delete` 显隐；空白格可点性按 `glucose:create` 显隐。**前端隐藏只是体验，服务端才是边界** |
| 审计 | `GLUCOSE_UPDATE`（changedFields）/ `GLUCOSE_VOID`（glucoseRecordId）；GET 详情不审计（裁定 Q4）；越权 `3xxxx` 照常 DENIED 落审计 |
| 脱敏/加密 | 不涉及新字段（血糖数据非身份三要素）；`operatorName` 是员工姓名（内部用户，非患者），同报表 `nurseName` 既有口径不脱敏 |
| 生效时机 | 过渡期 JWT 内嵌 permissions：新权限点需**重新登录**生效（既有约定，上线通知里写明） |

### 6. 前端交互 ⭐

**入口**：患者详情 → 血糖报告子路由（`GlucoseReportTab`），无新路由。

1. **单元格点击（编辑入口）**：`ReportCell` 每个 entry 块（第 1 行 值+时间+来源时段名 / 第 2 行 记录者，两行整体）包一层可点击容器：`cursor: pointer` + hover 背景（token `colorFillTertiary` 级）、`tabIndex=0` + Enter/Space 键盘可达（ui-design-tokens 可达性口径）；点击 → 打开 review 弹框（传 `entry.id`）。同日同时段多条堆叠时**各块独立可点**（裁定理解 1）。打印时 hover/focus 样式不输出（`gc-no-print` 既有机制不受影响）。
2. **空白格点击（添加入口）**：`rows` 非空时，**可见** entries 为空的单元格整格可点（裁定 Q14/Q16：被展示勾选隐藏的 entry 不可点，此时格视觉为空 → 按空白格处理，可添加）→ 打开添加弹框并预填。`rows` 为空（患者无任何血糖）→ 维持「暂无数据」空态，不可点。
3. **添加弹框预填（裁定 Q15/Q16）**：`GlucoseCreateModal` 加可选 prop `prefill?: { measuredAt: Dayjs; mealContext: string }`：
   - `measuredAt` = **该行日期 + 当前时刻的时分秒**（历史日期照此拼接，需求人明确裁定）；
   - `mealContext` = 该列 code，且置 `mealContextTouched = true`——预填时段**不被「按检测时间自动推荐」覆盖**，用户可改；
   - 不传 `prefill` 时行为与现状完全一致（列表页/详情页壳入口零变化）。
4. **新组件 `GlucoseReviewModal`**（review / edit 双模式）：
   - 打开时按 `recordId` 拉 GET 详情（loading 态；`41001`/`10008` → toast + 关闭 + 报表刷新）；
   - **review 模式**：`label：value` 行式展示 检测时间 / 检测时段（名称）/ 血糖值（数值 + 单位，按 `resultType` 字典色；非数值型显示字典 label）/ 试纸 / 记录者 / 入录方式（固定「手动入录」）/ 备注（空值 `-`）。按钮：**取消**、**编辑**（`glucose:update`）；
   - **edit 模式**：字段与添加弹框一致（无「入录方式」），数据回填；表单结构抽公共子组件 `GlucoseFormFields` 供两弹框复用（避免两份实现漂移，实现方决策）。按钮：**删除**（`glucose:delete`，`Modal.confirm`「确认作废该条血糖记录？作废后报表将不再展示」，裁定 Q2 文案）、**取消**、**保存**；
   - 保存成功 → `message.success('血糖记录已更新')`；作废成功 → `message.success('血糖记录已作废')`；均触发报表刷新并关闭。
5. **刷新机制**：`DetailOutletContext` 增加 `onGlucoseChanged: () => void`（壳 `index.tsx` 里 `setGlucoseVersion(v => v+1)`），弹框挂在 `GlucoseReportTab` 内、成功后调它——与壳上添加弹框共用同一版本号源，报表自动重拉（R24 查询条件、R22 勾选、R23 全屏态均不受影响）。
6. **异常呈现**：`41003` → 字段级挂 `measuredAt`；`10001` → 字段级（既有拦截器口径）；`10008`/`41001` → toast + 刷新；其余走 `applyErrorStrategy` 统一处理，页面不自弹 toast。

### 7. 错误码与前端行为 ⭐（裁定 Q6；先登记 `docs/ERROR-CODES.md`，再改 `codes.ts`）

| 场景 | 错误码 | HTTP | action | 前端行为 |
|---|---|---|---|---|
| 记录不存在 / 已作废 / 不属于该患者 | **`41001 GLUCOSE_RECORD_NOT_FOUND`（新登记）** | 404 | toast-refresh | toast + 报表刷新 |
| 编辑改检测时间撞另一条有效记录 | **`41003 GLUCOSE_MEASURED_AT_DUPLICATE`（新登记）** | 409 | field | 字段级挂 `measuredAt`（带 details） |
| 保存/作废时记录已被他人变更或作废 | `10008 CONCURRENT_CONFLICT`（既有） | 409 | toast-refresh | toast + 报表刷新 |
| 患者不存在 / 已归档 | `40001`（既有） | 404 | toast | 同 create 现状 |
| 患者非住院 | `40004`（既有） | 409 | toast | 同 create 现状 |
| 跨科室 | `30002`（既有） | 403 | toast | DENIED 审计 |
| 无权限点 / NONE 档 | `30004` / `30006`（既有） | 403 | toast | DENIED 审计 |
| 字段校验（范围/时段/记录者） | `10001`（既有） | 422 | field | 字段级 |
| 阈值配置缺失/非法 | `10000`（既有） | 500 | toast | 拒绝写入，同 create |

`41002`/`41006`/`41008` 预留状态不变（P3-5 复核功能未实现，本轮不碰）。

### 8. 测试要求

- [ ] 服务端单测：
  - update：阈值重判（0/1/2）、非检测类型清空值、时段未改豁免 / 改为停用拒绝、`41003`（先查命中 + P2002 兜底）、`10008`（已被作废）、changedFields 计算（含空数组）、越权 `30002`、非住院 `40004`、无权限点 `30004`
  - void：正常作废（voidedAt/voidedById 落库）、重复作废 `10008`、越权、`glucose:delete` 仅护士长/系管（医生 `30004`）
  - detail：正常回显、`41001`（不存在/已作废/患者不匹配）、`patient:view` 即可读
  - 读路径：报表行/统计/lastGlucose 均排除已作废；**作废后同 `measuredAt` 可新增**（部分唯一索引行为）；create 幂等回读不返回已作废记录
  - 审计：`GLUCOSE_UPDATE` detail 含 changedFields 且无 remark 明文；`GLUCOSE_VOID` detail 含 glucoseRecordId；GET 详情不产生审计行
- [ ] 前端单测：ReportCell entry 点击回调（多块独立）、空白格点击（含 Q16 隐藏后可点）、`prefill` 预填（Q15 拼接、时段不被推荐覆盖）、ReviewModal 双模式渲染 / 按钮权限显隐 / 删除确认文案、无权限用户 review 只读
- [ ] 手工验证：`dr.chen`（医生）→ 可编辑、**无删除按钮**；护士长 → 可作废；作废后单元格消失、统计栏变化、审计表出现 `GLUCOSE_VOID` 行；同时间补录成功

### 9. 非功能要求

| 项 | 要求 |
|---|---|
| 性能 | 部分唯一索引不劣于原约束；`voidedAt` 过滤走既有索引后判断，当前规模无需新索引 |
| 内网 | 无新依赖、无公网资源 |
| 等保 | 作废留痕（不物理删除）、审计 append-only 不变、越权 DENIED 落审计、留存 ≥180 天不受影响 |
| 兼容 | 大字号 / 暗色 / 打印（点击态不打印）/ 键盘可达 |

### 10. 验收标准 ⭐

- [ ] **schema 变更 + 部分唯一索引 SQL 人工评审通过并执行**（迁移 #16，`pnpm db:migrate` + 手工 SQL，记录进 `docs/DB-MIGRATION-NOTES.md`）
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] shared 改动走三步（build → sync:shared → 清 Vite 缓存）
- [ ] 三接口契约、错误码、审计行为符合本稿；越权被拒且落审计
- [ ] 前端按钮权限生效（医生无删除、设备管理员不可见报表）
- [ ] 文档回写：ROADMAP P3-4、ERROR-CODES.md（41001/41003）、glucose-report.md（R25 行）、glucose-domain.md 规则（作废口径 + 部分唯一索引）、AGENTS.md §4.5（唯一约束描述更新）

### 11. 裁定摘录与待确认项

**已裁定（2026-11-20）**：Q1a 软删除；Q2 `voidedAt+voidedById`、确认文案；Q3 三接口 + entry 加 id；Q4 详情不审计；Q5 审计只记字段名；Q6 `41001`/`41003`/`10008`；Q7 权限点拆两个；Q8 update 四角色、delete 仅护士长+系管；Q9 无权限只读 review；Q10 全字段可编辑、不加 updatedById；Q11 结果类型服务端重判；Q12 停用时段未改豁免；Q13 入录方式固定文案；Q14 无数据仅「暂无数据」、有数据行内空白格均可点；Q15 历史日期也拼当前时分秒；Q16 隐藏 entry 不可点、视觉空格可添加。

**待确认（评审时裁定）**：
1. **患者状态口径**：编辑/作废是否同 create 要求患者**住院中**（非住院 → `40004` 拒绝）？建议同 create（口径一致、边界简单）；若需「出院后仍可更正历史记录」请明确，将单独放开 PATCH/DELETE 的状态校验。
2. **`voidedById` 外键**：建议 `Restrict`（同 `operator` 留痕口径，需在 `User` 模型加反向关系）；备选无外键（同 `AuditLog.operatorId` 口径，少动 User 模型）。
3. **§2.1 唯一约束 → 部分唯一索引**：本稿最重要的评审项（AGENTS.md §4.5 契约变更）。若否决，软删除将出现「作废后同时间无法补录」的体验缺陷，需重新裁定 Q1。
4. **`41003` 前端行为**：字段级挂 `measuredAt`（本稿建议）而非 409 类惯用的 toast-refresh——确认。
5. **审计动作命名**：`GLUCOSE_VOID`（对应作废语义）而非 `GLUCOSE_DELETE`——确认。
