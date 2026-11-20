# 交接文档：患者详情 · 血糖数据 · 血糖报告（R20~R26 归档）

> 日期：2026-11-20
> 范围：`住院管理 / 患者管理 / 患者详情 / 血糖数据 / 血糖报告`
> 状态：**血糖报告已完成并接入**（矩阵报表 + 查询表单 + 单元格增改废 + 全屏 + 公共模块抽取）；
> 同一「血糖数据」下的**血糖记录 / 趋势图仍是占位页**，是下一步开发对象。
> 本文只做交接说明，不包含代码改动。

---

## 0. 一句话结论

血糖报告子页已全功能落地：日期 × 时段矩阵、服务端全量统计、住院/科室/秒级时间范围三层联动查询、
四个展示勾选、全屏、单元格点击直接添加/编辑/作废（软删除留痕）。R26 已把「统计栏 / 查询表单 / 全屏」
抽取为 `apps/web/src/components/glucose/` 公共模块，**血糖记录页与趋势图页可零改动接入**。

血糖记录模块起点很干净——路由、Tab、占位、公共工具栏都已就位，**唯一硬缺口是后端没有记录列表/分页接口**
（现有 5 个 glucose 接口里没有列表查询），共享包也还没有对应 query/response schema。

剩余事项：

1. `ADMISSION_QUERY` 的 StrictMode 守卫**待硬刷新复验**（§7.1）。
2. R26 公共化后的**手工 e2e 未做**（全屏/ESC/换患者重置/打印预览单测覆盖不到）。
3. `.codebuddy/rules/glucose-domain.md` 有**两处事实性过时**，会误导新会话（§7.2）。
4. 血糖记录页的**统计口径与分页语义未定**，需按 `FEATURE-SPEC-TEMPLATE` 立项（§9）。

---

## 1. 新窗口阅读顺序

1. 仓库根 `AGENTS.md`：项目总纲、技术栈版本约束、目录结构、分层职责、合规要求（**最高优先级上下文**）。
2. `.codebuddy/rules/`：`ai-collaboration.md`（产出前/时/后约定、禁止清单）、
   `glucose-domain.md`（单位/时间语义/取值异常/时段/去重/住院记录模型，⚠️ 见 §7.2）、
   `permissions.md`、`security-and-audit.md`、`shared-package.md`（改共享包三步流程）、
   `error-codes.md`、`ui-design-tokens.md`、`git-commit.md`、`agent-efficiency.md`。
3. 本文档。
4. 规格文档：
   - `docs/specs/glucose-report.md`：主规格，§0.1 决策记录表 **R20~R26 全录**
   - `docs/specs/glucose-report-query.md`：R24 查询表单，**18 项裁定**、三层联动状态机、`Admission` 双写口径
   - `docs/specs/glucose-report-edit.md`：R25 单元格增改废，**16 项裁定**、软删除与部分唯一索引
   - `docs/specs/patient-detail.md`：详情页 Tab 结构，**A4「占位页不发请求」**（L28）、§6.2 五内容页路由化（L146-150）
   - `docs/specs/glucose-timeslot-validation.md`：时段查库校验
5. `docs/FEATURE-SPEC-TEMPLATE.md`：**新功能需求必须按此模板提供**（11 节，⭐ 为必填）。
6. 关键代码（§5、§6）。

> ⚠️ 不要依赖 `docs/HANDOFF-2026-10-23-INPATIENT-PATIENTS.md` 判断血糖现状——它写着
> 「添加血糖 / 查看详情仍是占位」「`GlucoseRecord` 只是最小模型，不要据此恢复血糖业务」，
> 两条**均已过时**：详情页与录入/编辑/作废早已落地，`GlucoseRecord` 已是完整业务模型（含软删除字段）。
> 该文档仅「住院患者卡片视图」部分仍有效。

---

## 2. 已完成范围（决策索引）

血糖报告是 R20~R26 七轮迭代叠加。**改任何一处前先查对应决策号**，
每条决策的完整裁定与理由都在 `docs/specs/glucose-report.md` §0.1 决策记录表里。

| 决策 | 内容 |
|---|---|
| R20 | 统计栏（总计/合格次数/最高/最低），取代原「单位：mmol/L」标注（D5 已推翻） |
| R21 | 布局：根节点撑满内容区高度，统计栏固定、表格占剩余空间、body 内滚、分页钉底 |
| R22 | 四个展示勾选（检测时间/操作人/常规记录/强化记录）；**弃用时段不成列**，历史记录合并进启用普通列并带弃用时段名后缀 |
| R23 | 全屏切换：**不用浏览器 Fullscreen API**，纯 CSS `position:fixed; inset:0` 覆盖层 |
| R24 | 查询表单：住院记录 → 科室记录 → 时间默认值与上下限**三层联动**；契约升级为**秒粒度闭区间** `startTime`/`endTime`（原天粒度 `startDate`/`endDate` 已废弃）；新增 `Admission`/`AdmissionDepartment` 表与 `GET /patients/:id/admissions` |
| R25 | 单元格直接添加/编辑/作废：点已有记录弹 review 弹框（只读→可转编辑/作废），点空白格复用添加弹框并预填「该行日期 + 当前时分秒、该列时段」；**删除按软删除实现**；新权限点 `glucose:update`/`glucose:delete` |
| R26 | 统计栏/查询表单/全屏抽取为三页共用公共模块 `components/glucose/` |

**R26 明确「不纳入」公共模块的两项**（记录页开发会撞到，理由已登记在 R26 决策行）：

- **R22 展示勾选**：报表专属视图过滤，位置在子 Tabs 行尾而非工具栏。
- **分页**：三页语义不可统一——报表按「**天**」（`GLUCOSE_REPORT_PAGE_SIZE=15` 是**日期数**不是记录条数）、
  **记录按「条」**、趋势图不分页。故记录页需自己实现分页。

---

## 3. 接口与权限现状

### 3.1 血糖接口（全部已实现，共 5 个）

`apps/server/src/modules/glucose/glucose.controller.ts`（`@Controller('patients')`，全部挂 `@RequireDataScope(RESOURCE.PATIENT)`）：

| 行 | 方法 + 路径 | 权限点 | 审计 action |
|---|---|---|---|
| L29 | `POST :id/glucose` | `GLUCOSE_CREATE` | `GLUCOSE_CREATE` |
| L56 | `GET :id/glucose/report` | `PATIENT_VIEW`（L49-50 注明**不新增 `glucose:view`**） | `GLUCOSE_REPORT_VIEW`（targetType PATIENT） |
| L81 | `GET :id/glucose/:recordId` | `PATIENT_VIEW` | **不挂审计**（R25 裁定 Q4） |
| L101 | `PATCH :id/glucose/:recordId` | `GLUCOSE_UPDATE` | `GLUCOSE_UPDATE`（`changedFields` **只记字段名不记值**，裁定 Q5） |
| L125 | `DELETE :id/glucose/:recordId` | `GLUCOSE_DELETE` | `GLUCOSE_VOID`（软删除） |

**没有列表/分页查询接口**——这是记录页的主要后端缺口。

### 3.2 详情页依赖的患者接口

`apps/server/src/modules/patient/patient.controller.ts`：

| 行 | 方法 + 路径 | 权限点 | 审计 action |
|---|---|---|---|
| L76 | `GET :id` | `PATIENT_VIEW` + DataScope | `PATIENT_VIEW`（**访问即留痕**，决策 A3） |
| L92 | `GET :id/admissions` | `PATIENT_VIEW` + DataScope | `ADMISSION_QUERY`（targetType PATIENT） |

### 3.3 权限点与角色（`packages/shared/src/dict/roles.ts`）

L36 `GLUCOSE_CREATE: 'glucose:create'`、L38 `GLUCOSE_UPDATE: 'glucose:update'`、L40 `GLUCOSE_DELETE: 'glucose:delete'`。
**没有 `glucose:view`**：查看由 `patient:view` 覆盖（`PERMISSION-DESIGN.md` §4 裁定）——
记录页是查看类功能，**默认不需要新权限点**；若要新增须先说明并加进字典。

| 角色 | create | update | delete | 数据范围 |
|---|---|---|---|---|
| DOCTOR（L70） | ✓ | ✓ | ✗ | DEPARTMENT |
| NURSE（L93） | ✓ | ✓ | ✗ | DEPARTMENT |
| NURSE_HEAD（L112） | ✓ | ✓ | ✓ | DEPARTMENT |
| SYS_ADMIN（L146） | ✓ | ✓ | ✓ | ALL（不变式：含全部权限点） |

DEVICE_ADMIN（L135）无任何 glucose 权限，数据范围 NONE 档。

### 3.4 数据模型（`apps/server/prisma/schema.prisma` L216-252）

`GlucoseRecord`：`id`、`patientId`、`resultType VarChar(2)`（DY-RESULT `'0'`~`'9'`）、
`valueMmolL Decimal(4,1)?`（结果类型 3~9 时为 null）、`mealContext VarChar(32)?`（**时段码**，非名称）、
`measuredAt Timestamptz(3)`、`operatorId?`（录入人）、`testStrip Int?`、`remark VarChar(500)?`、`createdAt`、
**`voidedAt?` / `voidedById?`**（L233-237，R25 软删除留痕）。

- 关系 `operator` / `voidedBy` 均 `onDelete: Restrict`（L242-243）。
- L245-250：唯一约束已改为**部分唯一索引** `glucose_record_active_unique`（仅 `voidedAt IS NULL`），
  SQL 在 `prisma/sql/glucose_record_active_unique.sql`。
- 索引 `@@index([patientId, measuredAt(sort: Desc)])`、`@@index([operatorId])`——**记录页按录入人筛选已有索引支撑**。

---

## 4. 关键实现决策与踩过的坑

### 4.1 ⚠️ StrictMode 双请求导致审计成对重复（2026-11-20 修复，commit `968780b`）

**现象**：进详情页时 `GET /patients/:id` 与 `/admissions` 各请求两次，审计表写入成对重复行
（实测 `08:44:45.570` 与 `.589` 两条 `PATIENT_VIEW`，相差 19ms、各自独立 requestId）。

**根因**：React 18 `StrictMode`（`apps/web/src/main.tsx:35`）在**开发模式**下 mount → cleanup → remount，
使 `useEffect` 跑两次。两个 hook 原本只有 `cancelled` 闭包标志——它只丢弃**响应**，请求早已发出、服务端照常写审计。

**为什么报表接口不双发**：`useGlucoseReport.ts:64-67` 有 `ready` 门控，首次挂载时 admissions 未就绪直接 return。
这条反证排除了「组件重复挂载 / 路由重渲染」等其他假设。

**修复**：`usePatientDetail.ts` / `useAdmissions.ts` 各加 `requestedIdRef` 记录已为哪个 id 发过请求，
StrictMode 第二次执行直接跳过（同 `usePatientQuery.ts:296-304` 的 `initializedRef` 口径）。

**⚠️ 这里有个会让页面卡死的坑，记录页若照抄务必注意**：竞态保护原本靠闭包 `cancelled`，
若只加守卫不改它，则 cleanup 把第一次请求的响应标记为丢弃、守卫又拦掉重发 → **数据永不落地、页面恒 loading**。
所以改为 `activeIdRef` 比对，且**复位必须写在判守卫之前**（`usePatientDetail.ts:43-45`、`useAdmissions.ts:43-45` 有注释标注）。

**影响面**：生产构建原本就是各 1 次（StrictMode 不双调用），本次只修开发/演示环境的审计失真。
**遗留约束**：将来若需「同 id 强制重取」（如编辑患者后就地刷新详情），必须另加 `version` 信号进依赖，
否则会被 `requestedIdRef` 挡住。

### 4.2 全屏不用浏览器 Fullscreen API（R23）

antd 弹层挂 `body`，进入浏览器原生全屏后**弹层不可见**；且有兼容性问题。
改用纯 CSS 覆盖层（`position:fixed; inset:0`，zIndex/背景/内边距全取 token），明暗主题天然兼容。
R26 已收拢进 `useFullscreen()`。

### 4.3 公共模块是纯 UI 骨架，不取数（R26）

`GlucoseQueryForm` 只收 `data: AdmissionsResponse | null`，**住院记录树仍由页面侧 `useAdmissions` 拉取**。
两个理由：① 避免三页各发一次相同请求；② 不产生 `components/` → `pages/` 的反向依赖。
所以 `useAdmissions` **留在 `patient-detail/` 不搬**。

同理 `buildReportStatsItems`（报表统计口径 → 公共 `items` 的适配）放**页面侧**，
公共 `GlucoseStatsBar` 因此不认识任何业务类型——记录页可传自己的口径（如「本页条数」），趋势图可传 TIR/达标率。

### 4.4 软删除与部分唯一索引（R25）

删除按**作废**实现：库内保留行 + `voidedAt`/`voidedById` 留痕，报表/统计/最新血糖不再展示。
Prisma 的 `@@unique` 不支持 `WHERE` 条件，故用**手写 SQL 的部分唯一索引** `glucose_record_active_unique`
（`WHERE voidedAt IS NULL`）——否则作废一条后就再也录不进同一时间点。

**记录页若做「含作废」筛选，必须显式处理 `voidedAt`**：默认查询排除已作废行，
勾选「含作废」时才纳入，且展示需区分（作废人/作废时间）。

### 4.5 报表分页单位是「日期数」

`GLUCOSE_REPORT_PAGE_SIZE = 15`（`packages/shared/src/glucose/schema.ts:241`）指 **15 个日期**，
不是 15 条记录——一天可能有多条（多时段）。记录页按「条」分页，**不要复用这个常量**。

### 4.6 时段是动态数据，禁止按名称匹配

`mealContext` 落库**时段码**（`code`）。时段存 `TimeSlot` 表、经 `GET /time-slots` 下发、
前端 `useCommonDataStore().timeSlots`。停用时段**历史可展示、新录入拒绝**。
`@gc/shared` 的 `TIME_SLOTS` 已降级为**仅 seed 数据源**，`getFallbackTimeSlots`/`getTimeSlotLabel` 已删除，
**禁止运行时用它做校验或展示兜底**（会与库数据漂移）。

### 4.7 字典禁止硬编码

结果类型（DY-RESULT）的 label 与颜色全部取字典（`DictItemOption { code; label; color; checkable; counted; sortOrder }`），
登录后经 `useCommonDataStore` 下发。**禁止硬编码 label/color**，字典未加载时回退 code 原文且不着色。

---

## 5. 关键文件

### 5.1 前端 · 公共模块（R26 新增，三页共用）

| 文件（`apps/web/src/components/glucose/`） | 作用 |
|---|---|
| `GlucoseStatsBar.tsx` | 统计栏，字段可配置 `items`，不认识业务类型 |
| `GlucoseQueryForm.tsx` | 查询表单（原 `patient-detail/ReportQueryForm.tsx` 迁移改名），三层联动 + `extra` 插槽 |
| `GlucoseToolbar.tsx` | 工具栏行：统计 + 表单插槽 + 全屏按钮；含 `FullscreenToggle` |
| `useFullscreen.ts` | 全屏 hook，收拢原分散四处的逻辑 |
| `GlucoseFormFields.tsx` | 录入/编辑弹框共用字段组 |

### 5.2 前端 · 患者详情页（`apps/web/src/pages/inpatient/patient-detail/`）

| 文件 | 作用 |
|---|---|
| `index.tsx` | 页面壳；data 加载后才渲染 Tabs，403/404 时子路由不挂载 |
| `PatientDetailTabs.tsx` | 两层 Tab（L19-23 主 Tab、L26-30 血糖子 Tab）；L122-134 展示勾选**仅 report 渲染**；L146 `<Outlet context>` |
| `detail-tabs.ts` | 路径与类型常量**唯一来源**（L26-32 `DETAIL_TAB_PATH`、L68-74 `DetailOutletContext`、L104-106 `DetailChildContext`、L145-175 `resolveDetailTab`） |
| `GlucoseReportTab.tsx` | 报表子页（矩阵、展示勾选、分页、增改废弹框） |
| `DetailPlaceholder.tsx` | 占位页（L12 注释：**不发任何请求**——占位页不该产生审计记录） |
| `usePatientDetail.ts` / `useAdmissions.ts` | 详情 / 住院树，均含 StrictMode 守卫（§4.1） |
| `useGlucoseReport.ts` | 报表数据，`ready` 门控 + `version` 信号 |
| `buildReportStatsItems.ts` | 报表统计口径 → 公共 `items` 的页面侧适配 |
| `../../routes/routes.tsx` | L86-89 子路由注册（**L88 是血糖记录占位，替换 element 即可**） |

### 5.3 共享契约与后端

| 文件 | 作用 |
|---|---|
| `packages/shared/src/glucose/schema.ts` | 血糖常量/Zod/类型全量（经 `src/index.ts` L4 导出） |
| `packages/shared/src/dict/dict-types.ts` | `DICT_TYPE`、`DictItemOption` |
| `packages/shared/src/dict/time-slots.ts` | `TIME_SLOT_CATEGORY`、`TimeSlotOption`、`pickTimeSlotByTime` |
| `packages/shared/src/dict/roles.ts` | `PERMISSION`、`ROLE_PERMISSIONS`、数据范围 |
| `apps/server/src/modules/glucose/glucose.controller.ts` / `.service.ts` | 5 个接口与业务逻辑 |
| `apps/server/prisma/schema.prisma` L216-252 | `GlucoseRecord` |
| `apps/server/prisma/sql/glucose_record_active_unique.sql` | 部分唯一索引 |

### 5.4 测试惯例与一个硬限制

spec 与源文件**同目录**、命名 `<源文件名>.spec.ts(x)`。

- web 页面侧：`GlucoseReportTab.spec.tsx`(27)、`GlucoseReviewModal.spec.tsx`、`PatientDetail.spec.tsx`、`detail-tabs.spec.ts`、`buildReportStatsItems.spec.ts`(10)
- web 公共模块：`GlucoseQueryForm.spec.tsx`(21)、`GlucoseStatsBar.spec.tsx`(9)、`GlucoseToolbar.spec.tsx`(7)、`useFullscreen.spec.ts`(4)
- server：`modules/glucose/glucose.service.spec.ts`（无 controller spec、无 `test/` 目录、无 `*.e2e-spec.ts`）

⚠️ **web 测试跑在 node 环境、无 jsdom**：不执行 `useEffect`、无法触发浏览器 API。
所以 hook 的 effect 逻辑、ESC 监听、rAF 尺寸通知**只能靠 typecheck + 手工 e2e**；
纯函数（`buildFullscreenOverlayStyle`、`derive*`、`build*`）才可单测。
这也是 `PatientDetail.spec.tsx` 用 `vi.mock('./usePatientDetail')` 把 hook 同步化的原因。
**记录页设计时应尽量把逻辑抽成纯函数**，否则同样测不到。

---

## 6. R26 公共模块 API 速查

```ts
// GlucoseStatsBar.tsx
export const STATS_GAP_PX = 20;                                     // L16
export interface GlucoseStatsItem {                                  // L18-38
  label: string; value: string;          // value 是已格式化文本，组件不加工
  color?: string;                        // 必须取字典色，禁止硬编码
  suffix?: string; numeric?: boolean;    // numeric → 走 gc-num（tabular-nums）
  divider?: boolean;                     // 该项前渲染竖线
}
export function GlucoseStatsBar({ items }: { items: GlucoseStatsItem[] });  // L49

// GlucoseToolbar.tsx
export function FullscreenToggle({ fullscreen, onToggle }:           // L25-31
  { fullscreen: boolean; onToggle: (next: boolean) => void });
export interface GlucoseToolbarProps {                               // L47-61
  stats?: GlucoseStatsItem[];            // 空/不传 = 不渲染统计区，按钮仍靠右
  form?: ReactNode;
  fullscreen: boolean;
  onToggleFullscreen: (next: boolean) => void;
}
// 内容区（表格/图表）不在组件内，调用方自渲染并用 overlayStyle 合并根样式（L15-17）

// GlucoseQueryForm.tsx（受控 + 纯函数，不取数 L23-24）
export const QUERY_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';              // L28
export const ADMISSION_ALL = 'ALL';                                  // L30
export const FALLBACK_FORM_STATE;                                    // L48
export interface GlucoseQueryFormState {                             // L33-39
  admissionId: string; departmentStayId: string | null;
  startTime: string | null; endTime: string | null;
}
export interface GlucoseQueryRange { startTime?: string; endTime?: string }  // L42-45
export interface GlucoseQueryFormProps {                             // L297-315
  data: AdmissionsResponse | null; loading: boolean;
  state: GlucoseQueryFormState | null;
  onChange: (next: GlucoseQueryFormState) => void;
  onSearch: () => void; onReset: () => void;
  extra?: ReactNode;   // 渲染在时间控件后、查询/重置按钮前（L434）
}
// 导出纯函数（均可单测）：deriveQueryDefaults(L87) / deriveAdmissionSelection(L108)
// / deriveStaySelection(L133) / deriveTimeBounds(L163) / buildAdmissionLabel(L189)
// / buildDepartmentLabel(L201) / buildAdmissionOptions(L217) / buildDepartmentOptions(L233)
// / toQueryRange(L250) / isRangeInverted(L258)
// L309-311 注释明确：extra 供「记录页可能要时段/结果类型/录入人/含作废」使用

// useFullscreen.ts
export interface FullscreenToken { zIndexPopupBase; colorBgContainer; padding }   // L18-22
export function buildFullscreenOverlayStyle(fullscreen, token): CSSProperties;    // L31（非全屏返回 {}）
export interface UseFullscreenOptions { onResize?: (fullscreen: boolean) => void } // L47-58（rAF 后触发）
export interface FullscreenApi {                                                  // L60-68
  fullscreen: boolean; toggle: () => void; exit: () => void; overlayStyle: CSSProperties;
}
export function useFullscreen(options?: UseFullscreenOptions): FullscreenApi;      // L70
// 内置 ESC 退出（L82-93）；换患者重置需调用方在 effect 里手动 exit()

// GlucoseFormFields.tsx（录入/编辑弹框共用）
export interface GlucoseFormValues {...}                           // L25-34
export function toPayload(values): CreateGlucosePayload;            // L37
export interface GlucoseFormFieldsProps { form; onMeasuredAtChange?; onMealContextManualSelect? }  // L51-60
export default GlucoseFormFields;                                   // L69

// 页面侧适配（记录页照此写自己的口径）
export function buildReportStatsItems(                // buildReportStatsItems.ts L22-25
  stats: GlucoseReportStats, resultTypes: DictItemOption[],
): GlucoseStatsItem[]
```

**接入骨架**（趋势图只需多传 `onResize`）：

```tsx
const { fullscreen, toggle, exit, overlayStyle } = useFullscreen();
// 趋势图：useFullscreen({ onResize: () => chartRef.current?.resize() })
const admissions = useAdmissions(id);          // hook 留在页面侧，公共表单不取数

<div style={{ height: '100%', display: 'flex', flexDirection: 'column', ...overlayStyle }}>
  <GlucoseToolbar
    stats={recordStatsItems}                   // 记录页自己的统计口径（页面侧适配函数产出）
    form={
      <GlucoseQueryForm
        data={admissions.data} loading={admissions.loading}
        state={queryForm} onChange={setQueryForm}
        onSearch={handleSearch} onReset={handleReset}
        extra={<>                              {/* 特有条件插在时间控件后、按钮前 */}
          <Select aria-label="时段" /* … */ />
          <Select aria-label="结果类型" /* … */ />
        </>}
      />
    }
    fullscreen={fullscreen} onToggleFullscreen={toggle}
  />
  {/* 内容区各页自理：分页语义不同（报表按天/记录按条/趋势图不分页），故未入公共模块 */}
</div>
```

---

## 7. 已知偏差与风险

### 7.1 `ADMISSION_QUERY` 的 StrictMode 守卫待复验

`usePatientDetail.ts` 改完（08:58:43 UTC）后的 08:59:06 访问，审计表 `PATIENT_VIEW` **已实证降为单条**；
`useAdmissions.ts` 改完于 09:00:04，其后尚无访问记录，故 `ADMISSION_QUERY` **只有代码级保证**
（与已实证生效的 `usePatientDetail` 逐行同模式），未拿到审计表实证。

**复验方式**：硬刷新（Ctrl+F5）患者详情页 → network 里两个接口应各只剩 1 次；
或查审计表比对刷新后时间戳是否各 1 条。

### 7.2 ⚠️ `.codebuddy/rules/glucose-domain.md` 两处事实性过时

规则文件是 AI 的强制上下文，过时会直接误导新会话。**建议人工确认后修正**：

1. 「报表查询表单联动…见 **`ReportQueryForm.tsx`** 导出纯函数与其 spec」
   → R26 已迁移改名为 `apps/web/src/components/glucose/GlucoseQueryForm.tsx`
   （`ReportQueryFormState`→`GlucoseQueryFormState`、`toReportRange`→`toQueryRange`），原文件已删除。
2. 「去重（唯一约束兜底）实现：**`@@unique([patientId, measuredAt])`**（索引 `GlucoseRecord_patientId_measuredAt_key`）」
   → R25 已改为**部分唯一索引** `glucose_record_active_unique`（`WHERE voidedAt IS NULL`，
   手写 SQL 在 `prisma/sql/glucose_record_active_unique.sql`），见 schema L245-250。
   原全表唯一约束会让「作废后重录同一时间点」失败，故必须带 `WHERE`。

### 7.3 R26 公共化后的手工 e2e 未做

组件已迁移改名、渲染路径改变（联动与样式逻辑未变）。`playwright-cli` 未安装，
全局安装会污染环境，故未做浏览器级验证。**待需求人复验**：
统计栏四项文案与 20px 间距、`|` 位置、极值着色；查询/重置联动；全屏进入/退出/**ESC**/**换患者重置**；
工具栏窄屏换行；打印预览无表单与按钮。

### 7.4 公共模块尚未经第二个调用方实证

R26 是为记录页/趋势图预备的，那两页仍是占位，所以公共模块**只被报表页单页使用过**。
「零改动接入」是设计承诺——记录页开发时若发现 API 不够用，
应**回头调整公共模块**（而不是在记录页里绕开它复制一份），否则三页漂移的老问题会重演。

---

## 8. 验证记录

### 8.1 已完成命令（R26 + StrictMode 修复后，全绿）

```bash
pnpm typecheck    # shared / web / server 三包
pnpm lint
pnpm test         # 488 例：shared 71 + server 265 + web 152
```

R26 第 1 笔提交（`f015230`）已单独 `git checkout` 验证可独立编译（exit 0）。

### 8.2 提交记录（均已推送 `origin/main`）

| commit | 内容 |
|---|---|
| `f015230` | `refactor(web)`: 新增血糖数据三页共用工具栏公共模块（纯新增，8 文件） |
| `90c995c` | `refactor(web)`: 血糖报告页接入公共工具栏并迁移查询表单（净减 627 行） |
| `19e1c1f` | `docs`: 回写 R26 公共模块抽取并补登 R25 决策 |
| `968780b` | `fix(web)`: 消除详情页 StrictMode 双请求导致的审计成对重复 |

### 8.3 环境

- 后端 NestJS `:3000`、前端 Vite `:5173`（`/api` 代理到后端）；嵌入式 PostgreSQL。
- 演示账号（`apps/server/prisma/seed.ts:346`）：`dr.wang` / `nurse.li` / `head.zhou` / `dr.chen` / `sys.admin`，
  密码均为 `Gc@2026pass`。`sys.admin` 是 SYS_ADMIN（全院范围），`dr.chen` 属心内科（用于验证跨科室越权被拒）。
- **新窗口不要假设服务仍在运行**，先检查 3000 / 5173 端口（仓库有 `gc-dev` skill 可增量启动）。
- 数据范围差异是正常现象：`sys.admin` 与 `dr.wang` 看到的患者数不同，是 `buildScopeWhere` 过滤结果，不是接口少返回。

---

## 9. 下一步：血糖记录模块的起点与缺口

### 9.1 已就位（不用动）

- **路由**：`routes/routes.tsx:88` 已登记 `DETAIL_TAB_PATH.glucoseRecord`（= `'glucose/record'`），
  当前 `element` 是 `<DetailPlaceholder label="血糖记录" />`——**替换 element 即可**（L87 注释原话：
  「本次只登记路由、保持占位且不发请求（R2），后续开发只需替换 element」）。
- **Tab**：`PatientDetailTabs.tsx:26-30` 的 `GLUCOSE_SUB_TABS` 已含 `{ key: 'record', label: '血糖记录' }`；
  URL 驱动（R10），刷新停留。
- **公共工具栏**：统计栏 / 查询表单（含 `extra` 插槽）/ 全屏三件套已备好，见 §6。
- **基础设施**：软删除字段与部分唯一索引、`operatorId` 索引、权限点、字典下发、DataScope 过滤全部齐全。
- **录入/编辑弹框**：`GlucoseFormFields.tsx` 可与 R25 的添加/编辑弹框共用（记录页若要行内增改）。

### 9.2 缺口（需立项明确）

| # | 缺口 | 说明 |
|---|---|---|
| 1 | **后端列表/分页接口** | 现有 5 个 glucose 接口无列表查询。需新增（如 `GET /patients/:id/glucose/records`），参照 report 接口口径：`PATIENT_VIEW` 权限 + `@RequireDataScope(RESOURCE.PATIENT)` + 逐次审计 action（**action 名需定，如 `GLUCOSE_RECORD_QUERY`**） |
| 2 | **共享包 schema** | `packages/shared/src/glucose/schema.ts` 需加 query schema（筛选参数 + 分页）与 response 类型（列表项 + total）。改共享包必须走 `.codebuddy/rules/shared-package.md` 三步 |
| 3 | **筛选条件** | R26 已预留 `extra` 插槽，登记的四项是**时段 / 结果类型 / 录入人 / 含作废**（`GlucoseQueryForm.tsx:309-311`、`glucose-report-query.md:295-296`）。是否全做、是否多选、录入人下拉数据源（本院全部还是本科室）待定 |
| 4 | **统计口径** | 公共 `GlucoseStatsBar` 已字段可配置，但记录页展示什么未定。`GlucoseStatsBar.tsx:8` 与 `buildReportStatsItems.ts:10` 注释提到「记录列表可能是本页条数」，**未定** |
| 5 | **分页语义** | 按「条」（R26 已裁定不纳入公共模块，记录页自己实现）。每页条数、排序字段（`measuredAt DESC` + 稳定第二排序键？参照患者列表用 `id` 兜底防页漂移）待定 |
| 6 | **列表列定义** | 展示哪些字段（测量时间/时段/结果类型/值/录入人/试纸/备注/作废状态）、`valueMmolL=null`（结果类型 3~9）如何显示、作废行如何呈现 |
| 7 | **行内操作** | 是否复用 R25 的编辑/作废（若复用，`glucose:update`/`glucose:delete` 权限与审计已就绪） |

### 9.3 建议先裁定的问题（新会话开场就该问清，避免猜）

按 `docs/FEATURE-SPEC-TEMPLATE.md`，⭐ 必填项缺失时**先问不猜**。血糖记录页至少要定：

1. 阶段号与优先级（`docs/ROADMAP.md` L80 登记为 **P3-2 血糖查询剩余部分**，L164 归入「血糖查询（剩余）/图表」，依赖：无）。
2. 接口契约：路径、筛选参数、分页单位与上限、响应结构、审计 action 名。
3. 「含作废」默认勾选与否；作废行是否需要额外权限才可见。
4. 录入人筛选的数据源与权限边界（会不会泄露跨科室人员名单）。
5. 统计栏展示什么（或本期不展示，`stats` 传 `undefined` 即可，工具栏按钮仍靠右）。
6. 是否需要导出（`ROADMAP` P3-6 依赖 P5 导出框架，本期应明确排除）。
7. 空态/加载态/错误态文案与错误码（只能用 `docs/ERROR-CODES.md` 已有码，新码需登记）。

---

## 10. 边界提醒

- 本次归档范围是**血糖报告**；开发血糖记录时**不要顺手改报表页行为**，公共模块的调整需保证报表页回归通过。
- **趋势图页不要一起动**（`routes.tsx:89` 同为占位），除非明确立项。
- 患者数据查询必须继续走后端数据权限过滤，**不要在前端或 service 内手写绕过 `buildScopeWhere`** 的科室条件。
- 查询患者血糖属敏感操作，**必须逐条留痕**；新增接口不要漏 `@Audit`，也不要为了减少审计而合并请求。
- 禁止新增依赖（含图表库、表格库）；确需新增须说明用途并等人工批准。
- 禁止修改 `prisma/schema.prisma`、migration、`docker-compose.yml`、CI、`.env*` 而不走人工审查
  （`AGENTS.md §6.5`）；记录页若需新字段（如列表用视图偏好）先提出来。
- 禁止硬编码业务常量（阈值、单位换算 18、角色码、字典 label/color、时段名称）。
- 不要向 AI 提供真实患者数据；本地演示数据来自 `seed.ts`。
- 提交按 `.codebuddy/rules/git-commit.md`：明确路径 `git add`（禁 `-A`/`.`）、四段式正文、
  影响面四项必填、schema/migration 与鉴权审计各自独立成笔。
