# 住院管理-预警管理（血糖预警列表）功能规格

> 状态：**已冻结**（2026-11-27 需求人三轮裁定确认，见 §12；下一轮实现：shared 契约 → 服务端 → 前端 → 测试）
> 模板：docs/FEATURE-SPEC-TEMPLATE.md ｜ 日期：2026-11-27 ｜ 需求人：用户

### 0. 元信息 ⭐

| 项     | 内容                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 阶段号 | P4-7 预警管理（2026-11-27 需求人裁定计入 P4，ROADMAP 已登记）                                                                                                                                                                                                                                                                                                                        |
| 模块   | server: glucose（新增跨患者查询）；web: pages/inpatient/alerts；shared: glucose/alert-schema                                                                                                                                                                                                                                                                                         |
| 优先级 | P1                                                                                                                                                                                                                                                                                                                                                                                   |
| 依赖   | 既有 `PERMISSION.ALERT_VIEW`（alert:view，已授医生/护士/护士长/系统管理员）；既有路由占位 `/inpatient/alerts`（routes.tsx L101-108）；`PatientGlucoseTargetService.resolveResultTypeThreshold`（GlucoseModule 写路径已在用）；TimeSlot 字典下发（`GET /time-slots` 含停用项）；`Tabs.tsx`（underline）；`DeptSelect`/`DoctorSelect`/`SearchActions` 控件族；R24 秒级时间范围查询口径 |
| 需求人 | 用户（2026-11-27 提出，两轮确认）                                                                                                                                                                                                                                                                                                                                                    |

### 1. 目标与用户故事 ⭐

作为**医护人员**（医生/护士/护士长/系统管理员），我要**以列表查看触发高/低血糖预警的血糖记录**，以便**快速识别哪些病人触发了预警**。

本次范围（做）：

- 住院管理-预警管理页面：三 Tab（所有预警/高血糖预警/低血糖预警）＋ 共用筛选区 ＋ 统计栏 ＋ 分页列表
- 后端跨患者血糖预警查询接口（含统计）＋ 新审计动作 `GLUCOSE_ALERT_QUERY`

本次不做（明确排除）：

- 住院管理其他子模块；预警阈值触发逻辑改造（`PatientAlertThreshold` 仍只服务趋势图阈值线，裁定 R1-Q1）
- 预警导出/打印、预警处理工作流（确认/关闭/交班）、实时推送、首页角标

### 2. 数据模型变更

| 模型                | 字段                           | 类型 | 说明             | 是否需迁移                                                  |
| ------------------- | ------------------------------ | ---- | ---------------- | ----------------------------------------------------------- |
| AuditAction（枚举） | 末尾追加 `GLUCOSE_ALERT_QUERY` | enum | 预警列表查询留痕 | ✅ 已执行（`20261127000000_add_glucose_alert_query_audit`） |

- 无新模型、无新字段、无存量数据影响、无回填。
- ⚠️ 枚举只能追加在 `PATIENT_TARGET_VIEW` 之后（PG `ALTER TYPE ADD VALUE` 限制，DB-MIGRATION-NOTES.md §2.3）。
- **迁移已于 2026-11-27 执行完毕**：需求人批准追加后，按 DB-MIGRATION-NOTES §3 约定手写 SQL + `pnpm db:deploy`（幂等 `IF NOT EXISTS`）+ `pnpm db:generate` + 重启后端；实测审计行落表（action=GLUCOSE_ALERT_QUERY、result=SUCCESS、detail 含 rangeFrom/rangeTo/count/alertType/valueGt/path/requestId）。执行前窗口期该动作审计行不落表（拦截器吞错，同 `GLUCOSE_TREND_VIEW` 先例）——裁定 R2-Q3 已接受，现已闭环。

### 3. 接口契约 ⭐

| #   | 方法 | 路径            | 权限点     | 数据范围(RESOURCE) | 审计动作            | 说明                     |
| --- | ---- | --------------- | ---------- | ------------------ | ------------------- | ------------------------ |
| 1   | GET  | /glucose/alerts | alert:view | PATIENT            | GLUCOSE_ALERT_QUERY | 跨患者血糖预警列表＋统计 |

落点：GlucoseModule 内新增跨患者 controller（`@Controller('glucose')`）＋独立查询 service；不挂 `/patients/:id` 子资源。

请求 query（shared 新增 `glucoseAlertQuerySchema`，zod，走 `ZodValidationPipe`）：

```ts
{
  type?: 'high' | 'low';            // 缺省 = 所有预警（resultType IN ('0','2')）
  departmentId?: string;            // uuid，精确
  doctorId?: string;                // uuid，责任医生精确
  patientNo?: string;               // 住院号，模糊（contains + insensitive，同患者管理）
  name?: string;                    // 姓名，密文确定性等值（encryptDeterministic → nameCipher）
  bedNo?: string;                   // 床号，模糊
  admissionStatus?: 'all' | 'inpatient' | 'discharged';  // 默认 'inpatient'
  startTime: string;                // 'YYYY-MM-DD HH:mm:ss' 本地秒级，闭区间起（必填，前端恒送默认值）
  endTime: string;                  // 闭区间止（必填）；startTime > endTime → 10001
  valueGt?: number;                 // 大于：正数、至多 1 位小数
  valueLt?: number;                 // 小于：同上；两者 AND 叠加（裁定 R1-Q2），valueGt ≥ valueLt 不强拦（裁定 R2-Q4）
  page?: number;                    // 默认 1
  pageSize?: number;                // 默认 20，max 100（同 patientListQuerySchema 惯例）
}
```

响应 `data`（`{ code, message, data }` 信封，code=0）：

```ts
{
  items: Array<{
    id: string; // GlucoseRecord.id
    departmentName: string | null; // Patient.departmentId → Department.name
    bedNo: string | null;
    name: string; // nameMasked 脱敏文（服务端预脱敏列，绝不回明文/密文）
    gender: string | null; // GENDER 码（MALE/FEMALE/...），前端 GENDER_LABELS 映射
    patientNo: string | null; // 住院号
    alertType: 'high' | 'low'; // 落库 resultType '2'→high、'0'→low（裁定 R1-Q1，不实时重判）
    valueMmolL: number; // mmol/L，1 位小数（resultType 0/2 必有数值，非空）
    measuredAt: string; // 'YYYY-MM-DD HH:mm:ss' 本地秒级（formatDateTime 出参，同 R27 记录列表口径；实现时修正，非 ISO）
    mealContext: string | null; // 时段码原样返回，前端 getTimeSlotName(code) 转名（含停用时段，同血糖记录页先例）
    targetRange: { low: number; high: number } | null;
    // 控糖范围：查询时 resolveResultTypeThresholdsBatch(patientIds) 批量实时解析
    //（患者时段目标 → 缺行回退全局）；解析失败 null，前端显示 '-'。
    // 目标事后被调整时范围与落库 alertType 可能不一致——需求人已知悉接受（裁定 R1-Q1）
    doctorName: string | null; // 责任医生（Patient.doctorId → Staff.name）
    nurseName: string | null; // 责任护士（Patient.nurseId → Staff.name）
  }>;
  total: number; // 当前筛选（含 type）总记录数，不受分页影响
  page: number;
  pageSize: number;
  stats: {
    patientCount: number; // 当前筛选命中的去重患者数（一人多条/兼高低只计 1，裁定 R2-Q1）
    totalCount: number; // = total
    highCount: number; // 当前筛选下高预警次数（type='low' 时为 0）
    lowCount: number; // 同上对称
  }
  // 审计回显字段（AuditLogInterceptor 按 AUDIT_DETAIL_ALLOW_LIST 白名单提取，同 R27 口径；实现时补充登记）
  rangeFrom: string; // = startTime 本地格式化
  rangeTo: string; // = endTime 本地格式化
  count: number; // 当页行数
  alertType: 'high' | 'low' | 'all'; // = type ?? 'all'
}
```

服务端实现要点：

1. 固定条件：`voidedAt: null`（软删排除）＋ `resultType IN ('0','2')`（或 type 单值）＋ `measuredAt` 闭区间 ＋ `valueMmolL` gt/lt。
2. 患者条件：`buildScopeWhere(user, RESOURCE.PATIENT)` 合入 patient 关系 ＋ `Patient.status`（admissionStatus 映射 INPATIENT/DISCHARGED，all 不过滤）＋ departmentId/doctorId/patientNo/nameCipher/bedNo。
3. 排序：`measuredAt DESC`，同刻 `id ASC` 稳定序；服务端分页。
4. `targetRange` 批量解析：`PatientGlucoseTargetService.resolveResultTypeThresholdsBatch(patientIds)`（实现落点）——当页 patientId 去重后一次性 IN 查询 `PatientGlucoseTarget` ＋ 全局回退值取一次，返回 `Map<patientId|timeSlotCode, 阈值>` 内存组装，**禁止逐条 N+1**；全局缺失/非法整体返回 null 不抛 10000（读路径不整页失败）。
5. 统计与列表共用同一 where（含 type）；`patientCount` 用 distinct patientId 聚合，high/lowCount 用 resultType 分组计数。
6. 姓名筛选复用患者管理密文等值逻辑（patient.service.ts L321-323 同款）。

### 4. 业务规则与校验 ⭐

1. **预警判定**：以落库 `resultType` 为准（'2'高/'0'低），查询时不重判、不读 `PatientAlertThreshold`（裁定 R1-Q1）。
2. **大于/小于**：`valueMmolL > valueGt AND valueMmolL < valueLt`，与 Tab type 条件叠加；只填一个则单边约束；`valueGt ≥ valueLt` 不强拦、允许空结果（裁定 R1-Q2、R2-Q4）。校验：正数、至多 1 位小数，违反 → 10001 + details。
3. **时间口径**（前端计算后送 startTime/endTime，作用于 measuredAt，秒级闭区间）：

| 预设                 | 开始                                                                                            | 结束                                      |
| -------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 本月（默认）         | 当月 1 日 00:00:00                                                                              | 当前时刻                                  |
| 近一月               | 30 天前当日零点                                                                                 | 当前时刻                                  |
| 近三月/近半年/近一年 | 3/6/12 个自然月前**同一日**零点（裁定 R1-Q3；如今天 2026-11-27 → 近三月 = 2026-08-27 00:00:00） | 当前时刻                                  |
| 自选区间             | 开始日 00:00:00                                                                                 | 结束日 **23:59:59**（含全天，裁定 R1-Q4） |

日历回推目标日不存在时（如 05-31 回推 3 月 → 02-31）取该月最后一天。注意混合口径：近一月=固定 30 天，近三月起=日历回推（需求原文＋裁定，非笔误）。4. **住院状态**：默认「住院」，进页即按 住院＋本月 查询；出院患者的科室/床号/责任医护取 Patient 当前（末次住院）字段，与患者管理出院 Tab 同口径。5. **Tab 交互**：三 Tab 共用一套筛选条件；切 Tab 保留筛选并自动重新查询；「查询」按钮触发请求、「重置」回默认（住院状态=住院、时间=本月、其余清空）（裁定 R2-Q2）。6. **统计**：随当前 Tab＋全部筛选变化，不受分页影响（裁定 R2-Q1）。7. 只读查询，无幂等/并发/状态机问题；空结果是正常态不是错误。

### 5. 权限与数据安全 ⭐

| 项       | 选择                                                                                                                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能权限 | `@RequirePermissions(PERMISSION.ALERT_VIEW)`（既有，四角色已授予；设备管理员无 → 30004）                                                                                                                                                                                                                                                     |
| 数据范围 | `@RequireDataScope(RESOURCE.PATIENT)` ＋ 查询 where 合入 `buildScopeWhere(user, RESOURCE.PATIENT)`；NONE 档 → 30006；科室档由 scope 自然过滤（不手写部门比较）                                                                                                                                                                               |
| 脱敏字段 | 姓名返回 `nameMasked`；本页**不提供**明文查看入口（无解掩按钮）                                                                                                                                                                                                                                                                              |
| 加密字段 | 姓名筛选走 `encryptDeterministic` 密文等值；无新增加密存储                                                                                                                                                                                                                                                                                   |
| 审计     | `@Audit('GLUCOSE_ALERT_QUERY')`：URL 无 `:id`，targetType/targetId 留空（跨患者查询，装饰器旧行为）；detail 记 `rangeFrom`/`rangeTo`/`count`（既有白名单）＋ **新登记** `alertType`（high/low/all 枚举码）、`valueGt`、`valueLt`（数值，均非敏感）入 `AUDIT_DETAIL_ALLOW_LIST`（先例 mealContexts/printType）；3xxxx DENIED 由统一机制落审计 |

### 6. 前端交互 ⭐

- **入口与路由**：`/inpatient/alerts`（住院管理分组、菜单项「预警管理」已存在，替换占位 element；权限 alert:view 已配，路由守卫自动生效）。
- **页面结构**（自上而下）：
  1. Tab：复用 `components/common/Tabs.tsx` `variant="underline"`（文字高亮，同住院/出院患者 Tab 样式）：所有预警 / 高血糖预警 / 低血糖预警。
  2. 筛选区 `AlertFilter`：科室（DeptSelect）、医生（DoctorSelect，随科室联动）、住院号（Input 模糊）、姓名（Input，placeholder 注明「精确」）、床号（Input 模糊）＋ 住院状态（Select：全部/住院/出院，默认住院）＋ 时间（Select：本月/近一月/近三月/近半年/近一年/自选时间区间，默认本月；选「自选」其后追加 DateRangePicker，格式 YYYY-MM-DD）＋ 大于/小于（InputNumber，正数 1 位小数）＋ 查询/重置（SearchActions）。布局与间距沿用 `PatientFilter` 惯例（局部常量 `CONTROL_GAP = 20` 先例，不新造令牌）。
  3. 统计栏 `AlertStatsBar`（间距 20px）：
     - 所有预警 Tab：`总计：{patientCount}人 {totalCount}次 | 高血糖预警：{highCount}次 低血糖预警：{lowCount}次`
     - 高/低 Tab：`总计：{patientCount}人 {totalCount}次`
     - 实现（落地时补充）：渲染层**复用公共 `GlucoseStatsBar`**（为此把其 `label` 扩展为可选——省略时不渲染「label：」前缀，向后兼容），口径层独立 `alert-stats.ts` 的 `buildAlertStatsItems(tab, stats)`，沿 R20 `buildReportStatsItems` 两层分离先例。
  4. 列表 `AlertTable`：Antd Table 服务端分页，默认 20 条/页（pageSizeOptions 沿用惯例 [10,20,50,100]、showTotal「共 N 条」）。
- **列定义**（12 列；高/低 Tab 隐藏「预警类型」为 11 列）：科室、床号、姓名（脱敏文）、性别（GENDER_LABELS）、住院号、预警类型（文案「高血糖预警/低血糖预警」）、血糖值（x.x mmol/L）、检测时间（YYYY-MM-DD HH:mm）、检测时段（getTimeSlotName）、控糖范围（`4.4-7.0 mmol/L`，对齐 formatTargetRange 先例；null → '-'）、责任医生、责任护士（空值 '-'）。
- **颜色**：预警类型文字与血糖值用血糖 Low/High 语义色（global.css 既有 `.gc-text-glucose-low/high` 工具类，tokens 变量，明暗模式自适应）；预警类型列自带文字，满足「色＋文」双通道。
- **状态**：加载 Antd loading；空态默认「暂无数据」；切 Tab/查询/翻页均重新请求。
- **按钮级权限**：纯只读列表，无行级操作按钮。
- **异常呈现**：统一由 `client.ts` 拦截器 `applyErrorStrategy()` 处理，页面不自弹 toast；10001 的 details 映射到筛选项。
- **可访问性**：大字号/明暗模式沿用全局机制；本页无打印需求，不做打印适配。
- **新增文件**：`api/alert.ts`（fetchGlucoseAlerts）、`pages/inpatient/alerts/{index.tsx, AlertFilter.tsx, AlertStatsBar.tsx, AlertTable.tsx, useAlertQuery.ts, alert-time.ts, alert-stats.ts}`；`alert-time.ts` / `alert-stats.ts` 均为纯函数（可单测，已配套 spec）。

### 7. 错误码与前端行为 ⭐

| 场景                                                            | 错误码      | HTTP | 前端行为                  |
| --------------------------------------------------------------- | ----------- | ---- | ------------------------- |
| 参数不合法（valueGt/valueLt 格式、startTime>endTime、枚举越界） | 10001       | 422  | 字段级 details 映射筛选项 |
| 缺参/格式错误                                                   | 10002/10003 | 400  | toast（拦截器统一）       |
| 会话失效                                                        | 20002       | 401  | relogin                   |
| 无 alert:view 权限点                                            | 30004       | 403  | toast＋审计 DENIED        |
| NONE 档（设备管理员）                                           | 30006       | 403  | toast＋审计 DENIED        |

**无新增业务错误码**（空结果非错误；41xxx 血糖段与 41002/41008 预留不动）。

### 8. 测试要求

- [x] 服务端单测（`glucose-alert.service.spec.ts`，21 例）：resultType 过滤（含 type 单值/全部）；valueGt/valueLt AND 组合与单边（含 gt ≥ lt 不强拦）；admissionStatus 三态；时间闭区间与 voidedAt 排除（where 构造断言）；统计去重（distinct patientId）与 high/lowCount 分组（含 type 指定时跳过无谓 count）；姓名密文等值；scope 过滤 ALL/DEPARTMENT（NONE 档由 `buildScopeWhere` 公共单测覆盖，服务层不重测）；items 映射与审计回显字段。批量解析在 `patient-glucose-target.service.spec.ts` 追加 `resolveResultTypeThresholdsBatch` describe（5 例：去重 IN/空列表/Decimal 转 number/不按展示集合过滤/全局失败返回 null）。
- [x] 前端单测：`alert-time.spec.ts`（9 例）六种预设（本月/近一月 30 天/近三月日历/月末 clamp/自选 23:59:59/自选未选回退本月）；`alert-stats.spec.ts`（6 例）统计栏三种文案格式；`GlucoseStatsBar.spec.tsx` 追加省略 label 用例（2 例）。Tab 切换列显隐、重置回默认、切 Tab 保留筛选属交互行为，web 测试环境无 jsdom（hook 不可测），由 playwright 实测覆盖（见下）。
- [x] playwright 实测（2026-11-27，sys.admin）：页面加载/三 Tab 切换（高/低 Tab 隐藏预警类型列、统计栏两种格式）/大于 10 筛选（统计随筛选）/重置回默认/时间预设请求参数（本月=11-01 零点、近三月=08-27 日历回推）/自选区间 00:00:00~23:59:59/出院状态空态「暂无数据」/控糖范围列与判定口径一致（6.1>患者空腹上限 6.0 → 高预警）。
- [x] 手工验证：`dr.wang`（内分泌科）仅见科室内预警；无 alert:view 账号 → 30004——**需求人 2026-11-27 确认已完成**。枚举迁移执行后 AuditLog 出现 `GLUCOSE_ALERT_QUERY` 行（result=SUCCESS，detail 含 rangeFrom/rangeTo/count/alertType/valueGt/path/requestId；valueLt 未传时不写键）——已实测确认。

### 9. 非功能要求

| 项   | 要求                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| 性能 | 万级 GlucoseRecord 内列表＋统计 < 1s；targetRange 批量解析禁 N+1；跨患者时间范围扫描暂无专用索引（见 §11-2） |
| 内网 | 不引用任何公网资源                                                                                           |
| 等保 | 姓名脱敏（nameMasked）、查询留痕（新审计动作）、DENIED 落审计、无导出面                                      |
| 兼容 | 大字号、明暗模式（语义色令牌自适应）；打印不适用                                                             |

### 10. 验收标准（可勾选）⭐

- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿（2026-11-27）
- [x] 接口返回符合 §3 契约（items/total/page/pageSize/stats＋审计回显字段），错误码符合 §7
- [x] 预警判定=落库 resultType；作废（voidedAt）记录不出现（单测 where 断言）
- [x] 时间六预设＋自选口径正确（含月末 clamp、结束日 23:59:59、近一月=30 天与近三月=日历回推的混合口径；单测＋实测请求参数双重验证）
- [x] valueGt/valueLt AND 叠加、宽松校验（≥ 不强拦；单测＋实测「大于 10」筛出 6 条 18.5）
- [x] 统计随全部筛选、患者数去重、不受分页影响；三种统计栏格式正确（实测「总计：1人15次|高7低8」/「总计：1人7次」）
- [x] 切 Tab 保留筛选自动查询；高/低 Tab 隐藏预警类型列；重置回默认（住院＋本月）——playwright 实测
- [x] 设备管理员被拒 30006 且落审计；科室档只见范围内数据（scope 合入由单测钉住）——需求人 2026-11-27 确认手工验证已完成
- [x] 姓名脱敏展示、密文精确筛选；性别/时段码前端字典映射（实测「林*」「空腹/早餐后」；密文等值单测）
- [x] 共享包改动走 build → sync:shared → 清 Vite 缓存三步
- [x] `GLUCOSE_ALERT_QUERY` 枚举迁移已执行（2026-11-27，`20261127000000_add_glucose_alert_query_audit`，需求人批准）；审计行落表已实测（见 §2）
- [x] 文档回写：ROADMAP P4-7 状态翻转（归属已裁定计入 P4，随本次实现提交）

### 11. 待确认项

1. ~~阶段号归属~~：**已裁定**（2026-11-27 R3-Q3）——计入 P4，ROADMAP 新增子项 P4-7 预警管理。
2. **跨患者查询索引**：现有索引 `@@index([patientId, measuredAt DESC])` 不服务跨患者时间范围扫描。本期默认**不加**索引先观察性能；若需加 `(resultType, measuredAt)` 类复合索引属 schema 迁移，需人工评审＋人工执行。

### 12. 裁定记录（2026-11-27，三轮）

| #     | 问题                 | 裁定                                                                                                              |
| ----- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R1-Q1 | 预警判定口径         | **落库 resultType**（2=高、0=低）；控糖范围列查询时实时解析，接受目标事后调整导致的极少数不一致                   |
| R1-Q2 | 大于/小于语义        | **数值区间 AND**（>大于 且 <小于），与 Tab 类型叠加                                                               |
| R1-Q3 | 近三月/半年/一年口径 | **日历同日回推**（3/6/12 个自然月前同一日零点）；近一月保持需求原文=30 天                                         |
| R1-Q4 | 自选区间结束时刻     | **结束日 23:59:59**（含全天）                                                                                     |
| R2-Q1 | 统计口径             | 患者人数=当前 Tab＋全部筛选命中**去重**患者数；次数=记录行数；随所有筛选、不受分页影响                            |
| R2-Q2 | 筛选交互             | 同患者管理：点「查询」发请求、「重置」回默认（住院＋本月）；切 Tab 保留筛选自动重查                               |
| R2-Q3 | 审计迁移             | 接受人工迁移：新增 `GLUCOSE_ALERT_QUERY` 枚举，迁移由需求人执行；执行前审计行不落表（同 GLUCOSE_TREND_VIEW 先例） |
| R2-Q4 | 大于/小于校验        | 宽松：正数、至多 1 位小数；valueGt ≥ valueLt 不强拦，允许空结果                                                   |
| R3-Q1 | 规格冻结             | **冻结**，下一轮按 shared 契约 → 服务端 → 前端 → 测试顺序实现                                                     |
| R3-Q2 | 规格文档提交         | **本轮提交**（单独 docs 提交并推送 origin/main）                                                                  |
| R3-Q3 | ROADMAP 阶段归属     | **计入 P4**（新增子项 P4-7 预警管理）                                                                             |

默认假设（两轮公示无异议）：一行=一条预警记录、measuredAt 倒序、服务端分页 20/页；姓名脱敏同患者列表机制；出院患者取末次住院科室/床号/责任医护、空值 '-'；时段码前端字典回显（含停用）。
