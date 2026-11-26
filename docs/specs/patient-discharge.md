# 患者出院（P2-6）+ 办理住院升级 —— 功能规格

> 状态：**已落地**（2026-11-26，三件套全绿 + playwright 全链路实测 + 数据库/审计核验通过）
> 裁定过程与实施验证见 §11 变更记录。模板：`docs/FEATURE-SPEC-TEMPLATE.md`。

### 0. 元信息 ⭐

| 项     | 内容                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------ |
| 阶段号 | P2-6 患者出院（docs/ROADMAP.md）                                                                 |
| 模块   | patient（连带 ward 自动移出、shared 契约）                                                       |
| 优先级 | P1                                                                                               |
| 依赖   | R24 `Admission`/`AdmissionDepartment` 双写；虚拟病区（`WARD_LEAVE_REASON.DISCHARGE` 预留值接入） |
| 需求人 | 用户（2026-11-26 两轮裁定）                                                                      |

### 1. 目标与用户故事 ⭐

作为 **护士/护士长**，我要 **为住院患者办理出院（可填备注）**，以便 **患者状态及时流转、虚拟病区不滞留已出院患者、出院交接信息可追溯**；
作为 **护士/护士长**，我要 **在办理住院时确认/修正科室、责任医护、住院号与床号**，以便 **再入院信息按本次住院实际情况落库**。

本次范围（做）：

- `POST /patients/:id/discharge`：出院状态流转（INPATIENT → DISCHARGED）+ 出院备注 + 虚拟病区自动移出 + R24 双写关闭
- `POST /patients/:id/admit` **升级**：从无请求体改为接收 `{departmentId, doctorId?, nurseId?, patientNo, bedNo?}`（办理住院弹框表单）
- schema：`Admission.dischargeRemark` 可空列 + 迁移（**需人工评审**，单独提交）
- 新权限点 `patient:discharge`（护士/护士长/系统管理员；医生不授予，与 admit 对称）
- 前端：出院弹框、住院弹框、列表 MoreActions 第 4 项「办理出院」、出院 Tab「办理住院」改弹框、详情页「更多操作」下拉

本次不做（明确排除）：

- 详情页「出入院记录 Tab」真实化（接口 `GET /patients/:id/admissions` 已存在，另起一轮）
- 患者归档功能（`WARD_LEAVE_REASON.ARCHIVE` 仍为预留值）
- 出院时间回填（裁定 Q1：服务端 now，弹框展示仅为预览）

### 2. 数据模型变更

| 模型      | 字段            | 类型                       | 说明                                      | 是否需迁移 |
| --------- | --------------- | -------------------------- | ----------------------------------------- | ---------- |
| Admission | dischargeRemark | `String? @db.VarChar(255)` | 出院备注（本次出院交接信息）；NULL = 未填 | 是         |

> 可空列，不影响存量数据，无需回填。迁移 `add_admission_discharge_remark`：
> `ALTER TABLE "Admission" ADD COLUMN "dischargeRemark" VARCHAR(255);`（可在事务内执行）。
> **本地开发库迁移由 AI 执行（2026-11-26 授权）；生产库迁移由运维执行。**
>
> 备选方案已否决：写 `Patient.remark` 会覆盖建档备注；写审计 detail 违反白名单
> 「不含自由文本」原则（`audit.decorator.ts`）。

### 3. 接口契约 ⭐

| #   | 方法 | 路径                    | 权限点                      | 数据范围(RESOURCE) | 审计动作       | 说明                     |
| --- | ---- | ----------------------- | --------------------------- | ------------------ | -------------- | ------------------------ |
| 1   | POST | /patients/:id/discharge | `patient:discharge`（新增） | PATIENT            | PATIENT_MANAGE | 办理出院                 |
| 2   | POST | /patients/:id/admit     | `patient:admit`（已有）     | PATIENT            | PATIENT_MANAGE | 办理住院（**契约升级**） |

请求（shared Zod，`packages/shared/src/patient/schema.ts`）：

```ts
export const dischargePatientSchema = z.object({
  /** 出院备注，可空；trim 后空串按未填处理 */
  remark: z.string().trim().max(255, '备注过长').optional(),
});
export type DischargePatientInput = z.infer<typeof dischargePatientSchema>;

export const admitPatientSchema = z.object({
  departmentId: z.string().uuid('请选择科室'),
  doctorId: z.string().uuid('责任医生不合法').optional(),
  nurseId: z.string().uuid('责任护士不合法').optional(),
  /** 住院号必填：再入院允许换号（2026-11-26 裁定，推翻原「沿用原值」口径） */
  patientNo: z.string().trim().min(1, '请输入住院号').max(32, '住院号过长'),
  bedNo: z.string().trim().max(32, '床号过长').optional(),
});
export type AdmitPatientInput = z.infer<typeof admitPatientSchema>;
```

响应：

```ts
/** 出院结果（与 PatientAdmitResult 对称） */
export interface PatientDischargeResult {
  id: string;
  fromStatus: PatientStatus; // 'INPATIENT'
  toStatus: PatientStatus; // 'DISCHARGED'
  /** 实际发生虚拟病区自动移出时返回；两字段均在审计 detail 白名单内 */
  wardRecordId?: string;
  leaveReason?: WardLeaveReason; // 'DISCHARGE'
  item: PatientListItem; // inVirtualWard 恒为 false
}

/** PatientAdmitResult 形状不变（id / fromStatus / toStatus / item） */
```

> 出院/入院时刻均为**服务端 now**（timestamptz 落库），弹框展示的时间只是预览，
> 不作为入参（裁定 Q1）。审计 detail 由拦截器按白名单从响应体拾取
> `fromStatus/toStatus/wardRecordId/leaveReason`，无需改拦截器。

### 4. 业务规则与校验 ⭐

**出院（discharge）**：

1. 患者不存在或已归档 → `40001`；非 INPATIENT → `40004`
2. 数据范围 `assertInScope(PATIENT)`：跨科室 → `30002`，NONE 档 → `30006`
3. `dischargeAt` = 服务端 now；`status` → DISCHARGED
4. **虚拟病区自动移出**（`WARD_LEAVE_REASON.DISCHARGE` 预留值正式接入，
   virtual-ward.md §4-8 裁定义务）：事务内 `findFirst({patientId, leftAt: null})` →
   `updateMany({id, leftAt: null}, {leftAt: now, leftById: 操作人, leaveReason: 'DISCHARGE'})`；
   `count = 0`（并发已被他人移出）不阻断出院，只是不返回 `wardRecordId`
5. **R24 双写关闭**：`Admission.updateMany({patientId, dischargedAt: null},
{dischargedAt: now, dischargeRemark: 备注})` + `AdmissionDepartment.updateMany({patientId,
endedAt: null}, {endedAt: now})`。备注 trim 后空串 → NULL
6. 并发防重复：`patient.update` 的 where 带 `status: INPATIENT`，后到事务 P2025 → `40004`
7. 事务顺序：**先退区、再关双写、最后 patient.update（select 出参）**——保证返回的
   `item.inVirtualWard` 已是 false
8. 备注为自由文本：只落 `Admission.dischargeRemark`，**不进审计 detail**（白名单原则）

**办理住院（admit，升级）**：

1. 患者不存在或已归档 → `40001`；非 DISCHARGED → `40004`
2. 数据范围双判（与 `update()` 同口径）：当前科室 + 目标科室（变更时）都过 `assertInScope`，
   防「借改科室跨出数据范围」
3. 责任医生/护士按**最终生效科室**校验（`assertStaffInDepartment`，字段级 `10001`）
4. 住院号：预查 `findUnique({patientNo})`，命中**他人** → `40002`（命中自己 = 沿用原号，放行）；
   并发冲突由事务内 P2002 兜底 → `40002`
5. 覆盖式写入：`departmentId/doctorId/nurseId/patientNo/bedNo` 按入参覆盖
   （弹框回填当前值，医护清空 = 置 NULL，床号清空 = 置 NULL）
6. `admissionAt` = 服务端 now；`dischargeAt` = NULL；`status` → INPATIENT
7. R24 双写：防御性关闭上一次「进行中」记录（原逻辑保留）；新 `Admission.departmentId`
   与首条 `AdmissionDepartment.departmentId` 用**入参科室**（原来是沿用患者当前科室）
8. 并发防重复：where 带 `status: DISCHARGED`，P2025 → `40004`

### 5. 权限与数据安全 ⭐

| 项       | 选择                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能权限 | 出院 `patient:discharge`（新增）；住院 `patient:admit`（已有）。医生两者均不授予（入院/出院登记属护理与管理动作）                                     |
| 角色授予 | `patient:discharge` → NURSE / NURSE_HEAD / SYS_ADMIN（SYS_ADMIN「含全部权限点」不变式同步）                                                           |
| 数据范围 | `@RequireDataScope(RESOURCE.PATIENT)` + service 内 `assertInScope`；NONE 档 → `30006`                                                                 |
| 脱敏字段 | 弹框姓名展示 `nameMasked`（列表/详情既有脱敏值），**不新增明文出口**                                                                                  |
| 加密字段 | 不涉及（备注非加密字段，VarChar(255) 明文落 Admission 行）                                                                                            |
| 审计     | 两接口均 `@Audit('PATIENT_MANAGE')`（裁定 Q2：不新增枚举），detail 记 `fromStatus/toStatus`（出院另有 `wardRecordId/leaveReason`），DENIED 照常落审计 |

### 6. 前端交互 ⭐

**入口**：

| 入口             | 位置                                                                                                 | 行为                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 列表（住院 Tab） | `PatientMoreActions` 第 4 项「办理出院」（编辑/血糖/病区之后，裁定 7）                               | 打开出院弹框；`patient:discharge` 无权限时整项不展示                           |
| 列表（卡片视图） | 同上（共用 `PatientMoreActions`）                                                                    | 同上                                                                           |
| 列表（出院 Tab） | 操作列「办理住院」独立按钮**保留原位**（裁定 7：不收进 MoreActions），但 Popconfirm 改为打开住院弹框 | 打开住院弹框                                                                   |
| 详情页           | 「添加血糖」按钮后新增「更多操作」下拉（裁定 Q3）：住院患者 →「办理出院」；出院患者 →「办理住院」    | 打开对应弹框；无对应权限**仅隐藏该菜单项**（裁定 6），菜单为空时整个下拉不渲染 |

**出院弹框（`PatientDischargeModal`）**：

- 数据源：详情页打开时复用已加载的 `PatientDetail`（不重复请求）；列表打开时弹框内
  `fetchPatientDetail`（后端写 PATIENT_VIEW 审计，访问即留痕，合规）
- 上半部分基本信息，label:value 平铺、**每行 2 项**（Row/Col span 12），缺失展示 `-`：
  姓名（脱敏）/ 性别 / 出生日期 / 科室 / 责任医生 / 责任护士 /
  出院时间（当前日期 `YYYY-MM-DD`，预览） / 操作人（当前登录账号 `displayName`）
- 患者在虚拟病区时（`detail.inVirtualWard`）展示 Alert（warning）：
  **「该患者将自动移出虚拟病区」**（裁定 2）
- 下半部分：备注 `TextArea rows=4 maxLength=255`，可为空（裁定 1a）
- 底部：取消 + 「办理出院」（primary，提交 loading 防连点，裁定 3）
- 成功：message「已办理出院」；列表页刷新当前页（`query.refresh()`）；详情页停留原地
  刷新状态（裁定 4）
- 失败：拦截器统一提示（裁定 5），弹框不关闭、保留已填备注

**住院弹框（`PatientAdmitModal`）**：

- 数据源：同出院弹框（详情复用 / 列表拉取）
- 展示项（无输入框）：姓名（脱敏）/ 性别 / 出生日期 / 入院时间（当前日期时间
  `YYYY-MM-DD HH:mm:ss`，预览，裁定 1b）
- 表单项（回填患者当前值，可改）：
  - 科室 / 责任医生 / 责任护士：下拉，**展示逻辑与数据源同添加患者弹框**
    （`filterDepartments` 按数据范围收敛、`filterStaff` 按科室+角色联动、换科室清空医护；
    抽公共模块 `patient-form-options.ts` 供两处复用，禁止复制第二份）
  - 住院号：Input，**必填**，maxLength 32
  - 床号：Input，可空，maxLength 32
- 底部：取消 + 「办理住院」（primary，提交 loading）
- 成功：message「已办理住院」；刷新口径同出院弹框
- 住院号撞他人：`40002` toast-refresh（拦截器既有行为），弹框关闭、列表刷新后可重试

**详情页刷新机制**：`usePatientDetail` 按其注释预留方案扩展 `version` 信号
（同 id 强制重取）；出院/住院成功后 version+1 重拉详情，并 bump `glucoseVersion`
（住院记录下拉数据随状态流转变化，报表子路由需重拉）。

**权限门控**：前端显隐仅体验，后端强制校验（30004/30002/30006 照常落审计）。

### 7. 错误码与前端行为 ⭐

| 场景                                                | 错误码 | HTTP | 前端行为       |
| --------------------------------------------------- | ------ | ---- | -------------- |
| 参数不合法（住院号空/超长、备注超长、医护不属科室） | 10001  | 422  | 字段级挂表单项 |
| 患者不存在或已归档                                  | 40001  | 404  | toast          |
| 住院号已被他人占用                                  | 40002  | 409  | toast-refresh  |
| 状态冲突（并发重复办理 / 状态已变）                 | 40004  | 409  | toast-refresh  |
| 无权限点                                            | 30004  | 403  | toast          |
| 跨科室                                              | 30002  | 403  | toast          |
| NONE 档（设备管理员）                               | 30006  | 403  | toast          |

**无新增错误码**（复用 40xxx 既有码，`docs/ERROR-CODES.md` §D4 不变）。

### 8. 测试要求

- [x] server 单测（`patient.service.spec.ts`，52 例全绿）：
  - discharge：状态机（非 INPATIENT → 40004）、越权（30002/30006）、归档（40001）、
    虚拟病区自动移出（updateMany 参数 + wardRecordId 返回 + 退区先于状态更新）、
    未在区时不返回 wardRecordId、并发移出 count=0 不阻断、
    R24 双写关闭（dischargedAt/endedAt/dischargeRemark）、备注空串 → NULL、
    并发 P2025 → 40004
  - admit（升级）：入参覆盖写入（科室/医护/住院号/床号）、住院号撞他人 → 40002、
    撞自己放行、目标科室越权 → 30002、医护不属科室 → 10001 字段级、
    新 Admission.departmentId = 入参科室、原状态机/并发用例适配新签名
- [x] web 单测：`PatientModalInfo.spec.tsx`（信息行每行 2 项、缺失「-」、gc-num）+
      `PatientDetail.spec.tsx` 更多操作下拉 3 例。弹框本体依赖 antd Modal portal（node 环境
      不渲染内容），按 `GlucoseReviewModal.spec` 同一约定靠 typecheck + playwright 覆盖
- [x] playwright 实测（2026-11-26，nurse.li / dr.wang）：列表 MoreActions 第 4 项办理出院
      （在区患者 Alert 提示 + 备注落库）→ 出院 Tab 出现该行 → 办理住院弹框（回填 + 护士下拉
      联动 + 改床号 12-33）→ 住院 Tab 出现；详情页「更多操作」双态切换 + 就地刷新（状态/按钮
      随流转变化）；医生账号菜单无「办理出院」且直调接口 → 403/30004；虚拟病区当前列表消失、
      历史列表 leaveReason=DISCHARGE；审计 3 条 PATIENT_MANAGE SUCCESS（退区那条 detail 含
      wardRecordId/leaveReason）
- [x] 数据库核验：`Admission.dischargeRemark` 备注落库 / 空备注 NULL；bedNo/nurseId 覆盖写入；
      Admission seq=3 新行科室 = 入参科室；AdmissionDepartment 停留关闭
- ⚠️ 已知边界（非本轮引入）：**守卫级 30004 拒绝不落审计行**——NestJS 生命周期中
  PermissionsGuard 先于拦截器执行，`AuditLogInterceptor` 捕获不到守卫抛出的异常；
  DB 中既有 DENIED 行均来自 service 层 30002/30006。属全平台既有行为，
  如需守卫级 DENIED 审计需另立项（涉及审计逻辑，需人工评审）

### 9. 非功能要求

| 项   | 要求                                                                                  |
| ---- | ------------------------------------------------------------------------------------- |
| 性能 | 单行状态流转，事务内 ≤5 条语句，无新增索引需求                                        |
| 内网 | 不引用公网资源                                                                        |
| 等保 | 审计留痕（PATIENT_MANAGE + detail 白名单）；备注自由文本不入审计；弹框姓名用脱敏值    |
| 兼容 | antd token 取色（禁硬编码色值）、暗色模式、大字号档、`gc-num` 等宽数字（时间/住院号） |

### 10. 验收标准（可勾选）⭐

- [x] `pnpm lint && pnpm typecheck && pnpm test` 全绿（shared 103 / web 257 / server 360+）
- [x] 迁移在本地开发库执行成功（`20261126000000_add_admission_discharge_remark`，migrate deploy），
      `Admission.dischargeRemark` 可写入读出
- [x] 出院后：状态流转、虚拟病区自动移出（当前病区列表不再出现、历史行 leaveReason=DISCHARGE）、
      Admission 行关闭且备注落库（空备注 → NULL）
- [x] 办理住院：科室/医护/住院号/床号按入参覆盖，新 Admission 行科室 = 入参科室
- [x] 权限：医生无 `patient:discharge`（前端无菜单项、后端直调 → 403/30004）。
      ⚠️ 原验收含「DENIED 审计」，实测确认**守卫级拒绝不落审计行**（NestJS 守卫先于拦截器，
      全平台既有行为，见 §8 已知边界），本条按实际行为收敛
- [x] 审计：两接口 PATIENT_MANAGE 行 detail 含 fromStatus/toStatus（出院含 wardRecordId/leaveReason 当发生退区）
- [x] 文档：ROADMAP P2-6 置 ✅（完成度 75%→85%）、ARCHITECTURE.md 角色权限表登记
      patient:discharge（权限点计数修正为 30）、virtual-ward.md §4-8 与 `ward.ts` 注释更新（DISCHARGE 已接入）

### 11. 变更记录（裁定过程）

| #   | 日期       | 裁定                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-11-26 | Q1 出院时间 = 服务端 now，无回填；Q2 审计沿用 PATIENT_MANAGE（不新增枚举）；Q3 双入口（列表 MoreActions + 详情页「更多操作」下拉）；Q4 不含出入院记录 Tab 真实化                                                                                                                                                                                                                                    |
| 2   | 2026-11-26 | 交互细节：出院弹框（基本信息 8 项每行 2 个 + 备注 rows=4 可空）；住院弹框（三下拉同添加患者逻辑 + 住院号必填 + 床号，入院时间展示当前日期时间）；虚拟病区确认提示；按钮 loading；成功文案与刷新口径（列表刷新当前页、详情停留刷新）；失败走拦截器；权限门控仅隐藏对应菜单项；「办理出院」列 MoreActions 第 4 项、出院 Tab 按钮不收进 MoreActions                                                    |
| 3   | 2026-11-26 | 备注存储：`Admission.dischargeRemark String? @db.VarChar(255)` + 迁移；AI 起草单独提交标「需人工评审」；本地开发库迁移由 AI 执行，生产库由运维执行                                                                                                                                                                                                                                                  |
| 4   | 2026-11-26 | 实施细节（AI 按先例自定，可逆）：住院弹框回填当前值；住院号撞他人 → 40002、撞自己放行；admit 科室变更双判 assertInScope（同 update 口径）；详情页刷新走 usePatientDetail version 信号 + bump glucoseVersion；出院事务顺序「退区 → 关双写 → patient.update」保证 item.inVirtualWard=false                                                                                                            |
| 5   | 2026-11-26 | 落地与全链路验证：迁移已应用；三件套全绿；playwright 实测（nurse.li 列表/详情双入口出院 + 住院弹框改床号/护士 + dr.wang 无出院项且直调 403/30004 + 病区自动移出 + 审计/落库核验）通过。两项发现：① 守卫级 30004 不落审计行（NestJS 守卫先于拦截器，全平台既有行为，如需补齐另立项）；② nurse.li 演示账号密码已按首登强制改密流程改为 `Gc@2026pass2`（seed 文档口径 Gc@2026pass 仅对未改密账号有效） |
