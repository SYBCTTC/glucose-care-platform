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

1. ~~医生（`DOCTOR`）是否需要建档权限？~~
   ✅ **已确认并实现**（2026-11-17，提交 `8e22a4b`）：`ROLE_PERMISSIONS.DOCTOR` 已加 `PATIENT_CREATE`。
   数据范围未放宽——`DOCTOR` 仍是 `DEPARTMENT`，`create` 第一行的 `assertInScope` 保证只能建本科室患者，
   跨科室抛 `30002` 并记 `DENIED` 审计。未一并授予 `PATIENT_UPDATE` / `PATIENT_ADMIT`。
   前端无需改动：`PatientToolbar` 已按 `hasPermission(PATIENT_CREATE)` 控制按钮。

2. ~~越权（`30002`）在审计表中记为 `FAILED` 而非 `DENIED`~~
   ✅ **已修**（2026-11-17，提交 `db8f363`）：改为按 `3xxxx` 码段判 `DENIED`，`detail` 增加 `errorCode`。
   本条建议的修法即为最终实现；同时修掉 `detail.requestId` 误存控制器类名的问题。
   存量审计行不回改（append-only），按 `createdAt` 分界解读。

3. **仍未修 → 已给出三个方案待需求人选择**：建档后审计 `targetType/targetId` 为空。
   拦截器只从 URL `params.id` 取值（`audit-log.interceptor.ts:117-118`），`POST /patients` 没有 `:id`，
   新患者 ID 只在**响应体**里。

   范围核实（2026-11-17）：全仓带 `@Audit` 的路由共 6 个，其中 5 个路径含 `:id` 且**都是患者相关**
   （`PATIENT_VIEW` / `PATIENT_UPDATE` / `PATIENT_MANAGE` / `GLUCOSE_CREATE`），只有 `PATIENT_CREATE` 取不到 ID。
   因此 `targetType` 硬编码 `'PATIENT'` 目前**恰好没错**，但属潜在隐患：
   将来给设备或字典的 `:id` 路由加 `@Audit` 就会误记成 `PATIENT`。

   | 方案 | 做法 | 优点 | 缺点 | 工作量 |
   |---|---|---|---|---|
   | **A（推荐）** | `@Audit` 增加可选参数声明 ID 来源，如 `@Audit('PATIENT_CREATE', { targetType: 'PATIENT', targetIdFrom: 'data.id' })`；拦截器在成功路径按**点号路径**从响应体取值（手写 split 遍历，不用 `eval` / `new Function`） | 声明式、集中在装饰器；对所有 create 类接口通用（患者/设备/字典）；顺带解决 `targetType` 硬编码；业务代码零改动 | 只覆盖成功路径（失败时本就没有新 ID，可接受）；需实现并单测路径取值 | 小：装饰器 + 拦截器 + 单测 |
   | B | service 创建成功后自己调 `AuditService` 补写一条带 `targetId` 的审计 | 精确，还能记录变更前后关键字段 | 与拦截器机制并存 → 两套写入路径，容易漏写或重复写；service 被审计关注点污染，违反分层职责 | 中 |
   | C | 拦截器隐式约定：响应体里有 `data.id` 就当 `targetId` | 零配置 | 隐式约定不可控：列表接口的 `data.id`、嵌套对象的 `id` 语义都不同，容易误取；出问题难排查 | 小但不推荐 |

   推荐 **A**：与现有 `AUDIT_DETAIL_ALLOW_LIST` 的白名单思路一致（显式声明、集中管控），
   且能一次解决 `targetType` 硬编码。属审计逻辑改动，按 `AGENTS.md` §6-5 需人工评审后实施。
