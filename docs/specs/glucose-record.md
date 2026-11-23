# 血糖记录列表（患者详情 · 血糖数据 · 血糖记录 Tab）

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 归档。状态：✅ **已实施**（2026-11-23 需求人提出 R27 并当日评审通过，
> 8 项裁定 Q1–Q8 全部锁定；同日实施完成，验证见 §12）。
>
> 上游规格：`docs/specs/glucose-report.md`（报表本体 R1–R23，含 R26 公共组件抽取）、
> `docs/specs/glucose-report-query.md`（R24 表单查询，18 项裁定）、
> `docs/specs/glucose-report-edit.md`（R25 单元格增改废）。
> 本规格是血糖数据第三个子页（记录列表），最大化复用 R24/R25/R26 既有能力。
>
> ⚠️ 本设计含 **Prisma schema 变更（`AuditAction` 枚举新增 `GLUCOSE_RECORD_QUERY`）**，属人工评审项：
> 裁定 Q6 = AI 起草、需求人评审通过后方可落库。R24 曾有枚举漏登记 → 审计行静默丢失的前车之鉴，
> 实施轮必须实证审计落表（§8/§10）。

## 0. 元信息

| 项     | 内容                                                                                                                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阶段号 | P3-2 血糖查询剩余部分（`docs/ROADMAP.md`）                                                                                                                                                                                                                     |
| 模块   | 后端 `modules/glucose`（records 接口）；前端 `pages/inpatient/patient-detail`（新 `GlucoseRecordTab`）；共享包 `glucose/schema.ts`（query schema + 分页常量 + 响应类型）                                                                                       |
| 优先级 | P1                                                                                                                                                                                                                                                             |
| 依赖   | R24 `GET /patients/:id/admissions` + `GlucoseQueryForm` 联动状态机；R25 `GlucoseReviewModal` + GET/PATCH/DELETE `:recordId`；R26 公共件（`GlucoseToolbar` / `GlucoseStatsBar` / `GlucoseQueryForm` / `useFullscreen`）；`scope.util.ts`；`AuditLogInterceptor` |
| 需求人 | 产品（2026-11-23 提出，8 项裁定 Q1–Q8）                                                                                                                                                                                                                        |

## 0.1 决策记录（需求人裁定，2026-11-23）

| #   | 裁定                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | 审计动作**新增 `GLUCOSE_RECORD_QUERY`**（语义准确、可与报告查询区分过滤；含 schema 枚举 + migration 批准）                                                                                 |
| Q2  | 已作废记录**列表不可见、不做「含作废」开关**（遵守全仓不变量「所有读路径排除 voided」；作废痕迹经审计 `GLUCOSE_VOID` 追溯）                                                                |
| Q3  | 血糖值列**同报告格约定**：数值型(0/1/2)显示一位小数数值 + 结果类型字典色；非数值型(3~9)显示字典标签（Low/High/拒检/外出…）+ 字典色；色+文双通道                                            |
| Q4  | 公共件组合 = **统计栏 + 三层联动表单 + 全屏**三件齐上、逻辑与报告一致；记录 Tab **不渲染**报告的 4 个展示勾选（常规/强化/检测时间/操作人，R22 规则 2 已钉死）                              |
| Q5  | 默认排序 **`measuredAt DESC` + `id` 第二键**（最新在前，防页漂移；与报告矩阵日期降序一致）                                                                                                 |
| Q6  | schema/migration 执行方式：**AI 起草、需求人评审**（AGENTS.md §6.5），评审通过后才落库                                                                                                     |
| Q7  | **本轮只出规格草案**（文档非代码），实现放下轮                                                                                                                                             |
| Q8  | 统计栏**同报告口径**：总计只计字典 `counted=true` 类型（当前 0~4）；拒检/外出/请假等 5~9 **列表可见但不计入总计/合格**——「列表行数 ≠ 统计总计」是正常现象；同范围下与报告 Tab 数字完全一致 |

## 1. 目标与用户故事

作为 **医生 / 护士**，我要 **以表格形式查看患者的所有血糖记录，并点击血糖值复核/编辑**，
以便 **快速了解患者血糖情况并修正错误记录**。

本次范围（做，实施轮）：

- 新接口 `GET /patients/:id/glucose/records`（时间范围过滤 + 按条分页 + 统计栏，§3.1）
- `AuditAction` 枚举新增 `GLUCOSE_RECORD_QUERY` + migration（§2，⚠️ 人工评审项）
- 新页面 `GlucoseRecordTab` 替换 `routes.tsx:88` 的 `DetailPlaceholder`（§6）
- 复用 R26 公共件：`GlucoseToolbar`（统计+表单+全屏）；复用 R25 `GlucoseReviewModal`（点值 → review → edit）
- shared 新增：`GLUCOSE_RECORD_PAGE_SIZE`、`glucoseRecordQuerySchema`、响应类型（走共享包三步流程）

本次不做（明确排除）：

- **添加血糖记录**（需求原文明确排除；壳顶部「添加血糖」是既有能力，本轮不动，记录 Tab 内不放任何添加入口）
- 导出（P3-6，依赖 P5 导出框架）
- 时段/结果类型/录入人等追加筛选（`GlucoseQueryForm` 的 `extra` 插槽本期不使用）
- 「含作废」开关（Q2）
- 趋势图（P3-7 独立需求）
- 报告 Tab / 公共组件 / R25 弹窗的任何行为改动（纯复用，零修改）

## 2. 数据模型变更（⚠️ 人工评审项）

**无新表、无新列、无存量回填**。仅 `AuditAction` 枚举新增一个值：

```prisma
/// 血糖记录查询（GET /patients/:id/glucose/records，R27），detail 记 rangeFrom / rangeTo / count
GLUCOSE_RECORD_QUERY
```

migration SQL（Prisma 生成，示意）：

```sql
ALTER TYPE "AuditAction" ADD VALUE 'GLUCOSE_RECORD_QUERY';
```

- PG 12+ 允许 `ADD VALUE` 在事务内执行（仅同一事务内不可使用新值；本迁移只加不用，无影响）
- 无数据变更、幂等性由 Prisma 迁移历史保证；回滚 = 不回滚（PG 枚举值不可删，留存无害）
- **实施轮验证点**：迁移后调用 records 接口，查审计表实证 `GLUCOSE_RECORD_QUERY` 行落表（防 R24 漏登记复发）

## 3. 接口契约

### 3.1 新增 `GET /patients/:id/glucose/records`

| 项       | 内容                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 权限点   | `PERMISSION.PATIENT_VIEW`（同报告/admissions，**不新增权限点**）                                                                                                                                       |
| 数据范围 | `@RequireDataScope(RESOURCE.PATIENT)` + `assertInScope`（跨科室 → 30002、不存在/归档 → 40001，口径同报告）                                                                                             |
| 审计     | `@Audit('GLUCOSE_RECORD_QUERY', { targetType: 'PATIENT' })`，一次调用一条；detail 记 `rangeFrom / rangeTo / count`（三键已在 `AUDIT_DETAIL_ALLOW_LIST`，**白名单零改动**）；DENIED 按 3xxxx 号段落审计 |
| 前端取数 | 手写 hook `useGlucoseRecords`（与 `useGlucoseReport` 同风格，全仓零 TanStack Query）；ready 门控：admissions 就绪并推导出默认范围后才发首个请求（防「先全量再默认范围」双请求闪变，R24 已实证的模式）  |

shared 新增（`packages/shared/src/glucose/schema.ts`，走共享包三步流程）：

```ts
/**
 * 血糖记录列表每页固定 15 条（R27 规则 5）。
 * ⚠️ 与 GLUCOSE_REPORT_PAGE_SIZE 数字相同但语义不同：那边是「15 个日期」，这边是「15 条记录」。
 * 独立常量，禁止互相引用。
 */
export const GLUCOSE_RECORD_PAGE_SIZE = 15;

export const glucoseRecordQuerySchema = z.object({
  /** YYYY-MM-DD HH:mm:ss 本地时间，闭区间含该秒；不传则不限起点（同报告契约） */
  startTime: dateTimeStringSchema.optional(),
  endTime: dateTimeStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  /** 默认 15；前端不提供条数切换器，max(100) 仅服务端防御 */
  pageSize: z.coerce.number().int().min(1).max(100).default(GLUCOSE_RECORD_PAGE_SIZE),
});
export type GlucoseRecordQuery = z.infer<typeof glucoseRecordQuerySchema>;
```

响应类型（shared 新增，前后端共用）：

```ts
/** 血糖记录列表行 */
export interface GlucoseRecordListItem {
  id: string;
  /** YYYY-MM-DD HH:mm:ss 本地时间（前端展示截到分钟，排序/查询用秒级全量） */
  measuredAt: string;
  /** 时段 code；前端按 code 查 timeSlots 回显名称（含停用项），null → '-' */
  mealContext: string | null;
  /** 结果类型 code（字典 DY-RESULT，0~9 全量下发，不做过滤——规则 3） */
  resultType: string;
  /** mmol/L 一位小数；非数值型(3~9)为 null */
  valueMmolL: number | null;
  /** 检测人 = operatorId 关联医护姓名（与报告格「操作人」同源，服务端 join 下发）；null → '-' */
  operatorName: string | null;
  /** 备注；null → '-' */
  remark: string | null;
}

export interface GlucoseRecordListResponse {
  items: GlucoseRecordListItem[];
  /** 过滤后总记录条数（分页依据，规则 5「分页条数就是按照血糖记录来」） */
  total: number;
  page: number;
  pageSize: number;
  /** 已应用范围回显（审计 detail 同源，同报告契约） */
  rangeFrom: string | null;
  rangeTo: string | null;
  /** 本页条数 */
  count: number;
  /** 统计栏：复用报告统计类型与口径（Q8），同范围下与报告 Tab 数字完全一致 */
  stats: GlucoseReportStats;
}
```

服务端实现要点：

- 过滤：`measuredAt ∈ [startTime, endTime]` 秒粒度闭区间（同报告 Q14 口径）+ **`voidedAt: null`**（全仓不变量，Q2）
- 排序：`measuredAt DESC, id ASC`（Q5；`id` 第二键防同秒记录页间漂移）
- 分页：Prisma `take/skip` 按记录条数切（与报告「按日期分组再切」不同，这里是平铺列表）
- 统计：复用 `glucose.service.ts` 的 `buildReportStats(patientId, range.where)`（Q8 同口径；
  总计只计 `counted=true` 字典项、合格 = `resultType='1'`、最高/最低 High/Low 优先否则数值极值）
- `startTime > endTime` → 10001 + `details[{field:'endTime'}]`（服务端兜底，前端已拦截；与报表 `resolveTimeRange` 同实现）
- 索引：既有部分唯一索引 `glucose_record_active_unique (patientId, measuredAt) WHERE voidedAt IS NULL`
  可服务本查询的过滤与排序，**无需新索引**

### 3.2 复用接口（零改动）

| 接口                                     | 用途                                | 来源 |
| ---------------------------------------- | ----------------------------------- | ---- |
| `GET /patients/:id/admissions`           | 表单住院/科室下拉数据源             | R24  |
| `GET /patients/:id/glucose/:recordId`    | 复核弹窗详情                        | R25  |
| `PATCH /patients/:id/glucose/:recordId`  | 编辑保存（审计 `GLUCOSE_UPDATE`）   | R25  |
| `DELETE /patients/:id/glucose/:recordId` | 作废（审计 `GLUCOSE_VOID`，软删除） | R25  |

## 4. 业务规则与校验

1. **初始加载即按默认条件查询**（沿用 R24-Q15：在院 = 本次住院 + 进行中停留 `startedAt` ~ 不限；出院 = 全部 + 无限制）
2. **表单联动状态机完整复用 R24 §4**：三层联动（住院记录 → 科室记录 → 时间）、改表单零请求、
   时间上下限、开始 > 结束阻止查询、重置回默认态**并自动查询**——口径一字不改
3. **分页**：固定 15 条/页、无条数切换器、显示「共 N 条」；点查询/重置后页码回第 1 页
4. **作废不可见**（Q2）：列表只含 `voidedAt: null`；在复核弹窗里作废成功后该行从列表消失
   （`onGlucoseChanged` → 版本号 +1 → 列表 + 统计重拉）
5. **编辑联动**：弹窗保存成功 → 列表行与统计栏同步刷新；报告 Tab 再进入时同样刷新（版本号同源，R25 既有机制）
6. **统计栏口径同报告**（Q8）：列表含全部结果类型（0~9），但总计/合格只计 `counted=true`（当前 0~4）；
   拒检/外出/请假等 5~9 列表可见、不计入总计——「列表行数 ≠ 统计总计」是正常现象
7. **检测时间展示** `YYYY-MM-DD HH:mm`（分钟级；前端 dayjs 独立 format，不复用秒级 `DATE_TIME_FORMAT`）；
   库存秒级 UTC、本地时区渲染，排序/查询用秒级全量
8. **检测时段**：code → `timeSlots` 动态名称（含停用项回显），查不到回退 code，null → `-`；**禁止按名称匹配**
9. **血糖值列**（Q3）：数值型(0/1/2) `toFixed(1)` + 结果类型字典色；非数值型(3~9) 字典标签 + 字典色；
   与报告格、复核弹窗、`LastGlucose` 同一渲染约定（色+文双通道，ui-design-tokens）
10. **检测人 / 备注**：null → `-`；备注超长省略 + Tooltip
11. **点击目标**：血糖值单元格可点击（**含非数值行**，拒检/外出等同样有记录详情）→ 打开 `GlucoseReviewModal`
    review 模式 → 点「编辑」切 edit 模式（规则 4「和血糖报告表格上点击效果一致」）；不设独立操作列

## 5. 权限与数据安全

| 项       | 内容                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 功能权限 | 接口 `PATIENT_VIEW`；弹窗内编辑/作废按钮沿用 R25 的 `glucose:update` / `glucose:delete` 门控（无权限则 review 只读、无编辑/作废按钮） |
| 数据范围 | `buildScopeWhere`/`assertInScope`：DEPARTMENT 档按科室过滤；NONE 档（设备管理员）→ 30006；跨科室 → 30002，DENIED 落审计               |
| 脱敏     | 列表不含患者姓名/身份证/电话；`operatorName` 是医护姓名（非患者敏感字段），不脱敏                                                     |
| 加密     | 不新增加密字段                                                                                                                        |
| 审计     | `GLUCOSE_RECORD_QUERY` 逐次留痕（敏感操作）；detail 仅 `rangeFrom/rangeTo/count`，无患者敏感明文；编辑/作废沿用 R25 审计              |

## 6. 前端交互

- **路由**：`routes.tsx:88` 的 `<DetailPlaceholder label="血糖记录" />` 替换为 `<GlucoseRecordTab />`；
  Tab 高亮/URL 派生（`resolveDetailTab`）已支持 `glucose/record`，**路由结构零改动**
- **页面结构**（新文件 `pages/inpatient/patient-detail/GlucoseRecordTab.tsx`）：
  - 顶部 `GlucoseToolbar`：
    - `stats` = `buildReportStatsItems(response.stats)`（复用报告 Tab 的展示项构建函数，四项文案/间距/竖线/极值着色全继承）
    - `form` = `<GlucoseQueryForm data loading state onChange onSearch onReset />`（**`extra` 插槽不使用**，Q4）
    - `fullscreen` / `onToggleFullscreen` 走 `useFullscreen`（ESC 退出、换患者重置、全屏态工具栏钉顶——公共件已实现）
  - 主体 antd `Table`：5 列固定列序（规则 2）——**检测时间｜检测时段｜血糖值｜检测人｜备注**；
    `rowKey="id"`；`loading` 走 Table；空态用自带「暂无数据」
  - 分页：`pagination={{ current, pageSize: GLUCOSE_RECORD_PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}`
  - 血糖值单元格：`cursor: pointer` + hover 视觉提示（与报告格交互暗示一致）；点击 → `GlucoseReviewModal`（recordId 受控）
  - 弹窗 `onChanged` → Outlet context 的 `onGlucoseChanged`（版本号 +1，列表+统计重拉）
- **状态归属**：表单态、已应用范围（applied range）、页码都在 `GlucoseRecordTab` 内（受控，同 `GlucoseReportTab` 模式）；
  联动推导纯函数复用 `GlucoseQueryForm` 已导出的 `deriveQueryDefaults / deriveTimeBounds / toQueryRange` 等，**不复制实现**
- **展示勾选**：记录 Tab 不渲染（`PatientDetailTabs` 既有行为，R22 规则 2 已有单测钉死，零改动）
- **打印**：公共件自带 `gc-no-print`（表单/全屏按钮隐藏），表格与统计栏正常打印——继承 R26 e2e 已验证行为
- **暗色/大字号/窄屏换行**：设计令牌与公共件承接，页面无特殊处理
- **异常呈现**：字段级错误（10001 details）映射表单项；全局错误走拦截器 toast，页面不自弹

## 7. 错误码与前端行为（无新增错误码）

| 场景                                       | 错误码 | HTTP | 前端行为                                                                 |
| ------------------------------------------ | ------ | ---- | ------------------------------------------------------------------------ |
| `startTime/endTime` 格式非法 / start > end | 10001  | 422  | 字段级（复用 `resolveTimeRange`，details field=`endTime`，与报表同实现） |
| 患者不存在 / 已归档                        | 40001  | 404  | toast（同详情页既有口径）                                                |
| 跨科室访问                                 | 30002  | 403  | toast + 审计 DENIED                                                      |
| 无权限点                                   | 30004  | 403  | toast                                                                    |
| NONE 档角色（设备管理员）                  | 30006  | 403  | toast + 审计 DENIED                                                      |
| 编辑改时间撞另一条有效记录（弹窗内）       | 41003  | 409  | 字段级挂 `measuredAt`（R25 既有）                                        |

## 8. 测试要求（实施轮）

- [ ] **shared**：`glucoseRecordQuerySchema`（默认值 15/1、pageSize 上限 100、时间格式校验、start>end 不在 schema 层拦——服务端 10001）；`GLUCOSE_RECORD_PAGE_SIZE` 导出
- [ ] **server 单测**：records 查询——分页切片与 `total` 口径、`measuredAt DESC + id` 排序稳定性（同秒两条不页漂移）、
      `voidedAt: null` 排除、时间闭区间边界（含秒）、无时间参数 = 不限、start>end → 10001 + field、
      stats 与报告同范围同数字（复用 `buildReportStats` 实证）、0~9 全类型下发、`operatorName` join（null → null）、
      越权 30002 / NONE 30006 / 归档与不存在 40001（不泄露存在性）、
      **审计落表实证**（`GLUCOSE_RECORD_QUERY` 行存在且 detail 三键齐全——R24 教训）
- [ ] **web 单测**：`GlucoseRecordTab`——5 列渲染与列序、血糖值格数值/标签双形态 + 字典色、
      时间分钟级截断、时段 code→名称（含停用项、查不到回退 code）、null → `-`、
      分页固定 15 / `showSizeChanger: false` / 共 N 条、查询后页码回 1、
      点值开弹窗（含非数值行）、版本号变化触发重拉；`useGlucoseRecords` ready 门控与改表单零请求
- [ ] **浏览器 e2e**（实施轮，参照 `.devtools/e2e-r26/` 脚本模式）：列表加载、点值 → review → edit → 保存刷新、
      作废后行消失、表单联动与报告一致、全屏 ESC/换患者、打印隐藏、暗色/大字号不破版

## 9. 非功能要求

| 项   | 要求                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| 性能 | 单页 15 条 + 统计全范围聚合；过滤与排序可走既有部分唯一索引 `glucose_record_active_unique (patientId, measuredAt)`，无需新索引 |
| 内网 | 不引用任何公网资源                                                                                                             |
| 等保 | 敏感查询逐次留痕（`GLUCOSE_RECORD_QUERY`）；审计 detail 无患者敏感明文；编辑/作废留痕沿用 R25                                  |
| 兼容 | 大字号、暗色、打印、窄屏换行——全部由 R26 公共件与设计令牌承接                                                                  |

## 10. 验收标准（2026-11-23 实施轮已勾选）

- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿
- [x] 接口返回符合 §3.1 契约，错误码符合 §7（API 级 26 项断言全过，`.devtools/e2e-r27/api-check.mjs`）
- [x] **审计表实证出现 `GLUCOSE_RECORD_QUERY` 行**（detail 含 rangeFrom/rangeTo/count；SUCCESS 行 Prisma 直查实证）
- [x] 越权场景（`dr.chen` 访问内分泌患者）被拒 30002 并落 DENIED 审计（临时翻转改密门禁验证后已还原）
- [x] 列表 5 列、DESC 排序、固定 15 条/页、统计与报告 Tab 同范围同数字（浏览器 54 项断言全过）
- [x] 点血糖值 → review → 编辑全流程可用（权限门控生效：dr.wang 见编辑不见作废）；
      作废后行消失由「服务端读路径恒排除 voided」保证（API 级实证 105 条全量翻页零 voided id；
      浏览器侧作废动作本轮不重演——R25 已验证且会改演示数据）
- [x] 记录 Tab 无展示勾选、无添加入口；壳顶部「添加血糖」行为不变（截图目视复核）
- [x] 文档回写：ROADMAP P3-2 进度、本规格状态行改「✅ 已实施」+ §12 实施记录

## 11. 待确认项

无——8 项裁定（Q1–Q8）已全部锁定（§0.1）。

## 12. 实施记录（2026-11-23）

**提交**（按 git 粒度规则拆分）：

| 提交                   | 内容                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `feat(shared)`         | `GLUCOSE_RECORD_PAGE_SIZE` / `glucoseRecordQuerySchema` / `GlucoseRecordListItem` / `GlucoseRecordListResponse` + 4 单测 |
| `feat(prisma)` ⚠️ 敏感 | `AuditAction` 末尾追加 `GLUCOSE_RECORD_QUERY` + 迁移 `20261123000000`；`db:deploy` 后 `migrate diff` 实证零漂移          |
| `feat(glucose)`        | `records()` + 路由（`:recordId` 之前）+ 9 单测                                                                           |
| `feat(web)`            | `fetchGlucoseRecords` / `useGlucoseRecords` / `GlucoseRecordTab` / 路由替换 + 12 单测                                    |

**验证**：shared 75 用例、server 274 用例、web 162 用例全绿；API 级 26 项断言全过
（`.devtools/e2e-r27/api-check.mjs`，可复跑）；浏览器 e2e 4 阶段 54 项断言全过
（`.devtools/e2e-r27/s0~s4`，截图 8 张目视复核：列表/复核弹窗/编辑态/非数值详情/全屏/打印/暗色大字号）。

**实施期发现与处置**（供后续轮次避坑）：

1. **`pnpm install` 会破坏 shared 分发约定**：本仓 `node-linker=hoisted` 下 `apps/*/node_modules/@gc/shared`
   应由 `pnpm sync:shared` 拷 dist 副本；误跑 `pnpm install` 会把它换成指向源码包的 junction，
   Vite/Rollup 随之把 CJS dist 当仓库内源码处理（跳过 commonjs 转换）→ 构建报
   `"ERROR_CODES" is not exported`。处置：`pnpm sync:shared` 恢复 + 清 `apps/web/node_modules/.vite`。
   另：`pnpm install` 顺手修剪了 lockfile（jsdom 相关），与本需求无关已还原。
2. **dr.chen 首登改密门禁（20005 PASSWORD_CHANGE_REQUIRED）**会拦在数据范围校验之前，
   API 级越权验证需临时翻转 `mustChangePassword`（验证后还原，密码不动）。
3. **暗色验证必须走 UI 开关**：直接改 `html[data-theme]` 只切自定义 CSS 变量，
   antd 组件色由 ConfigProvider（主题 store）驱动不会变——截图会呈「body 暗、组件亮」假象。
4. `resolveTimeRange` 对 start>end 抛 10001 的 details field 是 **`endTime`**（与报表同实现），
   规格 §3.1/§7 原文误写 `startTime`，已随实施修正。
