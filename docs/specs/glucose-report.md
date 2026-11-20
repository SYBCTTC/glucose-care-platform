# 血糖报告（患者详情 · 日期 × 时段矩阵）

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 归档。状态：✅ **已实现**（2026-11-19 出规格并三轮裁定，同日实现落地；
> lint / typecheck / test / build 全绿，test 389：shared 71 / server 233 / web 85；手工 e2e 待联调环境执行，见 §8）
>
> 上游规格：`docs/specs/patient-detail.md`（详情页框架；其决策 A4 把血糖报告留为 `Empty` 占位，本规格填充其中「血糖报告」一项）。
> 口径来源：`docs/COMMON-DATA.md:114` 已预裁定报表表头与着色口径，本规格与其一致。
>
> 变更范围：**共享包 3 个文件**（`pickTimeSlotByTime` 加选项、`date.ts` 加 3 个本地时区助手、`glucose/schema.ts` 加报表契约）
> \+ **后端 1 个只读接口** + **前端路由基建改造（全仓首个嵌套路由）** + **详情页 5 个内容页全路由化** + **报表子页**
> \+ **2 处列表页 `goDetail` 跳转目标调整**。
> **无 Prisma schema 变更、无迁移、无新增权限点、无新增错误码。**

## 0. 元信息

| 项 | 内容 |
|---|---|
| 阶段号 | P3-2 血糖查询（`docs/ROADMAP.md:77`，由 ❌ 推进为 ⚠️ 部分完成） |
| 模块 | 后端 `modules/glucose`（新增查询）；前端 `routes/`（`menu.tsx` 类型 + `App.tsx` 渲染 + `routes.tsx` 登记）、`pages/inpatient/patient-detail`（5 个内容页路由化 + 新增 report 子页）、`pages/inpatient/patients`、`pages/inpatient/virtual-ward`（各 1 处 `goDetail`）；共享包 `dict/time-slots.ts`、`date.ts`、`glucose/schema.ts` |
| 优先级 | P1 |
| 依赖 | `GET /time-slots`（已有）、`DY-RESULT` 字典（已有）、`scope.util.ts`、`AuditLogInterceptor`、患者详情页框架（P2-2） |
| 需求人 | 产品（2026-11-19 提出，三轮共 14 项裁定 R1–R14 + 12 项默认补齐 D1–D12） |

## 0.1 决策记录（需求人裁定）

| # | 决策 |
|---|---|
| R1 | **路由方案 A**：`AppRoute` 增加 `children` / `index`，详情页壳用 `<Outlet/>` 渲染子页 —— 全仓首个嵌套路由 |
| R2 | **血糖三条子路由全登记**：`glucose/report`（真实表格）、`glucose/record`、`glucose/trend`（仍 `Empty`「（建设中）」占位、**不发请求**）。Tab 切换全走路由，刷新任意子页均保持。（**已被 R10 扩展**：主 Tab 两项也一并路由化，共 5 个内容页） |
| R3 | **单元格由三行改两行**：第 1 行 `值(HH:mm)`，强化时段则 `值(HH:mm)(强化时段名)`；第 2 行 = 检测人（原第 3 行上移）；**原第 3 行取消**。目的：压缩单条高度，缓解同日同时段数据多时表格被撑开 |
| R4 | **一格多条**：同时段列内按时间先后**纵向堆叠**多组「两行」，组间加分隔线（不折叠、不隐藏） |
| R5 | **强化归组**：给共享包 `pickTimeSlotByTime` 加「忽略 `enabled`」选项，报表归组时停用时段也参与匹配；仍无命中（区间空洞）→ 归入 `RANDOM` 列并**保留强化后缀** |
| R6 | `startDate` / `endDate` **仅在接口契约预留**，本轮前端不做日期选择器（涉及出入院业务，单开任务） |
| R7 | **不补空行**；**服务端分页 `pageSize=15`，单位是「15 个日期」而非 15 条血糖记录**；不传范围 → 查全量、日期**降序** |
| R8 | `valueMmolL` 为 null（`resultType` `'3'~'9'`）→ 第 1 行显示 **`DY-RESULT` 字典标签** + 时间 |
| R9 | 阶段号归入 **P3-2**，规格归档本文件，`ROADMAP.md:77` 改 ⚠️ 部分完成 |
| R10 | **主 Tab（基本信息 / 出入院记录）也必须是独立路由，刷新停留** —— 需求人明确**不接受**「停在主 Tab 时刷新被打回血糖报告」的降级。故详情页 5 个内容页全部路由化 |
| R11 | 日期列**仅 `YYYY-MM-DD`，不附星期** |
| R12 | 审计动作名采用 **`GLUCOSE_REPORT_VIEW`** |
| R13 | `mealContext` 为 `null` / 未知 code 的历史脏数据统一落 **`RANDOM` 列**（不单开「未归组」列，表头保持 11 列） |
| R14 | `formatLocalDate` / `formatLocalTime` **加进 `shared/date.ts`**（不在 service 内联实现） |
| R15 | Tab 切换用 **`replace: true`**：浏览器后退键不在 Tab 间穿梭，直接回列表页 |
| R16 | **`parseLocalDate` 一并落地**（入参侧把 `YYYY-MM-DD` 解析为本地零点），与 R14 的两个出参函数同批加入 `shared/date.ts` |
| R17 | **（2026-11-19 实现后二次调整）表格不横向滚动**：日期列**不固定**（去 `fixed: 'left'` 与 `scroll.x`），11 列均分页面宽度全部可见；时段列不定宽，格内内容允许换行 |
| R18 | **（同批）格内内容居中**（列 `align: 'center'`，`gc-num` 的默认右对齐被 inline 覆盖）；**无数据的单元格渲染为空**，不放 `-` 占位（D7 的 `nurseName=null` 显示 `-` 口径不变，那是有记录但缺记录者） |
| R19 | **（2026-11-19 三次调整）值行加 6px 视觉间距**：`值` 与 `(时间)` 之间**恒有**间距；有强化时段时 `(时间)` 与 `(强化名)` 之间同样加间距。用 **inline margin** 实现（非空格字符，R3「紧邻无空格」的文本口径不变；inline margin 不破坏 R18 居中）。6px 为需求人指定值，非 token 档位，立常量 `VALUE_GAP_PX` 注明出处 |
| R20 | **（2026-11-19 四次调整）「单位：mmol/L」标注删除（D5 被推翻），原位替换为统计栏**：`总计：N 次 ←20px→ \| ←20px→ 合格次数：M 次 ←20px→ 最高血糖：X ←20px→ 最低血糖：Y`，左对齐；20px 为需求人指定值（常量 `STATS_GAP_PX`）。口径：①总计 = `DictItem.counted=true` 码集的记录数（**数据驱动**，当前种子 0~4；5~9 不计入；需求人更正裁定：3/4 计入总计）；②合格 = `'1'` 正常条数；③最高：存在 `'4'`(High) → 展示字典 label，否则数值最大值 `toFixed(1)` + ` mmol/L`；最低对称（`'3'`/Low）；④极值颜色取**该记录自身 resultType** 的字典色，High/Low 文案色取 `'4'`/`'3'` 字典色；⑤统计由**服务端按查询范围全量计算**、随报表响应 `stats` 字段下发（不新增接口/权限/审计），**与分页无关**，后续新增筛选条件（时间/住院记录/科室，本轮不做）自动跟随；⑥无数据时统计栏照常展示 `总计：0 次`、极值 `-`（裁定 3a）；⑦**布局预留**：统计栏居左，下一个任务的查询筛选表单挂同一行右侧（左右分布，本轮不实现） |
| R21 | **（2026-11-19 五次调整）滚动边界下移：子 Tabs 与统计栏固定，表格占据剩余空间、仅 body 内滚**：①详情页滚动容器（`PatientDetailTabs` 内容区）拆两层——子 Tabs 移出滚动区固定，内容区 `flex:1 + overflow:auto` 为唯一滚动容器；②血糖报告根节点 `height:100%` flex 列：统计栏/错误条 `flexShrink:0` 固定，表格 `flex:1`（最小高度 `REPORT_TABLE_MIN_HEIGHT=200` 防极矮屏塌缩，此时根节点 `overflow:auto` 兜底滚动）；③表格挂 `scroll.y='100%'` 触发 antd 拆分固定表头与滚动 body，实际高度由 `global.css` 的 `.gc-report-table` flex 链决定（antd 无百分比撑满 API，需求人接受 CSS 穿透其内部 DOM，作用域限定本表格）；④**裁定 1**：行数不足一屏时表格边框盒仍撑满剩余空间（body `flex:1`）；⑤**裁定 2**：分页条固定在表格区底部不随内容滚动；⑥**裁定 3**：打印裁剪本轮不考虑（现状即按定高卡片裁剪，非本次引入）；⑦其余 4 个内容页滚动行为不变（仍在内容区内滚），全应用其他页面零影响 |
| R22 | **（2026-11-19 六次调整）展示项勾选 + 弃用时段合并展示**：①子 Tabs 同一水平线紧跟四个 Checkbox——**常规血糖 / 强化血糖 / 检测时间 / 操作人**，仅「血糖报告」子 Tab 渲染（切主 Tab 或其他子 Tab 即隐藏），默认全勾选；②常规与强化**至少保留一项**：取消其中一项时若另一项已未勾选 → 阻止 + `message.warning('常规血糖与强化血糖至少需勾选一项')`（裁定 Q7），双向都拦；③勾选变化**纯前端实时过滤**已下发数据，不重新请求（裁定 Q5：统计栏与分页 `total` 不受影响）——常规/强化控制**记录显隐不控列显隐**（裁定 Q3），检测时间控制格内 `(HH:mm)`、操作人控制第 2 行；④**特殊时段来源记录恒展示且时间恒展示**（规则 6），记录者仍受「操作人」控制；⑤**弃用时段不再成列**（推翻 R5 的「停用时段仍下发列」口径，裁定 Q2）：其历史记录按检测时间合并进**启用的**普通列，展示方式与强化一致——`值(时间)(弃用时段名)`，后缀是**弃用时段自己的名称**（裁定 Q1）；entry 契约随之变更：`intensiveName` 泛化为 `sourceSlotName`、新增 `sourceType`（原时段类型 0/1/4），弃用记录按**原时段类型**跟随勾选（裁定 Q4），归组失败兜底记录按特殊对待（恒展示）；⑥强化归组宿主只认**启用**普通时段（R5 的 `ignoreEnabled:true` 不再使用）；⑦记录全被过滤的日期行**保留为空行**（裁定 Q6：`total` 由服务端按日期算，前端抽行会页内不一致）；⑧勾选状态详情页会话内记忆，换患者/重进详情页重置全勾选（裁定 Q8），不持久化；⑨演示数据（裁定 Q9）：林*（`de6f6beb`）经 API 新增随机 ×3（含 1 条 High 无值型）+ 复测 ×2，随后 dev 库弃用 `RETEST`——复测记录即合并进早餐后/晚餐后列带 `(复测)` 后缀 |

> ⚠️ **R3 与原始需求的差异**（需求人 2026-11-19 主动变更，按新口径实施）：
> 原需求 4a 为「强化时段名紧跟血糖值」，现改为「**紧跟检测时间之后**」；括号由中文全角「（）」改为**英文半角** `()`。

### 0.2 AI 依既有裁定补齐的默认（需求人可否决，见 §11）

| # | 默认 | 依据 |
|---|---|---|
| D1 | 权限复用 `PATIENT_VIEW` + `RESOURCE.PATIENT`，**不新增** `glucose:view` 权限点、不新增资源类型 | `PERMISSION-DESIGN.md:81-84`「挂患者下的子资源复用 `RESOURCE.PATIENT`」（虚拟病区先例） |
| D2 | 审计动作 `GLUCOSE_REPORT_VIEW`，**一次接口调用一条**（非每条血糖一行），`targetType='PATIENT'` | `AGENTS.md` §5.2「查询患者血糖数据属敏感操作，必须逐条留痕」 |
| D3 | **归组在服务端做**，响应下发 `columns`，前端不依赖 `useCommonDataStore().timeSlots` 画表头 | 单一口径、可单测；避免前端 store 未加载完或与库数据漂移 |
| D4 | 着色只作用于**血糖数值/标签**，色值取 `DY-RESULT` 字典 `color`；时间与检测人用正文色 | `COMMON-DATA.md:114`「按服务端返回 `resultType` 着色，不要在前端拿阈值自己比」；`LastGlucose.tsx` 先例 |
| D5 | ~~格内**不带单位**，`mmol/L` 在表格说明处标注一次~~ **已被 R20 推翻**（2026-11-19）：单位标注删除，格内数值无单位；`mmol/L` 只随统计栏最高/最低值后缀出现 | 两行结构下格内空间紧张 |
| D6 | 日期列仅 `YYYY-MM-DD`，不附星期 | 需求人裁定（R11） |
| D7 | 检测人 `operatorId` 为空 → 第 2 行显示 `-` | 与 `LastGlucose.tsx` 空值口径一致 |
| D8 | 数据层用**手写 hook**（`useState`/`useEffect` + `cancelled` 防竞态），不引入 `useQuery` | 全仓零 `useQuery` 使用，`usePatientDetail.ts:23-58` 为现行约定 |
| D9 | 裸 `/inpatient/patients/:id` 与**任何未知子路径**由 index / `*` 子路由 `Navigate replace` 到 `glucose/report`，且**必须透传 `location.state`** | 满足「进入详情页默认高亮血糖报告」；不透传会破坏 C1 返回还原（§12 风险 1） |
| D10 | **列表页 `goDetail` 直接跳 `.../glucose/report`**，不再跳裸详情 URL | 把 index 重定向从**主路径**上摘掉，`history.state` 结构性无损（§12 风险 1 的主防线）；仅 2 处调用点 |
| D11 | **Tab 切换一律 `navigate(..., { replace: true, state })`**，由统一 hook `useDetailTabNavigate()` 实现 | `replace` 防止 Tab 切换污染浏览器历史（否则「返回」会在 Tab 间打转而非回列表）；`state` 必须透传，否则 `index.tsx:29` 的 `from` 丢失、返回退化为兜底跳转 |
| D12 | 详情页子路径常量集中在 `patient-detail/detail-tabs.ts`，`routes.tsx` 与 `PatientDetailTabs.tsx` **共同引用** | 避免路径字符串两处各写一份而漂移 |

## 1. 目标与用户故事

作为 **医护人员**，我要 **在患者详情页查看该患者的血糖报告表格**，以便 **按「日期 × 时段」快速掌握患者血糖情况**。

**本次做**：
- ① 后端新增血糖报告只读接口（日期 × 时段矩阵、强化时段归组、按日期服务端分页）；
- ② 前端血糖报告子页（表格渲染 + 分页）；
- ③ 详情页路由改造为**嵌套子路由**，5 个内容页（基本信息 / 出入院记录 / 血糖报告 / 血糖记录 / 趋势图）各占独立 URL，**刷新均保持**（R10）；
- ④ 共享包：`pickTimeSlotByTime` 加「忽略 enabled」选项、`date.ts` 加 3 个本地时区日期助手、`glucose/schema.ts` 加报表契约类型。

**本次不做**（明确排除）：
- 血糖记录、趋势图的**真实实现**（仅登记路由 + 保持 `Empty` 占位、不发请求，延续 A4）；
- 添加血糖（已有 `GlucoseCreateModal`，不动）；
- **日期范围选择器 UI**（`startDate`/`endDate` 仅接口预留，待出入院业务立项）；
- 报表导出 / 打印样式；基本信息 Tab、出入院记录 Tab（仍占位）；
- `GlucoseDailySummary` 汇总表、分区（`ROADMAP.md:159` 待立项）。

## 2. 数据模型变更

**无 Prisma schema 变更、无迁移。**

| 项 | 说明 |
|---|---|
| 报表所需字段 | 全部已存在：`GlucoseRecord.{valueMmolL, resultType, mealContext, measuredAt, operatorId}` |
| 检测人姓名 | 走 `operator: { select: { name: true } }` 嵌套查询，**不加冗余字段**（与 `patient.service.ts:132,323` 的 `nurseName` 同口径） |
| 索引 | 现有 `@@index([patientId, measuredAt(sort: Desc)])` 可支撑「按患者 + 时间倒序」查询，**无需新索引** |
| 时段数据 | 读 `TimeSlot` 表（含 `enabled=false` 项），不新增字段 |

## 3. 接口契约

| # | 方法 | 路径 | 权限点 | 数据范围 | 审计动作 | 说明 |
|---|---|---|---|---|---|---|
| 1 | GET | `/patients/:id/glucose/report` | `patient:view`（`PATIENT_VIEW`） | `RESOURCE.PATIENT` | `GLUCOSE_REPORT_VIEW` | 血糖报告矩阵（只读） |

请求（query）：

```ts
{
  /** YYYY-MM-DD，本地日期（含当日）。本轮前端不传，仅契约预留（R6） */
  startDate?: string;
  /** YYYY-MM-DD，本地日期（含当日）。本轮前端不传，仅契约预留（R6） */
  endDate?: string;
  /** 页码，从 1 开始，默认 1 */
  page?: number;
  /** 每页**日期数**（非记录数），默认 15（R7） */
  pageSize?: number;
}
```

响应（`data`）：

```ts
interface GlucoseReportResponse {
  /** 时段列定义：普通(type=1) + 特殊(type=4)，按 sortOrder 升序；强化(type=0)不成列 */
  columns: GlucoseReportColumn[];
  /** 日期行，降序（最新在前）；只含有数据的日期（不补空行，R7） */
  rows: GlucoseReportRow[];
  /** **日期总数**，不是记录总数（分页单位是日期，R7） */
  total: number;
  page: number;
  pageSize: number;
  /** 实际生效的查询区间（本地日期）；未传时为 null。回显以便审计 detail 自动落库（§4-11） */
  rangeFrom: string | null;
  rangeTo: string | null;
  /** 本页血糖记录条数；同样为审计 detail 而回显 */
  count: number;
  /** 统计栏（R20，2026-11-19 追加）：按查询范围**全量**统计，与分页无关 */
  stats: GlucoseReportStats;
}

/**
 * 报表统计栏（R20）。总计的 counted 码集由服务端查 `DictItem.counted` 动态取
 * （字典是数据不是代码），当前种子为 0~4；5~9（拒检/外出/请假/已吃饭/未进食）不计入。
 */
interface GlucoseReportStats {
  /** 总计：resultType ∈ counted=true 集合的记录数 */
  total: number;
  /** 合格次数：resultType='1'（正常）的记录数 */
  qualified: number;
  /** 存在 High('4') 记录 → 最高血糖展示字典 label 而非数值 */
  hasHigh: boolean;
  /** 存在 Low('3') 记录 → 最低血糖展示字典 label 而非数值 */
  hasLow: boolean;
  /** 数值型(0/1/2)极值及其自身 resultType（前端按其字典色着色）；无数值记录为 null */
  maxValueMmolL: number | null;
  maxResultType: string | null;
  minValueMmolL: number | null;
  minResultType: string | null;
}

interface GlucoseReportColumn {
  /** TimeSlot.code，落库契约值 */
  code: string;
  /** TimeSlot.name，表头文字（库里维护，前端禁止硬编码） */
  name: string;
  /** 1 普通 / 4 特殊（columns 里不会出现 0 强化） */
  type: 1 | 4;
  sortOrder: number;
  // R22：原 enabled 字段已删除——只有启用的时段成列，弃用时段记录合并进启用列（§4-4/5）
}

interface GlucoseReportRow {
  /** YYYY-MM-DD，**本地日期**（Asia/Shanghai），非 UTC（§4-3）。不附星期（R11） */
  date: string;
  /** 与 columns **等长同序**；无数据的列为空 entries */
  cells: GlucoseReportCell[];
}

interface GlucoseReportCell {
  /** 对应 columns[i].code */
  slotCode: string;
  /** 同日同时段多条 → 按 measuredAt **升序**堆叠（R4） */
  entries: GlucoseReportEntry[];
}

interface GlucoseReportEntry {
  /** mmol/L，一位小数；null → 前端显示 resultType 字典标签（R8） */
  valueMmolL: number | null;
  /** '0'~'9'，着色依据（D4） */
  resultType: string;
  /** HH:mm，**本地时间** */
  time: string;
  /** operator.name；operatorId 为空则 null（前端显示 `-`，D7） */
  nurseName: string | null;
  /**
   * 原时段类型（R22）：0 强化 / 1 普通 / 4 特殊。前端展示勾选据此过滤（裁定 Q3/Q4）；
   * 特殊来源恒展示且时间恒展示（规则 6）；归组失败兜底记录按特殊对待
   */
  sourceType: 0 | 1 | 4;
  /** 后缀来源时段名（R22，泛化自原 intensiveName）：强化时段名或弃用时段名（裁定 Q1）；启用时段落自己列时为 null */
  sourceSlotName: string | null;
}
```

### 3.1 共享契约变更（`packages/shared`）

| 变更 | 位置 | 类型 |
|---|---|---|
| `pickTimeSlotByTime(slots, time, options?: { ignoreEnabled?: boolean })` 增加第三参 | `src/dict/time-slots.ts:227` | 改既有导出**签名**（向后兼容：不传时保持原行为，现有调用方不受影响） |
| 新增 `formatLocalDate(value): string \| null` → `YYYY-MM-DD`（**本地**时区） | `src/date.ts` | **新增导出** |
| 新增 `formatLocalTime(value): string \| null` → `HH:mm`（**本地**时区） | `src/date.ts` | **新增导出** |
| 新增 `parseLocalDate(value: string): Date \| null` → `YYYY-MM-DD` 解析为**本地零点** | `src/date.ts` | **新增导出**（服务 R6 预留的 `startDate`/`endDate`，见下） |
| 新增 `GlucoseReport*` 响应类型 + `glucoseReportQuerySchema` | `src/glucose/schema.ts` | **新增导出** |
| `src/index.ts` 补 re-export | `src/index.ts` | 漏了会导致前端 `undefined`（`shared-package.md` 硬规则 4） |
| （R22）`GlucoseReportColumn` 删 `enabled`；`GlucoseReportEntry.intensiveName` → `sourceSlotName` + 新增 `sourceType` | `src/glucose/schema.ts` | 改既有导出**类型**（破坏性；前后端同轮改齐，纯类型变更不影响运行时导出） |

> ⚠️ **含新增导出 → 必须走 `shared-package.md` 三步**：`pnpm --filter @gc/shared build` → `pnpm sync:shared` → 清 `apps/web/node_modules/.vite`。
> `gc-dev` 自 commit `e90c6d9` 起已具备「共享包副本 vs `.vite/deps/_metadata.json`」过期检测，跑 `node .codebuddy/skills/gc-dev/scripts/dev-up.mjs` 会自动清缓存，无需手工 `Remove-Item`。

**为什么必须新增本地时区系列函数，而不能复用 `date.ts` 现有的两个纯日期 API**：

`measuredAt` 是 `timestamptz` 存 **UTC**，而报表的「日期」必须是**本地日期**。`date.ts` 现有的纯日期 API 全是 **UTC 口径**（为 `@db.Date` 列如出生日期设计），直接复用会静默错一天：

| 现有 API | 口径 | 误用后果 |
|---|---|---|
| `formatDateOnly`（`date.ts:49`，用 `getUTC*`） | UTC | **出参**：北京时间 00:00–08:00 的记录被归到**前一天** |
| `dateOnlyStringSchema`（`date.ts:41`，`new Date(str)` = UTC 零点） | UTC | **入参**：`startDate`/`endDate` 的日界偏移 8 小时，范围过滤漏/多一整天 |

因此新增 `formatLocalDate` / `formatLocalTime` / `parseLocalDate` 三个**本地口径**函数，
并在 `date.ts` 注释里与 UTC 版本**互相指明差异**，防止后续（尤其日期选择器任务）误用。
`parseLocalDate` 本轮虽只服务预留入参（R6，前端不传），仍一并落地——否则该任务接手时极可能顺手用 `dateOnlyStringSchema` 而踩坑。

## 4. 业务规则与校验

1. **数据范围**：先查患者 `departmentId`，再 `assertInScope(user, RESOURCE.PATIENT, { departmentId })`；
   跨科室 → `30002`，`NONE` 档（设备管理员）→ `30006`。**禁止手写部门比较**（`permissions.md` 硬规则 1）。
   参照 `glucose.service.ts:83-90` 既有「先查后判」写法。
2. **患者不存在/已归档** → `40001`（与 `GET /patients/:id` 一致）。
3. **日期分组按本地时区**：服务端用 `Date` 的**本地 getter** 取 `YYYY-MM-DD`（即 `formatLocalDate`），
   **不得**用 `formatDateOnly`（UTC）、**不得**依赖数据库时区设置。生产须确保 `TZ=Asia/Shanghai`（`date.ts:7` 既有约定）。
4. **列归组规则**（R22 修订，宿主匹配只在**启用**普通时段里做）：

   | 记录的 `mealContext` | 落列 | `sourceType` | `sourceSlotName` |
   |---|---|---|---|
   | 启用的普通时段（`type=1`） | 该 `code` 列 | `1` | `null` |
   | 启用的特殊时段（`type=4`，`RANDOM`/`RETEST`） | 该 `code` 列，**不做时间归组** | `4` | `null` |
   | 强化时段（`type=0`，无论启用/弃用） | `pickTimeSlotByTime(slots, HH:mm)` 命中的**启用**普通时段列 | `0` | 该强化时段的 `name` |
   | **弃用的普通/特殊时段**（R22，裁定 Q1/Q2） | 按检测时间归入**启用**普通列（展示方式与强化一致）；弃用普通时段的原区间无启用宿主 → `RANDOM` 兜底 | **原时段类型**（裁定 Q4，前端据此跟随勾选） | **弃用时段自己的 `name`**（如「复测」） |
   | 归组无命中（区间空洞） | `RANDOM` 列（兜底） | 原类型（强化保留 `0`） | **保留**来源时段名 |
   | `null` 或 code 在 `TimeSlot` 表中不存在（历史脏数据） | `RANDOM` 列 | `4`（按特殊对待，恒展示） | `null`（**不静默丢弃记录**，R13） |

5. **`columns` 只含启用时段**（R22，推翻原「含停用项」口径）：表头由服务端查 `TimeSlot`（`enabled=true` 且 `type in (1,4)`）生成，按 `sortOrder` 升序。
   弃用时段的历史数据不再需要自己的列——按规则 4 合并进启用列并带后缀，`COMMON-DATA.md`「停用时段历史可展示」口径仍满足（展示形式变化）。
6. **分页单位是日期**（R7）：先取该患者（范围内）的 **distinct 本地日期**集合 → 降序 → 切出本页 15 个日期 →
   再查这 15 天内的**全部记录**组装矩阵。**禁止用 Prisma `take`/`skip` 直接切记录**（那会切成 15 条血糖）。
7. **不补空行**（R7）：无血糖数据的日期不出现在 `rows` 里。
8. **排序**：`rows` 按日期**降序**；同一 `cell.entries` 按 `measuredAt` **升序**（R4 堆叠顺序）。
9. **时间格式**：`measuredAt` 存 UTC，出参 `time` 为本地 `HH:mm`（`formatLocalTime`）；接口出入参一律
   `YYYY-MM-DD HH:mm:ss` / `YYYY-MM-DD`，**不使用 ISO 8601**（`date.ts:6` 既有约定）。
10. **幂等/并发**：只读接口，无写入、无状态机、无并发冲突。
11. **审计**：一次接口调用写**一条** `GLUCOSE_REPORT_VIEW`（`targetType='PATIENT'`、`targetId` 取 `params.id`，无需 `targetIdFrom`）。
    `AuditLogInterceptor` 从**响应 `data`** 按 `AUDIT_DETAIL_ALLOW_LIST` 提取 detail（`audit-log.interceptor.ts:185-203`），
    而 `rangeFrom` / `rangeTo` / `count` **已在白名单内** → 响应回显这三个键即可自动落审计，**无需改 `AUDIT_DETAIL_ALLOW_LIST`**。
    越权（`3xxxx` 号段）由拦截器自动记 `DENIED`（`permissions.md` 硬规则 7）。

## 5. 权限与数据安全

| 项 | 内容 |
|---|---|
| 功能权限 | `@RequirePermissions(PERMISSION.PATIENT_VIEW)`。**不新增 `glucose:view`**：现状血糖查看已由 `patient:view` 覆盖（`roles.ts:22-58` 无该权限点），新增须同步 `ROLE_PERMISSIONS` 且 `SYS_ADMIN` 必须含全部权限点，成本与收益不匹配（D1） |
| 数据范围 | `@RequireDataScope(RESOURCE.PATIENT)` + service 内 `assertInScope`。**不新增 `RESOURCE` 类型**（`PERMISSION-DESIGN.md:81-84`）。两个装饰器缺一不可（`permissions.md` 硬规则 2） |
| 脱敏字段 | 本接口**不返回**患者姓名/身份证/手机号，无需脱敏。`nurseName` 是医护真实姓名（`User.name`，schema L44 非加密列），**不属患者敏感信息，不脱敏** |
| 加密字段 | 不涉及；Prisma `select` **不含**任何 `*Cipher` 列 |
| 审计 | `GLUCOSE_REPORT_VIEW` 每次查询留痕（`AGENTS.md` §5.2）；detail 走既有白名单，**不新增患者敏感字段**；越权落 `DENIED` |
| 前端守卫 | 子路由**继承**父路由 `PermissionRoute`（`PATIENT_VIEW`），不重复声明（§6.1） |

## 6. 前端交互

### 6.1 路由改造（全仓首个嵌套路由，R1 + R10）

**路由树**（5 个内容页全部路由化，R10）：

```
/inpatient/patients/:id            element: <PatientDetailPage/>（壳：返回栏 + 基本信息摘要 + Tabs 区）
├── index                          → <Navigate> 到 glucose/report（默认高亮血糖报告，需求 1）
├── basic                          → 基本信息 Tab（Empty 占位）
├── admission                      → 出入院记录 Tab（Empty 占位）
├── glucose/report                 → 血糖报告（本次真实实现）
├── glucose/record                 → 血糖记录（Empty 占位，不发请求）
├── glucose/trend                  → 趋势图（Empty 占位，不发请求）
└── *                              → <Navigate> 到 glucose/report（兜底，防未知子路径渲染空白 Outlet）
```

- **`routes/menu.tsx`：`AppRoute` 用可辨识联合，`path` 对普通路由保持必填**（不改可选，避免削弱既有 40+ 条路由的类型约束）：

```ts
interface AppRouteBase {
  element: ReactNode;
  label?: string;
  icon?: ComponentType;
  permissions?: PermissionCode[];
  menuGroup?: string[];
  children?: AppRoute[];          // 新增：嵌套子路由
}
export type AppRoute =
  | (AppRouteBase & { path: string; index?: false })
  | (AppRouteBase & { path?: undefined; index: true });   // index 路由必须显式声明
```

  `buildMenuTree` 里 `route.path` 变为 `string | undefined` → 循环体开头改成
  `const path = route.path; if (!route.label || !path) continue;`，后续统一用局部 `path`。
  这既是类型收窄也是**语义正确**的守卫（无 path 本就无法生成菜单项）。**必须复核 `routes.spec.tsx`**。
- **`App.tsx:47-58`**：抽出递归渲染函数。`index` 路由渲染 `<Route index/>`（**不可带 children**，React Router 会报错）；
  其余渲染 `<Route path>` 并递归其 `children`。`PermissionRoute` 对 `permissions` 为空时直接放行（`PermissionRoute.tsx:28-30`），
  故子路由被包一层无副作用。
- **`routes.tsx:65-71`**：患者详情路由补 `children`，路径字符串**全部引用 `detail-tabs.ts` 常量**（D12），不写字面量。
- **子路由不声明 `permissions`**：它们渲染在父 `element` 的 `<Outlet/>` 内，已被父级 `PermissionRoute`（`PATIENT_VIEW`）包住；
  父级判 403 时 `Outlet` 根本不渲染。重复声明只会多一层无意义守卫。
- 子路由**无 `label`/`icon`/`menuGroup`** → `buildMenuTree` 跳过（`menu.tsx:79-81`），不进菜单。
- **`BasicLayout.tsx:128-133` 无需改**：`selectedKeys` 已对 `/inpatient/patients/` 前缀归一到 `/inpatient/patients`，
  更深的子路径同样命中该前缀，侧栏「患者管理」高亮不受影响。

**重定向组件（index 与 `*` 共用），必须透传 `location.state`**（D9）：

```tsx
function DetailFallbackRedirect() {
  const { id } = useParams();
  const { state } = useLocation();
  // ⚠️ 不传 state → index.tsx:29 读不到 from → handleBack 从 navigate(-1)（精确还原来源页）
  //    退化为兜底跳 /inpatient/patients，虚拟病区入口与列表快照全部失效
  return <Navigate to={`/inpatient/patients/${id}/${DETAIL_DEFAULT_TAB}`} replace state={state} />;
}
```

- 用**绝对路径**而非相对 `to="glucose/report"`：避免 React Router v6 相对解析（route vs path）歧义。
- **主防线是把重定向从主路径上摘掉**（D10）：`patients/index.tsx:90-92` 与 `virtual-ward/index.tsx:47-49`
  两处 `goDetail` 改为直接 `navigate(\`/inpatient/patients/${id}/${DETAIL_DEFAULT_TAB}\`, { state: { from: location.pathname } })`。
  这样正常入口**不经过任何 `replace`**，`history.state` 结构性无损；index/`*` 重定向只服务直接访问 URL、书签与旧链接。

### 6.2 详情页 Tab 改造（R10：双层 Tab 全部 URL 驱动）

- **新增 `patient-detail/detail-tabs.ts`**（D12，路径与派生逻辑的单一来源）：
  - `DETAIL_TAB_PATH`：`basic` / `admission` / `glucose/report` / `glucose/record` / `glucose/trend` 五个子路径常量
  - `DETAIL_DEFAULT_TAB = DETAIL_TAB_PATH.glucoseReport`
  - `resolveDetailTab(pathname): { main: 'glucose'|'basic'|'admission'; glucose: 'report'|'record'|'trend' }`
    —— **纯函数**，供 `PatientDetailTabs` 派生高亮；无法识别时回落默认值。可独立单测。
- **新增 `useDetailTabNavigate()`**（D11，页内跳转的唯一出口）：

```ts
export function useDetailTabNavigate() {
  const navigate = useNavigate();
  const { state } = useLocation();          // 必须透传，否则 from 丢失
  const { id } = useParams();
  return useCallback(
    (sub: string) => navigate(`/inpatient/patients/${id}/${sub}`, { replace: true, state }),
    [navigate, state, id],
  );
}
```

  **`replace: true` 是必需的**：Tab 切换若用 push，浏览器历史会变成
  `列表 → report → basic → trend …`，用户点「返回」会在 Tab 间打转而非回列表。
  代价是浏览器前进/后退键不再在 Tab 间穿梭——对详情页这是期望行为，已记为明确取舍。
- **`PatientDetailTabs.tsx` 改造**：删除 `useState`（现 `:37-38`），`mainTab`/`glucoseTab` 改由
  `resolveDetailTab(location.pathname)` 派生；两层 `Tabs` 的 `onChange` 改调 `useDetailTabNavigate()`。
  内容区的 4 处 `Empty` 占位（血糖记录/趋势图/基本信息/出入院记录）**全部移出**，改为渲染 `<Outlet/>`。
- **`<Outlet/>` 必须留在 `index.tsx:78-97` 的 `data` 已加载分支内**（即仍由 `<PatientDetailTabs/>` 承载）：
  `loading` / `!data` 时壳渲染 `Spin` / `Result`，Tabs 不渲染 → 子路由不渲染 → **报表请求不会对无权或不存在的患者发出**。
  改造时若把 `<Outlet/>` 提到该分支之外，会同时破坏这个安全性质与 403/404 占位页。
- **新增 `DetailPlaceholder.tsx`**：`basic`/`admission`/`record`/`trend` 四条路由共用一个
  `Empty`「XXX（建设中）」占位组件（`label` 入参），避免 4 份重复 JSX 与内联样式。

### 6.3 血糖报告表格

- **表头**：日期列 + `columns`（8 普通 + 2 特殊 = 10 列）= **11 列**；表头文字取 `column.name`
  （库里维护，**禁止硬编码、禁止按名称匹配** —— `time-slots.ts:21` code 才是契约）。
- **日期列**：`YYYY-MM-DD`（R11，**不附星期**），`gc-num` 等宽数字，居中、**不固定**（R17）。
- **展示项勾选**（R22）：子 Tabs 同一水平线紧跟四个 Checkbox（常规血糖/强化血糖/检测时间/操作人），
  仅「血糖报告」子 Tab 渲染；默认全勾选；常规与强化至少保留一项（取消到两项都空时阻止并
  `message.warning`，裁定 Q7）。状态在 `PatientDetailTabs` 持有、经 Outlet context（`DetailChildContext.reportDisplay`）
  下发，换患者重置（裁定 Q8）。过滤是**纯前端**的（裁定 Q5）：常规/强化 → `filterReportRows` 按
  `entry.sourceType` 滤记录（不滤列，裁定 Q3；弃用记录按原类型跟随，裁定 Q4；特殊恒展示）；
  检测时间/操作人 → `ReportCell` 控制格内 `(HH:mm)` 与第 2 行的渲染（特殊来源时间恒展示，规则 6）。
  记录全被过滤的日期行保留为空行（裁定 Q6）。
- **单元格**（R3/R4，R22 修订后缀口径）：`entries` 纵向堆叠，每条**两行**，组间用 `token.lineWidth` 分隔线：
  - **第 1 行** `{值或标签}[(HH:mm)][({sourceSlotName})]`——后缀为强化时段名或**弃用时段名**（R22）：
    - `valueMmolL !== null` → `value.toFixed(1)`，颜色取 `DY-RESULT` 字典 `color`
    - `valueMmolL === null` → 字典 `label`（如 `Low` / `High` / `拒检`），颜色取字典 `color`；字典查不到则回退 `resultType` 原文
      （与 `LastGlucose.tsx:44` 的 `item?.label ?? resultType` 同口径）
    - 括号一律**英文半角**、**紧邻无空格**：`6.8(08:30)`、`6.8(08:30)(强化-上午)`、`5.5(09:05)(复测)`、`Low(08:30)`；
      视觉上按 R19 加 **6px margin**（`值` 与 `(时间)` 之间恒有；有后缀时 `(时间)` 与 `(名称)` 之间同样有），文本口径不变
    - `(HH:mm)` 受「检测时间」勾选控制，但 `sourceType=4`（特殊来源，含弃用特殊与兜底）**恒展示**（规则 6）
    - 时间与后缀名用正文色 `var(--gc-color-text)`，**不着色**（D4）
    - 判定「是否数值型」**以 `valueMmolL === null` 为准**，不在前端复制 `VALUE_RESULT_CODES` 码集
      （避免与 `LastGlucose.tsx:6` 形成第二份实现，`shared-package.md` 硬规则 3）
  - **第 2 行** `nurseName`，为 `null` 显示 `-`（D7）；整行受「操作人」勾选控制（对所有来源生效，规则 6「其他几个继续受控」）
- **统计栏**（R20，替代原「单位：mmol/L」标注，D5 已推翻）：表格上方左对齐展示
  `总计：N 次 | 合格次数：M 次 最高血糖：X 最低血糖：Y`（段落间 20px，`|` 仅在前两段之间）；
  数据取响应 `stats`（服务端全量统计，翻页不变）；High/Low 的 label 与色、极值着色全部取 `DY-RESULT` 字典；
  极值无数值时显示 `-`。外层为 `space-between` flex 行——**右侧预留给下一个任务的查询筛选表单**（本轮不实现）。
- **分页**：Antd `Table` `pagination`，`pageSize=15`、`total` 取响应 `total`（**日期数**）、`onChange` 重新请求（服务端分页）。
- **空态/加载态**：`rows` 为空 → `Table` 自带空态（不补空行）；请求中 → `Table loading`。
  有行但**无数据的单元格渲染为空**（R18，不放 `-` 占位）。
- **不横向滚动**（R17，替代原「窄屏 `scroll.x` + 日期列固定」方案）：所有列 `align: 'center'`，
  时段列不定宽、均分页面宽度，格内内容允许换行（不设 `nowrap`）。
- **纵向仅表格 body 内滚**（R21）：子 Tabs、统计栏、表头、分页全部固定；表格边框盒撑满
  统计栏以下的剩余空间（行数不足一屏也撑满）。实现：`PatientDetailTabs` 内容区为唯一滚动容器 →
  报表根节点 `height:100%` flex 列 → `Table` 挂 `.gc-report-table`（`global.css` flex 链穿透 antd
  内部 DOM，作用域限定本表格）+ `scroll.y='100%'`（仅触发固定表头/body 拆分）+
  `minHeight=REPORT_TABLE_MIN_HEIGHT`（极矮屏兜底，此时根节点内滚）。
- **样式口径**：颜色取 `theme.useToken()`、间距取 `layoutSize`、边框取 `token.lineWidth`，
  **无硬编码色值/魔法数字**（沿用 `patient-detail.md` §6.2）。
- **打印**：报表属临床数据，本次**不加** `gc-no-print`（返回栏已有）。

### 6.4 数据层

- `api/glucose.ts` 新增 `fetchGlucoseReport(patientId, params)`（现仅有 `createGlucose`）。
- 新增 `patient-detail/useGlucoseReport.ts`：手写 `useState`/`useEffect` + `cancelled` 防竞态（D8，沿用 `usePatientDetail.ts:23-58`）。
- `page` 变化触发重新请求；`patientId` 变化重置 `page=1`。
- 错误交由 `api/client.ts` 拦截器统一处理，**页面不自己弹 toast**（`error-codes.md` 前端写法）。

## 7. 错误码与前端行为

| 场景 | 码 | HTTP | 前端行为 |
|---|---|---|---|
| 参数不合法（`page`/`pageSize`/日期格式） | `10001` | 422 | toast（无表单，不做字段级映射） |
| 跨科室访问 | `30002` | 403 | 详情页 `Result status="403"`「无权查看该患者」+ 返回按钮 |
| `NONE` 档（设备管理员） | `30006` | 403 | 同上（`forbidden` 分支） |
| 缺 `patient:view` | `30004` | 403 | 路由守卫 `PermissionRoute` 渲染 403 页（进不到详情页） |
| 患者不存在/已归档 | `40001` | 404 | 详情页 `Result status="error"`「无法加载患者详情」+ 返回按钮 |

**不新增错误码**：`error-codes.md` 明确 `41xxx` 为预留号段，实现对应功能时才登记，不提前写进 `codes.ts`。
本接口全部复用既有码，与 `patient-detail.md` §7 一致。

## 8. 测试要求

- [x] **单测（server）`glucose.service.spec.ts`**（report 32 用例，下列各点全覆盖；含 R20 统计栏 6 例、R22 归组 6 例）：
  - 强化归组：`INTENSIVE_AM` + 检测时间 `09:00` → 落 `BREAKFAST_POST` 列，`sourceSlotName='强化-上午'`、`sourceType=0`
  - 强化宿主只认**启用**普通时段：宿主停用 → 落 `RANDOM` 兜底且保留后缀（R22，替代 R5 的忽略 `enabled` 口径）
  - 区间空洞 → 落 `RANDOM` 列且**保留** `sourceSlotName`
  - **弃用时段不再成列**（R22）：弃用特殊时段（`RETEST`）记录按检测时间合并进启用列（`09:05` → 早餐后），
    后缀 = 弃用时段自己的名称、`sourceType` 保留原类型（4）；弃用普通时段（`BEDTIME`）记录原区间无启用宿主 → `RANDOM` 兜底 + 后缀 + `sourceType=1`
  - 启用的普通/特殊记录落自己列：`sourceType` 为原类型、无后缀
  - `mealContext` 为 `null` / 未知 code → 落 `RANDOM` 列，**不丢记录**，`sourceType` 按特殊对待（恒展示）
  - 特殊时段（`RANDOM`/`RETEST`）直接落列，**不做**时间归组
  - **分页按日期**：18 个有数据日期 → `total=18`、第 1 页 15 行、第 2 页 3 行
  - **不补空行**：中间缺测的日期不出现在 `rows`
  - 日期**降序**；`cell.entries` 按 `measuredAt` **升序**
  - `valueMmolL=null`（`resultType='5'`）→ 原样返回 `null` + `resultType`
  - `operatorId=null` → `nurseName=null`
  - **时区（必测）**：构造 UTC 时间使本地日期跨日（如 UTC `2026-11-18 17:00` = 北京 `11-19 01:00`）→ 必须归入 **11-19**
  - 越权：跨科室 → `30002`；`NONE` 档 → `30006`
  - **统计栏（R20）**：总计只数字典 `counted=true` 码集（5~9 不计入）且**码集数据驱动**（改字典即改口径）；
    合格 = `'1'` 条数；`hasHigh`/`hasLow` 存在性；极值取记录本身（值 + 自身 `resultType`）、只查数值型且有值记录；
    无数值记录 → 极值 null；**统计与分页无关**（page=2 时 where 仍为全范围）
- [x] **单测（shared）`time-slots.spec.ts`**：`pickTimeSlotByTime` 的 `ignoreEnabled`
      （不传/`false` 保持原行为跳过停用项、`true` 时命中停用时段）—— 选项行为仍被钉住；
      R22 起报表归组**不再传 `true`**（宿主只认启用时段），当前无生产调用方使用 `true`
- [x] **单测（shared）`date.spec.ts`**：`formatLocalDate` / `formatLocalTime`，并断言与 `formatDateOnly`（UTC）在跨日场景下**结果不同**
- [x] **单测（web）`GlucoseReportTab`**（33 用例）：两行结构、来源时段名后缀、`valueMmolL=null` 显示字典标签、
      同日同时段多条堆叠、`nurseName=null` 显示 `-`、半角括号无空格；空格子渲染为空（R18）；
      值行 6px 间距两种形态（R19）；**统计栏 `ReportStatsBar`（R20，8 例）**：总计/合格文案、20px 间距 ×4、
      极值 `toFixed(1)`+` mmol/L` 按自身 resultType 着色、`hasHigh`/`hasLow` 展示字典 label 及色、
      无数值且无 High/Low → `-`、字典未加载回退 code 原文；
      **R22 展示勾选（10 例）**：`ReportCell` 取消「检测时间」常规记录隐藏 `(HH:mm)` 而特殊来源恒展示、
      取消「操作人」第 2 行隐藏（含特殊来源）、弃用特殊记录后缀显示弃用时段名；
      `filterReportRows` 全勾选返回原引用、取消常规/强化各自只滤对应来源（特殊恒保留）、
      弃用记录按原类型跟随（Q4）、整行滤空保留空行（Q6）、时间/操作人勾选不触发行级过滤
- [x] **单测（web）`PatientDetail.spec.tsx`**（R22 补 3 例）：血糖报告子 Tab 渲染四个勾选且默认全勾选；
      其他血糖子 Tab / 主 Tab 非血糖数据 → 不渲染勾选（规则 2）
- [x] **单测（web）`routes.spec.tsx`**：菜单结构仍绿（5 条子路由 + `*` 兜底均不进菜单）；可辨识联合改造后类型不破
- [x] **单测（web）`detail-tabs.spec.ts`**（13 用例）：`resolveDetailTab` 纯函数 —— 5 条子路径各自派生出正确的
      `{ main, glucose }`；裸详情路径 / 未知子路径 → 回落默认 `glucose`+`report`（覆盖风险 5、6）
- [x] **单测（web）`useDetailTabNavigate`**：断言调用 `navigate` 时 **`replace === true`** 且 **`state` 与当前 `location.state` 同值**
      （覆盖风险 1、4 —— 这是本次最关键的回归护栏。落地方式：约束收敛在纯函数 `buildDetailTabNavigation`，
      `detail-tabs.spec.ts` 直接断言其返回的 `options.replace === true` 与 `state` 透传，hook 只是薄封装）
- [x] **单测（web）详情页壳**：`loading` / `!data`（403、404）分支下**不渲染** `<Outlet/>` 内容（覆盖风险 7。
      `PatientDetail.spec.tsx` mock `usePatientDetail` + 哨兵子路由，四分支各断言哨兵挂载与否）
- [ ] **集成**（待联调环境；越权抛码部分已由 server 单测覆盖）：`dr.chen`（心内科）访问内分泌科患者报表 → `30002` + 审计 `DENIED`；
      `dr.wang` 正常访问 → 审计表出现 `GLUCOSE_REPORT_VIEW`，`targetType='PATIENT'`、`targetId=患者id`，
      `detail` 含 `rangeFrom`/`rangeTo`/`count`
- [ ] **手工 e2e**（密码 `Gc@2026pass`）：
  - `dr.wang` 从列表点患者姓名进详情 → URL 为 `.../glucose/report`，主 Tab 高亮「血糖数据」、子 Tab 高亮「血糖报告」
  - **5 个内容页逐个切换并 F5**：`basic` / `admission` / `glucose/report` / `glucose/record` / `glucose/trend`
    → 每次刷新都停在原页，且主/子 Tab 高亮与 URL 一致（R10 核心验收）
  - ⚠️ **风险 1 主用例**：患者管理列表改 Tab/筛选/页码 → 进详情 → **连切 3 个 Tab** → 点「返回」
    → 来源页状态精确还原（筛选、页码、视图均在）
  - ⚠️ **风险 1 虚拟病区用例**：从**虚拟病区**整卡进详情 → 切 2 个 Tab → 点「返回」→ 回到**虚拟病区**（不是患者管理）且状态还原
  - ⚠️ **风险 4 用例**：连切 3 个 Tab 后按**浏览器后退键** → 直接回列表页，不在 Tab 间逐级回退
  - 直接访问 `/inpatient/patients/<uuid>`（无历史）→ 落 `glucose/report`，点返回兜底跳患者管理
  - 手输未知子路径 `/inpatient/patients/<uuid>/xxx` → 落 `glucose/report`，**不出现空白内容区**（风险 5）
  - ⚠️ **风险 7 用例**：`dr.chen` 直接访问内分泌科患者详情 URL → 显示 403 占位页，
    且**网络面板中不出现 `/glucose/report` 请求**
  - 强化时段记录显示为 `值(HH:mm)(强化-上午)` 且落在**正确的普通时段列**
  - 翻到第 2 页：日期连续、无重复、无遗漏
  - 表格**无横向滚动条**：11 列全部在页面内可见，格内内容居中（R17/R18）
  - **纵向滚动边界（R21）**：滚动只发生在表格 body 内；子 Tabs、统计栏、表头、分页固定不动；
    行数不足一屏时表格边框盒仍撑满剩余空间；切到血糖记录/趋势图/基本信息/出入院记录，滚动行为与改造前一致
  - **展示项勾选（R22）**：勾选框仅「血糖报告」子 Tab 出现（切其他子 Tab/主 Tab 即消失）；默认全勾选；
    取消「检测时间」→ 常规/强化记录的 `(HH:mm)` 消失、特殊来源记录时间仍展示；取消「操作人」→ 所有记录第 2 行消失；
    取消「常规血糖」→ 只隐藏常规来源记录（列仍在，强化/合并记录保留）；再取消「强化血糖」→ 被阻止并提示
    「常规血糖与强化血糖至少需勾选一项」（反方向同理）；统计栏与分页 total 不随勾选变化（Q5）；
    整行被滤空的日期保留为空行（Q6）；换患者/重进详情页勾选重置为全勾选（Q8）
  - **弃用时段合并展示（R22，演示数据见裁定 Q9）**：表头无「复测」列；林* 的 `2026-11-15 09:05` /
    `2026-11-14 19:31` 复测记录分别在「早餐后」「晚餐后」列展示为 `5.5(09:05)(复测)` / `11.1(19:31)(复测)`；
    随机 ×3 落「随机」列（其中 1 条 High 显示字典标签、无数值）；复测记录已不再出现在录入表单的时段选项中
  - **统计栏（R20）**：翻页时四个统计值**不变**（与分页无关）；有 High/Low 记录的患者最高/最低显示字典标签及色；
    无数据患者显示 `总计：0 次` 与 `-`；原「单位：mmol/L」标注已消失
  - `device.admin`（`NONE` 档）访问 → 403 占位页

## 9. 非功能要求

| 项 | 要求 |
|---|---|
| 性能 | 两次查询（distinct 日期 + 本页记录）；现有 `@@index([patientId, measuredAt(sort: Desc)])` 支撑；单页最多 15 天 × 每天数十条，量级可控。若长期住院患者记录量增大导致 distinct 日期查询变慢，再考虑 `$queryRaw` + `date_trunc(... AT TIME ZONE)` 或 `GlucoseDailySummary`（`ROADMAP.md:159` 待立项），**本次不做** |
| 内网 | 不引入新依赖，不引用公网资源 |
| 等保 | 每次查询落 `GLUCOSE_REPORT_VIEW` 审计（含越权 `DENIED`）；不返回患者身份明文；detail 走既有白名单，不新增患者敏感字段 |
| 兼容 | 复用 `layoutSize`/token，继承大字号与明暗模式；数值/时间 `gc-num` 等宽（对齐被 inline 覆盖为居中，R18）；11 列均分页宽、不横向滚动（R17） |
| 时区 | 服务端运行环境须 `TZ=Asia/Shanghai`（`date.ts:7` 既有约定）；本地日期分组**不得**依赖数据库时区设置 |

## 10. 验收标准

- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿（test 389：shared 71 / server 233 / web 85）
- [x] 接口返回符合 §3 契约，错误码符合 §7（server 单测 27 用例）
- [x] 越权被拒（后端 `30002`/`30006` 单测；前端 403 分支不渲染 `<Outlet/>` 单测），正常访问落 `GLUCOSE_REPORT_VIEW`
      （`@Audit` 已登记，`DENIED` 号段判定为既有拦截器行为；审计落库实测归入 §8 集成项）
- [x] **五条子路由**（basic / admission / glucose-report / glucose-record / glucose-trend）独立可达、**刷新均保持**
      （URL 驱动设计天然保证 + `resolveDetailTab`/`routes.spec` 单测；浏览器实测归入 §8 e2e）
- [x] 裸详情 URL 与未知子路径均重定向到 `glucose/report`（`DetailFallbackRedirect` + `detail-tabs.spec` 单测）
- [x] **列表页返回还原未被任何页内跳转破坏**（C1 回归，含虚拟病区入口）
      （`goDetail` 直达 + `buildDetailTabNavigation` 强制 `state` 透传单测；浏览器实测归入 §8 e2e 风险 1 用例）
- [x] Tab 切换不污染浏览器历史：连点多个 Tab 后按「返回」/浏览器后退键**直接回列表**，不在 Tab 间打转
      （`buildDetailTabNavigation` 单测断言 `replace: true`；后退键实测归入 §8 e2e 风险 4 用例）
- [x] 强化时段记录正确归入普通时段列并带后缀（server 归组单测 + `GlucoseReportTab` 渲染单测）
- [x] **跨日 UTC 记录归入正确的本地日期**（server 时区单测 + shared `date.spec` 跨日差异断言）
- [x] 分页单位为日期、`pageSize=15`、不补空行（server 单测：18 日期 → total=18、第 2 页 3 行）
- [x] **统计栏（R20）**：`stats` 随报表响应下发、按查询范围全量统计、与分页无关（server 6 例：counted 码集数据驱动、
      合格口径、High/Low 存在性、极值带自身 resultType、分页无关性）；前端展示字典驱动、20px 间距、左对齐、
      右侧预留筛选表单位（web 8 例）；浏览器视觉确认归入 §8 e2e
- [x] 共享包改动已走 build → sync:shared → 清 `.vite` 三步，前端无 `undefined`
- [x] 文档更新：本规格状态改「✅ 已实现」+ `ROADMAP.md` P3-2 推进为 ⚠️ 部分完成 + `COMMON-DATA.md:114` 报表口径核对
- [ ] 手工 e2e（§8）待联调环境执行

## 11. 待确认项

**原 5 项已由需求人 2026-11-19 第二轮全部裁定**，固化为本规格决策：

| 原待确认项 | 裁定 | 落点 |
|---|---|---|
| 1 主 Tab 刷新降级 | **不接受** → 基本信息/出入院记录也建独立路由，刷新停留 | R10、§6.1、§6.2 |
| 2 审计动作名 `GLUCOSE_REPORT_VIEW` | 采用 | R12、§4-11 |
| 3 日期列附星期 | **不附** | R11、§3、§6.3 |
| 4 脏数据落 `RANDOM` 列 | 接受 | R13、§4-4 |
| 5 本地日期函数加进 `shared/date.ts` | 采纳 | R14、§3.1 |

**本轮重评新增 2 项，已由需求人 2026-11-19 第三轮裁定**：

| 新增待确认项 | 裁定 | 落点 |
|---|---|---|
| Tab 切换用 `replace: true`（浏览器后退键不在 Tab 间穿梭，直接回列表） | **采纳** | R15、D11、§6.2 |
| `parseLocalDate` 一并落地（入参侧本地零点解析，防后续误用 `dateOnlyStringSchema`） | **采纳** | R16、§3.1 |

> ✅ **待确认项已全部清空**，本规格进入可实现状态。

## 12. 实现顺序与风险

按 `FEATURE-SPEC-TEMPLATE.md:152` 的顺序：

1. **共享包**：`pickTimeSlotByTime` 加 `ignoreEnabled` + `date.ts` 加 `formatLocalDate`/`formatLocalTime`/`parseLocalDate`
   + `glucose/schema.ts` 加报表类型与 query schema → `build` → `sync:shared` → 清 `.vite`（`gc-dev` 会自动清）
2. **服务端**：`glucose.service` 新增 `report()` + controller 新增 GET 路由（权限/数据范围/审计三件套）+ 单测
3. **前端路由基建**：`AppRoute` 改可辨识联合（加 `children`/`index`）→ `buildMenuTree` 加 `!path` 守卫
   → `App.tsx` 抽递归渲染 → 复核 `routes.spec.tsx`
4. **前端详情页**：新增 `detail-tabs.ts`（路径常量 + `resolveDetailTab`）、`useDetailTabNavigate`、`DetailPlaceholder`、
   `DetailFallbackRedirect`；`PatientDetailTabs` 改双层 URL 驱动 + `<Outlet/>`；两处 `goDetail` 改直达
5. **前端报表页**：`api` + `useGlucoseReport` + `GlucoseReportTab` 表格 + 单测
6. **文档回写**：`ROADMAP.md` P3-2、`COMMON-DATA.md` 报表口径、
   **`patient-detail.md` §6.3**（`goDetail` 目标路径由裸 URL 改为 `.../glucose/report`）与 **§6.2**（Tabs 由 `useState` 改 URL 驱动）

### 12.1 风险重评（含 R10 引入的新风险）

| # | 风险 | 重评后严重度 | 后果 | 防护 |
|---|---|---|---|---|
| 1 | 页内跳转**吞掉 `history.state`** | 🔴 **升高**（R10 后触发点由「1 次 index 重定向」变为「每次切 Tab」，共 3 类：index / `*` 兜底 / Tab 切换） | `index.tsx:29` 读不到 `from` → `handleBack` 从 `navigate(-1)` 退化为兜底跳患者管理；**虚拟病区入口回错页**、列表 Tab/筛选/页码快照全丢 | ① **D10 主防线**：`goDetail` 直达 `.../glucose/report`，正常入口不经过任何 `replace`；② **D11**：Tab 切换统一走 `useDetailTabNavigate()`，`state` 强制透传，无第二处 `navigate` 调用；③ 重定向组件显式 `<Navigate state={state}>`；④ §8 e2e 必测「列表改筛选 → 进详情 → 切 3 个 Tab → 返回」 |
| 2 | **本地日期 vs UTC 日期** | 🟠 不变 | 北京时间 00:00–08:00 的记录归到前一天，报表数据错位（医疗数据错误，且静默无报错） | 新增 3 个本地口径函数；`date.ts` 注释与 UTC 版本互相指明差异；**出参禁用 `formatDateOnly`、入参禁用 `dateOnlyStringSchema`**；§8 跨日单测必测 |
| 3 | `AppRoute` 类型改造 | 🟢 **降低**（原方案把 `path` 改可选会削弱既有 40+ 条路由约束；现改**可辨识联合**，普通路由 `path` 仍必填） | 若仍用「`path` 可选」方案，漏写 `path` 的路由会静默变成无效路由 | 用可辨识联合：省略 `path` 必须显式写 `index: true`；`buildMenuTree` 加 `!path` 守卫；`pnpm typecheck` + `routes.spec.tsx` 全绿后才继续 |
| 4 | 🆕 Tab 切换用 `push` **污染浏览器历史** | 🟠 新增（R10 直接引入） | 历史栈变成 `列表→report→basic→trend…`，点「返回」在 Tab 间打转，用户回不到列表 | `useDetailTabNavigate()` 内固定 `replace: true`；§10 验收项 + §8 e2e 覆盖 |
| 5 | 🆕 缺 `*` 兜底子路由 | 🟡 新增 | 访问 `/inpatient/patients/:id/xxx`（旧链接、手输）→ 无子路由匹配 → `<Outlet/>` 渲染 null → **Tab 栏在、内容区空白、无 Tab 高亮** | 登记 `path: '*'` 子路由，与 index 共用 `DetailFallbackRedirect` |
| 6 | 🆕 子路径字符串**两处漂移** | 🟡 新增（5 条子路由 × `routes.tsx` 与 `PatientDetailTabs.tsx` 各一份） | 改了一处忘另一处 → Tab 高亮与实际内容不符，或 `navigate` 到不存在的路由触发风险 5 | D12：`detail-tabs.ts` 为唯一来源，`routes.tsx` 与 Tab 组件均引用常量，**禁止字面量** |
| 7 | 🆕 `<Outlet/>` 位置提错 | 🟠 新增 | 若把 `<Outlet/>` 提到 `index.tsx` 的 `loading`/`!data` 分支之外：① 患者 403/404 时**报表请求仍会发出**（越权探测面 + 多余审计）；② `Spin`/`Result` 占位页被子路由内容覆盖 | `<Outlet/>` 必须留在 `data` 已加载分支内（仍由 `<PatientDetailTabs/>` 承载）；§8 补一条「403 患者不发报表请求」断言 |

