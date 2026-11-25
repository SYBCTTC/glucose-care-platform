# 患者控糖目标（Patient Glucose Target）功能规格

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 填写。2026-11-25 需求人经 **6 轮 25 项裁定（A–Y）** 落定后成文，裁定全文见 §13。
>
> **交付状态（2026-11-25）**：四个原子任务 ①②③④ **全部完成**，提交号与验证证据见 §12「实施记录」。
> ⚠️ ④ 改变了**进病历的 `resultType` 判定口径**，跨期统计不可比，上线前须告知医护 —— 详见 §13「口径变更日期」。
> 剩余开口项只有 §11 待确认项 1（预警值能否清空）与 3（`diabetesType`/`hba1c`/`remark` 无展示位），均待需求人决定，不阻塞本需求关闭。
> 相关规范：`AGENTS.md`（§4 血糖口径、§5 安全审计、§6.5 AI 禁改清单）、`docs/ERROR-CODES.md`、`docs/PERMISSION-DESIGN.md`、
> `docs/UI-DESIGN-TOKENS.md`、`docs/COMMON-DATA.md`、`docs/DB-MIGRATION-NOTES.md`、
> `.codebuddy/rules/glucose-domain.md`、`.codebuddy/rules/security-and-audit.md`、`.codebuddy/rules/shared-package.md`。

## 0. 元信息

| 项     | 内容                                                                                                                                                                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阶段号 | 患者详情 —「基本信息」Tab 改造为「控糖目标」（原 Tab 为空占位页，无 ROADMAP 阶段号）                                                                                                                                                                                                                                              |
| 模块   | patient / glucose                                                                                                                                                                                                                                                                                                                 |
| 优先级 | P1                                                                                                                                                                                                                                                                                                                                |
| 依赖   | `TimeSlot`（时段动态数据 + `valueDown/valueUp` 默认阈值）、`SystemConfig`（全局告警阈值，④ 后降级为回退源 + 建档快照来源）、`SystemConfigService.getGlucoseAlertThreshold`、`GlucoseService.resolveResultType`、患者详情 Tab 框架                                                                                                 |
| 被依赖 | ④ 完成后新增：`GlucoseService` 的 `create` / `update` / `trend` 三条路径均依赖本规格的 `PatientGlucoseTargetService.resolveResultTypeThreshold`（R4/R5）与 `resolveAlertThreshold`（R8）。`GlucoseModule` 因此 import `PatientGlucoseTargetModule`（单向依赖，无循环）；`GlucoseService` 已**不再**直接注入 `SystemConfigService` |
| 需求人 | （2026-11-25 对话裁定，6 轮 A–Y）                                                                                                                                                                                                                                                                                                 |

## 1. 目标与用户故事

作为 **医生 / 护士 / 护士长 / 系统管理员**，我要 **在患者详情页查看并修改该患者的控糖目标（各时段血糖上下限 + 低/高血糖预警值）**，以便 **按患者个体情况管理控糖目标，并让新录入的血糖按该患者自己的目标判定偏低/正常/偏高**。

本次范围（做）：

- 患者详情 Tab「基本信息」→ **「控糖目标」**，路由 key `basic` → `target`（裁定 M），替换空占位页 `DetailPlaceholder`。
- 新增两张表：`PatientGlucoseTarget`（时段目标，一时段一行，裁定 D）、`PatientAlertThreshold`（患者级预警阈值，一患者一行，裁定 F）。
- 新增接口 `GET /patients/:id/glucose-targets` 与批量写接口 `PATCH /patients/:id/glucose-targets`（裁定 N）。
- 展示区 + 编辑弹框（裁定 R/S，布局见 §6）。
- 建档时快照初始化 + 存量患者两段式回填脚本（裁定 G/T）。
- `resultType` 判定阈值来源迁移：命中展示集合的时段改读**患者时段目标**（裁定 E）；PATCH 编辑仅在判定输入变更时重算（裁定 I）。
- 趋势图阈值线改读**患者级预警值**，缺失回退全局（裁定 Y）。
- 新增权限点 `patient:target:update` 与审计动作 `PATIENT_TARGET_UPDATE` / `PATIENT_TARGET_VIEW`（裁定 H/L；GET 留痕为 2026-11-25 复核修订，见 §5.2）。

本次不做（明确排除）：

- **预警触发逻辑**（低/高血糖预警的实际产生、推送、通知）——本次仅定义并存储参数（裁定 O，需求原文明确「后续实现」）。
- 历史 `resultType` 重算（裁定 C：不重算，仅影响新录入）。
- 患者详情「血糖数据」「出入院记录」两个 Tab（需求原文明确「不做」）。
- 详情页顶部患者摘要区 `PatientBasicInfo.tsx`（姓名/性别/年龄/科室/责任医生 + 添加血糖按钮）——**不动**。
- 强化时段（`INTENSIVE_AM/PM/NIGHT`）与特殊时段（`RANDOM`/`RETEST`）的控糖目标（裁定 A：不展示、不参与判定）。
- `Patient.diabetesType` / `hba1c` / `remark` 的展示位（既有缺陷，见 §11 待确认项 3）。

## 2. 数据模型变更

| 模型                    | 变更                                                    | 说明                                                                                                               | 是否需迁移 |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| `PatientGlucoseTarget`  | **新表**                                                | 患者时段控糖目标，一时段一行（裁定 D）                                                                             | 是         |
| `PatientAlertThreshold` | **新表**                                                | 患者级低/高血糖预警阈值，一患者一行（裁定 F）                                                                      | 是         |
| `Patient`               | 加 2 个反向关系字段                                     | `glucoseTargets` / `alertThreshold`，仅关系导航，无新列                                                            | 否         |
| `AuditAction`（枚举）   | 末尾追加 `PATIENT_TARGET_UPDATE`、`PATIENT_TARGET_VIEW` | ⚠️ PG `ALTER TYPE ADD VALUE` 只能加末尾（`DB-MIGRATION-NOTES.md` §2.3）；`VIEW` 为 2026-11-25 复核新增，走独立迁移 | 是         |
| `TimeSlot`              | **无变更**                                              | 仅作为默认值来源被读取（裁定 G 快照语义）                                                                          | 否         |
| `SystemConfig`          | **无变更**                                              | 两个阈值 key 保留（裁定 B）；但 `seed.ts` 需补写这两行（裁定 X）                                                   | 否         |

### 2.1 `PatientGlucoseTarget`

```prisma
/// 患者控糖目标（一时段一行，裁定 D）。
/// 默认值于建档时**快照**自 TimeSlot.valueDown/valueUp（裁定 G）：管理员后续改 TimeSlot 默认
/// **不影响存量患者**；单个患者要跟随新默认值，走编辑弹框「恢复默认」按钮（裁定 S）。
/// 缺行 = 「未设置」（裁定 K），resultType 判定回退全局 SystemConfig 阈值（裁定 E）。
/// 编辑时清空上下限 = **删除该行**（裁定 V），不保留 valueDown/valueUp 为 null 的空壳行，故两列均 NOT NULL。
model PatientGlucoseTarget {
  id        String @id @default(uuid()) @db.Uuid
  patientId String @db.Uuid
  /// 时段码，取值同 TimeSlot.code（落库契约，改名不改码）
  timeSlotCode String @db.VarChar(32)
  /// 目标下限 mmol/L，0.6~33.3，1 位小数（裁定 J）
  valueDown Decimal @db.Decimal(4, 1)
  /// 目标上限 mmol/L，0.6~33.3，1 位小数，必须 > valueDown（裁定 J）
  valueUp   Decimal @db.Decimal(4, 1)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  /// 随患者删除（同 GlucoseRecord / Admission 口径）；审计行不连带删（append-only，AGENTS.md §5.3）
  patient Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)

  @@unique([patientId, timeSlotCode])
}
```

> **不设 `TimeSlot` 外键**：`timeSlotCode` 是字符串契约而非 id 引用，与 `GlucoseRecord.mealContext` 同口径。
> 好处是时段被停用/删除时历史目标行仍可读出并用于历史判定（裁定 K「停用时段目标行保留不删」）。

### 2.2 `PatientAlertThreshold`

```prisma
/// 患者级血糖预警阈值（一患者一行，裁定 F）。
/// 默认值于建档时**快照**自 SystemConfig 的 glucose.low_threshold / glucose.high_threshold（裁定 B/G）。
/// 全局 SystemConfig 两个 key **保留**，降级为「新患者初始值来源 + 无患者级配置时的回退」（裁定 B/E/Y）。
/// ⚠️ 本次用途：存储 + 展示 + 编辑 + **趋势图阈值线**（裁定 Y）。
///    预警触发逻辑（低于 lowThreshold 触发低血糖预警等）**本次不实现**（裁定 O）。
///    resultType 判定**不读本表**（裁定 E：判定只读时段目标，缺失回退全局）。
model PatientAlertThreshold {
  id        String @id @default(uuid()) @db.Uuid
  patientId String @unique @db.Uuid
  /// 低血糖预警阈值 mmol/L，0.6~33.3，1 位小数（裁定 J）
  lowThreshold Decimal @db.Decimal(4, 1)
  /// 高血糖预警阈值 mmol/L，必须 > lowThreshold（裁定 J）
  highThreshold Decimal @db.Decimal(4, 1)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  patient Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)
}
```

### 2.3 迁移 SQL 要点

- 建表范式对齐 `20261120000000_add_admission_records`：`"id" UUID NOT NULL`（**无 DB 默认值**，UUID 由 Prisma Client 应用层生成）、`DECIMAL(4,1)`（无空格）、`createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`、`updatedAt TIMESTAMP(3) NOT NULL`。
- 外键：`ON DELETE CASCADE ON UPDATE CASCADE`。
- 索引：`PatientGlucoseTarget_patientId_timeSlotCode_key`（唯一）、`PatientAlertThreshold_patientId_key`（唯一）。
- 枚举：`ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_TARGET_UPDATE';`，追加在 `GLUCOSE_PRINT` 之后。
- 枚举（**独立迁移** `20261125120000_add_patient_target_view_audit`）：`ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_TARGET_VIEW';`，追加在 `PATIENT_TARGET_UPDATE` 之后。2026-11-25 复核裁定新增，理由见 §5.2；两个迁移均不插入审计数据，不受「同一事务内不得使用新枚举值」限制。
- **建表迁移内不做存量回填**（与 Admission 先例不同）：按裁定 T 走独立两段式脚本，理由见 §12 任务 ②。

## 3. 接口契约

### 3.1 `GET /patients/:id/glucose-targets`

权限 `patient:view`；数据范围 `RESOURCE.PATIENT`；审计 **`PATIENT_TARGET_VIEW`**（逐次留痕）。

> ⚠️ **2026-11-25 需求人复核裁定，推翻原裁定 L**：原稿为「GET 不单独留审计，由打开详情页的 `PATIENT_VIEW` 兼顶」。
> 实施后发现该口径与既有惯例冲突——`patient.controller.ts` 的**全部单患者 GET 都留痕**
> （`PATIENT_VIEW` / `ADMISSION_QUERY` / `PATIENT_NAME_PLAIN_VIEW`），只让控糖目标 GET 不留痕会导致
> 越权「查看」在审计表筛不出（越权「编辑」却有 `PATIENT_TARGET_UPDATE` 行），等保三级下敏感数据的越权尝试应可追溯。
> 已改为留痕，代价是正常查看也逐条写入（与 `PATIENT_VIEW` 同量级，321 行/日级别可接受）。详见 §5.2。

```ts
interface PatientGlucoseTargetsResponse {
  /**
   * 展示集合（裁定 U）：TimeSlot 中满足 `enabled && type === 1(普通) && valueDown != null && valueUp != null`，
   * 按 sortOrder 升序。当前命中 8 个（空腹/早餐前后/午餐前后/晚餐前后/睡前）。
   * ⚠️ 动态跟随库数据，禁止硬编码 code 白名单或按 name 匹配（AGENTS.md §4.4）。
   */
  targets: Array<{
    timeSlotCode: string;
    /** 时段名称，取 TimeSlot.name（动态数据，前端禁止硬编码 label） */
    timeSlotName: string;
    /** 患者已配置的目标；null = 该时段缺行 =「未设置」（裁定 K） */
    valueDown: number | null;
    valueUp: number | null;
    /** TimeSlot 当前默认值，供编辑弹框「恢复默认」按钮使用（裁定 S） */
    defaultValueDown: number;
    defaultValueUp: number;
  }>;
  alert: {
    /** 患者级预警值；null = 该行不存在（裁定 Q 初始化失败 / 尚未回填） */
    lowThreshold: number | null;
    highThreshold: number | null;
    /** 当前全局 SystemConfig 值，供「恢复默认」使用；读取失败时为 null（裁定 Q：不阻断） */
    defaultLowThreshold: number | null;
    defaultHighThreshold: number | null;
  };
}
```

### 3.2 `PATCH /patients/:id/glucose-targets`

权限 **`patient:target:update`**（裁定 H）；数据范围 `RESOURCE.PATIENT`；审计 `PATIENT_TARGET_UPDATE`（裁定 L）。
额外校验：`patient.status === INPATIENT`，否则 `40004` `PATIENT_INVALID_STATE`（裁定 W，与「添加血糖」同口径）。

```ts
interface UpdatePatientGlucoseTargetsRequest {
  /**
   * **全量提交**展示集合内的时段（裁定 N）。后端与库中现有行 diff，得出 create / update / delete 三类操作。
   * valueDown 与 valueUp **同时为 null** = 删除该目标行（裁定 V）；
   * **只空一个** = 字段级校验错误 10001（裁定 V）。
   */
  targets: Array<{
    timeSlotCode: string;
    valueDown: number | null;
    valueUp: number | null;
  }>;
  alert: { lowThreshold: number; highThreshold: number };
}
```

- 响应：返回更新后的完整 `PatientGlucoseTargetsResponse`（与 GET 同结构），前端直接刷新，无需二次请求。
- 事务：`targets` 的增删改与 `alert` 的 upsert 在**同一事务**内完成，避免半配置状态。
- 审计 `detail.changedFields`：只记实际变更项（裁定 L），格式见 §5.2。
- 路由路径为**单段** `glucose-targets`，与两段路径 `glucose/:recordId` 不冲突，无声明顺序要求。

## 4. 业务规则与校验

### R1 展示集合（裁定 U）

`enabled && type === 1(普通) && valueDown != null && valueUp != null`，按 `sortOrder` 升序。

- 当前命中 8 个：`FASTING` `BREAKFAST_PRE` `BREAKFAST_POST` `LUNCH_PRE` `LUNCH_POST` `DINNER_PRE` `DINNER_POST` `BEDTIME`。
- 排除：强化 ×3（`INTENSIVE_AM/PM/NIGHT`）、`RANDOM`（均 `valueDown/valueUp` 为 null）、`RETEST`（`enabled = false`）。
- 将来新增带阈值的普通时段**自动入列**；新增无阈值时段自动排除。

### R2 实库默认阈值（2026-11-25 实读，供回填与「恢复默认」参照）

| 时段码           | 名称   | 区间        | 下限 | 上限 |
| ---------------- | ------ | ----------- | ---- | ---- |
| `FASTING`        | 空腹   | 00:00–07:00 | 4.4  | 7.0  |
| `BREAKFAST_PRE`  | 早餐前 | 07:00–08:00 | 4.4  | 7.0  |
| `BREAKFAST_POST` | 早餐后 | 08:00–11:00 | 4.4  | 10.0 |
| `LUNCH_PRE`      | 午餐前 | 11:00–12:00 | 4.4  | 7.0  |
| `LUNCH_POST`     | 午餐后 | 12:00–17:00 | 4.4  | 10.0 |
| `DINNER_PRE`     | 晚餐前 | 17:00–18:00 | 4.4  | 7.0  |
| `DINNER_POST`    | 晚餐后 | 18:00–22:00 | 4.4  | 10.0 |
| `BEDTIME`        | 睡前   | 22:00–24:00 | 5.0  | 8.3  |

全局 `SystemConfig`：`glucose.low_threshold = 3.9`、`glucose.high_threshold = 16.7`。

### R3 数值校验（裁定 J）

| 对象           | 规则                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------- |
| 时段目标上下限 | `valueDown < valueUp`（**严格**小于）；各值 ∈ [0.6, 33.3]；最多 **1 位小数**（对齐 `Decimal(4,1)`） |
| 预警值         | `lowThreshold < highThreshold`（严格）；同范围同精度                                                |
| 跨字段关系     | **不校验**预警值与时段目标的大小关系（裁定 J 明确排除）                                             |
| 清空           | 时段目标：两值同时 null → 删行；只空一个 → `10001` 字段级错误（裁定 V）                             |
| `timeSlotCode` | 必须属于 R1 展示集合，否则 `10001`（防止给强化/随机/停用时段写目标）                                |

### R4 `resultType` 判定（裁定 E）— 本次核心变更

现状：`glucose.service.ts:63-71` 的 `resolveResultType(valueMmolL, threshold)` 恒读全局 `SystemConfig`（`create` L127、`update` L254 两处调用）。

变更后阈值来源：

| 录入时选择的时段                           | 判定阈值来源                                           |
| ------------------------------------------ | ------------------------------------------------------ |
| 命中 R1 展示集合 **且** 患者有该时段目标行 | **患者该时段** `valueDown` / `valueUp`                 |
| 命中 R1 但患者**缺行**（未设置）           | 回退全局 `SystemConfig` 3.9 / 16.7                     |
| 强化 / 随机 / 复测（不在展示集合）         | 回退全局 `SystemConfig` 3.9 / 16.7（**现状不变**）     |
| `resultType` 3~9（人工选择，非「检测」）   | **不判定**，直接用传入值（现状不变，见 L125-128 注释） |

区间口径**不变**（闭区间，裁定 J）：`value < low` → `'0'` 偏低；`low <= value <= high` → `'1'` 正常；`value > high` → `'2'` 偏高。即读数**恰等于**上/下限算**正常**。

> ⚠️ 患者级预警值（`PatientAlertThreshold`）**不参与** `resultType` 判定（裁定 E）。

> ✅ **已于 2026-11-25 任务 ④ 实现**，入口 `PatientGlucoseTargetService.resolveResultTypeThreshold(patientId, timeSlotCode)`。
> ⚠️ **实现口径澄清（与上表字面表述的差异，已确认更正确）**：实现**不查展示集合**，只判「患者有没有该时段的目标行」。
> 上表四行结果完全一致，但「有行却不在展示集合」这一表外情形两者相反，而该情形恰好由 R10 规定：
>
> - 强化 / 随机 / 复测：R3 禁止写行 → 必然缺行 → 回退全局（与上表第三行一致，无需特判 code）；
> - 时段被**停用**或 `TimeSlot` 默认值被**清空**：目标行按 R10「保留不删」且「历史记录判定时仍可用」→ **有行即用**。
>   若实现叠加 `enabled` 过滤，编辑这类历史血糖会退化成全局阈值，**直接违背 R10**。
> - 附带收益：录入/编辑路径不必多查一次 `TimeSlot` 全表（§9 非功能要求）。
>
> 已用单测钉住该口径（停用时段场景断言 `timeSlots.list` **未被调用**），防止后人「顺手补上展示集合过滤」造成回归。

### R5 PATCH 血糖的重算条件（裁定 I）

现状 `glucose.service.ts:252-255`：`isDetect` 时**一律**重算 `resultType`。

变更后：**仅当本次编辑实际改动了 `valueMmolL` 或 `mealContext`**（判定输入）才重算；仅改 `remark` / `testStrip` / `measuredAt` 等无关字段时**保持原值**。

- 理由：避免护士改备注导致已入病历的 `resultType` 被静默翻转（裁定 C 意图）。
- 同时保证「结果类型与读数 + 时段始终一致」：判定输入变了就重算。
- `measuredAt` 变更**不触发**重算（时段归属由 `mealContext` 显式携带，非由时间推导）。
- ✅ **已于 2026-11-25 任务 ④ 实现**：`GlucoseService.update` 用 `judgeInputChanged =（valueMmolL 变了 || mealContext 变了）` 三分支决定「用人工传入值 / 重算 / 保持原值」。
  `existingValue` 上提到判定处与 `changedFields` 复用同一份，保证两处比较口径一致（否则会出现「`changedFields` 记了 `valueMmolL` 却没重算」的自相矛盾）。
  单测的既有 `resultType` 故意设成与全局口径不一致的值，若实现仍无条件重算就会被翻转、断言立即失败。

### R6 历史记录不重算（裁定 C）

- 已入库的 `resultType` **一律不改写**，无批量重算脚本。
- **口径变更日期：④ 任务上线日**（实施时填入 §13）。
- ⚠️ 已知后果：同一患者的血糖列表/报表/趋势统计中，变更日期前后的记录使用了**两套判定标准**，跨期统计**不可比**。需在变更日向医护告知。

### R7 预警触发定义（裁定 O）— **本次不实现，仅定义**

| 触发条件                                                                                | 结果       |
| --------------------------------------------------------------------------------------- | ---------- |
| 检测值 < `lowThreshold`（患者级，默认 3.9）**或** 直接选择 `Low`（`resultType='3'`）    | 低血糖预警 |
| 检测值 > `highThreshold`（患者级，默认 16.7）**或** 直接选择 `High`（`resultType='4'`） | 高血糖预警 |

- 「下限/上限」指**患者级预警值**，**不是**时段目标上下限（裁定 O 明确）。
- 预警与 `resultType`（0/1/2）是**两套独立机制**：预警值本次只存储 + 展示 + 编辑 + 供趋势图阈值线使用。

### R8 趋势图阈值线（裁定 Y）

`glucose.service.ts` 的 `trend()`（原读 `this.systemConfig.getGlucoseAlertThreshold()`）改为：**先查 `PatientAlertThreshold`，缺失/读取失败则回退全局 `SystemConfig`**。
✅ **已于 2026-11-25 任务 ④ 实现**：`Promise.all` 第三项换成 `targets.resolveAlertThreshold(patientId)`，解析逻辑归 `PatientGlucoseTargetService`（患者行读取异常记 `warn` 后回退；全局也读不到则原样抛 `10000`，不新增兜底）。`GlucoseService` 已不再注入 `SystemConfigService`。

- 语义：趋势图阈值线代表**该患者**的预警边界，与 R7 预警定义同源。
- 回退保证：患者无预警行时行为与现状完全一致（3.9/16.7），不产生回归。
- ⚠️ **已知限制（未消除）**：患者预警值默认 = 全局 3.9/16.7，而时段目标下限更窄（如空腹 4.4）。故默认配置下仍会出现「`resultType` 判为偏低的红点落在趋势图目标带**内部**」。详见 §11 待确认项 2。

### R9 初始化（裁定 G / Q）

- **建档时快照写入**：`PatientService.create` 的建档事务**提交之后**，写入 R1 展示集合内每个时段的 `PatientGlucoseTarget`（值取当时 `TimeSlot.valueDown/valueUp`）+ 一行 `PatientAlertThreshold`（值取当时 `SystemConfig`）。
  - ⚠️ **2026-11-25 实施时修正**：本条初稿写「在同一事务内写入」，与下一条「失败不阻断建档」**逻辑互斥** —— 事务内任何一步失败都会回滚整个事务（含建档），而 Prisma 不支持 savepoint / 嵌套事务，做不到「局部失败但主体保留」。故实现为：建档 `$transaction` 成功返回后再独立调用 `initSnapshot()`，该方法内部吞掉全部异常并记 `warn`。代价可接受：快照失败 → 目标行缺失 → 展示「未设置」、判定回退全局，存量可由 `pnpm db:backfill-targets` 补齐（裁定 Q 已认可此结果）。
- **快照语义**：写入后即为患者自己的值，管理员后续改 `TimeSlot` / `SystemConfig` **不影响存量**。
- **失败不阻断建档**（裁定 Q）：`SystemConfig` 阈值行缺失、`TimeSlot` 展示集合为空、或写入异常时，**患者照常建档**，目标/预警行缺失（→ 展示「未设置」、判定回退全局），服务端记一条 `warn` 日志供运维排查。
  - ⚠️ 此处**有意偏离** `AGENTS.md §4.3`「配置缺失抛 10000 拒绝写入」的口径：控糖目标是辅助配置，不应阻断「患者住不进系统」这类核心业务。

### R10 时段漂移（裁定 K）

| 事件                             | 处理                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 管理员**新增**带阈值的普通时段   | **不给存量患者补行**。该时段自动进入展示集合，存量患者显示「未设置」，判定回退全局。用户可通过编辑弹框手工填（裁定 S） |
| 管理员**停用**某时段             | 患者目标行**保留不删**；展示区**隐藏**（不满足 R1 的 `enabled`）；历史记录判定时仍可用                                 |
| 管理员**改** `TimeSlot` 默认值   | 存量患者**不跟随**（裁定 G 快照语义）；单个患者要跟随走「恢复默认」按钮（裁定 S）                                      |
| 管理员**清空** `TimeSlot` 默认值 | 该时段退出展示集合；患者已有目标行保留但不再展示（同「停用」处理）                                                     |

### R11 状态限制（裁定 W）

编辑入口条件 = `patient.status === PATIENT_STATUS.INPATIENT && hasPermission(PATIENT_TARGET_UPDATE)`，与现有「添加血糖」按钮（`patient-detail/index.tsx:41-42`）完全同口径。出院 / 归档患者**只能看不能改**。

## 5. 权限与数据安全

### 5.1 权限点（裁定 H）

新增 `PERMISSION.PATIENT_TARGET_UPDATE = 'patient:target:update'`（`packages/shared/src/dict/roles.ts`）。

| 角色           | 是否授予 | 数据范围               |
| -------------- | -------- | ---------------------- |
| `DOCTOR`       | ✅       | `DEPARTMENT`           |
| `NURSE`        | ✅       | `DEPARTMENT`           |
| `NURSE_HEAD`   | ✅       | `DEPARTMENT`           |
| `SYS_ADMIN`    | ✅       | `ALL`                  |
| `DEVICE_ADMIN` | ❌       | `NONE`（无患者数据权） |

- ⚠️ `roles.ts:167` 不变式：**`SYS_ADMIN` 含全部权限点**，新增权限点必须同步加入其数组。
- **不复用** `patient:update`（裁定 H）：改控糖目标会改变后续所有血糖判定结果，敏感度高于改床号/责任医生，需可单独授权与单独审计过滤。
- 查看沿用 `patient:view`，不新增查看权限点。
- 后端 `@RequirePermissions` + `@RequireDataScope(RESOURCE.PATIENT)` 为**权威**校验；前端 `hasPermission` 隐藏按钮仅是体验（`AGENTS.md §5.1`）。

### 5.2 审计（裁定 L；GET 部分于 2026-11-25 复核修订）

新增两个 `AuditAction`，均**追加在枚举末尾**（PG `ALTER TYPE ADD VALUE` 只能加到 `pg_enum` 末尾，见 `DB-MIGRATION-NOTES.md §2.3`）：
`PATIENT_TARGET_UPDATE`（在 `GLUCOSE_PRINT` 之后，迁移 `20261125000000_add_patient_glucose_target`）、
`PATIENT_TARGET_VIEW`（在 `PATIENT_TARGET_UPDATE` 之后，迁移 `20261125120000_add_patient_target_view_audit`）。

| 项                   | `PATCH`（编辑）                               | `GET`（查看）                                             |
| -------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `action`             | `PATIENT_TARGET_UPDATE`                       | `PATIENT_TARGET_VIEW`                                     |
| 触发                 | 每次调用                                      | 每次调用（**2026-11-25 修订**，原裁定为不留痕）           |
| `targetType`         | `'PATIENT'`（**显式声明**，`AGENTS.md §5.2`） | 同左                                                      |
| `targetId`           | URL `params.id`（患者 ID）                    | 同左                                                      |
| `detail`             | `{ path, changedFields, requestId }`          | `{ path, requestId }`（无 `changedFields`，不落阈值数值） |
| 越权 `30002`         | `DENIED` 行                                   | `DENIED` 行（**本次修订的核心目的**）                     |
| 失败 `1xxxx`/`4xxxx` | `FAILED` 行（带 `errorCode`）                 | 同左                                                      |

`changedFields` 只记**实际变更项**，且是**字段名数组（只记名、不记值）** —— 与现有 `PATIENT_UPDATE` / `GLUCOSE_UPDATE` 完全同口径（`audit.decorator.ts:68` 白名单注释「只记字段名，不记值」、裁定 Q5）。时段级变更用复合名精确定位：

```jsonc
{
  "changedFields": [
    "FASTING.valueDown", // 单值变更
    "FASTING.valueUp",
    "BEDTIME", // 整行新增（裁定 S）或删除（裁定 V）；行级变更只记时段码，不区分增删
    "alert.lowThreshold", // 预警值变更
    "alert.highThreshold",
  ],
}
```

> ⚠️ **2026-11-25 实施时修正**：本节初稿把 `changedFields` 写成 `[{field, old, new}]` 对象数组，并称「与现有 `PATIENT_UPDATE` 口径一致」——**该说法是错的**：`patient.service.ts:441` 与 `glucose.service.ts:217` 均为 `string[]`。已按 `string[]` 实现。
> 不记值是刻意的隐私/体积取舍：审计表 append-only 且留存 ≥180 天，记值会让每行膨胀、并把临床配置明细散落进审计表。若将来确需还原历史配置值，应另开「配置变更历史表」需求，而不是往审计 `detail` 里塞值。

- `changedFields` **已在** `AUDIT_DETAIL_ALLOW_LIST`（`audit.decorator.ts:69`），无需改白名单。
- 无实际变更时（提交值与库中完全一致）仍**写一行 `SUCCESS`，但 `changedFields` 为空数组 `[]`**。

> ⚠️ **2026-11-25 实施时修正**：本节初稿写的是「无实际变更时**不写审计行**，避免噪声」——**该口径无法实现**：
> `audit-log.interceptor.ts:98-108` 只判断 `meta.action` 是否存在，命中即无条件写入，架构上不支持「按业务结果条件性跳过」；
> 既有 `PATIENT_UPDATE` / `GLUCOSE_UPDATE` 同样是空 `changedFields` 照写一行。已按实际行为修订，
> 「不产生噪声」的正确含义是**空数组可被审计查询过滤**，而不是不写行。若确需条件性跳过属拦截器改造，需另开需求。

### 5.3 数据安全

- 两张新表**不含**任何患者身份明文（姓名/身份证/电话），仅 `patientId` 外键 + 数值阈值，无脱敏与加密需求。
- 数据范围过滤走 `RESOURCE.PATIENT`（按 `Patient.departmentId` 收敛），跨科室访问抛 `30002` 并记 `DENIED` 审计。
- 删除患者时两表 `onDelete: Cascade`；**审计行不连带删**（append-only，留存 ≥ 180 天，`AGENTS.md §5.3`）。

## 6. 前端交互

### 6.1 Tab 改造（裁定 M）

| 项       | 变更前                        | 变更后                                               |
| -------- | ----------------------------- | ---------------------------------------------------- |
| label    | 基本信息                      | **控糖目标**                                         |
| 路由 key | `basic`                       | **`target`**                                         |
| 子组件   | `DetailPlaceholder`（空占位） | 新建 `PatientGlucoseTarget`                          |
| 重定向   | —                             | **不做**（旧 `/basic` 链接失效，需求人已知悉并接受） |

涉及文件：`PatientDetailTabs.tsx:21`（Tab 定义）、`detail-tabs.ts:26-32`（子路径常量）、`routes.tsx:86`（路由）。

### 6.2 展示区

- 布局：`label：value`，**一行三个**（`Row gutter` + `Col span={8}`）。
- `label` = 时段名称（取接口 `timeSlotName`，源头是 `TimeSlot.name` 动态数据，**禁止硬编码**）。
- `value` = `<下限>-<上限> mmol/L`，**统一补 1 位小数**（裁定 R）：`4.4-7.0 mmol/L`、`5.0-8.3 mmol/L`。
- 缺行时段 `value` 显示 **「未设置」**（裁定 K）。
- 8 个时段排完后**另起**，追加两项：`低血糖预警：3.9 mmol/L`、`高血糖预警：16.7 mmol/L`（同样补 1 位小数；缺失显示「未设置」）。
- 内容区**右上角**「编辑」按钮，显隐条件见 R11。

### 6.3 编辑弹框

- 标题「编辑控糖目标」；布局 `label：<输入框>-<输入框> mmol/L`，**两个一行**（`Col span={12}`）。
- 时段排完后**另起一行**：`低血糖预警：<输入框> mmol/L`、`高血糖预警：<输入框> mmol/L`。
- 输入控件：Antd `InputNumber`，`step={0.1}` `precision={1}` `min={0.6}` `max={33.3}`。
- 缺行时段输入框**为空但可填**，保存即创建目标行（裁定 S）。
- 三个附加交互（裁定 S）：
  1. **「恢复默认」按钮**：把表单重置为接口下发的 `defaultValueDown/defaultValueUp` 与 `defaultLowThreshold/defaultHighThreshold`（即当前 `TimeSlot` + `SystemConfig` 值）。**仅重置表单，仍需点保存才落库**。加 `Popconfirm` 二次确认（会覆盖已填值）。
  2. **取消时二次确认**：表单有未保存改动时点取消/关闭 → `Modal.confirm('修改尚未保存，确定离开？')`。
  3. 保存前前端 `safeParse`，失败用 `form.setFields` 落**字段级**错误（沿用 `GlucoseCreateModal.tsx:125` 范式）。

### 6.4 共享包

Zod schema 放 `packages/shared`，前后端共用（同一套校验规则，避免前后端两套判断）。
⚠️ 改 `packages/shared` 后**必须** `pnpm sync:shared`（重建 dist + 拷两 app）再 typecheck/build —— app 读的是 dist 副本不是源码。

## 7. 错误码与前端行为

| 场景                                                                 | 错误码     | 常量名                    | 前端行为                                                   |
| -------------------------------------------------------------------- | ---------- | ------------------------- | ---------------------------------------------------------- |
| 校验失败（下限≥上限、超范围、精度、只空一个框、非法 `timeSlotCode`） | `10001`    | `VALIDATION_FAILED`       | 字段级红字提示（`form.setFields`），弹框不关闭             |
| 无 `patient:target:update` 功能权限                                  | `30004`    | `MISSING_PERMISSION`      | `message.error`，按钮本已隐藏（后端为权威）                |
| 登录态失效                                                           | `30001`    | `FORBIDDEN`               | 跳登录页                                                   |
| 跨科室访问                                                           | `30002`    | `CROSS_DEPARTMENT_DENIED` | `message.error`，刷新详情页                                |
| 患者不存在 / 已归档                                                  | `40001`    | `PATIENT_NOT_FOUND`       | `message.error`，返回患者列表                              |
| 患者非在院（出院 / 待入科）拒绝编辑                                  | `40004`    | `PATIENT_INVALID_STATE`   | `message.error('仅住院患者可编辑控糖目标')`                |
| 全局 `SystemConfig` 阈值缺失（GET 的 `default*` 字段）               | **不报错** | —                         | 返回 `null`，「恢复默认」按钮置灰 + tooltip 说明（裁定 Q） |
| 并发编辑（撞 `(patientId, timeSlotCode)` 唯一索引 `P2002`）          | `10008`    | `CONCURRENT_CONFLICT`     | `message.warning('目标已被他人修改，请刷新后重试')`        |

> ⚠️ **2026-11-25 实施时修正**：本表初稿有 4 处码值错误（凭记忆填写、未核对 `packages/shared/src/error/codes.ts`）——曾写「患者不存在 `30003`」（30003 实为 `PATIENT_ARCHIVED`）、「非在院 `30002`」（30002 实为跨科室，非在院是 `40004`）、「并发冲突 `10002`」（10002 实为 `MISSING_PARAM`，并发冲突是 `10008`）、「无权限 `30001`」（功能权限不足是 `30004`，`30001` 是登录态失效）。上表为核对后的准确值，并补 `常量名` 列便于检索。
>
> 「跨科室」（3xxxx）与「非在院」（4xxxx）分属不同号段是**有意的**：3xxxx 会被审计拦截器判为 `DENIED`（越权尝试，等保三级要求可筛出），4xxxx 判为 `FAILED`（业务状态不符）。混用会让越权尝试统计失真（`AGENTS.md` §5.2）。

## 8. 测试要求

**后端单测**

- `PatientGlucoseTargetService`（`patient-glucose-target.service.spec.ts`，29 项）：展示集合过滤（含 null 阈值 / 停用 / 强化时段排除）、diff 出 create/update/delete、清空删行、非法 `timeSlotCode` 拒绝、事务原子性、`changedFields` 正确性、无变更时不写库且 `changedFields` 为空数组（审计行仍写，见 §5.2）、并发 `P2002` → `10008`、`Decimal` 出参转 `number`。
- 「只空一个框报错」属 **Zod 格式校验**，落在共享包而非 service（`packages/shared/src/patient/target-schema.spec.ts`，23 项）：半配置定位到具体字段、上下限大小关系、0.6~33.3 边界、1 位小数精度、时段码 trim/空串/超长、请求体规模上限。分工同 `mealContext`（格式在 shared、可用性查库在 server）。
- 建档快照初始化：正常写入 8 行 + 1 预警行；`SystemConfig` 缺失时**不阻断建档**且记 `warn`；`TimeSlot` 展示集合为空时不阻断。
- `resolveResultType` 阈值来源：命中展示集合读患者目标、缺行回退全局、强化/随机回退全局、`resultType` 3~9 不判定、边界值（等于上/下限）算正常。
- PATCH 重算条件：改 `valueMmolL` 重算、改 `mealContext` 重算、仅改 `remark`/`testStrip`/`measuredAt` **不重算**。
- `trend()` 阈值线：有患者预警行读患者值、无则回退全局。
- 权限：四角色可编辑、`DEVICE_ADMIN` 拒绝（`30004`）、跨科室 `30002`、非在院 `40004`、患者不存在 `40001`。

**前端单测**：展示区一行三个 + 补 1 位小数 + 「未设置」文案；弹框两个一行；「恢复默认」仅重置表单不落库；取消二次确认；字段级报错。

**回归**：现有 `glucose.service.spec.ts`（285 项）必须全绿。⚠️ 其中 L188「改配置即改判定」与 L210「阈值读取失败拒绝写入」两个用例的断言需随 R4 判定来源变更相应调整。

**回填脚本**：试运行只统计不写库；`--apply` 幂等可重跑（重跑不产生重复行、不改已有行）。

## 9. 非功能要求

- `GET` 单次查询完成（`TimeSlot` + 患者目标行 + 预警行），避免 N+1。
- `PATCH` 全量提交在单事务内完成，8 时段 + 1 预警行的写入量级极小。
- 展示区不引入新依赖；弹框复用现有 Antd `Modal` + `Form` 范式。
- 趋势图阈值线改造不得增加额外串行查询（并入现有 `Promise.all` 批）。

## 10. 验收标准（可勾选）

- [x] 患者详情 Tab 显示「控糖目标」，路由为 `/target`，旧 `/basic` 不再可达（③ e2e 实测点击 Tab 后 URL 变为 `/target` 且展示区渲染；`detail-tabs.ts` 的 key 由 `basic` 改为 `target`；旧 `/basic` 按裁定 M **不做重定向**，`PatientDetail.spec.tsx` 有回归断言钉住其命中 `*` 兜底回落「血糖报告」而非白屏）
- [x] 展示区按 R1 展示 8 个时段，一行三个，`label：value` 格式，数值补 1 位小数（③ e2e 实测：`空腹：4.4-7.0 mmol/L`、`睡前：5.0-8.3 mmol/L`，时段名由接口下发）
- [x] 8 个时段后另起展示「低血糖预警」「高血糖预警」（③ e2e 实测 3.9 / 16.7）
- [x] 缺行时段显示「未设置」（③ e2e 实测：删行后展示区变「睡前：未设置」；半配置分支由单测覆盖）
- [x] 右上角「编辑」按钮仅在 `INPATIENT` + 有 `patient:target:update` 时可见（③ e2e 实测：住院患者 1 个按钮；出院患者 0 个，且与既有「添加血糖」按钮同为 0，证明门控同口径）
- [x] 编辑弹框两个一行，末尾另起一行两个预警值输入框（③ e2e 可访问性快照实测：8 时段 × 2 个 spinbutton + 2 个预警值输入框，均带 aria-label）
- [x] 「恢复默认」重置表单为当前 `TimeSlot` + `SystemConfig` 值，需点保存才落库（③ e2e 实测：库中 4.0 → 表单 4.4，点「确定离开」后页面仍显示 4.0，证明未落库）
- [x] 有未保存改动时取消 → 二次确认（③ e2e 实测弹出「修改尚未保存，确定离开？」，点「继续编辑」后输入值 9.9 保留；**无改动时取消不弹**，不打扰医护）
- [x] 清空某时段两个框并保存 → 该行被删除，展示变「未设置」（③ e2e 实测；重新打开弹框该时段两个输入框为空、可再填）
- [x] 只清空一个框 → 字段级报错，不提交（③ e2e 实测：`aria-invalid` 标记 1 处、弹框保持打开、文案「上下限需同时填写或同时清空」）
- [x] 下限 ≥ 上限 / 超 0.6~33.3 / 超 1 位小数 → 字段级报错（下限>上限 ③ e2e 实测红字「上限必须大于下限」挂在**上限**框；范围与小数位由 shared 契约 23 项单测覆盖）
- [x] 出院/归档患者：可看不可改，后端同样拒绝（出院 `40004`、归档 `40001`）（前端 ③ e2e + 后端 ② 冒烟均已验证）
- [x] `DEVICE_ADMIN` 与跨科室用户：后端拒绝（`30004` / `30002`）并记 `DENIED` 审计（② 冒烟实测，审计表有 `DENIED` 行、`errorCode=30002`）
- [x] 新建患者后自动有 8 行目标 + 1 行预警（值等于当时 `TimeSlot` / `SystemConfig`）（② 单测 + 冒烟实测）
- [x] 管理员改 `TimeSlot` 默认值后，存量患者目标**不变**（② 单测覆盖 + **④ 端到端实测补齐**：当前无时段维护接口，故直接改库模拟管理员动作 —— 把 `TimeSlot.FASTING` 默认目标临时改为极宽的 `3.0-20.0` 后，存量患者目标行仍为 `4.4-7.0`、`GET` 下发的患者值仍是 `4.4-7.0` 而 `defaultValue*` 列跟随变成 `3.0/20.0`；**关键判定证据**：此时录入空腹 `4.2` 仍判「偏低」，若实现误读 `TimeSlot` 默认值则会判「正常」。验证后 `TimeSlot` 已还原为 `4.4-7.0`，测试记录与审计行已清理）
- [x] `SystemConfig` 阈值行缺失时建档**仍成功**，目标行缺失，服务端有 `warn` 日志（② 单测覆盖；调用点另有防御性 `.catch`，见 R9）
- [x] 回填脚本试运行只输出统计；`--apply` 后存量患者全部有目标行；重跑不产生重复（2026-11-25 实测：DRY-RUN 统计 8000 目标行 / 1000 预警行且两表仍 0 行 → `--apply` 写入 7999 + 999 → 查库核验 7 项全过（每患者恰好 8 行、值等于 `TimeSlot` 默认）→ 重跑 DRY-RUN「需补 0 / 已齐全 1000 / 新建 0」）

> ⬇️ **以下 7 项属任务 ④（判定改造），已于 2026-11-25 实施完成**。验证方式：后端单测（server 325 → **345** 项）+ 真实 HTTP 端到端冒烟 **27 项全通过**（登录 → 录入 → 查库核验 → 编辑 → 趋势图 → 还原现场并清理测试记录与审计行）。
> 判定阈值解析入口：`PatientGlucoseTargetService.resolveResultTypeThreshold(patientId, mealContext)`（R4）与 `resolveAlertThreshold(patientId)`（R8）；`GlucoseService` 不再直接注入 `SystemConfigService`，回退口径归解析方独有。

- [x] 录入血糖选「空腹」、患者空腹目标 4.4-7.0 → 读数 4.2 判**偏低**、4.4 判**正常**、7.0 判**正常**、7.1 判**偏高**（冒烟实测 4 个边界**接口返回与落库值双向核验**全部命中；闭区间口径见裁定 J。另附「可区分新旧口径」前置断言：探针值 4.2 在旧全局 3.9/16.7 下本会判正常，证明差异确实由患者目标产生）
- [x] 录入血糖选「随机」（不在展示集合）→ 仍按全局 3.9/16.7 判定（冒烟实测：同一读数 4.2 在 `RANDOM` 下判**正常**，与 `FASTING` 下的**偏低**结果不同）
- [x] 患者缺该时段目标行 → 按全局 3.9/16.7 判定（单测覆盖：`resolveResultTypeThreshold` 缺行分支回退全局；强化/随机/复测按 R3 不可能有行，故同走此分支）
- [x] 编辑历史血糖仅改备注 → `resultType` **不变**（冒烟实测：既有记录 `resultType='0'` 而读数 8.9 按全局本该是 `'1'`，仅改备注后仍为 `'0'`、`changedFields=['remark']`；**仅改试纸**、**仅改检测时间**同样不重算，各 2 项断言全过）
- [x] 编辑历史血糖改读数或时段 → `resultType` 按新口径重算（冒烟实测：改读数 4.2 → 7.0 后由「偏低」变「正常」，`changedFields=['valueMmolL','resultType']`；单测另覆盖改时段 `FASTING → LUNCH_POST` 时按**新**时段码解析阈值）
- [x] 历史已有记录的 `resultType` 未被任何脚本改写（④ 未新增任何批量写库脚本，改动仅限 `GlucoseService` 的录入/编辑/趋势三条读判路径；回填脚本 `backfill-glucose-targets.ts` 只写 `PatientGlucoseTarget` / `PatientAlertThreshold` 两表，不触碰 `GlucoseRecord`）
- [x] 趋势图阈值线：有患者预警行时画患者值，无则画全局 3.9/16.7（冒烟实测三态：预警改 `4.5/15.0` → `thresholds={low:4.5,high:15}`；改 `1.0/30.0` → 跟随；**删掉预警行** → 回退 `{low:3.9,high:16.7}`。验证后预警行已还原。附带验证 R7：预警放宽到 `1.0/30.0` 后空腹 4.2 仍判偏低，证明预警值不参与判定）
- [x] 每次成功编辑产生 1 行 `PATIENT_TARGET_UPDATE` 审计，`detail.changedFields` 只含实际变更项，含 `requestId`（② 查库实测：`detail={"path","requestId","changedFields":["FASTING.valueDown"]}`）
- [x] 无实际变更的提交产生 1 行 `SUCCESS`，`detail.changedFields` 为**空数组**（2026-11-25 修正：拦截器命中 `@Audit` 即无条件写行，原稿「不产生审计行」不可实现，见 §5.2）（② 冒烟实测）
- [x] 每次 GET 产生 1 行 `PATIENT_TARGET_VIEW`；**越权 GET 产生 `DENIED` 行**（2026-11-25 复核裁定推翻原裁定 L，见 §5.2）（② 查库实测 `DENIED` + `errorCode=30002`；③ e2e 实测**单次页面访问审计总数 41 → 42、增量恰为 1**，证明前端 hook 的 StrictMode 守卫生效、开发模式下未双写）
- [x] `pnpm sync:shared` 后三包 typecheck 通过、server 单测全绿、web build 通过（2026-11-25 ③ 完成后：typecheck / lint / test 三包 exit=0，web **20 files / 247 tests**、server 325、shared 103，`pnpm --filter @gc/web build` ✓ 19.61s）
- [x] ④ 完成后复跑全量：typecheck / lint / test 三包 exit=0，**server 325 → 345**（+20：解析方法 11 项、判定接入 9 项）、shared 103、web 20 files / 247 tests 不变（前端零改动），`pnpm --filter @gc/web build` ✓ 19.62s。既有 325 项**无一需要改断言**（测试工厂让解析方法默认委托全局配置桩，等价于「患者缺行」回退分支），只改了 4 处标题/注释使其准确描述所覆盖分支

## 11. 待确认项

1. **预警值能否清空**（AI 补全，待需求人确认）
   裁定 V 只定义了**时段目标**的清空语义（删行），未提预警值。本规格暂按**必填不可清空**处理（§3.2 `alert` 两字段为 `number` 非 `number | null`），理由：预警值是全局阈值的患者级快照，空值无医学意义，且裁定 Y 已让趋势图依赖它。
   → 若需求人希望与时段目标同语义（两个都清空 = 删 `PatientAlertThreshold` 行 → 趋势图回退全局），请指出，改动仅限 Zod schema 与 `alert` 的 delete 分支。

2. **趋势图「红点落在正常带内」的视觉矛盾** — ✅ **已裁定（2026-11-25，需求人）：确认沿用 R8 口径，不做 tooltip 增补**
   需求人裁定原文：「趋势图的阈值范围要取值患者的预警范围，患者的预警范围默认使用全局的（3.9-16.7），如果存量患者没有该值，则使用全局的（3.9-16.7）」。
   即：趋势图阈值线 = **患者级 `PatientAlertThreshold`**，缺失时回退全局 `SystemConfig` 3.9/16.7 —— 与 R8 / 裁定 Y 完全一致，**任务 ④ 按 R8 实现即可，无需增补 tooltip**。
   补充事实（裁定时未提及，实施时确认）：存量 1000 名未归档患者已由 `pnpm db:backfill-targets -- --apply`（2026-11-25 执行）补齐预警行，值均为全局 3.9/16.7，故「回退全局」实际只在**新建患者快照初始化失败**（R9 失败不阻断路径）时触发。
   ⚠️ **视觉矛盾作为已知限制保留**：患者预警值（3.9/16.7）比时段目标下限（空腹 4.4）宽，故空腹读数 4.2 仍会被判**偏低**（红点）却落在趋势图目标带**内部**。需求人已知悉此现象并接受；若日后医护反馈造成误判，再单独开需求处理（届时可考虑 tooltip 增补或阈值线改画时段目标）。

3. **`Patient.diabetesType` / `hba1c` / `remark` 永久无展示位**（既有缺陷，非本次引入）— ⚠️ **缺口已于 2026-11-25 任务 ③ 落地后固化**
   这三个字段建档时可填、库中有数据，但全系统无任何展示入口——原「基本信息」Tab 一直是空占位页（`DetailPlaceholder`）。
   任务 ③ 已把该 Tab 改为「控糖目标」正式页面（裁定 M），`DetailPlaceholder` 现仅剩「出入院记录」一条子路由在用，故这三个字段**确认无展示位**。
   → 是否另开独立需求处理（可选方案：在详情页顶部摘要区 `PatientBasicInfo` 补展示，或新增独立 Tab），待需求人决定。本次未擅自扩大范围。

4. **`AGENTS.md` / `COMMON-DATA.md` 的同步时机** — ✅ **已按 AI 建议执行（2026-11-25，随任务 ④ 一起落笔）**
   裁定 X 已定三项文档同步。AI 建议：`AGENTS.md §4.3` 与 `COMMON-DATA.md §92-97` 的改动**放在任务 ④ 完成之后**再落笔——口径真正生效是在 ④，文档先于实现会造成中间态自相矛盾。`seed.ts` 补阈值行可随任务 ② 一起（只影响新环境初始化）。
   执行情况：`seed.ts` 已随 ② 落地；④ 完成后同步了 **5 处**文档（比裁定 X 的 3 项多 2 项，因为口径变更波及面比预估广）：
   - `AGENTS.md §4.3`：判定阈值升为患者级、全局降级为回退源 + 建档快照来源；新增 R5 重算条件与 R7/R8 预警值口径 4 条
   - `docs/COMMON-DATA.md`：`D-ALERT` 行、`TimeSlot.valueDown/valueUp` 字段说明、§92-97「⏸️ 保持现状」整段改写为「✅ 已接入判定」、§114 提取示例
   - `.codebuddy/rules/glucose-domain.md`：与 `AGENTS.md §4.3` 同源，同步「取值与异常」整节（该规则声明「冲突以 AGENTS.md 为准」，不同步会造成两份 AI 上下文互相矛盾）
   - `docs/UI-DESIGN-TOKENS.md`：`DY-RESULT` 表中 `0`/`1`/`2` 的「判定方式」列由写死的 `< 3.9` / `3.9~16.7` / `> 16.7` 改为「判定下限/上限」，并新增来源说明 + 阈值线与判定阈值不同源的提示
   - `docs/specs/glucose-trend.md`：R7 阈值来源、接口 `thresholds` 字段注释、依赖清单、实现记录 4 处加 2026-11-25 修订标注（该规格已交付，采用「划掉旧文 + 修订说明」而非改写历史）

## 12. 实施计划（裁定 P：4 个原子任务顺序交付）

每步独立提交、独立验证；`prisma schema/migration` 与「鉴权/权限过滤/审计逻辑」各自**单独成一次提交并标注敏感**（`.codebuddy/rules/git-commit.md`）。

### ① schema + 迁移（敏感，需人工评审）— ✅ 已完成（2026-11-25，提交 `8679345`；`PATIENT_TARGET_VIEW` 枚举补于 `335b7e0`）

- `apps/server/prisma/schema.prisma`：新增 §2.1 / §2.2 两个 model；`Patient` 加 2 个反向关系字段；`AuditAction` **末尾**追加 `PATIENT_TARGET_UPDATE`。
- 新建迁移目录 `apps/server/prisma/migrations/<ts>_add_patient_glucose_target/migration.sql`：2 张 `CREATE TABLE` + 索引 + 外键 + `ALTER TYPE ... ADD VALUE IF NOT EXISTS`。**不含回填**。
- `packages/shared/src/dict/roles.ts`：新增 `PERMISSION.PATIENT_TARGET_UPDATE`，并加入 `DOCTOR` / `NURSE` / `NURSE_HEAD` / `SYS_ADMIN` 四个角色数组（`DEVICE_ADMIN` 不加）。
- 应用：`pnpm db:deploy` + `prisma generate`；验证 `migrate status` up-to-date、`migrate diff` 无漂移、`pg_enum` 中 `AuditAction` 新值位于末尾。
- ⚠️ 仅本地开发库；`migrate dev` 禁用（`DB-MIGRATION-NOTES.md §3`）。

### ② 后端接口 + 建档快照 + 回填脚本 — ✅ 已完成（2026-11-25，提交 `e3132d9` / `46eebe9` / `4b66f75` / `79d7f1b`；回填 `--apply` 已执行并核验）

- `packages/shared`：新增 Zod schema（GET 响应 / PATCH 请求）与 TS 类型 → `pnpm sync:shared`。
- 新建 `PatientGlucoseTargetModule`（service + controller）：`GET` / `PATCH`，含展示集合过滤、diff、事务、`changedFields`、`@Audit`、`@RequirePermissions`、`@RequireDataScope`、`INPATIENT` 校验。
- `PatientService.create`：加建档快照初始化（R9），失败不阻断 + `warn` 日志。
- `apps/server/prisma/backfill-glucose-targets.ts` + `package.json` 脚本 `db:backfill-targets`：两段式（默认试运行只统计，`-- --apply` 写库），`WHERE NOT EXISTS` 幂等，仿 `db:remask` / `db:reencrypt` 先例。
  - 之所以不放进 ① 的迁移 SQL（仓库有 `20261120000000` 迁移内回填的先例）：裁定 T 要求可**先试运行看统计**、可重跑、且与建表解耦，避免迁移失败连带回滚表结构。
- `seed.ts`：把 `glucose.low_threshold=3.9` / `glucose.high_threshold=16.7` 补进 `configs` 数组（裁定 X）。
- 单测覆盖 §8 后端项（除判定改造相关）。

### ③ 前端 Tab（改名 + 展示 + 编辑弹框）— ✅ 已完成（2026-11-25，提交 `0bfe58b` 组件与单测 / `8e2ed62` Tab 改名与路由接入；`@gc/shared` 审计口径注释修正见 `39716a8`）

- Tab label / 路由 key / 子路径常量改造（§6.1）：`basic` → `target`，改 `detail-tabs.ts`（`DetailMainTab` / `DETAIL_TAB_PATH` / `MAIN_TAB_PATH` / `resolveDetailTab`）、`PatientDetailTabs.tsx`（`MAIN_TABS` label 改「控糖目标」）、`routes.tsx`（子路由指向新组件）。
  **刻意不做 `/basic` → `/target` 重定向**（裁定 M）：旧 URL 命中 `*` 兜底回落默认页「血糖报告」，不白屏、不出现无高亮空档（已加回归断言）。`DetailPlaceholder` **保留**（「出入院记录」仍在用），仅更新其注释。
- 新建文件：`PatientGlucoseTargetTab.tsx`（展示区，§6.2）、`PatientGlucoseTargetEditModal.tsx`（编辑弹框，§6.3）、`usePatientGlucoseTargets.ts`（数据 hook）、`glucose-target-view.ts`（纯函数：格式化 / 表单值转换 / 编辑门控 / 字段路径解析）；API 封装加在既有 `api/patient.ts`。
- 前端单测：`glucose-target-view.spec.ts`（纯函数，钉住裁定 K / N / Q / R / S / V / W）+ `PatientGlucoseTargetTab.spec.tsx`（展示组件走 `renderToStaticMarkup`，web 测试为 node 环境无 jsdom）；同步修正 `detail-tabs.spec.ts` / `PatientDetail.spec.tsx` 中受改名影响的既有断言。web 测试 201 → **247**。
- **本步未改任何判定逻辑**，可独立上线演示。
- ~~⚠️ **交付时必须向医护说明**：本 Tab 只能查看与配置，血糖的「偏低 / 正常 / 偏高」分类**仍按全局 3.9/16.7 判定**，患者级目标要等任务 ④ 才生效——否则「改了不生效」会被当成 bug 报障。~~
  → **本条已于 2026-11-25 随 ④ 完成而失效**（同日交付，未经历「能配置但不生效」的对外窗口期）：判定现已按患者时段目标生效，无需再做此项说明。
  ⚠️ 取而代之的告知义务见 §13「口径变更日期」——需说明的是**判定口径变了、跨期统计不可比**，而不是「配置不生效」。
- hook 带 **StrictMode 守卫**：GET 每次写一条 `PATIENT_TARGET_VIEW` 审计，React 18 开发模式下 effect 跑两次会造成审计成对重复（同 `usePatientDetail` 踩过的 `PATIENT_VIEW` 问题）。守卫 key 用 `${patientId}#${nonce}` 而非仅 `patientId`，以便 `reload()` 能穿透守卫。e2e 实测单次访问审计总数 41 → 42、增量恰为 1。
- 实现期修正的两处 antd 兼容问题：`FormInstance` 未暴露 `clearValidate`（改用 `resetFields` + `setFieldsValue` 清校验态，同时消除 rc-field-form 的 `circular references` 警告）；`InputNumber` 的 `addonAfter` 已弃用（改用独立单位 span，与时段行写法统一）。

### ④ 判定改造（风险最高，可单独评审）— ✅ 已完成（2026-11-25）

- `PatientGlucoseTargetService`：**新增两个解析方法**（跨模块唯一入口）——
  `resolveResultTypeThreshold(patientId, timeSlotCode)`（R4）与 `resolveAlertThreshold(patientId)`（R8）。
  ⚠️ 实现要点：R4 **不叠加展示集合过滤**（不查 `loadDisplaySet`），只看「患者有没有该时段的目标行」。
  理由：R3 已禁止给展示集合外的时段写行，故强化/随机/复测必然缺行 → 天然回退全局（= R4 第三行）；
  而时段被**停用**或默认值被**清空**时行按 R10 保留且「历史判定仍可用」，若按 `enabled` 过滤反而会违背 R10。
  附带收益：录入/编辑路径少一次 `TimeSlot` 全表查询（§9）。已用单测钉住（`timeSlots.list` 断言 `not.toHaveBeenCalled`）。
- `GlucoseService`：`resolveResultType` 阈值来源改为 R4 表；**移除 `SystemConfigService` 注入**（三处调用点全部改走解析方法后该依赖已无用，留着会是死代码），`GlucoseModule` 的 `SystemModule` 依赖相应换成 `PatientGlucoseTargetModule`（单向依赖，无循环）。
- `GlucoseService.update`：重算条件改为 R5（仅 `valueMmolL` / `mealContext` 变更）；`existingValue` 上提复用，保证「重算条件」与 `changedFields` 两处比较口径一致。
- `GlucoseService.trend`：阈值线改为 R8（患者预警值 → 回退全局），仍占 `Promise.all` 一个位子，命中患者行时查询次数与改造前相同（§9）。
- 调整 `glucose.service.spec.ts` 中受影响的既有断言，补齐 §8 新增用例。
  实际结果：**既有 325 项无一需要改断言**（比 §8 预估的「L188/L210 需调整」更轻）——测试工厂里把两个解析方法默认**委托给全局配置**桩，等价于「患者缺行」的回退分支，既有用例语义原样保留；只改了 4 处**标题/注释**使其准确描述所覆盖的分支，并加强 2 处断言（`3~9` 分支同时断言不查患者目标行）。新增 20 项（server 325 → 345）。
- **前端零改动**：`thresholds` 响应结构不变，`GlucoseTrendTab` 直接透传；全仓无任何前端阈值比对（`tokens.ts` 的 `getGlucoseLevel` 无调用方），故不存在「前端着色与库中 `resultType` 打架」的风险。仅修正了该函数的注释以防后续误用。
- ~~（待 §11 待确认项 2 裁定）可能增补趋势图 tooltip~~ → **已裁定不做**（2026-11-25，见 §11 待确认项 2）：趋势图阈值线按 R8 取患者预警值、缺失回退全局 3.9/16.7 即可，「红点落在正常带内」的视觉矛盾作为已知限制保留，④ 无需改前端。
- ✅ 已落笔 `AGENTS.md §4.3` 与 `COMMON-DATA.md §92-97` 的文档同步（裁定 X），并在 §13 填入**口径变更日期**。实际同步 5 处文档，明细见 §11 待确认项 4。

## 13. 裁定记录（2026-11-25，6 轮共 25 项）

| #   | 裁定                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | 只展示 8 个普通时段；强化 ×3、随机、复测不展示、不参与目标判定                                                                                                                                                                    |
| B   | **撤销**需求原文的「低血糖预警默认 3 / 高血糖预警默认 25」；改为默认取全局 `SystemConfig` 3.9/16.7，并把该阈值**升为患者级**；全局 key **保留**作初始值来源与回退                                                                 |
| C   | 历史 `resultType` **不重算**，新口径只影响变更后的新录入；文档记载口径变更日期与跨期不可比告知                                                                                                                                    |
| D   | 新表 `PatientGlucoseTarget(patientId, timeSlotCode, valueDown, valueUp)` + 唯一索引，一时段一行                                                                                                                                   |
| E   | 判定阈值：命中展示集合的时段读**患者时段目标**；强化/随机/复测 + 患者缺行时段 → 回退全局 3.9/16.7；患者级预警值**不参与判定**                                                                                                     |
| F   | 新表 `PatientAlertThreshold(patientId 唯一, lowThreshold, highThreshold)`                                                                                                                                                         |
| G   | 建档时**快照写入** 8 行 + 预警值；存量患者一次性回填；管理员改 `TimeSlot` 默认不影响存量                                                                                                                                          |
| H   | 医生/护士/护士长（本科室）+ 系统管理员（全院）可编辑；新增独立权限点 + 独立审计枚举；**迁移已授权（仅本地开发库）**                                                                                                               |
| I   | PATCH 血糖：**仅当 `valueMmolL` 或 `mealContext` 实际变更**才重算 `resultType`                                                                                                                                                    |
| J   | 最小校验：下限<上限（严格）、0.6~33.3、1 位小数；预警 `low<high` 同范围；**不校验**预警与目标的大小关系；等于上/下限算**正常**（闭区间）                                                                                          |
| K   | 新增时段不补行（缺行展示「未设置」+ 判定回退全局）；停用时段目标行保留不删、展示隐藏、历史判定仍可用                                                                                                                              |
| L   | 仅编辑留痕，`detail` 记 `changedFields`；查看不单独留痕，由 `PATIENT_VIEW` 兼顶。⚠️ **后半句已于 2026-11-25 复核推翻**：GET 改为逐次留痕 `PATIENT_TARGET_VIEW`（否则越权查看在审计表筛不出），`changedFields` 部分仍有效，见 §5.2 |
| M   | Tab key `basic` → **`target`**，label →「控糖目标」，**不做重定向**（旧链接失效，已知悉）                                                                                                                                         |
| N   | `GET` + `PATCH /patients/:id/glucose-targets`，**整体批量保存**，后端 diff 出 `changedFields`                                                                                                                                     |
| O   | 预警触发定义（**本次不实现**）：低于 `lowThreshold` 或选 `Low` → 低血糖预警；高于 `highThreshold` 或选 `High` → 高血糖预警。与 `resultType` 是两套独立机制                                                                        |
| P   | 拆 **4 个原子任务**顺序交付：① schema+迁移 → ② 后端接口+回填 → ③ 前端 Tab → ④ 判定改造（风险最高，放最后可单独评审）                                                                                                              |
| Q   | 建档初始化失败**不阻断建档**：行缺失 →「未设置」+ 回退全局，服务端记 `warn` 日志                                                                                                                                                  |
| R   | 展示数值**统一补 1 位小数**：`4.4-7.0 mmol/L`、`5.0-8.3 mmol/L`                                                                                                                                                                   |
| S   | 编辑弹框三项全要：①「恢复默认」按钮（仅重置表单，需点保存）② 取消时有改动则二次确认 ③ 缺行时段输入框为空但**可填**，保存即创建行                                                                                                  |
| T   | 新增 `pnpm db:backfill-targets` **两段式**（试运行统计 → `-- --apply` 写库），脚本放 `apps/server/prisma/`，幂等可重跑，执行前需需求人确认                                                                                        |
| U   | 展示集合权威条件 = `enabled && type===1(普通) && valueDown!=null && valueUp!=null`，**动态跟随库**，禁止硬编码 code 或按名称匹配                                                                                                  |
| V   | 清空某时段上下限 = **删除该目标行** → 展示「未设置」、判定回退全局；两个框必须同时空，只空一个报字段级错误                                                                                                                        |
| W   | 编辑条件 = `status === INPATIENT && hasPermission(PATIENT_TARGET_UPDATE)`，与「添加血糖」同口径；出院/归档只能看                                                                                                                  |
| X   | 文档同步三项：改 `COMMON-DATA.md:92-97`（标注 2026-11-17 旧裁定**已被推翻**）、改 `AGENTS.md §4.3`（阈值升患者级 + 修正「seed 默认 3.9/16.7」与事实不符）、把两个阈值行补进 `seed.ts`                                             |
| Y   | **趋势图阈值线改读患者级预警值**（缺失回退全局 3.9/16.7）。⚠️ 此项推翻了 E 的「预警值只存不用」中关于趋势图的部分，但**未消除** R8 所述视觉矛盾（见 §11 待确认项 2）                                                              |

### 口径变更日期

| 项                            | 值                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resultType` 判定口径变更日期 | **2026-11-25**（任务 ④ 完成日；本地开发库已生效，**内网生产上线日以实际部署日为准，部署时须回填本行**）                                                                                                                                                |
| 变更前口径                    | 全局 `SystemConfig` 3.9 / 16.7（全院统一）                                                                                                                                                                                                             |
| 变更后口径                    | 患者时段目标（缺失回退全局 3.9 / 16.7）                                                                                                                                                                                                                |
| 历史记录                      | **不重算**，跨期统计不可比（裁定 C）                                                                                                                                                                                                                   |
| 跨期不可比的具体表现          | 同一条读数在变更前后可能得到不同 `resultType`。例：空腹 4.2 —— 旧口径（全局 3.9）判**正常**，新口径（空腹目标 4.4）判**偏低**。凡目标比全局窄的时段（seed 下 8 个普通时段全部如此）都会出现这类翻转，**报表按日期跨该变更点做同比/环比时须告知使用者** |
| 编辑历史记录的口径            | 按 R5：只在读数或时段实际变更时按**新口径**重算。故一条变更前的记录被编辑读数后，其 `resultType` 会按新口径生成 —— 这是裁定 C「不批量重算」与裁定 I「编辑须重算」共同作用的必然结果，不是缺陷                                                          |

### 实施记录

> 本表 2026-11-25 补齐（此前四行一直停留在「未开始」，与 §12 各小节标题的完成标记不一致）。
> 四个任务全部交付完毕，本需求关闭；剩余开口项只有 §11 待确认项 1（预警值能否清空）与 3（三个患者字段的展示位）。

| 任务 | 状态    | 提交                                                                                     | 验证                                                                                                                                                           | 备注                                                                                                                           |
| ---- | ------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ①    | ✅ 完成 | `8679345`（`PATIENT_TARGET_VIEW` 枚举补于 `335b7e0`）                                    | 迁移在本地开发库执行成功；三包 typecheck/lint/test 全绿                                                                                                        | schema + 迁移 + 权限点 + 审计枚举（**敏感，需人工评审**）                                                                      |
| ②    | ✅ 完成 | `e3132d9` / `46eebe9` / `4b66f75` / `79d7f1b`                                            | 后端单测 + 真实 HTTP 冒烟（含越权 `DENIED` 审计查库核验）；回填 `--apply` 写入 7999 目标行 + 999 预警行，查库核验 7 项全过、重跑 DRY-RUN 需补 0                | 后端接口 + 建档快照 + 回填脚本 + seed 补阈值                                                                                   |
| ③    | ✅ 完成 | `0bfe58b` / `8e2ed62`（`@gc/shared` 注释修正 `39716a8`，规格更新 `173f624` / `2d4edd7`） | web 单测 20 files / 247 tests；playwright e2e 全通过（含**审计增量恰为 1**证明 StrictMode 守卫生效）；`web build` ✓                                            | 前端 Tab 改名 + 展示 + 编辑弹框；**前端零改动延续到 ④**                                                                        |
| ④    | ✅ 完成 | `8137322`（解析方法）/ `3903e2e`（接入判定）/ `e254cd4`（前端注释）+ 本次文档同步提交    | server 单测 325 → **345**；真实 HTTP 端到端冒烟 **27 项全通过** + 快照语义专项 **7 项全通过**（均自清理）；三包 typecheck/lint/test 全绿、`web build` ✓ 19.62s | 判定改造 + 趋势图阈值线 + 文档同步（5 处，明细见 §11 待确认项 4）。⚠️ **改变进病历的结果类型口径**，上线前须告知医护，详见 §13 |
