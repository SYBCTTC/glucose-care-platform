# 患者详情页（基本信息摘要 + 血糖数据占位 + 列表/卡片入口）

> 按 `docs/FEATURE-SPEC-TEMPLATE.md` 归档。状态：✅ **已实现**（2026-11-18 落地，需求人逐条裁定后实施）
>
> 本期为**详情页框架 + 基本信息摘要 + 入口接线**；血糖报告/记录/趋势图、基本信息 Tab、出入院记录 Tab
> 均为纯前端 `Empty` 占位（不发请求），待「血糖查询/图表」（见 `docs/ROADMAP.md` 待立项）与「患者出院」立项后填充。
>
> 变更范围：**1 处后端出参补充（`nurseName`，无 schema 迁移）** + **前端新页面/路由/入口**。
> 不含鉴权、权限过滤、审计逻辑改动（详情接口沿用既有 `PATIENT_VIEW` 守卫与审计）。

## 0. 元信息

| 项 | 内容 |
|---|---|
| 阶段号 | P2-2 患者详情（`docs/ROADMAP.md`，由「⚠️ 后端完成」推进为「⚠️ 部分完成」） |
| 模块 | 前端新增 `pages/inpatient/patient-detail`；改造 `pages/inpatient/patients`、`pages/inpatient/virtual-ward`；后端 `patient.service.ts` 详情出参 |
| 优先级 | P1 |
| 依赖 | 患者列表/卡片（P2-1/P2-9）、`GET /patients/:id`（已有）、`GlucoseCreateModal`（P2-10）、数据权限 `scope.util.ts` |
| 需求人 | 产品（2026-11 提出并逐条确认 A/B/C/D 各组决策） |

## 0.1 决策记录（需求人裁定）

| # | 决策 |
|---|---|
| A1 | 后端详情接口补 `nurseName`（责任护士姓名）——**本期唯一后端改动** |
| A2 | 身份证 / 手机号显示**脱敏值**（`idCardMasked` / `phoneMasked`），不回显明文 |
| A3 | 详情页调 `GET /patients/:id`，后端**每次访问写一条 `PATIENT_VIEW` 审计**（访问即留痕） |
| A4 | 血糖报告 / 血糖记录 / 趋势图 + 基本信息 Tab + 出入院记录 Tab：**纯前端 `Empty` 占位，不发请求** |
| B1 | 路由 `/inpatient/patients/:id` |
| B2 | 详情页**保留在 `BasicLayout` 内**（带侧边栏/顶栏，非全屏独立布局） |
| B3 | 前端路由守卫 **`PATIENT_VIEW`**（与后端详情接口权限点一致） |
| C1 | **方式B**：返回时精确还原来源页 Tab/筛选/视图/页码，状态写入**浏览器历史条目**（`history.state.usr`）而非 URL；卡片滚动位置回到顶部；无可靠历史时兜底跳 `/inpatient/patients` |
| C2 | 卡片**整卡可点**进详情；卡内「更多」操作区**阻止冒泡** |
| C3 | 列表**仅姓名可点**进详情（整行不可点，避免与操作列/文本选中冲突） |
| C4 | **移除** `PatientMoreActions` 的「查看详情」菜单项（入口已由姓名/整卡承担）；三项操作均无权限时菜单为空 → 返回 `null` |
| D1 | 基本信息字段顺序：姓名/性别/年龄**仅值**在前，其余「label：值」——入院时间、手机号、身份证、状态、住院号、科室、责任医生、责任护士 |
| D2 | 姓名**加粗放大、不带 label**（页面主体标识） |
| D3 | 「添加血糖」按钮位于基本信息区**右下角** |
| D4 | 顶部「基本信息区」是**始终可见的摘要**，与主 Tab 里的「基本信息」页是两回事 |
| D5 | 「添加血糖」复用 `GlucoseCreateModal`，受 `GLUCOSE_CREATE` 权限控制，**出院患者隐藏** |
| 默认1 | 详情页侧边栏**高亮父级「患者管理」**（详情路由本身不进菜单） |
| 默认2 | 403（越权）/ 404（不存在）显示**错误占位页**（`Result`），带返回按钮 |

## 1. 目标与用户故事

作为 **医护人员**，我要 **从患者列表/卡片点进患者详情页**，以便 **集中查看该患者的基本信息摘要，并（后续）查看血糖数据**。

**本次做**：
- ① 详情页框架（返回栏 / 基本信息摘要区 / Tabs 区）；
- ② 基本信息摘要（脱敏展示，含责任护士）；
- ③ 列表姓名、卡片整卡两个入口接线；移除冗余的「查看详情」菜单项；
- ④ C1 方式B 的「返回还原来源页状态」；
- ⑤ 住院患者「添加血糖」入口（复用既有弹窗）；
- ⑥ 后端详情出参补 `nurseName`。

**本次不做**（明确排除）：
- 血糖报告 / 血糖记录 / 趋势图的**真实实现**（占位，依赖「血糖查询/图表」立项）；
- 基本信息 Tab、出入院记录 Tab 的**真实实现**（占位，依赖「患者出院」立项）；
- 身份证/手机号**明文回显**（按 `AGENTS.md` §5.3 需独立规格 + 访问留痕）；
- 详情页内的患者编辑、设备绑定、导出等。

## 2. 数据模型变更

**无 Prisma schema 变更、无迁移。**

`nurseName` 不是新库字段：`Patient` 已有 `nurseId` 外键与 `nurse` 关系（`User`）。
详情出参在 `patient.service.ts` 的 `detail()` 里**组装**：`PATIENT_DETAIL_SELECT` 增加
`nurse: { select: { name: true } }`，返回 `nurseName: row.nurse?.name ?? null`。

## 3. 接口契约

**复用既有接口，不新增路由。**

| # | 方法 | 路径 | 权限点 | 数据范围 | 审计 | 说明 |
|---|---|---|---|---|---|---|
| 1 | GET | `/patients/:id` | `patient:view`（`PATIENT_VIEW`） | `RESOURCE.PATIENT` | `PATIENT_VIEW` | 患者详情，每次访问留痕（A3） |

### 3.1 共享契约变更（`packages/shared`）

| 变更 | 位置 |
|---|---|
| `PatientDetail` 接口新增 `nurseName: string \| null` | `packages/shared/src/patient/schema.ts` |

> 属**类型-only** 变更（接口字段，运行时无符号），不会触发 `shared-package.md` 所述的「新增运行时导出未同步 → 白屏」事故；
> 但仍按流程 `pnpm --filter @gc/shared build && pnpm sync:shared` 刷新 dist 副本（`pnpm build` / `dev:up` 已含此步）。
> 列表接口（`PatientListItem`）**不返回** `nurseName`，仅详情返回。

响应（`PatientDetail`，节选新增字段）：

```ts
interface PatientDetail extends PatientListItem {
  // ...既有字段（idCardMasked / phoneMasked / birthDate / nurseId / diabetesType / hba1c / devices 等）
  nurseName: string | null;   // A1 新增：责任护士姓名，无则 null
}
```

## 4. 业务规则与校验

1. **详情数据范围**：沿用后端 `@RequireDataScope(RESOURCE.PATIENT)`。跨科室访问 → `30002`（403），
   `NONE` 档（设备管理员）→ `30006`（403）。前端**不做**患者可见性判断，越权拦截全在后端。
2. **脱敏**：身份证/手机号一律展示 `*Masked`（A2），详情页**不调用**任何明文解密接口。
3. **添加血糖门控**（D5）：仅 `status === INPATIENT` 且具备 `GLUCOSE_CREATE` 权限时展示按钮；出院患者隐藏。
   录入成功由 `GlucoseCreateModal` 内部提示；详情页血糖区为占位、基本信息不含血糖，**录入成功无需刷新本页**。
4. **返回还原**（C1 方式B）：
   - 来源页（患者管理 / 虚拟病区）在状态变化时把 Tab/筛选/视图/页码序列化写入**当前历史条目**的 `history.state.usr`
     （`list-nav-state.ts` 的 `writeListSnapshot`，保留 React Router 的 `idx`/`key`，不改 URL、不触发重渲染）；
   - 进详情时 `navigate(path, { state: { from: location.pathname } })` 压入新条目；
   - 详情页返回：有 `location.state.from` → `navigate(-1)` 回来源条目，来源页重挂载时 `readListSnapshot` 还原；
     无 `from`（直接访问 URL / 新标签打开）→ 兜底 `navigate('/inpatient/patients', { replace: true })`；
   - **Dayjs 不能进 `history.state`**（结构化克隆丢原型方法），日期区间序列化为 ISO 字符串（`serializeRange`/`deserializeRange`）；
   - 还原时校验快照里的科室/医生是否仍在当前可见选项内（数据范围可能已变），失效则回退默认；
   - 卡片滚动位置**不还原**，回到顶部（C1）；
   - 快照带版本 `__v` 与页面标识 `__page`，版本不符/跨页/损坏一律静默回退默认状态，**绝不阻断列表**。

## 5. 权限与数据安全

| 项 | 内容 |
|---|---|
| 功能权限 | 详情路由守卫 `PATIENT_VIEW`（B3）；「添加血糖」按钮 `GLUCOSE_CREATE`（D5） |
| 数据范围 | 后端 `@RequireDataScope(RESOURCE.PATIENT)` 强制过滤；前端不复制权限逻辑 |
| 脱敏字段 | 姓名/身份证/手机号均展示 `*Masked`（A2）；脱敏唯一实现 `@gc/shared` 的 `mask` |
| 加密字段 | 无新增；详情接口 select **不含**任何 `*Cipher` 列 |
| 审计 | 每次访问详情由后端写 `PATIENT_VIEW`（A3）；越权（`3xxxx`）由拦截器自动记 `DENIED`。**前端无审计改动** |
| 明文回显 | **未实现**（本次不做）；接入时须同时加「访问即留痕」审计，属独立规格 |

## 6. 前端交互

### 6.1 路由与菜单

- `routes.tsx` 新增 `{ path: '/inpatient/patients/:id', permissions: [PATIENT_VIEW], element: <PatientDetailPage/> }`，
  **无 `label`/`icon`/`menuGroup`** → `buildMenuTree` 跳过，不进菜单；React Router 按特异性排序，与 `/inpatient/patients` 不冲突。
- `BasicLayout.tsx`：`selectedKeys` 对 `/inpatient/patients/` 前缀归一到 `/inpatient/patients`，详情页**高亮「患者管理」**（默认1）。

### 6.2 详情页结构（`pages/inpatient/patient-detail/`）

- `index.tsx`：页面壳。`Card`（`height: calc(100vh - 88px)`）内含返回栏 / 基本信息区 / Tabs 区；
  加载中 `Spin`；无数据时 `Result`（`forbidden` → `403`「无权查看该患者」，否则 `error`「无法加载患者详情」，默认2）；
  返回栏与「添加血糖」弹窗（`GlucoseCreateModal`）。
- `usePatientDetail.ts`：拉取 `GET /patients/:id`，`cancelled` 标志防竞态与卸载后 setState；
  `forbidden = error instanceof ApiError && error.status === 403`。
- `PatientBasicInfo.tsx`：顶部基本信息摘要（D1/D2/D4）。`flex-wrap` 横向流动；姓名（`fontSizeLG`/600）/性别/年龄仅值，
  其余「label：值」；入院时间、年龄用 `gc-num` 等宽数字；「添加血糖」按钮 `marginLeft: 'auto'` 贴右下角（D3）。
  颜色取 `theme.useToken()`、间距取 `layoutSize`、边框宽度取 `token.lineWidth`，**无硬编码色值/魔法数字**。
- `PatientDetailTabs.tsx`：主 Tabs（`underline`：血糖数据 / 基本信息 / 出入院记录）+ 子 Tabs（`background`：血糖报告 / 记录 / 趋势图），
  默认「血糖数据 → 血糖报告」。
  ⚠️ **2026-11-19 起（`docs/specs/glucose-report.md` R10）两层 Tab 全部由 URL 驱动，不再 `useState`**：
  5 个内容页（`basic` / `admission` / `glucose/report` / `glucose/record` / `glucose/trend`）各为独立子路由，刷新停留；
  内容区经 `<Outlet context={{ glucoseVersion }}/>` 渲染；Tab 切换统一走 `useDetailTabNavigate()`
  （`replace: true` + `state` 透传，防污染历史与丢返回来源）；路径常量唯一来源 `detail-tabs.ts`。
  血糖报告子页已是真实数据，记录 / 趋势图仍 `DetailPlaceholder`「（建设中）」占位（A4 剩余部分）。

### 6.3 入口接线（C2/C3/C4）

- `PatientTable.tsx`：`TableBaseProps` 增 `onViewDetail`；**姓名列**渲染为 `Button type="link"`，点击进详情（C3）。
- `PatientCardGrid.tsx`：`CardBaseProps` 增 `onViewDetail`；整卡 `hoverable` + `onClick` 进详情，
  操作区包一层 `onClick={e => e.stopPropagation()}` 防误触（C2）。
- `PatientMoreActions.tsx`：移除 `detail` 菜单项与分隔线（C4）；编辑/血糖/加入病区三项均无权限时 `items.length === 0` → 返回 `null`。
- `patients/index.tsx`、`virtual-ward/index.tsx`：新增 `goDetail(patient)`，传给表格与卡片网格。
  ⚠️ **2026-11-19 起（`docs/specs/glucose-report.md` D10）跳转目标由裸详情 URL 改为直达默认子路由**：
  `navigate(`${DETAIL_PATH_PREFIX}${patient.id}/${DETAIL_DEFAULT_TAB}`, { state: { from: location.pathname } })`
  （即 `.../glucose/report`），不经过 index 重定向、不产生额外历史栈条目；`state.from` 保留供返回还原（C1）。

## 7. 错误码与前端行为

| 场景 | 码 | HTTP | 前端行为 |
|---|---|---|---|
| 跨科室访问患者 | `30002` | 403 | 详情页 `Result status="403"`「无权查看该患者」+ 返回按钮 |
| `NONE` 档（设备管理员） | `30006` | 403 | 同上（`forbidden` 分支） |
| 患者不存在/已归档 | `40001` | 404 | 详情页 `Result status="error"`「无法加载患者详情」+ 返回按钮 |
| 缺 `patient:view` | `30004` | 403 | 路由守卫 `PermissionRoute` 渲染 403 页（进不到详情页） |

> 详情页错误占位区分 403 与其它：`ApiError.status === 403` → `forbidden`，文案「无权查看」；其余 → 「无法加载」。

## 8. 测试要求（已落地）

- [x] `patient-detail/PatientDetail.spec.tsx`（`renderToStaticMarkup`，node 环境无 jsdom）：
  基本信息区字段/脱敏值/责任护士、添加血糖按钮门控（住院+权限展示、出院/无权限隐藏）、`nurseName=null` 边界；
  2026-11-19 扩充：双层 Tab 由 URL 派生（`MemoryRouter`）、`DetailPlaceholder` 占位、
  壳组件 loading/403/失败分支不渲染 `<Outlet/>` 内容（mock `usePatientDetail` + 哨兵子路由，风险 7）——共 15 用例。
  Tab 派生/跳转约束纯函数另见 `detail-tabs.spec.ts`（13 用例）
- [x] `patients/PatientMoreActions.spec.tsx`：C4 空菜单守卫（三项无权限 → 返回 null）、触发按钮渲染（3 用例）
- [x] `inpatient/list-nav-state.spec.ts`：C1 快照序列化/反序列化、版本与跨页守卫、读写异常降级（15 用例）
- [x] `patient.service.spec.ts`：`detail()` 返回 `nurseName`（有护士 / 无护士 null）回归
- [x] `routes.spec.tsx`：菜单结构复核仍绿（详情路由不进菜单）
- [ ] 手工 e2e（密码 `Gc@2026pass`）：
  - `dr.wang`（内分泌科医生）：列表点姓名 / 卡片整卡 → 进详情，基本信息与脱敏值正确，责任护士展示
  - 改 Tab/筛选/页码 → 进详情 → 返回：来源页状态精确还原，卡片回顶部
  - 直接访问 `/inpatient/patients/<uuid>`（无历史）→ 返回兜底跳患者管理
  - `dr.chen`（心内科）访问内分泌科患者详情 URL → 403 占位页，且后端落 `DENIED` 审计
  - 住院患者「添加血糖」可点并成功；出院患者无此按钮

## 9. 非功能要求

| 项 | 要求 |
|---|---|
| 性能 | 详情单条查询，无列表；基本信息区纯展示 |
| 内网 | 不引入新依赖，不引用公网资源 |
| 等保 | 每次访问详情落 `PATIENT_VIEW` 审计（含越权 `DENIED`）；只出脱敏值，不出明文/密文 |
| 兼容 | 复用 `layoutSize`/token，继承大字号、明暗模式；返回栏 `gc-no-print` 打印隐藏；数值/时间 `gc-num` 等宽 |

## 10. 验收标准

- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿（test 302：shared 59 / server 203 / web 40）
- [x] 详情接口符合契约（新增 `nurseName`），错误码符合 §7
- [x] 越权被拒（前端 403 占位 + 后端 `DENIED` 审计）
- [x] 前端路由守卫（`PATIENT_VIEW`）与按钮权限（`GLUCOSE_CREATE`）生效
- [x] 文档更新：本规格 + `ROADMAP.md` P2-2 推进
- [ ] 手工 e2e（见 §8）待联调环境执行

## 11. 待确认项

无。A/B/C/D 各组决策与默认值均已由需求人裁定（见 §0.1）。
