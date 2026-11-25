# 血糖趋势图（P3-7）功能规格

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 填写。2026-11-24 需求人 4 项裁定（图表形态 / 接口与审计 / 统计栏 / 阈值来源）落定后成文。
> 相关规范：`docs/ROADMAP.md`（P3-7）、`docs/ERROR-CODES.md`、`docs/PERMISSION-DESIGN.md`、`docs/UI-DESIGN-TOKENS.md`、
> `.codebuddy/rules/glucose-domain.md`（图表节）、`.codebuddy/rules/security-and-audit.md`、`.codebuddy/rules/shared-package.md`。

## 0. 元信息

| 项     | 内容                                                                                                                                                                                                                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阶段号 | P3-7 血糖趋势图（见 `docs/ROADMAP.md`）                                                                                                                                                                                                                                                                                 |
| 模块   | glucose                                                                                                                                                                                                                                                                                                                 |
| 优先级 | P1                                                                                                                                                                                                                                                                                                                      |
| 依赖   | R24 查询表单联动（`GlucoseQueryForm`）、R26 公共件（`GlucoseToolbar`/`useFullscreen`）、R20 报表统计口径（`buildReportStats`/`buildReportStatsItems`）、R25 复核弹窗（`GlucoseReviewModal`）、`PatientGlucoseTargetService.resolveAlertThreshold`（2026-11-25 起，原为 `SystemConfigService.getGlucoseAlertThreshold`） |
| 需求人 | （2026-11-24 对话裁定）                                                                                                                                                                                                                                                                                                 |

## 1. 目标与用户故事

作为 **医生 / 护士 / 护士长**，我要 **在患者详情页「血糖数据 → 趋势图」看到该患者一段时间内每次血糖读数随时间的分布**，以便 **直观判断血糖波动趋势与达标情况**。

本次范围（做）：

- 新增只读接口 `GET /patients/:id/glucose/trend`：下发查询范围内**原始测量点**（不做按日聚合）+ 告警阈值 + 报表口径统计。
- 趋势图子页替换占位：ECharts **时间轴散点图**，每个数值型读数按 `measuredAt` 描点、按结果类型字典色着色，叠加低/高阈值线与目标范围带。
- 复用 R24 查询表单（住院/科室/时间三层联动）、R26 工具栏（统计栏 + 全屏）、R20 统计口径、R25 复核弹窗（点击数据点 → review/编辑）。

本次不做（明确排除）：

- 按日聚合（日均值/最低/最高）与 TIR/达标率/CV 等趋势专属指标（裁定：图表形态=原始测量点；统计栏=复用报表口径）。
- 「含作废」历史视图（同 R27 裁定 Q2：作废记录任何读路径不可见）。
- 新增权限点（血糖查看现状由 `patient:view` 覆盖，同报表/记录）。
- CGM 连续数据（当前 BGM 手工录入，属目标态，见 `AGENTS.md` §4.6）。

## 2. 数据模型变更

| 模型                  | 字段                      | 类型       | 说明                                                                                                                                              | 是否需迁移       |
| --------------------- | ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| —                     | —                         | —          | **无表/字段变更**：趋势按原始测量点即时查询 `GlucoseRecord`，不建 `GlucoseDailySummary`（P3-3 仍 ❌）                                             | 否               |
| `AuditAction`（枚举） | 追加 `GLUCOSE_TREND_VIEW` | enum value | 趋势查询独立审计动作（裁定：新审计动作）。**2026-11-24 已应用**（迁移 `20261124000000_add_glucose_trend_view_audit`，需求人授权 AI 执行），见 §11 | **是（已应用）** |

## 3. 接口契约

| #   | 方法 | 路径                          | 权限点         | 数据范围(RESOURCE) | 审计动作             | 说明                                 |
| --- | ---- | ----------------------------- | -------------- | ------------------ | -------------------- | ------------------------------------ |
| 1   | GET  | `/patients/:id/glucose/trend` | `patient:view` | PATIENT            | `GLUCOSE_TREND_VIEW` | 血糖趋势（原始测量点，只读，不分页） |

> ⚠️ 路由顺序：必须声明在 `:id/glucose/:recordId` **之前**（同 `report`/`records`），否则 `trend` 被 `:recordId` 捕获。

请求（`glucoseTrendQuerySchema`，复用 `dateTimeStringSchema`，与报表/记录同口径）：

```ts
{
  startTime?: string;    // YYYY-MM-DD HH:mm:ss 本地时间，闭区间起点；不传则不限
  endTime?: string;      // YYYY-MM-DD HH:mm:ss 本地时间，闭区间终点；不传则不限
  mealContexts?: string; // 时段过滤（2026-11-24 增补）：逗号分隔 mealContext 码（如 `FASTING,BEDTIME`）；不传/空串 = 不过滤（「全部」）
}
```

> **无 page/pageSize**：趋势图不分页，返回范围内全部数值点；范围由查询表单按住院记录默认收敛。
> **mealContexts 传输格式**：前端 `http.get` 用 `URLSearchParams` 序列化，数组被 `String()` 拼成 `A,B,C`，故以**逗号分隔字符串**下发；服务端 `glucoseTrendQuerySchema` 用 `.transform` 拆回数组（trim + 去空）。

响应（`GlucoseTrendResponse`）：

```ts
{
  points: GlucoseTrendPoint[];        // 数值型(0/1/2)有效记录，按 measuredAt 升序
  thresholds: { low: number; high: number }; // 患者预警值（缺行回退 SystemConfig 全局阈值），前端画阈值线/目标带
  stats: GlucoseReportStats;          // 复用报表统计类型与口径（同范围与报表/记录数字一致）
  rangeFrom: string | null;           // 实际生效区间回显（审计 detail 同源，白名单零改动）
  rangeTo: string | null;
  count: number;                      // 本页点数（= points.length），审计 detail 用
  mealContexts: string[] | null;      // 实际生效时段过滤回显（null = 未过滤/「全部」），审计 detail 用（2026-11-24 增补）
}

// GlucoseTrendPoint
{
  id: string;                         // GlucoseRecord.id，点击数据点定位记录（复核弹窗用）
  measuredAt: string;                 // YYYY-MM-DD HH:mm:ss 本地时间
  valueMmolL: number;                 // 数值型记录恒有值（mmol/L）
  resultType: string;                 // '0'|'1'|'2'，前端取字典 label/color
  operatorName: string | null;        // 记录者姓名（tooltip 展示，同报表 nurseName 口径）；null → '-'
}
```

## 4. 业务规则与校验

1. **只含数值型读数**：仅 `resultType ∈ {0,1,2}` 且 `valueMmolL` 非空的记录成点（复用 `numericRecordWhere` 口径）；`3~9`（Low/High/拒检/外出/请假/已吃饭/未进食）无读数，**不成点**，但仍计入 `stats.total`（同报表口径，总计按字典 `counted=true` 集合）。
2. **排除已作废**：`voidedAt = null`（全仓不变量，`glucose-domain` 作废节）。漏加即数据错误。
3. **时间过滤**：秒粒度闭区间 `measuredAt ∈ [startTime, endTime]`，单侧不传则该侧不限（复用 `resolveTimeRange`，与报表/记录一字不差）。
4. **时段过滤**（2026-11-24 增补）：`mealContexts` 非空 → 按记录 `mealContext` 码收窄（`mealContext IN (...)`）；缺省/空数组 = **不过滤**（「全部」，含停用时段 mealContext 的历史记录，与无此参数时完全一致）。**points 与 stats 叠加同一 `mealContextWhere`**——取消勾选某时段，图表与统计栏一起排除（需求 #2），保证「所见即所滤」。只做格式拆分（逗号串 → 数组）、**不做白名单校验**：code 是否存在/启用同 `mealContext`（动态时段，读路径不查库——停用时段的历史记录在「全部」/勾选时仍应可见）。
5. **排序**：`measuredAt ASC`（时间顺序，散点/折线按时间铺开）；同秒按 `id ASC` 稳定。
6. **统计栏**：复用 `buildReportStats(patientId, range.where, mealContextWhere)`（第 3 参为时段过滤，2026-11-24 增补；报表/记录不传 → 默认 `{}` 不受影响），与分页无关、按范围 + 时段收窄全量（裁定：复用报表口径，同范围同时段下与报表/记录 Tab 数字完全一致）。
7. **阈值**：~~经 `SystemConfigService.getGlucoseAlertThreshold()` 读取 `glucose.low_threshold`/`glucose.high_threshold`~~
   **（2026-11-25 修订，任务 ④ / R8）**：改为经 `PatientGlucoseTargetService.resolveAlertThreshold(patientId)` 解析 ——
   **患者预警值（`PatientAlertThreshold`）优先**，患者缺行或该行读取失败则回退全局 `SystemConfig`
   （`glucose.low_threshold`/`glucose.high_threshold`）。仍随响应下发、**禁止前端硬编码**；
   回退源配置缺失/非法/`low >= high` → 抛 `10000`（与全系统口径一致，seed 保证有效配置）。
   解析仍占 `Promise.all` 的一个位子，命中患者行时查询次数与改造前相同。
   ⚠️ 预警值**不参与** `resultType` 判定（R7），判定阈值是患者时段目标（R4），两者不同源，
   故可能出现「判为偏低的点落在目标带内部」（`patient-glucose-target.md` §11 待确认项 2，需求人已接受）。
8. **不分页**：返回范围内全部数值点。BGM 手工录入量级有限 + 查询表单按住院收敛；大数据量由前端 ECharts `sampling:'lttb'` + `large:true` 承接（`glucose-domain` 图表节）。
9. **患者校验**：`assertPatientReadable`（存在、未归档、数据范围内；**不要求住院中**——出院患者历史趋势同样可查）。

## 5. 权限与数据安全

| 项       | 选择                                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 功能权限 | `@RequirePermissions(PERMISSION.PATIENT_VIEW)`（不新增权限点，同报表/记录）                                                                                                                                                                                                                                                          |
| 数据范围 | `@RequireDataScope(RESOURCE.PATIENT)` + service 内 `assertInScope`；`NONE` 档（设备管理员）→ `30006`                                                                                                                                                                                                                                 |
| 脱敏字段 | 趋势响应**不含**患者姓名/身份证/电话；`operatorName` 是医护姓名（非患者敏感信息，同报表 `nurseName` 口径）                                                                                                                                                                                                                           |
| 加密字段 | 无（不触碰 Cipher 字段）                                                                                                                                                                                                                                                                                                             |
| 审计     | `@Audit('GLUCOSE_TREND_VIEW', { targetType: 'PATIENT' })`：查询患者血糖属敏感操作，逐次留痕（含越权 DENIED）；detail 的 `rangeFrom`/`rangeTo`/`count`/`mealContexts` 由 service 回显、拦截器按 `AUDIT_DETAIL_ALLOW_LIST` 提取（`mealContexts` 2026-11-24 加入白名单——时段码数组非敏感，回显使 count 随过滤变化可解释；其余为既有项） |

## 6. 前端交互

- **入口与路由**：`/inpatient/patients/:id/glucose/trend`（子 Tab「趋势图」，权限继承父路由 `PATIENT_VIEW`）。`routes.tsx` 将 `glucoseTrend` 的 `element` 由 `DetailPlaceholder` 替换为 `GlucoseTrendTab`。
- **页面结构**：工具栏行（统计栏 + 查询表单 + 全屏按钮，复用 `GlucoseToolbar`）+ 图表主体（ECharts，占满剩余高度）。
- **查询表单**：复用 `GlucoseQueryForm`（住院记录 → 科室记录 → 时间范围三层联动），`extra` 插槽不使用（时段过滤放在图表区顶部覆盖行、紧贴图例，不挤进工具栏）。状态机同记录页：表单态与**已应用**范围分离，点「查询」/初始默认态/重置才发请求；初始按住院记录默认范围自动查询（R24 裁定 Q15）。
- **时段过滤**（2026-11-24 增补，需求人 5 项裁定）：图表容器顶部覆盖行（图例 `top:32` 上方、行高 ~22px 不挤压绘图区），左侧「全部」+ 所有**启用**时段复选框（普通 + 特殊 + 强化，与录入下拉一致，取 `useCommonDataStore().timeSlots` 过滤 `enabled`），右侧折线/散点切换按钮。
  - **布局**（裁定 #5）：复选框单行排列、容器限宽（避开右上按钮）、`overflow-x` 横向滚动（`.gc-slot-filter`：隐藏滚动条但保留滚动，行高不叠加滚动条以免压住图例）；图表图例/绘图区不变。
  - **默认全选** =「全部」勾上 + 各时段勾上（= 默认视图，不发 `mealContexts`、不过滤）。状态用**取消勾选的时段集合**（默认空）表示：时段异步加载完成后无需 reset effect——选中项恒由启用时段减去取消集派生。
  - **取消勾选某时段**（需求 #2）：图表隐藏该时段点、**统计栏同步排除**（后端重查 + 重算 stats，口径同报表）；X 轴重贴过滤后数据（裁定 #3）；每次勾选/取消**立即重查**（裁定 #4，与报表/记录「改筛选即查」一致）。
  - **「全部」联动**（需求 #3/#4）：取消任一时段 →「全部」自动转 indeterminate/取消；点「全部」→ 所有时段重新勾上（回默认）。**须保留 ≥1 个时段**：取消最后一个时段 → `message.warning('请至少选择一个时段')` 并拦截（同报表 `toggleDisplay` 最少 1 项口径）。
  - **空态可见**：过滤行在 `data` 就绪即渲染——图表空态（范围无数值记录）下用户仍能重新勾选时段，不随 `Empty` 一起隐藏。
- **图表**（ECharts 时间轴，`buildTrendOption` 重写；支持**折线/散点切换**）：
  - X 轴 `type:'time'`（数据点横坐标 = `measuredAt` 完整毫秒时间戳，**保留时分秒**，同日多次测量横向铺开）；Y 轴 `type:'value'`，名 `mmol/L`。
  - **X 轴日期级范围/刻度**（2026-11-24 增补）：轴 `min`/`max` 取数据最小/最大日期的**日界**（最小日 `startOf('day')`、最大日 `endOf('day')`）；刻度标签固定 `MM-DD`（`axisLabel.formatter:'{MM}-{dd}'`，两位月-两位日、不含年）；`minInterval:86400000`（刻度下限 1 天）避免短范围出现小时级刻度致 MM-DD 重复同一天，长范围由 ECharts 自动放大间隔（周/月）+ `hideOverlap` 防拥挤。**单日数据**（最小日 = 最大日）向两侧各扩 1 天（轴跨 3 天、居中该日）。**空点**不设 min/max（交轴自动）。tooltip 不受影响，仍显示完整 `YYYY-MM-DD HH:mm:ss`。
  - **形态切换按钮**（2026-11-24 增补）：叠加在图表容器右上角（图例上方，图例下移 `top:32`、绘图区 `top:56` 让位），折线 ↔ 散点来回切换；**默认折线图**，按钮文案/图标显示**目标**形态（当前折线 → 显示「散点图」+ `DotChartOutlined`；当前散点 → 显示「折线图」+ `LineChartOutlined`）。切换仅改系列 `type`（`line`/`scatter`）与渲染参数，数据/颜色/图例/tooltip/点击复核完全一致。
  - 三个系列「偏低/正常/偏高」（折线/散点同构），**颜色与图例文案取 DY-RESULT 字典**（`resultType` 0/1/2 的 `color`/`label`），字典缺失回退 `glucoseColor` 令牌；图例可分类切换（色+文双通道）。折线模式 `showSymbol:true` 保留可点击符号、`lineStyle` 与字典同色（宽 1.5）；散点模式 `large:true`+`largeThreshold:2000` 渐进渲染（CGM 大数据量预留）。
  - 阈值线：`markLine` 低值（`glucoseColor.low` 虚线）/ 高值（`glucoseColor.high` 虚线）；目标范围带：`markArea`（low→high 半透明绿）。挂在不进图例的专用系列上，切换点系列时恒可见。
  - tooltip（`trigger:'item'`）：**同时展示测量时间 + 血糖值 + 录入人**（`glucose-domain` 图表节硬要求），格式 `时间 / X.X mmol/L（类型标签）/ 记录者：name`。
  - 点击数据点 → `GlucoseReviewModal`（复用 R25，与报表/记录一致）；编辑/作废成功走 `onGlucoseChanged` → 版本号 +1 → 趋势重拉。
- **全屏**：`useFullscreen({ onResize })`，回调里 `chartRef.current?.getEchartsInstance().resize()`（不另写 resize 监听 / Fullscreen API）。
- **统计栏**：`buildReportStatsItems(data.stats, resultTypes)`（与记录页同一构建函数）。
- **按钮级权限**：本页无新增按钮；复核弹窗内编辑/作废按钮的权限门控在弹窗既有实现里。
- **异常呈现**：字段级错误挂表单项；全局错误 `Alert` + 重试按钮；越权（403）走 `forbidden` 态。
- **可访问性**：大字号跟随 token；`gc-no-print` 打印隐藏交互控件；图例文案 + 字典标签构成色+文双通道。

## 7. 错误码与前端行为

| 场景                  | 错误码 | HTTP | 前端行为                             |
| --------------------- | ------ | ---- | ------------------------------------ |
| 时间参数不合法        | 10001  | 422  | 字段级（挂表单）                     |
| 阈值配置缺失/非法     | 10000  | 500  | toast（系统错误，提示联系管理员）    |
| 无数据范围（NONE 档） | 30006  | 403  | toast + `forbidden` 态               |
| 跨科室越权            | 30002  | 403  | toast + `forbidden` 态 + 审计 DENIED |
| 患者不存在/已归档     | 40001  | 404  | toast                                |

## 8. 测试要求

- [ ] 后端单测（`glucose.service.spec.ts` 追加 `trend`）：数值点过滤（仅 0/1/2）、排除作废、升序、stats 与报表一致、thresholds 下发、越权 `30002`/`30006`、患者不存在 `40001`、空范围返回空 points。
- [ ] 前端单测：`buildTrendOption`（三系列分组、字典色/标签、阈值线/目标带、空数据、tooltip 含录入人）；`useGlucoseTrend`（请求触发、过期响应丢弃、错误/越权态）；`GlucoseTrendTab`（渲染、空态、错误态、统计栏）。
- [ ] 手工验证（迁移应用后）：`dr.wang`（DOCTOR，本科室）查本科室患者趋势 → 200 + 审计 `GLUCOSE_TREND_VIEW` SUCCESS；查跨科室患者 → 403 + 审计 DENIED；设备管理员 → 30006。

## 9. 非功能要求

| 项   | 要求                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- |
| 性能 | 范围内数值点全量返回；ECharts `sampling:'lttb'`+`large:true` 承接大数据量；查询表单按住院收敛范围 |
| 内网 | 不引用任何公网资源（ECharts 本地依赖）                                                            |
| 等保 | 敏感查询逐次审计（`GLUCOSE_TREND_VIEW`）；越权落 DENIED；不返回患者明文身份信息                   |
| 兼容 | 大字号、打印（`gc-no-print`）、明暗模式（图表色随 `mode`）、全屏 resize                           |

## 10. 验收标准

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] 接口返回符合契约，错误码符合规范
- [ ] 越权场景被拒并落审计（**迁移应用后**）
- [ ] 前端路由与按钮权限生效；趋势图正确描点、阈值线/目标带/统计栏/全屏/复核弹窗可用
- [ ] 文档更新（`docs/ROADMAP.md` P3-7 进度）

## 11. 待确认项 / 人工动作（阻塞）

1. ✅ **【2026-11-24 已应用】Prisma 枚举 + 迁移**：`AuditAction` 追加 `GLUCOSE_TREND_VIEW`（需求人授权 AI 起草并执行；原属 `AGENTS.md §6.5` 人工评审项，本次经明确授权在**本地开发库**完成，未触碰生产/内网库）。
   - `apps/server/prisma/schema.prisma`：已在 `enum AuditAction` **末尾**追加 `GLUCOSE_TREND_VIEW`（PG `ALTER TYPE ADD VALUE` 只能加到末尾，见 `docs/DB-MIGRATION-NOTES.md` §2.3）。
   - 迁移 `apps/server/prisma/migrations/20261124000000_add_glucose_trend_view_audit/migration.sql`：`ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GLUCOSE_TREND_VIEW';`（仿 `20261123000000_add_glucose_record_query_audit` 先例；本迁移不插审计数据，不受「同一事务内不得使用新枚举值」限制，随 `db:deploy` 正常应用）。
   - 已执行 `pnpm exec prisma migrate deploy`（18 迁移全部应用）+ `pnpm exec prisma generate`（Prisma Client 重生成）。
   - **验证**：`prisma migrate status` → up to date；`migrate diff` 漂移为空（实库枚举与 schema 一致）；`pg_enum` 查询 → `AuditAction` 共 24 值、`GLUCOSE_TREND_VIEW` 位于末尾；`pnpm typecheck`（三包）✅ / server 单测 285 ✅。
   - 背景：应用前 `@Audit('GLUCOSE_TREND_VIEW')` 虽过 typecheck（装饰器参数是 `string`）、接口正常返数据，但审计写入被 PG 拒绝（非法枚举值）、拦截器吞错 → 审计静默不落表（`GLUCOSE_REPORT_VIEW` 旧缺陷同款）。应用后趋势审计恢复落表（detail 含 `rangeFrom`/`rangeTo`/`count`/`mealContexts`）。
2. 阈值配置非法时趋势请求整体失败（`10000`）——已确认接受（与全系统口径一致，seed 保证有效配置；趋势图缺阈值参照判读价值大减，故不降级为「无阈值线」）。

## 12. 实施记录（2026-11-24）

### 改动文件清单

**共享契约（packages/shared）**

- `src/glucose/schema.ts`：新增 `glucoseTrendQuerySchema` / `GlucoseTrendQuery` / `GlucoseTrendPoint` / `GlucoseTrendResponse`（经 `src/index.ts` 的 `export * from './glucose/schema'` 自动 re-export）。已 `pnpm --filter @gc/shared build` + `pnpm sync:shared`。

**服务端（apps/server）**

- `src/modules/glucose/glucose.service.ts`：新增 `trend(user, patientId, query)`——`assertPatientReadable` → `resolveTimeRange` → `Promise.all([findMany(numericRecordWhere, orderBy measuredAt asc+id asc, select id/measuredAt/valueMmolL/resultType/operator.name), buildReportStats, resolveAlertThreshold(patientId)])`（第三项 2026-11-25 起由 `getGlucoseAlertThreshold()` 换成患者预警值解析，见 R7 修订） → 映射 points（`formatDateTime` + `Number(valueMmolL)` + `operator?.name`）。
- `src/modules/glucose/glucose.controller.ts`：新增 `@Get(':id/glucose/trend')`（声明在 `:recordId` 之前），`@RequirePermissions(PATIENT_VIEW)` + `@RequireDataScope(RESOURCE.PATIENT)` + `@Audit('GLUCOSE_TREND_VIEW', { targetType: 'PATIENT' })`。
- `src/modules/glucose/glucose.service.spec.ts`：新增 `createTrendService`/`trendQuery` 夹具 + `GlucoseService.trend` describe（8 用例：排序映射、where 口径+不分页、不限时间、阈值/统计、operator 空、空范围、时间倒挂 10001、越权 30002/30006/40001）。

**前端（apps/web）**

- `src/api/glucose.ts`：新增 `GlucoseTrendParams` + `fetchGlucoseTrend`。
- `src/styles/chartTheme.ts`：`buildTrendOption` 由「日均值类目轴」重写为「原始测量点时间轴散点」——三 scatter 系列（DY-RESULT 字典色/标签，缺失回退 `glucoseColor` 令牌+code）、阈值线/目标带挂不进图例的专用 line 系列、tooltip 含时间+血糖值+录入人、数据点带 `recordId`、`large`+`largeThreshold` 承接大数据量。
- `src/styles/chartTheme.spec.ts`：新增（7 用例：系列结构、分组、阈值线/带、tooltip、录入人空、字典缺失兜底、空点）。
- `src/pages/inpatient/patient-detail/useGlucoseTrend.ts`：新增数据 hook（仿 `useGlucoseRecords`，去分页）。
- `src/pages/inpatient/patient-detail/GlucoseTrendTab.tsx`：新增子页（复用 R24 表单联动 / R26 工具栏+全屏 `onResize→chart.resize` / R25 复核弹窗 / 报表统计口径；ECharts 散点 + 点击复核 + 空/错/载态）。
- `src/routes/routes.tsx`：`glucoseTrend` 的 `element` 由 `DetailPlaceholder` 替换为 `GlucoseTrendTab`。

**文档**

- `docs/specs/glucose-trend.md`（本文件）、`docs/ROADMAP.md`（P3-7 → ✅、P3-2 剩余项、P2-2 进度备注）。

### 验证结果

- `pnpm lint` ✅ / `pnpm typecheck`（shared+server+web）✅ / `pnpm test`（shared 75 + web 169 + server，含新增 trend 8 + chartTheme 7）✅ / `pnpm build` ✅。
- 前端外层 `GlucoseTrendTab` 与 `useGlucoseTrend` 依赖 Outlet context/网络/ECharts DOM，按本仓口径（同 `GlucoseRecordTab`）不做 node 环境单测，靠 typecheck + 手工 e2e 验证。

### 2026-11-24 增补：折线/散点切换按钮

需求人追加：图表容器右上角（图例上方）加切换按钮，折线 ↔ 散点来回切换，**默认折线图**，按钮文案/图标显示**目标**形态（当前折线 → 显示「散点图」+ `DotChartOutlined`；当前散点 → 显示「折线图」+ `LineChartOutlined`）。

- `src/styles/chartTheme.ts`：`buildTrendOption` 新增 `TrendChartType = 'line' | 'scatter'` 与 `chartType` 入参；三个结果类型系列按 `chartType` 在 `line`（`showSymbol:true` + `lineStyle` 同字典色、宽 1.5）/ `scatter`（`large:true`）间切换，数据/颜色/图例/tooltip/`recordId` 两模式完全一致；图例下移 `top:32`、绘图区 `top:56` 为按钮让位。
- `src/pages/inpatient/patient-detail/GlucoseTrendTab.tsx`：新增 `chartType` 状态（默认 `'line'`）；图表容器右上角绝对定位 Antd `Button`（图标 + 目标形态文案，`zIndex:10`、位于绘图区上方不遮挡数据点），点击切换并经 `useMemo` 依赖重建 option。
- `src/styles/chartTheme.spec.ts`：补折线模式 4 用例（系列 `type:line`、线色/线宽/`showSymbol`、数据点附加字段、字典缺失兜底），共 11 用例。

验证：`pnpm --filter @gc/web typecheck` ✅ / `pnpm --filter @gc/web test chartTheme`（11 用例）✅ / `pnpm lint` ✅ / `pnpm --filter @gc/web build` ✅。目检增补项：切换按钮位置（图例上方）、默认折线、文案与图标随目标形态、折线/散点两种描点与字典色、点符号进复核、全屏 resize。

### 2026-11-24 增补：X 轴改日期级（MM-DD）

需求人裁定 4 项：① 数据点保留时分秒（仅轴标签改日期）② 刻度自动间隔 ③ 单日数据向两侧各扩 1 天 ④ tooltip 保持完整时间。

- `src/styles/chartTheme.ts`：`buildTrendOption` 在 `return` 前由 `points` 计算 `xMin`/`xMax`——循环取 `measuredAt` 最小/最大（用循环而非 `Math.min(...arr)` 避免大数据量爆栈），`startOf('day')`/`endOf('day')` 取日界；单日（最小日 = 最大日）向两侧各扩 1 天；空点保持 `undefined`。`xAxis` 加 `min`/`max`/`minInterval:86400000`（1 天下限，防短范围小时级刻度致 MM-DD 重复同一天）/`axisLabel.formatter:'{MM}-{dd}'`。数据点横坐标（完整时间戳）与 tooltip 均未变。
- `src/styles/chartTheme.spec.ts`：补 X 轴日期级 4 用例（多日日界 + MM-DD + minInterval、单日扩 ±1 天、数据点保留时分秒、空点 min/max undefined），共 15 用例。

验证：`pnpm --filter @gc/web typecheck` ✅ / `pnpm --filter @gc/web test chartTheme`（15 用例）✅ / `pnpm lint` ✅ / `pnpm --filter @gc/web build` ✅。目检增补项：X 轴标签为 MM-DD、轴范围贴数据日界、单日数据扩 3 天居中、短范围刻度不重复 MM-DD、长范围刻度自动稀疏、tooltip 仍完整时间。

### 2026-11-24 增补：时段过滤（需求人 5 项裁定）

需求人裁定 5 项：① **后端过滤 + 重查**（趋势接口增时段参数，后端过滤点并**重算统计**，使统计与报表口径一致）② 按记录 `mealContext` 过滤，选项 = 全部启用时段（普通 + 特殊 + 强化，与录入下拉一致）③ X 轴重贴过滤后数据 ④ 每次勾选/取消**立即重查** ⑤ 布局 = **单行横向滚动**（复选框行限宽避开右上按钮、`overflow-x` 滚动，图表图例/绘图区不变）。

**共享契约（packages/shared）**

- `src/glucose/schema.ts`：`glucoseTrendQuerySchema` 增 `mealContexts`（`z.string().transform(逗号拆分 → trim → 去空).optional()`；前端 `http.get` 用 `URLSearchParams` 把数组序列化成逗号串，此处 transform 还原）；`GlucoseTrendResponse` 增 `mealContexts: string[] | null`（过滤回显，null = 未过滤）。已 `pnpm --filter @gc/shared build` + `pnpm sync:shared`。
- `src/glucose/schema.spec.ts`：新增 `glucoseTrendQuerySchema` describe（5 用例：缺省 → undefined、逗号拆分、trim + 去空、空串 → []、startTime/endTime Date 解析），共 15 用例。

**服务端（apps/server）**

- `src/common/decorators/audit.decorator.ts`：`AUDIT_DETAIL_ALLOW_LIST` 追加 `'mealContexts'`（时段码数组非敏感；回显使审计 detail 里 count 随过滤变化可解释）。
- `src/modules/glucose/glucose.service.ts`：`trend()` 增 `mealContextWhere`（`mealContexts` 非空 → `{ mealContext: { in } }`，否则 `{}`），`findMany`（points）与 `buildReportStats`（stats）叠加**同一** where；响应回显 `mealContexts`（空 → null）。`buildReportStats` 增第 3 参 `mealContextWhere: Prisma.GlucoseRecordWhereInput = {}`，spread 进 `groupBy` 与两个 max/min `findFirst` 的 where（报表/记录不传 → 默认 `{}` 不受影响）。
- `src/modules/glucose/glucose.service.spec.ts`：trend describe 补 3 用例（mealContexts → findMany/groupBy/findFirst 均叠 `mealContext IN` + 回显；无参 → 不含 mealContext 条件 + 回显 null；空数组 → 不过滤），共 89 用例。

**前端（apps/web）**

- `src/api/glucose.ts`：`GlucoseTrendParams` 增 `mealContexts?: string`（逗号分隔码）。
- `src/pages/inpatient/patient-detail/useGlucoseTrend.ts`：签名增 `mealContexts: string | undefined`（range 后、ready 前），fetch 透传、进 effect 依赖（勾选变化即重查）。
- `src/pages/inpatient/patient-detail/GlucoseTrendTab.tsx`：新增时段过滤态——订阅 `timeSlots` 过滤 `enabled`，用**取消集**（`uncheckedSlots`，默认空 = 全选）表示状态（时段异步到达免 reset effect），派生 `selectedCodes`/`allSlotsChecked`/`mealContextsParam`（全选 → undefined 不发）；`handleSelectAllSlots`（清空取消集）/ `handleToggleSlot`（勾选 = 移除、取消 = 加入但 `selectedCodes.length<=1` 时 `message.warning('请至少选择一个时段')` 拦截，副作用放 updater 外避免 StrictMode 双调用重复弹）；换患者 reset 清空取消集。图表区重构：`data` 就绪即渲染顶部覆盖 flex 行（`.gc-slot-filter` 复选框组 `flex:1 minWidth:0` + 切换按钮 `flexShrink:0`），图表/Empty/Spin 在其下，空态下过滤行仍可见。
- `src/styles/global.css`：新增 `.gc-slot-filter`（flex 单行 + gap + `overflow-x:auto` + `white-space:nowrap` + 隐藏滚动条：Firefox `scrollbar-width:none` / WebKit `::-webkit-scrollbar{display:none}`；`.ant-checkbox-wrapper` 清零 `margin-inline-start` + `flex-shrink:0` 防压缩文字）。

**文档**

- `docs/specs/glucose-trend.md`（本文件：§3 契约 + §4 规则 4/6 + §5 审计 + §6 时段过滤交互 + 本实施记录）。

验证：`pnpm sync:shared` ✅ / `pnpm typecheck`（shared+server+web）✅ / shared `schema.spec.ts`（15 用例）✅ / server `glucose.service.spec.ts`（89 用例）✅ / `pnpm lint` ✅ / `pnpm --filter @gc/web build` ✅。目检增补项：默认全选 =「全部」、取消某时段图表 + 统计栏同步排除、X 轴重贴、「全部」联动与 indeterminate、取消最后一个时段拦截、单行横向滚动不叠图例、空态下过滤行可用、换患者重置过滤行。

### 遗留项（阻塞「合规完成」）—— 已全部闭环（2026-11-24）

1. ✅ **迁移已应用**：`AuditAction` 追加 `GLUCOSE_TREND_VIEW`（迁移 `20261124000000_add_glucose_trend_view_audit` + `pnpm db:generate`，详见 §11）。趋势审计恢复落表（detail 含 `rangeFrom`/`rangeTo`/`count`/`mealContexts`）。
2. ✅ **需求人浏览器目检已完成**（2026-11-24）：散点描点/字典色/阈值线/目标带/tooltip（时间+录入人）/图例切换/全屏 resize/点击复核/明暗模式/大字号/时段过滤。

> 至此 P3-7 血糖趋势图（含时段过滤增补）**合规完成**：功能、审计落表、文档三者齐备。
