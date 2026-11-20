# 血糖报告表单查询（住院记录 × 科室记录 × 时间范围）

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 归档。状态：✅ **已实施**（2026-11-20 需求人提出 R24，
> 同日 18 项裁定 Q1–Q18；裁定 Q1a 先出设计稿，需求人评审通过后同日实施落地，
> 实施记录见 §12）。
>
> 上游规格：`docs/specs/glucose-report.md`（报表本体，R1–R23）。本规格是其查询维度扩展：
> 统计栏行（R20 预留位）挂表单，报表数据按「住院记录 → 科室记录 → 时间范围」联动筛选。
>
> ⚠️ 本设计含 **Prisma schema 变更（两张新表 + AuditAction 枚举值）**，属人工评审项：
> schema 草案见 §2，评审通过后方可进入实施轮。

## 0. 元信息

| 项 | 内容 |
|---|---|
| 阶段号 | P3-2 血糖查询延伸（`docs/specs/glucose-report.md` 同阶段）；住院记录数据模型属 P4-患者域扩展 |
| 模块 | 后端 `modules/patient`（或新 `modules/admission`，实施时定）+ `modules/glucose`（report 参数升级）；前端 `pages/inpatient/patient-detail`（表单组件）；共享包 `glucose/schema.ts`（query 升级）+ 新增 admission 契约 |
| 优先级 | P1 |
| 依赖 | 患者详情页框架、`GET /patients/:id/glucose/report`（R23 现状）、`scope.util.ts`、`AuditLogInterceptor` |
| 需求人 | 产品（2026-11-20 提出，18 项裁定 Q1–Q18） |

## 0.1 决策记录（需求人裁定，2026-11-20）

| # | 裁定 |
|---|---|
| Q1 | **本轮只出表/接口设计，下轮实施**（不改代码） |
| Q2 | 新建 `Admission` 表；`Patient.admissionAt/dischargeAt/status` **保留并双写**，列表接口不动，后续再废弃 |
| Q3 | 科室停留表名 **`AdmissionDepartment`**；**加冗余 `patientId` 列**（按患者查免 join） |
| Q4 | 新增 `GET /patients/:id/admissions` **一次性树形下发**（住院记录 + 各自科室记录），联动纯本地；走数据权限 + 审计 |
| Q5 | 住院记录选项**带次数前缀**：`第2次 (2026-01-01 ~ 2026-01-15)`（`YYYY-MM-DD`，两位年为笔误） |
| Q6 | 住院记录**按入院时间降序**（最近的排最前） |
| Q7 | 在院患者 `admittedAt` 为空（老数据）：「本次住院」照常可选、区间显示为空 |
| Q8 | 科室选项 label：`科室名 (YYYY-MM-DD ~ YYYY-MM-DD)`，进行中 `科室名 (YYYY-MM-DD ~ 至今)` |
| Q9 | 切历史住院记录 → 科室默认选**该次住院第一条**（入院科室） |
| Q10 | 住院=「全部」时选中某科室记录 → 开始/结束时间**同样联动**该记录起止 |
| Q11 | 科室下拉**允许清空**：清空 = 不按科室过滤、时间无限制 |
| Q12 | 时间控件**设上下限**：限所选科室记录 `[startedAt, endedAt ?? 今天]`；无科室记录时按住院记录范围；「全部」+科室清空 → 无限制 |
| Q13 | 开始/结束时间**允许单独清空**（= 该侧不限）；开始 > 结束 → **阻止查询并校验提示** |
| Q14 | 范围外血糖**不展示、不统计**：统计栏数字随筛选范围变化，但展示与计算口径不动 |
| Q15 | **初始加载即按默认条件查询**（在院 = 本次住院 + 当前科室 + 默认时间；出院 = 全部 + 无限制） |
| Q16 | 报表契约 `startDate/endDate`（天粒度）**直接升级为秒粒度**（破坏性，前后端同轮改齐）；查询后页码重置第 1 页；R22 勾选与 R23 全屏在查询结果上照常叠加 |
| Q17 | 「重值」= **重置**：恢复进入页面时的默认态（按患者状态重算），**不是清空** |
| Q18 | 布局方案 a：表单挂统计栏同一行，**接受换行**（flexWrap），全屏按钮保持最右；全屏态该行随统计栏固定视口顶部、表单照常可用 |

## 1. 目标与用户故事

作为 **医生 / 护士**，我要 **按住院次数、科室停留与时间范围筛选血糖报告**，
以便 **查看患者各个时期（历次住院）以及时间段（科室内）的血糖情况**。

本次范围（做，实施轮）：

- `Admission` + `AdmissionDepartment` 两张新表、部分唯一索引 SQL、存量数据迁移回填（§2）
- 既有写入口**双写改造**：建档（第一次住院）、办理住院 `admit()`（第 N 次住院）（§2.4）
- 新接口 `GET /patients/:id/admissions`（§3.1）
- 报表接口 query 契约升级：天粒度 → 秒粒度 `startTime/endTime`（§3.2，破坏性）
- 统计栏行表单：住院记录/科室记录下拉 + 开始/结束时间（秒级）+ 查询/重置，联动状态机（§4/§6）

本次不做（明确排除）：

- **转科功能模块**（本轮只落表结构；转科 = 关闭旧 `AdmissionDepartment` + 开新条，后续需求）
- 统计栏展示与计算口径改动（R20 不动，数字随范围自然变化——Q14）
- 全屏按钮逻辑改动（R23 不动）
- `Patient.admissionAt/dischargeAt/status` 旧字段废弃（Q2：保留双写，后续单独评审）

## 2. 数据模型变更（⚠️ 人工评审项）

### 2.1 `Admission`（住院记录：一行 = 一次住院）

```prisma
/// 住院记录：一行 = 一次住院。seq = 第几次住院（患者内唯一，从 1 起）。
/// dischargedAt NULL = 本次住院（在院）。R24-Q2：Patient.admissionAt/dischargeAt/status
/// 保留并双写，列表接口仍读旧字段；旧字段废弃属后续独立评审。
model Admission {
  id           String    @id @default(uuid()) @db.Uuid
  patientId    String    @db.Uuid
  /// 第几次住院（label 前缀「第N次」的数据源，R24-Q5）
  seq          Int
  /// 可空：兼容存量老数据（R24-Q7，同 Patient.admissionAt 可空口径）
  admittedAt   DateTime? @db.Timestamptz(3)
  /// NULL = 在院（本次住院）
  dischargedAt DateTime? @db.Timestamptz(3)
  /// 入院科室（首科室；科室轨迹见 AdmissionDepartment）
  departmentId String    @db.Uuid
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  patient         Patient               @relation(fields: [patientId], references: [id], onDelete: Cascade)
  department      Department            @relation(fields: [departmentId], references: [id])
  departmentStays AdmissionDepartment[]

  @@unique([patientId, seq])
  @@index([patientId, admittedAt(sort: Desc)])
}
```

### 2.2 `AdmissionDepartment`（科室停留：一行 = 一次住院中在某个科室的一段连续停留）

```prisma
/// 科室停留（转科轨迹）：endedAt NULL = 当前在科。
/// 「每次住院至多一条进行中」由部分唯一索引保证（Prisma 表达不了，
/// 见 prisma/sql/admission_one_active_department.sql，同 ward_one_active.sql 模式）。
/// 转科功能模块后续实现（R24 只落表结构）：转科 = 关闭旧行 endedAt + 开新行。
model AdmissionDepartment {
  id           String    @id @default(uuid()) @db.Uuid
  admissionId  String    @db.Uuid
  /// 冗余列（R24-Q3）：按患者取全部科室记录免 join；删患者随 Cascade
  patientId    String    @db.Uuid
  departmentId String    @db.Uuid
  /// 可空：兼容 admittedAt 为空的存量数据（R24-Q7）
  startedAt    DateTime? @db.Timestamptz(3)
  /// NULL = 当前在科
  endedAt      DateTime? @db.Timestamptz(3)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  admission  Admission  @relation(fields: [admissionId], references: [id], onDelete: Cascade)
  patient    Patient    @relation(fields: [patientId], references: [id], onDelete: Cascade)
  department Department @relation(fields: [departmentId], references: [id])

  @@index([admissionId, startedAt])
  @@index([patientId])
}
```

部分唯一索引 SQL（`prisma/sql/admission_one_active_department.sql`，迁移后手工执行，同 ward 先例）：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "AdmissionDepartment_one_active_per_admission"
  ON "AdmissionDepartment"("admissionId")
  WHERE "endedAt" IS NULL;
```

关系反向引用（schema 改动清单）：`Patient` 加 `admissions Admission[]` +
`admissionDepartments AdmissionDepartment[]`；`Department` 加对应反向关系；
`AuditAction` 枚举加 `ADMISSION_QUERY`（§5）。

### 2.3 存量迁移回填（幂等，可重跑）

1. **每个患者**（含已归档）生成一条 `Admission`：`seq=1`、`admittedAt=Patient.admissionAt`、
   `dischargedAt=Patient.dischargeAt`、`departmentId=Patient.departmentId`；
   已存在 `Admission` 的患者跳过（幂等键 `patientId`）
2. 每条 `Admission` 生成一条 `AdmissionDepartment`：`startedAt=admittedAt`、`endedAt=dischargedAt`
   （在院则 NULL）；已存在停留记录跳过（幂等键 `admissionId`）
3. 迁移脚本形态与执行方式（`prisma/seed.ts` 之外的一次性脚本 or migrate deploy 钩子）实施轮定，
   参照 `docs/DB-MIGRATION-NOTES.md` 既有流程；**回填前备份库**

### 2.4 双写改造（实施轮必做，否则新住院患者无下拉数据）

| 写入口 | 现状 | 双写改造 |
|---|---|---|
| 建档 `patient.service.ts create()` | 写 `Patient.admissionAt/status` | 同事务创建 `Admission(seq=1)` + 首条 `AdmissionDepartment` |
| 办理住院 `admit()`（出院→在院，**第 N 次住院的产生点**） | 写 `Patient.status/admissionAt=new Date()/dischargeAt=null` | 同事务创建 `Admission(seq=max+1, admittedAt=now)` + 首条 `AdmissionDepartment(startedAt=now)` |
| 出院操作 | **当前未发现独立写入口**（`dischargeAt` 只在建档输入与查询排序出现）——实施轮核实现状；若出院功能落地：写 `Patient.dischargeAt` 同时关闭 `Admission.dischargedAt` + 进行中 `AdmissionDepartment.endedAt` | 同左 |
| 转科 | 未实现 | 本轮不做；实现时关闭旧停留 + 开新停留（同事务） |

## 3. 接口契约

### 3.1 新增 `GET /patients/:id/admissions`（下拉数据源，一次性树形下发）

| 项 | 内容 |
|---|---|
| 权限点 | `PERMISSION.PATIENT_VIEW`（同详情页） |
| 数据范围 | `RESOURCE.PATIENT`：`assertInScope`（越权 → 30002/40001，口径同报表接口） |
| 审计 | `@Audit('ADMISSION_QUERY', { targetType: 'PATIENT' })`——患者数据查询逐条留痕；DENIED 按 3xxxx 号段落审计 |
| 缓存 | 前端 TanStack Query 按患者 id 缓存；换患者重新请求 |

响应（shared 新增类型，前后端共用）：

```ts
/** 科室停留记录（转科轨迹的一段） */
interface AdmissionDepartmentOption {
  id: string;
  departmentId: string;
  /** 科室名由库下发（同 TimeSlot.name 口径：前端禁止硬编码、禁止按名称匹配） */
  departmentName: string;
  /** YYYY-MM-DD HH:mm:ss 本地时间；可空（R24-Q7 老数据） */
  startedAt: string | null;
  /** null = 当前在科 */
  endedAt: string | null;
}

/** 一次住院记录 */
interface AdmissionOption {
  id: string;
  /** 第几次住院（label 前缀「第N次」） */
  seq: number;
  admittedAt: string | null;
  /** null = 在院（本次住院） */
  dischargedAt: string | null;
  /** dischargedAt === null；前端「本次住院」选项的判定依据 */
  isCurrent: boolean;
  /** 该次住院的科室停留，按 startedAt 升序（NULLS FIRST） */
  departments: AdmissionDepartmentOption[];
}

interface AdmissionsResponse {
  /** 按 admittedAt 降序（R24-Q6），NULLS LAST；在院的那条天然排最前 */
  admissions: AdmissionOption[];
}
```

### 3.2 报表接口 query 升级（破坏性，R24-Q16，前后端同轮改齐）

`glucoseReportQuerySchema`：`startDate/endDate`（`YYYY-MM-DD` 天粒度）→
**`startTime/endTime`（`YYYY-MM-DD HH:mm:ss` 秒粒度，本地时间）**：

```ts
export const glucoseReportQuerySchema = z.object({
  /** YYYY-MM-DD HH:mm:ss 本地时间，含该秒；不传则不限起点（服务端 parseLocalDateTime 解析，同 R 系报表本地日界口径） */
  startTime: z.string().trim().regex(DATETIME_PATTERN).optional(),
  /** 同上；不传则不限终点 */
  endTime: z.string().trim().regex(DATETIME_PATTERN).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(GLUCOSE_REPORT_PAGE_SIZE),
});
```

- **不加 `admissionId/admissionDepartmentId` 参数**：血糖记录没有住院归属字段，
  住院/科室选择最终都投影为 `measuredAt` 的时间范围——服务端只按时间过滤，
  下拉选择是纯前端 UI 状态（联动推导时间默认值与上下限）。契约保持最小
- 过滤语义（Q14）：`measuredAt ∈ [startTime, endTime]`（闭区间，秒级）；
  **行分组、统计栏（总计/合格/最高/最低）、分页 total 全部基于过滤后的记录**——
  某天只有部分记录在范围内时，该行显示且只显示范围内记录
- `startTime > endTime` → 10001 + `details[{field:'startTime'}]`（服务端兜底，前端已拦截）
- 既有调用方（`useGlucoseReport`）同轮改参数名；`GLUCOSE_REPORT_PAGE_SIZE`、响应结构不变

## 4. 业务规则与校验（前端联动状态机）

### 4.1 初始态（进入血糖报告子 Tab / 换患者，Q15：初始加载即按默认条件查询）

| 患者状态 | 住院记录 | 科室记录 | 开始时间 | 结束时间 |
|---|---|---|---|---|
| 在院（存在 `isCurrent` 记录） | 「本次住院」 | 该次住院**进行中**的停留（`endedAt=null`） | 该停留 `startedAt` | 空（在科中） |
| 出院 | 「全部」 | 空（清空） | 空 | 空 |
| 无任何住院记录（防御，迁移后不应出现） | 「全部」 | 空 | 空 | 空 |

### 4.2 住院记录下拉

- 选项构成：
  - **在院患者**（第 N 次住院）：`本次住院`（= `isCurrent` 那条，label 固定文案）
    \+ N-1 条历史 `第N次 (YYYY-MM-DD ~ YYYY-MM-DD)` + `全部`
  - **出院患者**（共 N 次）：N 条 `第N次 (…)` + `全部`（无「本次住院」项）
  - 日期为空（Q7）：省略区间部分，只显示 `第N次`
- 排序：接口已按 `admittedAt` 降序下发，前端保持原序渲染；「全部」恒为末项
- 切换联动：
  - 选「本次住院」/某历史住院 → 科室选项 = 该住院 `departments`；科室默认选中：
    本次住院 → 进行中那条；历史住院 → **第一条**（入院科室，Q9）；时间 = 所选科室记录起止（Q12 上下限同步）
  - 选「全部」→ 科室**选中值清空**；科室选项 = 所有住院的 `departments` 平铺
    （每段停留一条、各带区间，跨住院同科室出现多条属正常）；时间清空、无上下限

### 4.3 科室记录下拉

- label（Q8）：`科室名 (YYYY-MM-DD ~ YYYY-MM-DD)`；进行中 `科室名 (YYYY-MM-DD ~ 至今)`；
  `startedAt` 为空则 `科室名 (~ 至今)` / `科室名`（省略空部分）
- `allowClear`（Q11）：清空 = 不按科室过滤；**时间上下限解除**，时间值回退为
  所选住院记录的 `[admittedAt, dischargedAt]`（「全部」时清空）——此为设计补充，见 §11-1
- 选中某条（含「全部」场景，Q10）→ 开始时间 = `startedAt`、结束时间 = `endedAt`（null → 空）；
  上下限 = `[startedAt, endedAt ?? 今天]`
- 用户手改时间后再切住院/科室 → **默认值覆盖**用户输入（需求规则 4 原文口径）

### 4.4 时间控件

- `DatePicker showTime`，format `YYYY-MM-DD HH:mm:ss`；秒粒度
- 上下限（Q12）：`disabledDate/disabledTime` 按当前生效范围（科室记录 > 住院记录 > 无限制）计算；
  上限「今天」= 本地当日 23:59:59
- 允许单独清空 = 该侧不限（Q13）
- `开始 > 结束` → 表单校验错误、**阻止查询**（Q13）；服务端 10001 兜底

### 4.5 查询 / 重置

- **查询**：按当前表单推导 `startTime/endTime`（秒级闭区间）请求报表；页码重置第 1 页（Q16）；
  R22 展示勾选（纯前端过滤）与 R23 全屏在查询结果上照常叠加
- **重置**（Q17）：恢复 §4.1 初始态（按患者状态重算默认值）并**自动按默认条件查询**
  （与初始加载一致）——自动查询为设计补充，见 §11-2
- 换患者：表单状态、查询结果全部重置（同 `page/fullscreen/reportDisplay` 既有模式）

## 5. 权限与数据安全

| 项 | 内容 |
|---|---|
| 功能权限 | `@RequirePermissions(PERMISSION.PATIENT_VIEW)`（admissions 接口）；报表接口权限不变 |
| 数据范围 | `@RequireDataScope(RESOURCE.PATIENT)` + `assertInScope`；NONE 档（设备管理员）→ 30006；跨科室 → 30002，DENIED 落审计 |
| 脱敏 | 下发内容仅科室名与时间，无患者敏感明文；不新增脱敏/加密字段 |
| 审计 | 新 `AuditAction.ADMISSION_QUERY`（schema 枚举，随迁移评审）；`targetType: 'PATIENT'`、`targetId` 取 URL `:id`；报表接口新参数不改审计口径（既有逐条留痕） |
| 留痕 | `AdmissionDepartment` 不含操作人列（转科功能实现时再加 `transferredById` 等留痕字段，属转科规格范围） |

## 6. 前端交互

- **位置**（Q18a）：统计栏行（R20 行）——统计（左）+ 表单 + 全屏按钮（最右，`marginLeft:auto` 保持）；
  该行已有 `flexWrap`，窄屏接受换行；全屏态（R23）该行随统计栏固定视口顶部、表单照常可用。
  **R26 起**这一行由公共 `components/glucose/GlucoseToolbar` 承接（布局与打印隐藏口径三页共用）
- **控件**：`Select`（住院记录）、`Select allowClear`（科室记录）、`DatePicker showTime` ×2、
  `Button type="primary"`（查询）、`Button`（重置）；图标如需仅 `@ant-design/icons`。
  **R26 起**另有 `extra?: ReactNode` 插槽（渲染在时间控件后、按钮前），供血糖记录页追加
  时段/结果类型/录入人/含作废、趋势图页追加粒度/指标——公共四项保持稳定，特有条件各页自理
- **打印**：表单控件与按钮加 `gc-no-print`（交互控件对纸质输出无意义，同 `FullscreenToggle` 口径）
- **状态归属**：表单状态与联动推导在**调用页**（受控组件），组件与纯函数
  `deriveQueryDefaults/deriveTimeBounds/buildAdmissionLabel/buildDepartmentLabel` 导出供单测
  （同 `filterReportRows` 模式）。**R26 起**组件位于公共 `components/glucose/GlucoseQueryForm.tsx`
  （原 `patient-detail/ReportQueryForm.tsx` 改名迁移：`ReportQueryFormState`→`GlucoseQueryFormState`、
  `toReportRange`→`toQueryRange`；三层联动状态机与本文 18 项裁定口径**一字未改**）；
  `admissions` 数据走**手写 hook** `useAdmissions`（实施修正：全仓零 TanStack Query 使用，
  与 `useGlucoseReport` 同风格，见 §12-2）——**留在 `patient-detail/` 不搬**：公共表单只收
  `data: AdmissionsResponse | null`、不自己取数，既避免三页各发一次相同请求，
  也不产生 `components/` → `pages/` 的反向依赖
- **加载/异常**：admissions 请求中 → 两个 Select `loading`；请求失败 → 全局拦截器 toast，
  表单退化为「全部 + 无限制」可用态（不阻塞报表本体）；字段级错误（10001 details）映射表单项
- **可访问性**：大字号档、暗色模式、键盘可达（antd 默认能力，不自造）

## 7. 错误码与前端行为（无新增错误码）

| 场景 | 错误码 | HTTP | 前端行为 |
|---|---|---|---|
| `startTime/endTime` 格式非法 / start > end | 10001 | 422 | 字段级（details 映射表单项） |
| 患者不存在 / 已归档 | 40001 | 404 | toast（同详情页既有口径） |
| 跨科室访问 admissions | 30002 | 403 | toast + 审计 DENIED |
| NONE 档角色 | 30006 | 403 | toast + 审计 DENIED |

## 8. 测试要求（实施轮）

- [x] **server 单测**：admissions（树形组装、排序参数、`isCurrent` 脏数据防御、越权 30002、
      归档/不存在 40001 不泄露存在性）；report `startTime/endTime`（秒级闭区间透传、
      窗口查询叠加范围条件、start>end → 10001、统计与分页 total 随过滤范围）
- [x] **server 单测（双写）**：建档 → `Admission(seq=1)` + 首条停留、住院号重复不创建；
      `admit()` → `seq=max+1` 新住院 + 首条停留、防御性关闭用原出院时间（为空则以办理时刻近似）、
      无历史记录兜底 seq=1；并发幂等由 where 带状态条件 + 事务回滚保证（既有模式）
- [x] **shared**：query schema 复用 `dateTimeStringSchema`（既有格式校验，71 用例全绿）
- [x] **web 单测**（21 用例；R26 起随组件迁至 `components/glucose/GlucoseQueryForm.spec.tsx`，用例一字未删）：
      `deriveQueryDefaults`（在院/出院/脏数据三态）、
      `deriveAdmissionSelection`/`deriveStaySelection`（Q9/Q10/Q11/§11-1）、`deriveTimeBounds`
      （科室 > 住院 > 无限制三层回退，进行中上限=今天）、`buildAdmissionLabel/buildDepartmentLabel`
      （Q5/Q7/Q8 格式、空日期省略）、选项集构造（降序保持、全部末项、平铺）、
      `toQueryRange/isRangeInverted`（Q13）、组件渲染两态
- [x] **迁移回填演练**：dev 库 1000 患者 → 1000 住院 + 1000 停留；700 在院 = 700 进行中停留；
      部分唯一索引与枚举新值落库核验通过
- [x] **接口 e2e（实测）**：`dr.wang` 查林*——admissions 树（2 次住院、转科 2 段停留、isCurrent、
      本地时刻格式）✓；秒粒度过滤（范围 4 天 total vs 全量 18 天，stats 25 vs 102）✓；
      start>end → 10001 + details ✓；`ADMISSION_QUERY`/`GLUCOSE_REPORT_VIEW` 审计落库 ✓
- [ ] **手工 e2e（浏览器，待需求人验收）**：表单默认态、下拉联动、时间上下限、查询/重置、
      全屏态表单可用、打印预览无表单。
      **R26 公共化后需一并复验**（组件已迁移改名、渲染路径改变，但联动与样式逻辑未变）：
      统计栏四项文案与 20px 间距、`|` 位置、极值着色；全屏进入/退出/ESC/换患者重置；
      工具栏窄屏换行与打印预览隐藏

## 9. 非功能要求

| 项 | 要求 |
|---|---|
| 性能 | 单患者住院次数 < 100，admissions 树形一次下发无分页；索引见 §2.1/§2.2 |
| 内网 | 不引用公网资源；图标仅 `@ant-design/icons` |
| 等保 | 住院记录查询逐条审计；迁移前备份库 |
| 兼容 | 明暗模式、大字号档、打印（表单 `gc-no-print`） |

## 10. 验收标准（实施轮勾选）

- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿（server 246 / web 121 / shared 71 用例）
- [x] schema 变更经人工评审（设计稿 §2 评审通过后实施）；迁移 + 回填 + 部分唯一索引 SQL 落库；双写生效（单测钉住）
- [x] admissions 接口契约、排序、审计符合 §3.1/§5；越权被拒（30002 单测 + 审计 DENIED 既有拦截器口径）
- [x] 报表秒粒度过滤、统计/分页随范围（Q14/Q16，接口实测）；初始加载按默认条件（Q15，ready 门控）
- [x] 联动状态机符合 §4（Q5–Q13 逐条，21 个 web 单测钉住）；重置回默认态（Q17）
- [x] 布局符合 Q18a；打印隐藏表单（`gc-no-print`）；全屏态表单可用（fixed 覆盖层包住整棵子树）
- [x] 文档回写：`glucose-report.md` R24 行、`ROADMAP.md`、`DB-MIGRATION-NOTES.md`（迁移记录）
- [ ] 浏览器视觉验收（需求人）：表单默认态/联动/查询/重置/全屏/打印

## 11. 待确认项（实施后状态）

1. **科室清空后的时间值**：已按设计补充实施（回退为所选住院记录起止；「全部」清空）——单测钉住
2. **重置自动查询**：已按设计补充实施（回默认态 + 自动查询）
3. **出院写入口现状**：实施轮核实**确认无出院接口**（ROADMAP P2-6 仍 ❌；`dischargeAt` 仅建档输入
   与查询排序出现）。出院功能落地时须按 §2.4 双写（关闭 `Admission.dischargedAt` + 进行中停留）；
   `admit()` 已做防御性关闭兜底（原出院时间为空时以办理时刻近似），保证「每患者至多一条本次住院」不变量
4. **演示数据**：已为林*（`de6f6beb`）dev 库直插「第二次住院 + 转科停留」——
   seq=1（11-15 ~ 11-16 出院）、seq=2（11-17 入院在院：心内科 11-17~11-18 → 内分泌科 11-18~至今），
   `Patient.admissionAt` 已同步（双写口径）
5. **`AdmissionDepartment` 操作人留痕列**：维持不加（转科功能实现时随转科规格补）

## 12. 实施记录（2026-11-20，与设计稿的差异与新增发现）

1. **既有缺陷修复（计划外）**：`GLUCOSE_REPORT_VIEW` 自 2026-11-19 报表上线即被 `@Audit` 使用，
   但 `AuditAction` 枚举漏登记——拦截器 `as AuditAction` 强转通过 TS，运行时 PG 拒绝非法枚举值，
   审计写入失败被 catch 吞掉（只打 console.error），**报表审计行从未落表**。本次迁移补登记，
   实测已恢复留痕（SUCCESS/FAILED 均落库，detail 含 rangeFrom/rangeTo/count）。
   教训：`@Audit` 的 action 参数是宽松 string，新增动作必须同步登记枚举（已写入迁移注释）。
2. **admissions 数据获取改手写 hook**：设计稿 §3.1 写 TanStack Query，实施遵循仓库约定
   （全仓零 `useQuery` 使用）改为手写 `useAdmissions`（useState/useEffect + cancelled 标志，
   同 `useGlucoseReport` 风格）；换患者时清空旧数据防竞态。
3. **`AdmissionsResponse` 增加 `status` 字段**：前端初始态判定（在院 → 本次住院 / 出院 → 全部）
   以患者状态为权威，不依赖 `isCurrent` 推断——出院患者若存在 `dischargedAt` 为空的脏数据行，
   `isCurrent` 恒 false 但状态仍须准确。
4. **窗口查询叠加范围条件**：天粒度时代「窗口 = 本页日期跨度、无需叠加用户范围」的假设随秒粒度
   升级失效（窗口内可能存在范围外记录），`buildReportRows` 已叠加 `range.where`（单测钉住）。
5. **报表 ready 门控**：`useGlucoseReport` 新增 `ready` 参数——住院记录未就绪时不发请求，
   保证初始加载即按默认条件查询（Q15），避免「先全量再默认范围」的双请求与闪变。
