# R28 血糖数据打印（患者详情 · 报告/记录/趋势图）

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 填写。2026-11-25 需求人两轮裁定（A1~A3、B1~B3、C1~C5、D1~D3、Q1~Q12）后定稿；2026-11-25/26 四轮变更裁定（时间范围行派生、对齐子行、页脚/审计口径、直接打印删预览 Modal）见 §11 变更记录 1~5，正文已同步为现状。
> 关联规格：`glucose-report.md`（R20~R25）、`glucose-report-query.md`（R24）、`glucose-record.md`（R27）、`glucose-trend.md`（P3-7）。

### 0. 元信息

| 项     | 内容                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------- |
| 阶段号 | P3-2 增补（R28，接 R27/P3-7 序列）                                                                |
| 模块   | glucose / patient（前端公共打印层 `components/print/`）                                           |
| 优先级 | P1                                                                                                |
| 依赖   | R24 查询表单（appliedRange）、R26 公共工具栏、R27 记录列表、P3-7 趋势图、字段加密（field-crypto） |
| 需求人 | 用户（2026-11-25 会话裁定）                                                                       |

### 1. 目标与用户故事

作为**医护**，我要**在患者详情-血糖数据的三个子 Tab（血糖报告/血糖记录/趋势图）打印当前查询范围的血糖数据**，以便**留存纸质医疗文书**。

本次范围（做）：

- 三页共用查询表单（`GlucoseQueryForm`）在「重置」后新增**打印按钮**（`type="primary"`，与查询同类型；全屏态同样展示）。
- 点击打印 → **直接唤起浏览器自带打印预览**（2026-11-26 方案 B 裁定，预览 Modal 已删除）：无头执行器取数、实测分页后触发 `window.print`，仅输出打印页。
- 打印公共层（大标题/小标题/患者信息/A4 页容器/分页工具）抽为可复用组件，供后续全院血糖、质控记录等打印复用。
- 配套后端：明文姓名接口（访问即留痕）、打印留痕接口、新权限点 `glucose:print`、两个审计枚举值。

本次不做（明确排除）：

- 血糖报告/记录/趋势图本身的业务逻辑改动（表格、统计、过滤口径全部沿用现状）。
- 打印水印/页脚导出人（裁定 A2 只选审计留痕，不选水印）。
- 大标题动态化（本期写死常量「血糖管理平台」，集中一处，后续接 SystemConfig 只改该处）。
- 异步导出框架（P3-6/P5 范畴）；本打印是同步前端行为，仅以审计接口留痕。

### 2. 数据模型变更

| 模型                  | 字段                               | 类型       | 说明             | 是否需迁移 |
| --------------------- | ---------------------------------- | ---------- | ---------------- | ---------- |
| `AuditAction`（enum） | 末尾追加 `PATIENT_NAME_PLAIN_VIEW` | enum value | 明文姓名访问留痕 | 是         |
| `AuditAction`（enum） | 末尾追加 `GLUCOSE_PRINT`           | enum value | 打印动作留痕     | 是         |

- 迁移 `20261125000000_add_print_audit_actions`：`ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS ...`（仿 20261123/20261124 先例）。
- ⚠️ PG 枚举值只能**追加末尾**、不可删（DB-MIGRATION-NOTES §2.3）；Prisma 漂移检测对枚举顺序敏感，schema 与实库顺序须一致。
- 无新表、无新列、无存量回填。权限点不入库（`ROLE_PERMISSIONS` 是共享包代码常量）。

### 3. 接口契约

| #   | 方法 | 路径                          | 权限点          | 数据范围(RESOURCE) | 审计动作                  | 说明                                      |
| --- | ---- | ----------------------------- | --------------- | ------------------ | ------------------------- | ----------------------------------------- |
| 1   | GET  | `/patients/:id/name-plain`    | `glucose:print` | PATIENT            | `PATIENT_NAME_PLAIN_VIEW` | 打印头明文姓名（访问即留痕，AGENTS §5.3） |
| 2   | POST | `/patients/:id/glucose/print` | `glucose:print` | PATIENT            | `GLUCOSE_PRINT`           | 打印留痕（前端点「打印」时调用）          |

接口 1 请求：无参数（路径 `:id`）。响应：

```ts
{
  name: string | null;
} // null = 密文不可解（历史 enc:hmac: 等），前端回退 nameMasked
```

接口 2 请求（`glucosePrintSchema`，`packages/shared/src/glucose/schema.ts`）：

```ts
{
  printType: 'report' | 'record' | 'trend';
  startTime?: string; // YYYY-MM-DD HH:mm:ss，本地时间，同 R24 契约
  endTime?: string;
  count: number; // 本次打印范围内 counted=true 记录数（= stats.total 口径），int ≥ 0
}
```

响应（`GlucosePrintResult`）：

```ts
{
  printType: GlucosePrintType;
  rangeFrom: string | null;
  rangeTo: string | null;
  count: number;
}
```

- 审计 detail：拦截器按白名单自动提取 `rangeFrom/rangeTo/count`（既有）+ `printType`（**白名单新增**，先例 `mealContexts`）。
- 接口 2 是**纯留痕端点**：不生成文件、不返回数据；服务端仍做患者可读校验（存在、未归档、数据范围内）。
- 打印数据本身复用既有接口，**不新增取数接口**：报告/记录按 `pageSize=100`（契约上限）循环拉全量（裁定 Q12：不设总量上限）；趋势图打印当前图表图片（`getDataURL`），不重新取数。

### 4. 业务规则与校验（裁定汇总）

**打印件版式**（A4 纵向，页边距上下左右 12mm，裁定 C4 区间内取值）：

1. 每页重复完整头部：大标题（居中加粗加大，「血糖管理平台」常量）→ 小标题（`患者血糖报告单（mmol/L）` / `患者血糖记录单（mmol/L）` / `患者血糖趋势图（mmol/L）`）→ 患者信息 → 时间范围行。
2. 患者信息 11 项：姓名（**明文**，接口 1）、性别、年龄、床号、住院号、科室、责任医生、责任护士、住院日期、出院日期、状态（住院/出院）。label:value 形式，横向 4 组一行，label 区等宽（「:」对齐），缺失展示「-」（住院患者出院日期为「-」）。
3. 时间范围行：紧贴内容区右上，`时间：<YYYY年MM月DD日>~<YYYY年MM月DD日>`；依**打印文档数据的最早/最晚测量日期派生**（2026-11-25 变更裁定，替代原「取已应用查询范围」，见变更记录 2），空侧展示「-」，丢弃时分秒（裁定 B2）。
4. 页脚（报告/记录每页；趋势图不展示，裁定 Q3）：紧贴内容区左下，`第<当前页>/<总页>页，本页<X>条数据，总计<Y>条数据`（文案不变）。X=该打印页 counted 记录数（counted 口径，裁定 Q2/Q3/Q4 不变）；Y=范围内**可见记录数**（2026-11-26 裁定，替代原 `stats.total` counted 口径——拒检/请假等可见但不计入的记录导致数字对不上，见变更记录 4）；counted 集合**动态跟随字典 `DictItem.counted=true`**（当前即排除 5~9 拒检/外出/请假/已吃饭/未进食），禁止硬编码码集。
5. 不使用浏览器自带页眉页脚页码（裁定 C4）。

**内容区**：

6. 血糖报告：表头同屏幕（日期列 + 服务端下发时段列）；受展示勾选影响（常规/强化过滤、检测时间显隐、操作人显隐，逻辑与屏幕 `ReportCell`/`filterReportRows` 一致）；**对齐子行**（2026-11-26 变更裁定，替代裁定 C1「每条独占一行」，见变更记录 4）：同日行数 = 该日单时段最大记录数，各时段第 i 条（检测时间升序）落第 i 行、缺位留空，日期列 rowspan 跨行合并；**不含统计栏**。
7. 血糖记录：5 列同屏幕（检测时间/检测时段/血糖值/检测人/备注）；血糖值**保留色+文双通道**（裁定 Q1）；数据 = 已应用范围内全量（裁定 B1/Q12）。
8. 趋势图：ECharts `getDataURL`（pixelRatio 2、白底）图片，**所见即所得**（含当前时段过滤与折线/散点形态），占满页宽、高度按比例，单页不分页（裁定 C3）。

**分页**（裁定 D1）：

9. DOM 实测高度切分：隐藏测量层渲染全部「分页单元」，实测高度后按页可用高度（A4 高 - 边距 - 头部 - 时间行 - 页脚）贪心装箱；不用公式推算。
10. 分页单元：报告 = **对齐子行**（key=`日期#子行序号`，子行级装箱，日期组可跨页；日期列按「页内连续同日期片段」合并，同日期跨两页时两页各自合并自己的片段——2026-11-25 变更裁定：原「日期组原子」会把装不下的下一组整体推去新页、首页大量留白；2026-11-26 再由「单记录行」改为对齐子行）；记录 = 单行。装满判定 = DOM 实测高度自适应（不硬编码每页行数）。单元高于整页时独占一页（防御，正常数据不触发）。

**交互与门控**：

11. 打印按钮受 `glucose:print` 控制：无权限**隐藏**（前端显隐是体验，接口 1/2 服务端强制校验兜底，裁定 Q6）。
12. 已应用范围内**无数据时按钮禁用**（裁定 B3）：报告 `total===0`（日期数）、记录 `total===0`、趋势 `points.length===0`。
13. 审计时机（裁定 Q11）：点打印 → 无头执行器挂载即调接口 1（记 `PATIENT_NAME_PLAIN_VIEW`）并拉打印数据；分页就绪后先调接口 2 留痕，**成功后**才 `window.print`；留痕失败则不打印（拦截器 toast 报错）。浏览器无法感知是否实际出纸，以点击为准。
14. 打印件固定白底黑字（不随暗色模式）；血糖值颜色取结果类型字典色（数据，非硬编码）。
15. 明文姓名解密失败（`decryptField` 返回 null，历史不可逆密文）→ 接口回 `name: null`，前端回退展示 `nameMasked`，不报错。

**实现级裁定**（本规格定稿时确认，非需求人逐条裁定）：

16. 报告打印时**无可见记录的日期行整行跳过**（屏幕上保留空行是为分页 total 口径，打印无此约束）。
17. 审计 `count` 与页脚「总计 Y 条」= **可见记录数**（2026-11-26 裁定，替代原 `stats.total` counted 口径）：report = 展示勾选过滤后 entry 总条数（含 5~9），record = 范围内记录条数；trend 打印的是图表图片、无记录列表可数，沿用 `stats.total`。服务端透传不重算。屏幕统计栏逻辑不变（仍 counted 口径）。
18. 权限点新增后需**重新登录**生效（JWT 内嵌 permissions 的过渡期约定，permissions.md 第 8 条）。

### 5. 权限与数据安全

| 项       | 选择                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能权限 | 新权限点 `glucose:print`（`PERMISSION.GLUCOSE_PRINT`），授予**医生/护士/护士长/系统管理员**四角色（同 `glucose:create` 档，裁定 Q5/A3）；设备管理员不授予（NONE 档无患者数据）   |
| 数据范围 | 两接口均 `@RequireDataScope(RESOURCE.PATIENT)` + service 内 `assertInScope`/`assertPatientReadable`；跨科室 → 30002                                                              |
| 脱敏字段 | 仅**姓名**新增明文出口（裁定 Q7）：独立接口 + 独立权限点 + 访问即留痕（`PATIENT_NAME_PLAIN_VIEW` 每次调用一条，含 DENIED）；身份证/手机号明文**仍无出口**                        |
| 加密字段 | `nameCipher` 经 `decryptField`（唯一实现 field-crypto）解密；失败返回 null 不抛错                                                                                                |
| 审计     | `GLUCOSE_PRINT` detail：printType/rangeFrom/rangeTo/count/requestId；`PATIENT_NAME_PLAIN_VIEW` detail：requestId（无患者敏感字段）；越权按 3xxxx 号段落 DENIED（既有拦截器口径） |

### 6. 前端交互

- 入口：三子 Tab 查询表单「重置」后（`GlucoseQueryForm` 可选 `onPrint`/`printDisabled`/`printLoading` props，一处改三页生效；`printLoading` 覆盖取数+实测分页到唤起打印对话框的等待）。
- 直接打印（2026-11-26 方案 B 裁定，预览 Modal 已删除，见变更记录 5）：点打印 → 挂载 `GlucosePrintRunner`（无头执行器）→ 文档渲染进 body 层 portal 容器 `.gc-print-headless`（屏上离屏 + visibility hidden 但保留布局，测量层照常实测分页）→ 分页就绪（报告/记录经 `PrintPagedDocument.onPagesReady`，趋势挂载即就绪）→ 自动留痕 + `window.print` → `onDone` 卸载并释放按钮 loading。浏览器自带打印对话框是唯一预览。
- 打印输出：`body.gc-printing` + `@media print` 隐藏 `#root`、`.gc-print-headless` 还原正常流并可见，仅输出打印页；`@page { size: A4 portrait; margin: 0 }`；页间 `break-after: page`（末张除外）。
- 数据流：挂载执行器 → 并行拉【接口 1 明文姓名 +（报告/记录）全量数据循环分页】→ 姓名落定后挂载文档（头部定稿再量分页）→ 测量分页 → 留痕 → 打印；趋势图由 Tab 在点击瞬间生成 chart 图片传入（无图则直接结束流程）。
- 患者信息数据源：详情页壳已有 `PatientDetail`，经 Outlet context 新增 `patientDetail` 字段下发（原 `patient` 摘要不动）。
- 公共层（`apps/web/src/components/print/`）：`printConstants.ts`（医院名/A4/边距/小标题）、`PrintSheet.tsx`（A4 页容器：头部+时间行+内容+页脚）、`PrintPatientInfo.tsx`、`paginate.ts`（装箱纯函数+mm/px 换算）、`usePrintPagination.ts`（测量 hook）。血糖专属文档组件在 `components/glucose/print/`。
- 按钮级权限：`hasPermission(PERMISSION.GLUCOSE_PRINT)` 不满足 → 不传 `onPrint` → 按钮不渲染。

### 7. 错误码与前端行为

| 场景                        | 错误码        | HTTP | 前端行为                                      |
| --------------------------- | ------------- | ---- | --------------------------------------------- |
| 打印留痕/明文接口参数不合法 | 10001         | 422  | 拦截器 toast（正常流程不触发）                |
| 无 `glucose:print` 权限点   | 30004         | 403  | toast + 重拉 profile（既有策略）；审计 DENIED |
| 跨科室 / NONE 档访问患者    | 30002 / 30006 | 403  | toast；审计 DENIED                            |
| 患者不存在/已归档           | 40001         | 404  | 拦截器 toast；执行器结束流程（无预览容器）    |

**不新增错误码**；明文解密失败不是错误（回 `name: null`，规则 15）。

### 8. 测试要求

- [x] 单测（server）：`namePlain`（成功/归档 40001/跨科室 30002/解密失败 null）；`print`（回显 printType/rangeFrom/rangeTo/count、患者校验）。→ `glucose-print.service.spec.ts` 10 用例
- [x] 单测（web，纯函数）：`packUnitsIntoPages` 装箱（恰好装满/超页/单元超整页）；报告打印行构建（勾选过滤、rowspan 组、空日期跳过、counted 计数）；时间范围行格式化（单侧空/双侧空/丢时分秒）。→ `paginate.spec.ts` 14 用例 + `buildPrintUnits.spec.ts` 8 用例
- [x] 手工验证：`dr.wang`（DOCTOR，重新登录后）三 Tab 打印预览与出纸；~~`device.admin` 无打印按钮且直连接口 → 30004 DENIED 落审计~~（seed 无 DEVICE_ADMIN 演示账号，见 §11 遗留）；审计表出现 `GLUCOSE_PRINT`（detail.printType/rangeFrom/rangeTo/count）与 `PATIENT_NAME_PLAIN_VIEW`。浏览器级验证见 §11

### 9. 非功能要求

| 项   | 要求                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 性能 | 全量拉取按 100/页循环；测量分页在 useLayoutEffect 一次完成，千行级 < 1s                                                                        |
| 内网 | 无公网资源；打印字体用系统默认                                                                                                                 |
| 等保 | 明文姓名访问即留痕；打印动作留痕（人/时间/范围/条数）；审计 append-only 不变                                                                   |
| 兼容 | 打印件固定白底（暗色模式不影响，执行器内容子树恒套亮色 ConfigProvider）；无屏幕预览（2026-11-26 删除）；大字号档不影响打印页（打印页固定字号） |

### 10. 验收标准

- [x] `pnpm lint && pnpm typecheck && pnpm test` 全绿；迁移 `prisma migrate deploy` 应用、`migrate status` up to date、无漂移
- [x] 三 Tab 打印按钮按权限显隐、空数据禁用；打印分页正确、每页头部一致、页脚计数符合口径（本页 X=counted、总计 Y=可见记录数）（浏览器级验证见 §11 变更记录 4/5；空数据禁用为纯 props 门控，随三 Tab 接线一并生效）
- [x] 打印输出仅含预览页（无侧边栏/按钮/Modal 壳），A4 纵向、边距 12mm（`@media print` + `@page` 规则经代码与 DOM 核验；出纸纸张以打印对话框 A4 默认为准）
- [x] 越权直连两接口 → 403 + DENIED 审计；正常打印 → `GLUCOSE_PRINT` 落表（printType/rangeFrom/rangeTo/count 齐全）（越权活链受演示账号限制，见 §11 遗留；30002/40001 由单测覆盖，DENIED 落表为既有拦截器口径）
- [x] 文档更新：本规格实施记录、ROADMAP P3-2 行补记

### 11. 实施记录与遗留项

**已实施**（2026-11-25，提交序列 `3bb2384` → `45a15a2`，本节回写为收尾提交）：

| 步  | 提交      | 内容                                                                                                                                                                                                                                                                                                             |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ①   | `3bb2384` | schema 追加两审计枚举 + 迁移 `20261125000000_add_print_audit_actions`（`ADD VALUE IF NOT EXISTS` 末尾追加）；`pnpm db:deploy` 已应用                                                                                                                                                                             |
| ②   | `be59069` | `PERMISSION.GLUCOSE_PRINT = 'glucose:print'`，授予 DOCTOR / NURSE / NURSE_HEAD / SYS_ADMIN                                                                                                                                                                                                                       |
| ③   | `e634f8f` | `GET /patients/:id/name-plain`、`POST /patients/:id/glucose/print`；审计 detail 白名单新增 `printType`；单测 `glucose-print.service.spec.ts` 10 用例                                                                                                                                                             |
| ④a  | `f9961dc` | 打印公共层 `apps/web/src/components/print/`（`printConstants` / `PrintSheet` / `PrintPatientInfo` / `paginate` / `usePrintPagination` / `PrintPagedDocument` / `printBrowser`）+ `global.css` 16 节；`paginate.spec.ts` 14 用例                                                                                  |
| ④b  | `45a15a2` | 血糖接线：`api/patient.ts` `fetchPatientNamePlain`、`api/glucose.ts` 全量拉取与留痕封装、`components/glucose/print/`（`buildPrintUnits` 8 用例 + 报告/记录/趋势三个文档组件 + `GlucosePrintModal`）、三 Tab 挂按钮与 Modal、`GlucoseQueryForm` 新增 `onPrint`/`printDisabled`、Outlet context 增 `patientDetail` |
| ⑤   | 本提交    | §8/§10 勾选回填、本节实施记录、ROADMAP P3-2 行补记                                                                                                                                                                                                                                                               |

**验证结果**：

- 静态：`pnpm lint`、三包 typecheck、`pnpm test` 全绿（shared 80；web 199，其中打印新增 22；server 全过）。
- 后端冒烟（dr.wang）：JWT 含 `glucose:print`；`name-plain` 返回明文（≠ 脱敏值）；`print` 201 回显 `{printType, rangeFrom, rangeTo, count}`；非法 `printType` → 422/10001；审计落表 `GLUCOSE_PRINT` SUCCESS（detail 齐全）/ FAILED（带 errorCode）与 `PATIENT_NAME_PLAIN_VIEW` SUCCESS。
- 浏览器级（playwright，dr.wang）：三 Tab「重置」后均出现打印按钮；报告预览 = 测量层 + 3 实页（A4 794×1123px、测量层屏外 -100000px），页脚「第1/3页本页1条 / 第2/3页本页9条 / 第3/3页本页3条，总计13条」（counted 口径，拒检/请假占行不计数），日期组 rowspan 不跨页，明文姓名「林涛」+ 11 项患者信息 + 时间范围行（空侧「-」）正确；记录预览单页 13 条 5 列同屏幕；趋势预览单页无页脚、图片占满内容宽（703px，dataURL 白底 pixelRatio 2）；Modal 内点「打印」→ `POST /patients/:id/glucose/print` 201 后触发 `window.print`（headless 空操作），`body.gc-printing` 挂载/移除生命周期正常。
- 打印输出形态：`@media print` 剥 `#root` 与 Modal 壳、`@page { size: A4 portrait; margin: 0 }`、页间 `break-after: page`（末张除外）经代码与 DOM 核验；以 Letter 纸出 PDF 产生的额外分页属纸张不匹配的预期产物（规格目标 A4，对话框默认即 A4）。

**遗留项 / 如实说明**：

- `device.admin` 越权活链（无按钮 + 直连 30004 DENIED）**未执行**：seed 无 DEVICE_ADMIN 演示账号，dr.chen 被首次改密（20005）阻挡无法取 token；该路径由单测（30002 跨科室 / 40001 归档）与既有权限守卫、审计拦截器基础设施覆盖。运维演示环境建档后可补验。
- 真实出纸（纸张/打印机）验证待人工现场执行；headless 仅验证到打印媒体形态与分页 DOM。
- 大标题动态化（接 SystemConfig）不在本期，常量集中于 `printConstants.ts` 一处。

**变更记录 1**（2026-11-25 需求人裁定，提交 `2565fd6`）：报告分页单元由「日期组（原子）」改为「单记录行」：

- 问题：日期组原子装箱时，装不下的下一日期组整体推去新页 → 首页常仅一组行、大量留白（林涛案例首页仅 2 行）。
- 改法：逐行装箱，装满判定 = DOM 实测高度自适应（不硬编码每页行数）；日期列按「页内连续同日期片段」合并 rowspan，同日期跨两页时两页各自合并自己的片段。
- 改动文件：`buildPrintUnits.ts`（行级单元，key=记录 id）、`PrintReportDocument.tsx`（页内片段合并）、`usePrintPagination.ts`（注释同步）、`buildPrintUnits.spec.ts`（行级断言 + 多日期摊平用例）；本规格规则 10 同步。
- 复验：lint/typecheck/test 全绿；浏览器实测林涛 页1 = 11-25×2 行 + 11-19×8 行（页脚 7 条）、页2 = 11-19×3 行 + 11-18×3 行（页脚 6 条），无大面积留白。与需求人举例（页1 装 9 行 11-19）差 1 行：第 9 行含强化标签行较高，实测高度自适应少装一行，属裁定口径内。

**变更记录 2**（2026-11-25 需求人裁定，提交 `16ae978`）：时间范围行改依数据派生 + 预览 Modal 加高加宽：

- 问题：时间范围行原取 appliedRange（查询条件），与打印文档实际数据范围可能不一致（如「本次住院」空侧）；预览 Modal 偏小看不全 A4 页。
- 改法：新增 `formatPrintRangeFromDates`，按文档数据的最早/最晚测量日期格式化（报告 = `rows[].date`、记录 = `items[].measuredAt`、趋势 = Tab 传入 `trendDates`）；Modal 加宽加高。规则 3 同步。Modal 相关改动随变更记录 5 删除 Modal 后失效，仅留档。

**变更记录 3**（2026-11-25 需求人裁定，提交 `40d8482`）：预览 Modal 上边距 antd 默认 100px → 20px。随变更记录 5 删除 Modal 后失效，仅留档。

**变更记录 4**（2026-11-26 需求人裁定，提交 `92d1bac`）：报告打印改**对齐子行**模型 + 页脚总计/审计改**可见记录数**：

- 反馈一：行级模型（变更记录 1）下一条记录独占一行，同日多时段不横向对齐且行数膨胀（11-25 五条记录 = 5 行）。裁定：同日行数 = 该日单时段最大记录数，各时段第 i 条（检测时间升序）落第 i 行、缺位留空；分页单元 = 子行（key=`日期#序号`）。规则 6/10 同步。
- 反馈二：页脚「总计」与审计 `count` 原 = `stats.total`（counted 口径，林涛案例 16），与表格可见记录 19 条（含 2 拒检 1 请假）对不上。裁定：总计/审计改**可见记录数**（19），「本页 X 条」沿用 counted 口径（16）、文案不变；屏幕统计栏不动；trend 打印图表无记录列表，审计沿用 `stats.total`。规则 4/17 同步。
- 口径实证：该范围 19 条可见 = counted 16（0×2 + 1×9 + 2×2 + 3Low×2 + 4High×1，Low/High 为标签型但 counted=true）+ 不计入 3（5 拒检×2 + 7 请假×1）；服务端 `stats.total=16` 无误，差异源于「可见但不计入」记录。
- 改动文件：`buildPrintUnits.ts`（子行模型 + `countVisibleReportRecords`）、`PrintReportDocument.tsx`（子行渲染）、`PrintPagedDocument.tsx`（单元加 `visible`、总计内部求和、移除 `totalCount` prop）、`PrintRecordDocument.tsx`（`visible` 恒 1）、`GlucosePrintModal.tsx`（审计口径；后被变更记录 5 的执行器取代）、`paginate.ts`/`usePrintPagination.ts`/`api/glucose.ts`/服务端 `glucose.service.ts`（注释同步）、`buildPrintUnits.spec.ts`（重写为子行对齐 + 可见记录数用例）。
- 复验：三件套全绿；实测 19 条记录压成 9 子行（11-25 = 2 子行 rowspan=2、行1 三值行2 两值），报告/记录页脚均「第1/1页，本页16条数据，总计19条数据」，留痕 `count=19`，截图目视对齐正确。

**变更记录 5**（2026-11-26 需求人裁定方案 B，提交 `0f06b3b`）：删除预览 Modal，打印按钮**直接唤起浏览器打印**：

- 裁定：不要中间预览确认步骤，点打印直接 `window.print`（浏览器自带打印对话框成为唯一预览）；预览能力完全删除（方案 B，非保留代码的方案 A）。
- 改法：新增无头执行器 `GlucosePrintRunner.tsx`——挂载即并行拉【明文姓名 + 打印数据】，文档渲染进 body 层 portal 隐藏容器 `.gc-print-headless`（屏上离屏 + visibility hidden 但保留布局，测量层照常实测分页），姓名落定后挂载文档（头部定稿再量分页）；报告/记录经 `PrintPagedDocument` 新增 `onPagesReady`（分页产出回调）就绪即打、趋势挂载即打；先留痕（裁定 Q11）成功后 `triggerBrowserPrint()`，`onDone` 卸载。删除 `GlucosePrintModal.tsx`；`global.css` 删 `.gc-print-preview` 与 ant-modal 打印剥壳清单、增 `.gc-print-headless`（print 媒体 static/visible）；`GlucoseQueryForm` 增 `printLoading`；三 Tab `printOpen→printRunning` 直接挂载执行器。
- 复验：三件套全绿（web 20 测试文件）；playwright 三 Tab 实测点打印无 Modal 直达 `window.print`，留痕 report `count=19`、record `count=19`、trend `count=16`；打印时点无头容器含 1 张真实 sheet（趋势含图表 img）；print 媒体级联核验（容器 visible/static、`#root` none、测量层 none、末页 `break-after:auto`）；流程结束容器卸载、按钮 loading 释放。
- 注意：headless 下 `window.print` 为 no-op，真实出纸效果需人工自测（§11 遗留项仍然成立）。
