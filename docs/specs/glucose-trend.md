# 血糖趋势图（P3-7）功能规格

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 填写。2026-11-24 需求人 4 项裁定（图表形态 / 接口与审计 / 统计栏 / 阈值来源）落定后成文。
> 相关规范：`docs/ROADMAP.md`（P3-7）、`docs/ERROR-CODES.md`、`docs/PERMISSION-DESIGN.md`、`docs/UI-DESIGN-TOKENS.md`、
> `.codebuddy/rules/glucose-domain.md`（图表节）、`.codebuddy/rules/security-and-audit.md`、`.codebuddy/rules/shared-package.md`。

## 0. 元信息

| 项     | 内容                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阶段号 | P3-7 血糖趋势图（见 `docs/ROADMAP.md`）                                                                                                                                                                                                      |
| 模块   | glucose                                                                                                                                                                                                                                      |
| 优先级 | P1                                                                                                                                                                                                                                           |
| 依赖   | R24 查询表单联动（`GlucoseQueryForm`）、R26 公共件（`GlucoseToolbar`/`useFullscreen`）、R20 报表统计口径（`buildReportStats`/`buildReportStatsItems`）、R25 复核弹窗（`GlucoseReviewModal`）、`SystemConfigService.getGlucoseAlertThreshold` |
| 需求人 | （2026-11-24 对话裁定）                                                                                                                                                                                                                      |

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

| 模型                  | 字段                      | 类型       | 说明                                                                                                  | 是否需迁移     |
| --------------------- | ------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| —                     | —                         | —          | **无表/字段变更**：趋势按原始测量点即时查询 `GlucoseRecord`，不建 `GlucoseDailySummary`（P3-3 仍 ❌） | 否             |
| `AuditAction`（枚举） | 追加 `GLUCOSE_TREND_VIEW` | enum value | 趋势查询独立审计动作（裁定：新审计动作）。**AI 禁改 schema/migration，需人工执行**，见 §11            | **是（人工）** |

## 3. 接口契约

| #   | 方法 | 路径                          | 权限点         | 数据范围(RESOURCE) | 审计动作             | 说明                                 |
| --- | ---- | ----------------------------- | -------------- | ------------------ | -------------------- | ------------------------------------ |
| 1   | GET  | `/patients/:id/glucose/trend` | `patient:view` | PATIENT            | `GLUCOSE_TREND_VIEW` | 血糖趋势（原始测量点，只读，不分页） |

> ⚠️ 路由顺序：必须声明在 `:id/glucose/:recordId` **之前**（同 `report`/`records`），否则 `trend` 被 `:recordId` 捕获。

请求（`glucoseTrendQuerySchema`，复用 `dateTimeStringSchema`，与报表/记录同口径）：

```ts
{
  startTime?: string; // YYYY-MM-DD HH:mm:ss 本地时间，闭区间起点；不传则不限
  endTime?: string;   // YYYY-MM-DD HH:mm:ss 本地时间，闭区间终点；不传则不限
}
```

> **无 page/pageSize**：趋势图不分页，返回范围内全部数值点；范围由查询表单按住院记录默认收敛。

响应（`GlucoseTrendResponse`）：

```ts
{
  points: GlucoseTrendPoint[];        // 数值型(0/1/2)有效记录，按 measuredAt 升序
  thresholds: { low: number; high: number }; // SystemConfig 告警阈值，前端画阈值线/目标带
  stats: GlucoseReportStats;          // 复用报表统计类型与口径（同范围与报表/记录数字一致）
  rangeFrom: string | null;           // 实际生效区间回显（审计 detail 同源，白名单零改动）
  rangeTo: string | null;
  count: number;                      // 本页点数（= points.length），审计 detail 用
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
4. **排序**：`measuredAt ASC`（时间顺序，散点/折线按时间铺开）；同秒按 `id ASC` 稳定。
5. **统计栏**：复用 `buildReportStats(patientId, range.where)`，与分页无关、按范围全量（裁定：复用报表口径，同范围下与报表/记录 Tab 数字完全一致）。
6. **阈值**：经 `SystemConfigService.getGlucoseAlertThreshold()` 读取 `glucose.low_threshold`/`glucose.high_threshold`，随响应下发；**禁止前端硬编码**。配置缺失/非法/`low >= high` → 抛 `10000`（与全系统口径一致，seed 保证有效配置）。
7. **不分页**：返回范围内全部数值点。BGM 手工录入量级有限 + 查询表单按住院收敛；大数据量由前端 ECharts `sampling:'lttb'` + `large:true` 承接（`glucose-domain` 图表节）。
8. **患者校验**：`assertPatientReadable`（存在、未归档、数据范围内；**不要求住院中**——出院患者历史趋势同样可查）。

## 5. 权限与数据安全

| 项       | 选择                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 功能权限 | `@RequirePermissions(PERMISSION.PATIENT_VIEW)`（不新增权限点，同报表/记录）                                                                                                                                                          |
| 数据范围 | `@RequireDataScope(RESOURCE.PATIENT)` + service 内 `assertInScope`；`NONE` 档（设备管理员）→ `30006`                                                                                                                                 |
| 脱敏字段 | 趋势响应**不含**患者姓名/身份证/电话；`operatorName` 是医护姓名（非患者敏感信息，同报表 `nurseName` 口径）                                                                                                                           |
| 加密字段 | 无（不触碰 Cipher 字段）                                                                                                                                                                                                             |
| 审计     | `@Audit('GLUCOSE_TREND_VIEW', { targetType: 'PATIENT' })`：查询患者血糖属敏感操作，逐次留痕（含越权 DENIED）；detail 的 `rangeFrom`/`rangeTo`/`count` 由 service 回显、拦截器按既有 `AUDIT_DETAIL_ALLOW_LIST` 提取，**无需改白名单** |

## 6. 前端交互

- **入口与路由**：`/inpatient/patients/:id/glucose/trend`（子 Tab「趋势图」，权限继承父路由 `PATIENT_VIEW`）。`routes.tsx` 将 `glucoseTrend` 的 `element` 由 `DetailPlaceholder` 替换为 `GlucoseTrendTab`。
- **页面结构**：工具栏行（统计栏 + 查询表单 + 全屏按钮，复用 `GlucoseToolbar`）+ 图表主体（ECharts，占满剩余高度）。
- **查询表单**：复用 `GlucoseQueryForm`（住院记录 → 科室记录 → 时间范围三层联动），`extra` 插槽不使用（趋势无追加筛选）。状态机同记录页：表单态与**已应用**范围分离，点「查询」/初始默认态/重置才发请求；初始按住院记录默认范围自动查询（R24 裁定 Q15）。
- **图表**（ECharts 时间轴散点，`buildTrendOption` 重写）：
  - X 轴 `type:'time'`（`measuredAt`）；Y 轴 `type:'value'`，名 `mmol/L`。
  - 三个 scatter 系列「偏低/正常/偏高」，**颜色与图例文案取 DY-RESULT 字典**（`resultType` 0/1/2 的 `color`/`label`），字典缺失回退 `glucoseColor` 令牌；图例可分类切换（色+文双通道）。
  - 阈值线：`markLine` 低值（`glucoseColor.low` 虚线）/ 高值（`glucoseColor.high` 虚线）；目标范围带：`markArea`（low→high 半透明绿）。挂在不进图例的专用系列上，切换点系列时恒可见。
  - tooltip（`trigger:'item'`）：**同时展示测量时间 + 血糖值 + 录入人**（`glucose-domain` 图表节硬要求），格式 `时间 / X.X mmol/L（类型标签）/ 记录者：name`。
  - 大数据量：`sampling:'lttb'`、`large:true`。
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

1. ⚠️ **【人工执行，AI 禁改】Prisma 枚举 + 迁移**：`AuditAction` 追加 `GLUCOSE_TREND_VIEW`。
   - `apps/server/prisma/schema.prisma`：在 `enum AuditAction` **末尾**追加 `GLUCOSE_TREND_VIEW`（PG `ALTER TYPE ADD VALUE` 只能加到末尾，见 `docs/DB-MIGRATION-NOTES.md` §2.3）。
   - 迁移 SQL：`ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GLUCOSE_TREND_VIEW';`（`ADD VALUE` 不能在事务块内，需按本仓枚举迁移先例单独执行）。
   - 应用后跑 `pnpm db:generate` 重新生成 Prisma Client。
   - **在迁移应用前**：`@Audit('GLUCOSE_TREND_VIEW')` 能通过 typecheck（装饰器参数是 `string`），接口能正常返回数据，但审计写入会被 PG 拒绝（非法枚举值）、拦截器吞错只打 `console.error` → **审计静默不落表**（即 schema 注释里 `GLUCOSE_REPORT_VIEW` 旧缺陷同款）。故本功能「合规完成」以迁移应用为准。
2. 阈值配置非法时趋势请求整体失败（`10000`）——已确认接受（与全系统口径一致，seed 保证有效配置；趋势图缺阈值参照判读价值大减，故不降级为「无阈值线」）。

## 12. 实施记录（2026-11-24）

### 改动文件清单

**共享契约（packages/shared）**

- `src/glucose/schema.ts`：新增 `glucoseTrendQuerySchema` / `GlucoseTrendQuery` / `GlucoseTrendPoint` / `GlucoseTrendResponse`（经 `src/index.ts` 的 `export * from './glucose/schema'` 自动 re-export）。已 `pnpm --filter @gc/shared build` + `pnpm sync:shared`。

**服务端（apps/server）**

- `src/modules/glucose/glucose.service.ts`：新增 `trend(user, patientId, query)`——`assertPatientReadable` → `resolveTimeRange` → `Promise.all([findMany(numericRecordWhere, orderBy measuredAt asc+id asc, select id/measuredAt/valueMmolL/resultType/operator.name), buildReportStats, getGlucoseAlertThreshold])` → 映射 points（`formatDateTime` + `Number(valueMmolL)` + `operator?.name`）。
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

### 遗留项（阻塞「合规完成」）

1. ⚠️ **人工执行**：`AuditAction` 追加 `GLUCOSE_TREND_VIEW` + 迁移 `ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GLUCOSE_TREND_VIEW';` + `pnpm db:generate`（详见 §11）。应用前接口正常返数据，但审计写入被 PG 拒绝、拦截器吞错 → 审计不落表。
2. 需求人浏览器目检：散点描点/字典色/阈值线/目标带/tooltip（时间+录入人）/图例切换/全屏 resize/点击复核/明暗模式/大字号。
