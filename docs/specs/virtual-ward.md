# 虚拟病区（加入 / 移出 / 当前与历史列表）

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 归档。状态：📝 **待评审**（2026-11-17 出稿，未动代码）
>
> ⚠️ 含 **schema 迁移**、**新增权限点**、**新增审计动作**、**新增错误码号段** 四类变更，
> 按 `AGENTS.md` §6.5 全部属"AI 不得自行决定"范围，**评审通过后才可实现**。

## 0. 元信息

| 项     | 内容                                                                                     |
| ------ | ---------------------------------------------------------------------------------------- |
| 阶段号 | P2-8 虚拟病区（`docs/ROADMAP.md`，当前 ⚠️ 部分完成）                                     |
| 模块   | 新增服务端 `ward`；前端改造 `pages/inpatient/virtual-ward` 与 `pages/inpatient/patients` |
| 优先级 | P1                                                                                       |
| 依赖   | 患者管理列表/卡片、数据权限 `scope.util.ts`、审计拦截器均已落地                          |
| 需求人 | 产品（2026-11-17 提出并逐条确认）                                                        |

## 0.1 决策记录（需求人 2026-11-17 确认）

| #   | 决策                                                                                  |
| --- | ------------------------------------------------------------------------------------- |
| 1a  | **单一全局虚拟病区**，非多个可命名病区                                                |
| 2a  | **沿用患者数据范围**：医生/护士/护士长只看本科室，系统管理员看全院；不跨科室          |
| 3a  | **新增 `ward:manage` 权限点**，授予 DOCTOR / NURSE / NURSE_HEAD / SYS_ADMIN           |
| 4a  | **仅住院患者**可加入                                                                  |
| 5   | 加入当天算 **1 天**（与 `formatHospitalDays` 口径一致）                               |
| 6a  | 历史 Tab 显示**加入→移出的实际天数**；列表**新增「移出时间」列**                      |
| 7a  | 重复进出**每次新建记录**，历史全留，不复用旧行                                        |
| 8   | 出院/归档自动移出——**本轮只定规则不实现**（见 §4-8）                                  |
| 9   | 虚拟病区页更多操作**只有那一项**，不要编辑/添加血糖/查看详情                          |
| 10  | ~~用 `Popconfirm`~~ → **改用 `Modal.confirm`**（2026-11-18 裁定，见 §11-1）；文案不变 |
| 11  | **新增** `AuditAction` 枚举值                                                         |
| 12a | 卡片变矮但**同一网格内仍等高**                                                        |
| 13  | 接受接口变更：`PatientListItem` 加 `inVirtualWard`                                    |
| 14  | 筛选条件**不增不减**                                                                  |
| 15  | 成功后**局部更新**，不整表重查                                                        |
| 16  | 模型名定为 **`VirtualWardRecord`**（§11-2）                                           |
| 17  | 归档患者**不排除**出虚拟病区列表，与患者管理口径一致（§11-3）                         |
| 18  | 历史 Tab **同时显示「加入时间」与「移出时间」两列**（§11-4）                          |
| 19  | 卡片模式**照患者管理实现滚动加载**，`useVirtualWardQuery` 补双路径逻辑（§11-5）       |

> 1~19 全部裁定完毕，本规格 **2026-11-18 评审通过**，无遗留待确认项。

## 1. 目标与用户故事

作为 **医护人员**，我要 **把特殊患者加入虚拟病区集中管理**，以便 **在独立视图里跟踪这批患者**。

**本次做**：① 患者管理住院 Tab 的更多操作加「加入虚拟病区」（未加入可点、已加入置灰）；
② 虚拟病区当前 Tab（卡片+列表）与历史 Tab（仅列表）；③ 血糖三项换成「加入虚拟病区天数」；
④ 服务端新表 + 3 接口 + 新权限点 + 2 审计动作 + 2 错误码。

**本次不做**：住院管理其他模块；患者管理更多操作的其他功能；多个可命名病区；跨科室查看；
出院/归档患者加入；出院/归档自动移出的**代码实现**；虚拟病区页的编辑/添加血糖/查看详情；
批量操作、导出、备注。

## 2. 数据模型变更

### 2.1 新增模型 `VirtualWardRecord`

一条记录 = **一次进出**。`leftAt IS NULL` = 当前在区，非空 = 已移出（历史）。
与既有 `PatientDeviceBinding`（`unboundAt IS NULL` = 当前绑定）是同一套"单条有效 + 保留历史"模式。

```prisma
/// 虚拟病区进出记录：一条 = 一次进出。leftAt 为空表示当前在区。
/// 决策 7a：重复进出每次新建记录，历史全部保留，不复用旧行。
model VirtualWardRecord {
  id          String    @id @default(uuid()) @db.Uuid
  patientId   String    @db.Uuid
  /// 加入时间，「加入虚拟病区天数」的计算起点
  joinedAt    DateTime  @default(now()) @db.Timestamptz(3)
  /// 移出时间；NULL = 当前仍在虚拟病区
  leftAt      DateTime? @db.Timestamptz(3)
  joinedById  String    @db.Uuid
  /// 移出操作人；leftAt 非空时必填（应用层保证，库层可空因在区行没有移出人）
  leftById    String?   @db.Uuid
  /// 移出方式，取值见 shared 的 WARD_LEAVE_REASON；在区时为 NULL
  leaveReason String?   @db.VarChar(16)
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime  @updatedAt @db.Timestamptz(3)

  patient  Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)
  /// Restrict：删用户不得抹掉操作人，医疗留痕优先（与 GlucoseRecord.operator 一致）
  joinedBy User    @relation("WardJoinedBy", fields: [joinedById], references: [id], onDelete: Restrict)
  leftBy   User?   @relation("WardLeftBy", fields: [leftById], references: [id], onDelete: Restrict)

  @@index([patientId, leftAt])   // 按患者取在区记录
  @@index([leftAt, joinedAt])    // 两个 Tab 的排序与日期区间
}
```

反向关系需同步补：`Patient.virtualWardRecords VirtualWardRecord[]`；
`User.wardJoinedRecords` 与 `User.wardLeftRecords`（分别对应两个命名关系）。

**删除语义**：`patient` 用 `Cascade`（进出记录无独立留存价值，审计行已单独留痕）；
操作人用 `Restrict`。与"删患者不得连带删审计"不冲突——`AuditLog.targetId` 不建外键。

### 2.2 「同一患者只能有一条在区记录」

Prisma **不支持部分唯一索引**，须用原生 SQL，沿用 `prisma/sql/binding_partial_unique.sql` 的做法。
新增 `apps/server/prisma/sql/ward_one_active.sql`：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS virtual_ward_record_one_active
    ON "VirtualWardRecord" ("patientId")
    WHERE "leftAt" IS NULL;
```

**执行时机**：`prisma migrate deploy` 之后**手工执行一次**（幂等）。本项目已禁用 `migrate dev`，
不要试图让 Prisma 生成这条索引。该索引是并发兜底：两人同时点「加入」时后到者撞 P2002，服务端映射为 `44001`。

### 2.3 `AuditAction` 新增两个值

在枚举**末尾**追加 `PATIENT_WARD_JOIN`、`PATIENT_WARD_REMOVE`（顺序即此）。

> ⚠️ **必须追加在末尾**。PostgreSQL 的 `ALTER TYPE ... ADD VALUE` 只能加到 `pg_enum` 末尾，
> 而 Prisma 的漂移检测**对枚举值顺序敏感**——本项目已因此踩过坑
> （见 `20261117000000_drop_residual_glucose_enums` 的注释与 `docs/DB-MIGRATION-NOTES.md` §2.3）。
> 插在中间会让 `migrate diff` 持续报漂移。

### 2.4 迁移

`apps/server/prisma/migrations/20261117100000_add_virtual_ward/migration.sql`：
① `CREATE TABLE "VirtualWardRecord"` + 三个外键 + 两个索引；
② `ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_WARD_JOIN';`
③ `ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_WARD_REMOVE';`

枚举加值写法照抄 `20261026100000_add_patient_update_audit/migration.sql`（PG 16 下可在事务内执行，
但同一事务内不得使用新值——本迁移不插数据，无此问题）。**存量数据**：新表，无回填。

### 2.5 共享契约变更（`packages/shared`）

| 变更                                                                                      | 位置                  |
| ----------------------------------------------------------------------------------------- | --------------------- |
| `PERMISSION.WARD_MANAGE = 'ward:manage'`（权限点 **22 → 23**）                            | `dict/roles.ts`       |
| `ROLE_PERMISSIONS` 四个角色加 `WARD_MANAGE`                                               | `dict/roles.ts`       |
| `WARD_LEAVE_REASON`：`MANUAL` / `DISCHARGE` / `ARCHIVE`                                   | 新增 `dict/ward.ts`   |
| `PatientListItem.inVirtualWard: boolean`（**必填**）                                      | `patient/schema.ts`   |
| `VirtualWardListItem`、`wardListQuerySchema`                                              | 新增 `ward/schema.ts` |
| `ERROR_CODES.WARD_ALREADY_JOINED = 44001`、`WARD_NOT_JOINED = 44002`（新开 `44xxx` 号段） | `error/codes.ts`      |

改共享包后必须走 `.codebuddy/rules/shared-package.md` 三步（构建 → 服务端 → 前端）。

## 3. 接口契约

新增 `apps/server/src/modules/ward/`（module / controller / service）。路由前缀 `/ward`，
与前端路由 `/inpatient/ward`、权限点 `ward:*` 命名一致。

| #   | 方法   | 路径                 | 权限点        | 数据范围           | 审计                  |
| --- | ------ | -------------------- | ------------- | ------------------ | --------------------- |
| 1   | GET    | `/ward/patients`     | `ward:view`   | `RESOURCE.PATIENT` | —                     |
| 2   | POST   | `/ward/patients/:id` | `ward:manage` | `RESOURCE.PATIENT` | `PATIENT_WARD_JOIN`   |
| 3   | DELETE | `/ward/patients/:id` | `ward:manage` | `RESOURCE.PATIENT` | `PATIENT_WARD_REMOVE` |

> **路径参数必须叫 `:id`**（实现期修正，原稿写的是 `:patientId`）：
> `AuditLogInterceptor` 只从 `params.id` 取审计对象 ID（`audit-log.interceptor.ts:137`），
> 叫别的名字会让 `targetId` 恒为空——**包括越权 DENIED 行**，事后无法按患者追溯越权尝试。
> `targetIdFrom` 也救不了：它只在成功路径生效（失败时 payload 为 null）。

**不新增 `RESOURCE`**：决策 2a 沿用患者数据范围，过滤落在**患者的科室**上
（列表 `where.patient = scope`，单行 `assertInScope(user, PATIENT, patient)`）。
`NONE` 档角色（设备管理员）自动被拒 `30006`，无需额外代码，`scope.util.ts` 一字不改。

### 3.1 GET `/ward/patients`

```ts
{
  tab: 'CURRENT' | 'HISTORY';             // 必填
  departmentId?: string; doctorId?: string;   // uuid
  patientNo?: string; name?: string; bedNo?: string;  // ≤32；name 为确定性密文**等值**匹配
  joinFrom?: string; joinTo?: string;     // 仅 CURRENT 生效，YYYY-MM-DD HH:mm:ss
  leaveFrom?: string; leaveTo?: string;   // 仅 HISTORY 生效
  page?: number;                          // 默认 1
  pageSize?: number;                      // 默认 20，≤100
}
```

与现有 `useVirtualWardQuery.buildParams` 已实现的参数**逐字段对齐**，前端参数构建逻辑无需改造。
跨 Tab 多传的日期字段按 strip 丢弃。

| Tab       | 主条件                  | 日期条件                        | 排序                    |
| --------- | ----------------------- | ------------------------------- | ----------------------- |
| `CURRENT` | `leftAt: null`          | `joinedAt` ∈ [joinFrom, joinTo] | `joinedAt desc, id asc` |
| `HISTORY` | `leftAt: { not: null }` | `leftAt` ∈ [leaveFrom, leaveTo] | `leftAt desc, id asc`   |

两个 Tab 都叠加 `patient: { ...buildScopeWhere(user, PATIENT), departmentId?, doctorId?, patientNo?, nameCipher?, bedNo? }`。
追加 `id asc` 保证分页顺序稳定（同 `patient.service.ts:268`）。响应 `page(items, total, page, pageSize)`。

### 3.2 POST / DELETE

无请求体，路径参数 `{ id: uuid }`——直接复用患者域的 `patientIdSchema`，不另建 schema。响应：

```ts
// POST
{
  patientId: string;
  wardRecordId: string;
  joinedAt: string;
  item: PatientListItem;
}
// DELETE
{
  patientId: string;
  wardRecordId: string;
  leftAt: string;
  leaveReason: 'MANUAL';
}
```

`item` 是更新后的患者列表项（`inVirtualWard` 已翻转），供前端**局部更新**（决策 15），
与 `admitPatient` 返回 `PatientAdmitResult.item` 一致。
审计：`targetType='PATIENT'`、`targetId` 取自 URL `:id`（不需 `targetIdFrom`）；
`detail` 记 `{ patientId, wardRecordId }`（移除另记 `leaveReason`）。

> **实现期修正**：原稿写的是 `detail` 记 `patientNo`，**已删除**。
> `AUDIT_DETAIL_ALLOW_LIST` 的存在目的就是"防止把患者敏感数据写进日志"，`patientNo` 从未在白名单里
> （连 `POST /patients` 建档都不记它），`targetId` 已能唯一定位患者。
> 改为把 `wardRecordId` 与 `leaveReason` 两个**非敏感**字段加入白名单（UUID + 枚举码，
> 与既有的 `deviceId` / `fromStatus` / `toStatus` 同类）。
> 加这两个字段是必要的：同一患者可多次进出，只靠 `targetId + action` 无法定位是哪一次。
> ⚠️ 这属 `AGENTS.md` §6.5 的审计逻辑改动，**需人工评审**。

### 3.3 `VirtualWardListItem`

```ts
export interface VirtualWardListItem extends PatientListItem {
  wardRecordId: string;
  wardJoinedAt: string; // YYYY-MM-DD HH:mm:ss
  wardLeftAt: string | null; // CURRENT Tab 恒为 null
  wardLeaveReason: string | null;
}
```

**天数由前端计算**，不下发——与「住院天数」现有做法一致（`formatHospitalDays` 在前端算）。
理由：跨零点后无需重新请求即自动 +1，且避免服务端与前端两套口径。

### 3.4 患者列表接口的连带变更

`PATIENT_PUBLIC_SELECT`（`patient.service.ts:63`）增加
`virtualWardRecords: { where: { leftAt: null }, take: 1, select: { id: true } }`；
`toListItem` 增加 `inVirtualWard: row.virtualWardRecords.length > 0`。

影响面：**所有走 `toListItem` 的出参**——住院/出院列表、详情、编辑结果、办理住院结果、添加血糖结果，
共 5 处。单点改动，但需回归这 5 处的前端类型。

## 4. 业务规则与校验

1. **加入前置**：患者存在且未归档（否则 `40001`）；`status = INPATIENT`（否则 `40004`，决策 4a）；
   数据权限通过（否则 `30002` 跨科室 / `30006` 无患者数据权）。
2. **加入幂等**：已存在在区记录 → `44001`；并发撞部分唯一索引（P2002）同样映射 `44001`。
3. **重新加入**（历史 Tab）：走**同一个** POST，**新建记录**（决策 7a），旧历史行原样保留。
   故同一患者可有多条历史 + 至多一条在区。
4. **移出前置**：患者存在且未归档（`40001`）；数据权限通过；存在在区记录（否则 `44002`）。
   **不校验患者状态**——出院患者也应能被移出，这正是决策 8 自动移出复用的同一条路径。
5. **移出写入**：`leftAt = now()`、`leftById = user.userId`、`leaveReason = 'MANUAL'`。
6. **天数口径**（决策 5/6a）：加入当天算 1 天，与 `formatHospitalDays` 完全一致：
   ```ts
   const end = leftAt ? dayjs(leftAt) : dayjs();
   const days = end.startOf('day').diff(dayjs(joinedAt).startOf('day'), 'day') + 1;
   return `${Math.max(days, 1)} 天`;
   ```
   历史 Tab 以 `leftAt` 为终点（显示"曾在区多久"，不是"至今"）。
7. **列表口径与患者管理一致**：不加 `archivedAt`、不加 `status` 过滤（`patient.service.ts:list()` 也没有）。
   依据决策 4「展示与患者管理一样」。若将来患者管理开始排除归档患者，本列表须同步。
8. **决策 8 的规则**：患者转出院或归档时应自动移出——
   写 `leftAt = now()`、`leaveReason = 'DISCHARGE' | 'ARCHIVE'`、`leftById = 触发者`。
   自动移出走 service 内部方法，**不做归档校验**（归档本身就是触发原因）。
   ✅ **`DISCHARGE` 已于 2026-11-26 接入**（P2-6 患者出院，`docs/specs/patient-discharge.md` §4 规则 4）：
   `POST /patients/:id/discharge` 事务内 `updateMany({id, leftAt: null})` 原子关闭在区记录，
   并发下他人已先移出（count=0）不阻断出院；出院结果返回 `wardRecordId`/`leaveReason` 供审计追溯。
   ⚠️ `ARCHIVE` 仍为**预留值**：归档功能未落地（归档靠 `archivedAt`，只能由 seed 产生），
   实现归档功能时**必须接上**，否则「当前虚拟病区」会累积已归档患者。

## 5. 权限与数据安全

| 项             | 内容                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| 功能权限       | 列表 `WARD_VIEW`；加入/移出 `WARD_MANAGE`                                                                        |
| 权限分配（3a） | `WARD_MANAGE` → **DOCTOR / NURSE / NURSE_HEAD / SYS_ADMIN**，与现有 `WARD_VIEW` 完全同一批（设备管理员两者都无） |
| 数据范围（2a） | `@RequireDataScope(RESOURCE.PATIENT)`。**不新增 RESOURCE、不改 `ROLE_DATA_SCOPE`、不改 `scope.util.ts`**         |
| 脱敏           | 列表只出 `nameMasked`，复用 `PATIENT_PUBLIC_SELECT`——`*Cipher` 列永不进 select                                   |
| 加密           | 无新增。姓名筛选沿用 `encryptDeterministic` 等值匹配（不支持模糊，前端已标「姓名（精确）」）                     |
| 审计           | 两个新动作，`targetType='PATIENT'`、`targetId=patientId`；越权（`3xxxx`）由拦截器自动记 `DENIED`                 |
| 列表是否记审计 | **不记**，与 `GET /patients/inpatient` 一致；虚拟病区列表不含明文，非敏感查询                                    |

### 5.1 权限点新增的连带影响

`PERMISSION` 22 → 23 项。`SYS_ADMIN` 的"含全部权限点"不变式要求**必须同步把 `WARD_MANAGE` 加进
`ROLE_PERMISSIONS.SYS_ADMIN`**。两处文档写了具体数字，需一并改：
`docs/ARCHITECTURE.md:49`、`AGENTS.md:142`（均「全部 22 个权限点」→ 23）。

已核实**无单测断言权限点数量**（`roles` 无 spec 文件），不会因数字变化而红；
但 `apps/web/src/routes/routes.spec.tsx` 断言了菜单结构与权限点，需复核仍绿。

## 6. 前端交互

### 6.1 患者管理页

`PatientMoreActions.tsx`：

- `ward` 项 label 按 `patient.inVirtualWard` 切换：`false` →「加入虚拟病区」可点；
  `true` →「**已加入虚拟病区**」且 `disabled: true`（决策 2：置灰**不隐藏**）
- 无 `ward:manage` 权限时**整项不展示**（与 `edit`/`glucose` 现有处理一致）
- 点击 → 确认框 → POST → `message.success('已加入虚拟病区')` → 用返回 `item` 走 `query.patchItem` 局部更新

⚠️ 确认框形式与决策 10 有技术冲突，见 §11-1。

`PatientTable.tsx` / `PatientCardGrid.tsx` 参数化以供复用：

```ts
/** 虚拟病区模式：隐藏血糖三项、改显示加入天数；不传即患者管理模式 */
wardTab?: 'CURRENT' | 'HISTORY';
/** 覆盖操作列/卡片菜单渲染（虚拟病区页用单菜单） */
renderActions?: (record: PatientListItem) => ReactNode;
```

`wardTab` 有值时：

- 表格去掉「最近血糖」「测量时段」「测量时间」三列，在「住院天数」后插入「**加入虚拟病区天数**」（决策 5b）
- 卡片去掉血糖时间行与血糖值/时段行，替换为一行「**加入虚拟病区天数：N 天**」（决策 5a）
- `HISTORY` 额外显示「**移出时间**」列（决策 6）
- 卡片高度（决策 12a）：内容变少后整体变矮，但**同一网格内仍等高**——保留现有
  `height: '100%'` + grid `alignContent: 'start'`，不做逐卡自适应
- 其余基本信息（床号/姓名/性别/年龄/住院号/住院天数/科室/责任医生）**完全一致**，直接复用

### 6.2 虚拟病区页

- `VirtualWardToolbar`：保持当前/历史两个 Tab
- 视图切换：仅 `tab === 'CURRENT'` 渲染「卡片/列表」`Tabs`（决策 4：历史只有列表）；切到 HISTORY 强制列表
- `VirtualWardFilter`：**不增不减**（决策 14）
- 列表区：`CURRENT && viewMode === 'CARD'` → `PatientCardGrid`（滚动加载）；否则 → `PatientTable`（分页）
- 新增 `WardMoreActions.tsx`：`Dropdown`「更多操作」，**只有一个菜单项**（决策 9）
  - CURRENT →「移除虚拟病区」，文案 `确认将 {nameMasked} 移出虚拟病区？`
  - HISTORY →「加入虚拟病区」，文案 `确认将 {nameMasked} 加入虚拟病区？`
  - 无 `ward:manage` 权限时不渲染（操作列留空）

`useVirtualWardQuery.ts` 需补齐（当前只有 `result: { total }` 的桩）：
`viewMode`/`changeViewMode`/`isCardMode`；列表分页 `page`/`pageSize`/`changePage`/`result.items`；
卡片滚动加载 `cardItems`/`cardLoading`/`cardHasMore`/`loadMore`/`retryCards`；
局部更新 `removeItem(patientId)`（移除成功后删行并 `total - 1`；历史 Tab 加入成功后同样删行，该患者已回到当前 Tab）；
`runQuery` 里替换掉 `TODO`（`useVirtualWardQuery.ts:134`）真正提交 `buildParams`。
参照 `usePatientQuery.ts` 的双路径实现，含 StrictMode 下的 `initializedRef` 守卫。

### 6.3 新增 API 层

`apps/web/src/api/ward.ts`：`fetchWardPatients(tab, params)` / `joinWard(patientId)` / `leaveWard(patientId)`。

## 7. 错误码与前端行为

新开 `44xxx` 号段，需**先登记 `docs/ERROR-CODES.md` 再改 `codes.ts`**（该文件头部注释的硬约束）。

| 场景                                       | 码      | HTTP | action        |
| ------------------------------------------ | ------- | ---- | ------------- |
| 必填/格式不合法                            | `10001` | 422  | field         |
| 缺 `ward:view` / `ward:manage`             | `30004` | 403  | toast         |
| 跨科室操作患者                             | `30002` | 403  | toast         |
| `NONE` 档（设备管理员）                    | `30006` | 403  | toast         |
| 患者不存在或已归档                         | `40001` | 404  | toast         |
| 非住院患者调用加入                         | `40004` | 409  | toast-refresh |
| **患者已在虚拟病区**「该患者已在虚拟病区」 | `44001` | 409  | toast-refresh |
| **患者不在虚拟病区**「该患者不在虚拟病区」 | `44002` | 409  | toast-refresh |

`44001`/`44002` 正常流程不触发（前端已置灰/已过滤），只在**并发**或**页面数据过期**时出现，
故用 `toast-refresh` 而非 `toast`——让用户立刻看到最新状态。

## 8. 测试要求

- [ ] `ward.service.spec.ts`（只 mock `PrismaService`，参照 `patient.service.spec.ts` 风格）
  - 加入：成功；不存在 → `40001`；已归档 → `40001`；非住院 → `40004`；已在区 → `44001`；
    P2002 → `44001`；跨科室 → `30002`；`NONE` 档 → `30006`
  - 移出：成功（写 `leftAt`/`leftById`/`leaveReason`）；不在区 → `44002`；**出院患者仍可移出**；已归档 → `40001`
  - 重新加入：**新建记录而非复用旧行**，历史行数 +1
  - 列表：CURRENT 只返回 `leftAt IS NULL`；HISTORY 只返回非空；日期区间按 Tab 各自生效；
    `DEPARTMENT` 档 where 含 `patient.departmentId`、`ALL` 档不含；排序含 `id asc` 兜底
- [ ] `patient.service.spec.ts` 回归：`toListItem` 新增 `inVirtualWard`，5 处出参全部带上
- [ ] `formatWardDays` 单测：当天 = 1 天；跨 1 天 = 2 天；历史行按 `leftAt` 收尾；`joinedAt` 晚于今天（脏数据）= 1 天
- [ ] `routes.spec.tsx` 复核仍绿
- [ ] 手工验证（密码 `Gc@2026pass`）：
  - `sys.admin`：加入 → 菜单变「已加入虚拟病区」置灰 → 当前 Tab 出现该患者、天数「1 天」
  - `sys.admin`：移除 → 当前 Tab 该行消失、`total - 1` → 历史 Tab 出现该行，天数与移出时间正确
  - `sys.admin`：历史 Tab 重新加入 → 该行从历史消失、当前 Tab 出现，且**历史里仍保留上一条记录**
  - `dr.wang`（内分泌科医生）：可加入本科室患者；虚拟病区列表只见内分泌科
  - `dr.chen`（心内科医生）：列表看不到内分泌科患者；直接调 POST 加内分泌患者 → `30002` 且落 `DENIED` 审计
- [ ] 审计核对：`prisma.auditLog.groupBy()` 确认两个新动作落库、`targetId` 非空、`detail.wardRecordId` 正确

## 9. 非功能要求

| 项   | 要求                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 性能 | `@@index([patientId, leftAt])` 支撑 `inVirtualWard` 子查询（每行一次、`take: 1`）；`@@index([leftAt, joinedAt])` 支撑两个 Tab 的排序与区间筛选。1000 患者规模下列表 < 1s |
| 内网 | 不引入新依赖，不引用公网资源                                                                                                                                             |
| 等保 | 加入/移出全部落审计（含越权 `DENIED`）；列表只出脱敏值；操作人 `Restrict` 不可删                                                                                         |
| 兼容 | 复用患者管理组件，大字号、打印（`gc-no-print`）、明暗模式自动继承                                                                                                        |

## 10. 验收标准

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] `prisma migrate deploy` 无漂移（`migrate diff` 为空），`ward_one_active.sql` 已手工执行
- [ ] 三个接口符合契约，错误码符合 §7
- [ ] 越权被拒并落 `DENIED` 审计
- [ ] 菜单项置灰、两个 Tab 的展示模式、天数口径符合 §6
- [ ] 文档更新：`ROADMAP.md` P2-8 → ✅；`ERROR-CODES.md` 登记 `44xxx`；
      `ARCHITECTURE.md` §3/§4 补权限点数与新模型；`AGENTS.md` §5.1 补权限点数；
      `PERMISSION-DESIGN.md` 补 `ward:manage`
- [ ] `useVirtualWardQuery.ts:134` 的 `TODO` 消除（全仓当前唯一的真实待办注释）

## 11. 待确认项（**已全部裁定，2026-11-18**）

**1. ⚠️ 决策 10（用 `Popconfirm`）与"菜单项在 Dropdown 里"技术冲突——需裁定**

`Popconfirm` 需要**持续存在的锚点元素**，而 antd `Dropdown` 的菜单项被点击后菜单立即关闭、锚点随之卸载，
`Popconfirm` 无法正常弹出。现有代码里 `Popconfirm` 用得通的地方（`PatientTable.tsx:115` 的「办理住院」）
都是**直接挂在操作列按钮上、不在 Dropdown 内**。

| 方案                                        | 说明                                                    | 代价                                                                                         |
| ------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **(A) 改用 `Modal.confirm`**（推荐）        | 菜单项点击后调命令式 API 弹居中确认框，可取消           | 与决策 10 字面不符，但交互等价（都是"确认弹框、可取消、可确认"），且是 Dropdown 内的标准做法 |
| (B) 保留 `Popconfirm`，锚定「更多操作」按钮 | 菜单项点击后不关菜单，在按钮位置弹气泡                  | 需手动控制 Dropdown `open`，菜单与气泡同时悬浮，视觉杂乱且易出定位 bug                       |
| (C) 虚拟病区页去掉 Dropdown                 | 该页只有一项（决策 9），直接做操作列按钮 + `Popconfirm` | 与需求原文"点击更多操作展示的功能有…"不符；且患者管理页仍在 Dropdown 内，两处交互不一致      |

✅ **裁定：方案 (A)**。两页统一用 `Modal.confirm`，文案照决策 10 不变。
理由：`Popconfirm` 的锚点会随 Dropdown 菜单关闭而卸载，在菜单项内无法可靠弹出；
`Modal.confirm` 是命令式 API、不依赖锚点，交互等价（确认弹框、可取消、可确认）。

**2. 模型命名**

`VirtualWardRecord` 与 `PatientDeviceBinding` 是同模式（单条有效 + 保留历史）。
备选：`PatientWardBinding`（更贴既有命名，但"binding"用于病区语义别扭）、
`PatientVirtualWardRecord`（最明确但过长）。✅ **裁定：维持 `VirtualWardRecord`**。

**3. 归档患者是否排除出虚拟病区列表**

§4-7 定的是"与患者管理一致，不排除"。但归档患者按项目既有约定是"按不存在处理"（`40001`），
出现在列表里可能让人困惑。若要排除，需加 `patient.archivedAt: null`——**但这会与患者管理列表口径不一致**，
两处得一起改。✅ **裁定：不排除**，维持与患者管理一致的口径，等患者管理统一处理归档时再一起动。

**4. 历史 Tab 是否需要「加入虚拟病区天数」以外的时间列**

决策 6 已定新增「移出时间」列。是否还要「加入时间」列？历史行有两个时间点，
只显示移出时间的话，用户看不出这次进出跨越了多久（虽然天数列已隐含）。建议**同时显示加入时间**，
列宽足够（`scroll={{ x: 1400 }}` 可上调）。✅ **裁定：同时显示「加入时间」与「移出时间」两列**，`scroll.x` 相应上调。

**5. 卡片模式下的滚动加载是否必须**

决策 4 要求当前 Tab 有卡片模式，而 `PatientCardGrid` 是为**滚动加载**设计的（`hasMore`/`onLoadMore`）。
若虚拟病区数据量小（预期远小于 1000），也可让卡片模式走分页。但那样要改 `PatientCardGrid`，
反而增加复杂度。✅ **裁定：照患者管理实现滚动加载**，`useVirtualWardQuery` 补双路径逻辑。
