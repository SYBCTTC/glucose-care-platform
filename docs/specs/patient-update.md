# 患者信息编辑（住院患者）

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 归档。状态：🚧 实现中（2026-10-26）

## 0. 元信息

| 项     | 内容                                             |
| ------ | ------------------------------------------------ |
| 阶段号 | P5-患者编辑                                      |
| 模块   | patient                                          |
| 优先级 | P0                                               |
| 依赖   | 患者建档（`docs/specs/patient-create.md`）已落地 |
| 需求人 | 产品                                             |

## 1. 目标与用户故事

作为 **有患者编辑权限的医护人员**，我要 **在住院患者列表/卡片上编辑患者信息**，以便 **随时纠正录错的床号、责任医生、糖尿病类型等信息**。

本次做：住院管理 → 患者管理 → 住院患者页，卡片「更多」/ 表格「更多操作」→「编辑患者信息」→ 编辑弹窗 + 编辑接口 + 详情回填接口。

本次不做：出院患者编辑（菜单置灰）、患者归档/删除/出院流转、姓名与证件号的明文回显。

## 2. 数据模型变更

| 模型        | 字段             | 类型   | 说明                 | 是否需迁移 |
| ----------- | ---------------- | ------ | -------------------- | ---------- |
| AuditAction | `PATIENT_UPDATE` | 枚举值 | 患者信息编辑审计动作 | 是         |

迁移：`apps/server/prisma/migrations/20261026100000_add_patient_update_audit/migration.sql`，仅新增枚举值，**不改表结构、无需回填存量数据**。

> Patient 表字段无变更。患者编辑只写已有列。

## 3. 接口契约

| #   | 方法  | 路径            | 权限点           | 数据范围           | 审计             |
| --- | ----- | --------------- | ---------------- | ------------------ | ---------------- |
| 1   | GET   | `/patients/:id` | `patient:view`   | `RESOURCE.PATIENT` | `PATIENT_VIEW`   |
| 2   | PATCH | `/patients/:id` | `patient:update` | `RESOURCE.PATIENT` | `PATIENT_UPDATE` |

### 3.1 详情（回填用）

响应 `PatientDetail`：在列表项基础上增加 `birthDate` / `idCardMasked` / `phoneMasked` / `remark` / `nurseId` / `diabetesType` / `hba1c` / `devices`。

**不返回任何明文身份信息**（姓名、证件号、手机号一律脱敏）。

### 3.2 编辑请求（`updatePatientSchema`，前后端同源）

字段分两类，语义不同：

```ts
{
  // ① 敏感字段：省略 = 不修改（前端留空即省略）
  name?: string;                    // ≤32
  idCard?: string | null;           // null = 清除
  phone?: string | null;            // null = 清除

  // ② 非敏感字段：整表单覆盖提交，null = 清空
  gender: Gender;                   // 必填
  birthDate: 'YYYY-MM-DD';          // 必填，不得晚于今天
  departmentId: string;             // 必填，uuid
  bedNo: string | null;
  doctorId: string | null;          // 须属所选科室且角色为 DOCTOR
  nurseId: string | null;           // 须属所选科室且角色为 NURSE/NURSE_HEAD
  diabetesType: DiabetesType | null;
  hba1c: number | null;             // 0~100，最多 1 位小数
}
```

**不可提交的字段**：`patientNo` / `admissionAt` / `status`，由 schema `omit` 掉，多传会被 strip 丢弃。

响应：`{ code: 0, data: { id: string, changedFields: string[] } }`。

`changedFields` 只含**字段名**（如 `['bedNo', 'doctorId']`），供审计留痕，不含任何值。

## 4. 业务规则与校验

1. **出院校验**：仅 `status = INPATIENT` 可编辑，否则返回 `40004`（`PATIENT_INVALID_STATE`）。前端在出院 Tab 置灰入口，后端独立兜底。
2. **数据权限**：按患者**当前**科室 `assertInScope`；若 `departmentId` 变更，还需对**目标科室**再校验一次，跨科室 → `30002`。
3. **医护归属**：以「最终生效的科室 + 最终生效的医生/护士」校验，科室改动后未同步换医生会字段级报错 `10001`。
4. **唯一性**：编辑不改住院号，不涉及 `40002`。schema 已 omit `patientNo`。
5. **加密与脱敏**：`name` / `idCard` / `phone` 有值时才重新 `encryptDeterministic` 并同步刷新 `*Masked`；`idCard = null` / `phone = null` 时把 Cipher 与 Masked 一起置空。
6. **状态字段与入院时间、住院号**：编辑弹窗内 `disabled` 展示，不可修改。
7. **编辑成功后**：卡片模式与表格模式均**本地更新该行/卡**，不整页重查，避免卡片模式滚动位置跳回顶部。

## 5. 权限与数据安全

| 项       | 内容                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| 功能权限 | `PATCH`：`@RequirePermissions(PERMISSION.PATIENT_UPDATE)`；`GET`：`PATIENT_VIEW`                                   |
| 权限分配 | `NURSE` / `NURSE_HEAD` / `SYS_ADMIN`（与「添加患者」能力对齐；如需收紧到护士长及以上，改 `ROLE_PERMISSIONS` 一行） |
| 数据范围 | `@RequireDataScope(RESOURCE.PATIENT)` + 服务端 `assertInScope`（当前科室 + 目标科室）                              |
| 脱敏字段 | 姓名、身份证、手机号；详情接口只返回 `*Masked`                                                                     |
| 加密字段 | `nameCipher` / `idCardCipher` / `phoneCipher`（`encryptDeterministic`）                                            |
| 审计     | `PATIENT_UPDATE`，`detail.changedFields` 记变更字段名；查看详情走 `PATIENT_VIEW` 单独留痕                          |

### 5.1 敏感字段回填口径（关键设计决策）

姓名 / 身份证 / 手机号**只存密文与脱敏值，无明文列**（`Patient.nameCipher` 等，`field-crypto.ts` 在生产环境为 HMAC-SHA256，不可逆），因此**无法把明文回填进编辑弹窗**。

采用口径：

- 输入框留空，`placeholder` 展示脱敏值并提示「留空则不修改」
- 用户输入新值才提交该字段；留空则整个字段从请求体中省略，后端不动原值
- 身份证 / 手机号额外提供「清除」操作，提交 `null` 清空（因「留空」已表示不变，无法表达删除）

后果：医护看不到完整姓名/证件号。若后续确有明文查看需求，需另立「查看完整信息」接口 + 独立权限点 + 审计，属安全架构变更，不在本期范围。

## 6. 前端交互

- 入口一：卡片视图 `更多` → `编辑患者信息`（`PatientCardGrid`）
- 入口二：表格视图 `更多操作` → `编辑患者信息`（`PatientTable` 操作列）
- 出院患者 Tab：入口**置灰**并 tooltip「出院患者不支持编辑患者信息」
- 无 `patient:update` 权限：入口不展示
- 弹窗复用 `PatientFormFields`（与「添加患者」同一套字段与校验规则），标题「编辑患者信息」，宽 760
- 只读字段：住院号、入院时间、状态
- 联动：切换科室清空责任医生/护士；初始回填不触发清空
- 校验：前端复用 `updatePatientSchema` 校验请求体，字段级错误映射到表单项
- 提交：非敏感字段整表单覆盖提交，敏感字段仅在有新值/显式清除时才出现；后端返回 `changedFields` 为空时提示「未做修改」

## 7. 错误码

| 场景                      | 码      | HTTP | 前端行为            |
| ------------------------- | ------- | ---- | ------------------- |
| 必填/格式/范围/医护归属   | `10001` | 422  | 字段级              |
| 缺 `patient:update`       | `30004` | 403  | toast（并重拉权限） |
| 跨科室编辑 / 改到无权科室 | `30002` | 403  | toast（并重拉权限） |
| 患者不存在或已归档        | `40001` | 404  | toast + 刷新        |
| 出院患者调用编辑          | `40004` | 409  | toast + 刷新        |

## 8. 验证记录

2026-10-26 端到端验证（`sys.admin` / `dr.wang`，演示数据）：

| #   | 场景                                          | 结果                                                                                         |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `GET /patients/:id`                           | 200，返回 `birthDate/nurseId/diabetesType/hba1c/devices`，无任何明文字段                     |
| 2   | `PATCH` 改床号 + 糖尿病类型 + hba1c           | 200，`changedFields = [bedNo, diabetesType, hba1c]`                                          |
| 3   | 重复提交同一份数据（幂等）                    | 200，`changedFields = []`                                                                    |
| 4   | 请求体多传 `patientNo / admissionAt / status` | 被 schema strip，患者住院号/状态/入院时间未变                                                |
| 5   | 编辑出院患者                                  | 409 / `40004`                                                                                |
| 6   | `dr.wang`（DOCTOR，无 `patient:update`）调用  | 403，符合权限设计                                                                            |
| 7   | 审计留痕                                      | `PATIENT_VIEW` 1 条、`PATIENT_UPDATE` 成功 4 条 / 失败 2 条；`detail.changedFields` 正确落库 |

未覆盖：护士跨科室编辑的端到端验证。`nurse.li` 演示账号处于「首次登录必须改密」状态，登录后被改密守卫拦下，未为此改动演示账号。该分支与建档共用 `assertInScope`，已有 `scope.util.spec.ts` 单测覆盖。

2026-10-27 自动化测试（`apps/server/src/modules/patient/patient.service.spec.ts`，14 例，只 mock `PrismaService`）：

- **已覆盖**：出院 / 已归档 / 不存在三类拦截；患者当前科室越权；改目标科室的二次判权；责任医生、护士不属于科室（校验 `details` 定位到字段）；敏感字段省略则保留密文；显式 `null` 同时清空密文与脱敏值；改名重算密文与 `nameMasked`；无变更时不写库且 `changedFields` 为空；`hba1c` 按 `Decimal` 保一位小数；详情出参不含 `name/idCard/phone` 明文键。
- **未覆盖**：controller 层（`@RequirePermissions` / `@RequireDataScope` / `@Audit` 是否真正生效）、Prisma 真实读写与唯一约束冲突。补齐需独立测试库，本次未搭。
- `create()` 路径无自动化测试，不在本次改动范围。

## 9. 待确认项

1. `PATIENT_UPDATE` 初始授予 `NURSE` / `NURSE_HEAD` / `SYS_ADMIN`（与建档能力对齐）。若产品要求「护士只能建档不能改档」，从 `ROLE_PERMISSIONS.NURSE` 删掉该权限点即可，前后端同步生效。
2. 查看详情（`GET /patients/:id`）会因打开编辑弹窗而产生一条 `PATIENT_VIEW` 审计。若审计量过大，可改为「编辑弹窗打开时不单独留痕」，但这会削弱等保可追溯性，不建议。
3. `updatePatientSchema` 中原有的 `id` 字段已废弃（患者 ID 走 URL path），旧死代码已重写。
4. 审计拦截器补了一层「从响应信封 `data` 里取白名单字段」。此前只扫描顶层，导致 `changedFields` 这类写在 `data` 里的字段永远进不了审计（`PATIENT_CREATE` 的 `targetId` 为空也是同一原因）。属于审计逻辑改动，已实现但**建议人工复审** `audit-log.interceptor.ts` 的 `pickPayloadFields`。
5. ~~**存量问题（非本次引入，未修）**：`schema.prisma` 的 `AuditAction` 缺少 `GLUCOSE_VIEW / GLUCOSE_INPUT / GLUCOSE_EXPORT`……需人工决定如何对齐。~~
   ✅ **已于 2026-11-17 解决**（提交 `3813f93`）：三个历史值已补回 `schema.prisma` 并按实库 `pg_enum` 顺序重排，
   注明"仅用于读取旧审计行，新代码禁止使用"；库漂移清零，`prisma.auditLog.groupBy()` 已可正常调用（本次核对即用它统计 `result` 分布）。
   处置过程见 `docs/DB-MIGRATION-NOTES.md` §2.3 / §4。
6. **仍未修（2026-11-17 复核确认）**：上文第 2、4 项提到的审计语义问题范围比原判断更大——
   `AuditLogInterceptor` 用 `error instanceof ForbiddenException` 判 `DENIED`，但**全仓没有任何守卫或 service 抛 `ForbiddenException`**
   （`PermissionsGuard` / `JwtAuthGuard` / `MustChangePasswordGuard` / `assertInScope` 一律抛 `BusinessException`），
   实测审计表 `SUCCESS 209 / FAILED 44 / DENIED 1`，即**越权事件实际全部记为 `FAILED`**，且 `detail` 不含错误码，
   无法从审计表筛出越权尝试。另 `detail.requestId` 存的是 `context.getClass().name`（如 `AuthController`）而非请求 UUID，
   无法与 `RequestIdMiddleware` 生成的 `X-Request-Id` 及服务端日志关联。两项均属等保可追溯性缺口，待决策。
