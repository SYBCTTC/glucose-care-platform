# 患者建档（添加患者）

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 归档。状态：✅ 已实现（2026-10-26）

## 0. 元信息

| 项 | 内容 |
|---|---|
| 阶段号 | P4-患者建档 |
| 模块 | patient |
| 优先级 | P0 |
| 依赖 | 公共数据（`DY-DEPT` / `DY-DOCTOR` / `DY-OPERATOR`）已落地 |
| 需求人 | 产品 |

## 1. 目标与用户故事

作为 **有建档权限的医护人员**，我要 **在住院患者页添加患者**，以便 **把新入院患者纳入统一管理**。

本次做：住院管理 → 患者管理 → 住院患者页右上角「添加患者」弹窗 + 建档接口。
本次不做：批量添加、模板下载、批量导入、患者编辑/详情/归档。
（其中「患者编辑」已在 `docs/specs/patient-update.md` 单独落地。）

## 2. 数据模型变更

| 模型 | 字段 | 类型 | 说明 | 是否需迁移 |
|---|---|---|---|---|
| Patient | `gender` | `VarChar(16)` | 由 8 放宽，容纳 `UNSPECIFIED` | 是 |
| Patient | `diabetesType` | `VarChar(32)` | 存 `DIABETES_TYPE` code | 是 |
| Patient | `hba1c` | `Decimal(4,1)` | 糖化血红蛋白（%），0~100，1 位小数 | 是 |
| Patient | `nurseId` | `Uuid` | 责任护士，关联 `User`（`PatientNurse`） | 是 |
| User | `nursePatients` | 关系 | `Patient[] @relation("PatientNurse")` | 是 |
| AuditAction | `PATIENT_CREATE` | 枚举值 | 建档审计动作 | 是 |

迁移：`apps/server/prisma/migrations/20261026090000_add_patient_create_fields/migration.sql`，列均可空，**无需回填存量数据**。
`patientNo` 库层保持可空（历史数据存在 null），必填约束放在接口契约层。

## 3. 接口契约

| # | 方法 | 路径 | 权限点 | 数据范围 | 审计 |
|---|---|---|---|---|---|
| 1 | POST | `/patients` | `patient:create` | `RESOURCE.PATIENT` | `PATIENT_CREATE` |

请求（`createPatientSchema`，前后端同源）：

```ts
{
  name: string;              // 必填，≤32
  gender: Gender;            // 必填，MALE/FEMALE/UNSPECIFIED
  birthDate: 'YYYY-MM-DD';   // 必填，不得晚于今天
  patientNo: string;         // 必填，院内唯一，≤32
  departmentId: string;      // 必填，uuid
  admissionAt: 'YYYY-MM-DD HH:mm:ss'; // 必填
  status: 'INPATIENT';       // 必填，本期仅住院患者
  idCard?: string;           // 18 位，末位可 X
  phone?: string;            // 1[3-9] + 9 位
  bedNo?: string;
  doctorId?: string;         // 须属所选科室且角色为 DOCTOR
  nurseId?: string;          // 须属所选科室且角色为 NURSE/NURSE_HEAD
  diabetesType?: DiabetesType;
  hba1c?: number;            // 0~100，最多 1 位小数
}
```

响应：`{ code: 0, data: { id: string } }`。

## 4. 业务规则与校验

1. 住院号院内唯一，重复 → `40002`；并发重复由 Prisma `P2002` 兜底同样返回 `40002`。
2. 姓名 / 身份证 / 手机号加密存 `*Cipher`，同时写 `*Masked`，接口不返回明文。
3. 科室必须落在当前账号数据范围内（`assertInScope`），跨科室 → `30002`；`NONE` 档角色 → `30006`。
4. 责任医生必须属于所选科室且角色为医生；责任护士必须属于所选科室且角色为护士/护士长，否则字段级 `10001`。
5. 状态只允许 `INPATIENT`（本期不做建档即出院），选择其他值 → 字段级 `10001`。
6. 糖化血红蛋白 0~100、最多 1 位小数，越界 → 字段级 `10001`。
7. 建档成功后不自动跳转，刷新当前列表（卡片模式回到第 1 页）。

## 5. 权限与数据安全

| 项 | 内容 |
|---|---|
| 功能权限 | `@RequirePermissions(PERMISSION.PATIENT_CREATE)`；按钮显隐同源判断 |
| 权限分配 | `NURSE` / `NURSE_HEAD` / `SYS_ADMIN`（医生默认无建档权，如需开通改 `ROLE_PERMISSIONS` 一行） |
| 数据范围 | `@RequireDataScope(RESOURCE.PATIENT)` + 服务端 `assertInScope` |
| 脱敏字段 | 姓名、身份证、手机号（后端 `maskName/maskPhone/maskIdCard`） |
| 加密字段 | `nameCipher` / `idCardCipher` / `phoneCipher`（`encryptDeterministic`） |
| 审计 | `PATIENT_CREATE`，成功 SUCCESS、失败 FAILED；越权记为 FAILED（见待确认项 2） |

## 6. 前端交互

- 入口：`/inpatient/patients` 住院 Tab 右上角「添加患者」，受 `patient:create` 控制。
- 弹窗 `PatientCreateModal`：两列布局（宽 760），左列 = 姓名/出生日期/床号/手机号/责任医生/糖尿病类型/糖化血红蛋白；右列 = 性别/身份证/住院号/科室/责任护士/入院时间/状态。
- 联动：未选科室时责任医生、责任护士禁用；选科室后按 `departmentId` 过滤（医生取 `DOCTOR`，护士取 `NURSE`/`NURSE_HEAD`），切换科室清空已选医护。
- 出生日期 `YYYY-MM-DD`；入院时间 UI 选到分钟 `YYYY-MM-DD HH:mm`，提交补 `:00`。
- 校验：前端复用 `createPatientSchema`，字段级错误映射到表单项；其余错误由请求拦截器统一提示。

## 7. 错误码

| 场景 | 码 | HTTP | 前端行为 |
|---|---|---|---|
| 必填/格式/范围/医护归属/状态非法 | `10001` | 422 | 字段级 |
| 缺 `patient:create` | `30004` | 403 | toast（并重拉权限） |
| 跨科室建档 | `30002` | 403 | toast（并重拉权限） |
| 角色无患者数据权限 | `30006` | 403 | toast |
| 住院号重复 | `40002` | 409 | toast + 刷新 |

## 8. 验证记录

- `pnpm lint` / 前后端 `tsc --noEmit` / `pnpm test` 全绿。
- 接口实测（sys.admin）：建档成功；重复住院号 `40002`；护士填医生 `10001(nurseId)`；`status=DISCHARGED` → `10001`；`hba1c=100.5` → `10001`。
- 数据权限实测（nurse.li，DEPARTMENT）：向心内科建档 `30002`，向本科室内分泌科建档成功。
- 落库核对：`gender=UNSPECIFIED`、`diabetesType=TYPE_2`、`hba1c=7.5`、`nurseId`/`doctorId` 关联正确、`nameMasked=欧*明`、身份证/手机号仅存密文与脱敏值。
- 审计核对：`PATIENT_CREATE` 成功/失败各留痕。

## 9. 待确认项

1. 医生（`DOCTOR`）是否需要建档权限？当前未授予，开通只需在 `ROLE_PERMISSIONS.DOCTOR` 增加 `PATIENT_CREATE`。
2. 越权（`30002`）在审计表中记为 `FAILED` 而非 `DENIED`：审计拦截器用 `error instanceof ForbiddenException` 判断，而业务异常是 `BusinessException`。建议后续单独修（按 `3xxxx` 码段判 `DENIED`）。
3. 建档后审计 `targetType/targetId` 为空：拦截器只从 URL `params.id` 取值。建议后续让 `@Audit` 支持从响应体取对象 ID。
