# 交接文档：住院管理 - 患者管理 - 住院患者卡片视图

> 日期：2026-10-23  
> 范围：`住院管理 / 患者管理 / 住院患者`  
> 状态：卡片视图已完成并接入，列表视图保留；出院患者未改动。  
> 本文只做交接说明，不包含代码改动。

---

## 0. 一句话结论

住院患者已支持“卡片 / 列表”双视图，默认卡片。卡片使用固定高度内容区内部滚动、滚到底部自动加载下一批；列表仍使用原表格分页。筛选区、C-TABS 固定，卡片/列表紧贴 Tabs 下方。

当前剩余事项主要是：

1. C-TABS 白字与边框色的设计规范确认。
2. “更多”菜单仍是占位，需要等后续功能规格。
3. 浏览器视觉验收尚未做截图级确认。

---

## 1. 新窗口阅读顺序

1. 仓库根 `AGENTS.md`：项目总纲、技术栈、分层、合规要求。
2. `.codebuddy/rules/` 下与本次相关的规则：
   - `ai-collaboration.md`
   - `ui-design-tokens.md`
   - `permissions.md`（涉及患者数据查询时）
3. 本文档。
4. 关键代码文件（见第 5 节）。

> 重要：仓库里原有的 `docs/HANDOFF.md` 状态描述已经过时。它仍写着“血糖业务已整体删除”，但当前代码已经重新加入了最小 `GlucoseRecord` 模型，用于住院患者列表展示最近一次血糖。新窗口不要直接按旧 HANDOFF 判断现状，以本文件和真实代码为准。

---

## 2. 当前项目进度

### 2.1 已完成

- 登录与权限骨架可用。
- 患者管理页已接入：
  - 住院患者列表接口。
  - 出院患者列表接口。
  - 科室、责任医生、住院号、姓名、床号、入院/出院日期筛选。
  - 表格分页，每页 10/20/50/100 条。
- 住院患者卡片视图已完成：
  - C-TABS 切换“卡片 / 列表”，默认卡片。
  - 卡片响应式多列铺满。
  - 卡片区域内部滚动，滚到底部自动加载。
  - 卡片模式不分页；列表模式保留分页。
  - 点击查询、重置、切换住院/出院、切换卡片/列表都会重新从第一页加载；单独修改筛选条件后需点击“查询”才生效。
- 最近血糖展示：
  - 后端返回每位患者最近一条血糖值、时段、测量时间。
  - 前端在表格和卡片中展示。
- 演示数据：
  - 患者 1000 位。
  - 住院 700 位，出院 300 位。
  - 血糖记录 3999 条，每位患者 3~5 条。

### 2.2 未完成 / 待确认

- “更多”菜单中的功能仍是占位：
  - 编辑患者信息
  - 添加血糖
  - 加入虚拟病区
  - 查看详情
  - 点击后提示“暂未开发”。
- C-TABS 的视觉规则存在两处与项目设计规范冲突，需要人工确认（见第 8 节）。
- 尚未做浏览器截图级视觉验收，尤其是：
  - 1366×768 分辨率。
  - 暗色模式。
  - 卡片滚动到底部加载。
  - Tabs 边框与内容紧贴效果。

---

## 3. 数据与权限现状

### 3.1 本地演示数据快照

> 以下为 2026-10-23 本地 `pnpm db:seed` 后的快照，重跑 seed 后数字可能变化。

| 指标 | 数量 |
|---|---:|
| 患者总数 | 1000 |
| 住院患者 | 700 |
| 出院患者 | 300 |
| 血糖记录 | 3999 |

### 3.2 数据范围差异是正常现象

- `sys.admin`：全院范围，住院 700 / 出院 300。
- `dr.wang`：受本科室数据范围限制，只能看到内分泌科患者，住院 560 / 出院 240。

这不是接口少返回，而是 `buildScopeWhere(user, RESOURCE.PATIENT)` 的数据权限过滤结果。排查数量不一致时先确认账号的数据范围。

### 3.3 接口

| 接口 | 权限点 | 说明 |
|---|---|---|
| `GET /api/patients/inpatient` | `PATIENT_INPATIENT_VIEW` | 住院患者分页列表 |
| `GET /api/patients/discharged` | `PATIENT_DISCHARGED_VIEW` | 出院患者分页列表 |

共同查询参数：

- `departmentId`
- `doctorId`
- `patientNo`
- `name`：姓名密文确定性等值匹配，不支持模糊。
- `bedNo`
- `admissionFrom` / `admissionTo`
- `dischargeFrom` / `dischargeTo`
- `page` / `pageSize`，`pageSize` 最大 100。

前端实际拿到的主要结构：

```ts
{
  items: PatientListItem[];
  total: number;
  page: number;
  pageSize: number;
}
```

`PatientListItem` 与卡片相关的字段：

- `id`
- `nameMasked`
- `patientNo`
- `gender`
- `bedNo`
- `departmentId` / `departmentName`
- `doctorId` / `doctorName`
- `status`
- `admissionAt` / `dischargeAt`
- `age`
- `lastGlucoseValue`
- `lastGlucoseMealContext`
- `lastGlucoseMeasuredAt`

安全约定：列表只返回脱敏姓名 `nameMasked`，不返回姓名、身份证、手机号密文或明文。

---

## 4. 关键实现决策

### 4.1 卡片视图只作用于住院患者

- `index.tsx` 中只有 `status === INPATIENT` 才渲染 C-TABS。
- 出院患者仍是原表格，没有卡片视图。
- 切换住院/出院时，若当前是卡片模式会走卡片查询；切到出院会走列表查询。

### 4.2 卡片模式采用内部滚动

- 页面 Card 在卡片模式下固定高度：`calc(100vh - 88px)`。
- 高度依据：顶栏 56px + 内容区上下 margin 各 16px。
- Card body 使用 flex 纵向布局，`overflow: hidden`。
- 筛选区、C-TABS 固定在滚动容器之外。
- 真正滚动的是 `PatientCardGrid` 的卡片区域。

### 4.3 卡片/列表与 Tabs 的间距

- 住院患者：卡片/列表容器 `marginTop: 0`，紧贴 C-TABS 下边框。
- 出院患者：没有 C-TABS，仍保留原来的 `16px` 上间距。
- C-TABS 外层仍有 `16px` 上间距，与筛选区隔开。

### 4.4 卡片滚动加载

- 每批 20 条，调用现有 `page` / `pageSize` 接口。
- 使用 `IntersectionObserver` 监听卡片滚动容器底部哨兵。
- 追加数据时按患者 `id` 去重。
- 累计到 `total` 后停止。
- 加载失败时保留已加载卡片，显示错误提示和“重试”按钮。
- 卡片模式不分页；列表模式继续使用表格分页。

### 4.5 分页稳定排序

后端排序增加了 `id` 作为第二排序字段：

- 住院：`admissionAt DESC, id ASC`
- 出院：`dischargeAt DESC, id ASC`

原因：同一入院时间患者很多，只按时间排序时 offset 分页可能重复或漏人。

---

## 5. 关键文件

### 5.1 前端

| 文件 | 作用 |
|---|---|
| `apps/web/src/pages/inpatient/patients/index.tsx` | 页面组装；卡片模式固定高度；仅住院患者显示 C-TABS；卡片/列表紧贴 Tabs |
| `apps/web/src/pages/inpatient/patients/usePatientQuery.ts` | 列表查询与卡片增量查询状态；筛选、状态、视图切换、重试 |
| `apps/web/src/pages/inpatient/patients/PatientCardGrid.tsx` | 卡片网格、内部滚动、IntersectionObserver 触底加载 |
| `apps/web/src/pages/inpatient/patients/PatientMoreActions.tsx` | “更多”菜单，列表和卡片共用 |
| `apps/web/src/pages/inpatient/patients/patient-format.ts` | 年龄、性别、住院天数、血糖时间等格式化 |
| `apps/web/src/pages/inpatient/patients/PatientTable.tsx` | 列表表格与分页 |
| `apps/web/src/pages/inpatient/patients/PatientFilter.tsx` | 筛选区，现有实现 |
| `apps/web/src/pages/inpatient/patients/PatientToolbar.tsx` | 住院/出院 Tab 与新增按钮，现有实现 |
| `apps/web/src/components/common/Tabs.tsx` | C-TABS，支持 `underline` / `background` 两种样式 |
| `apps/web/src/api/patient.ts` | 患者列表接口封装 |

### 5.2 共享契约

| 文件 | 作用 |
|---|---|
| `packages/shared/src/patient/schema.ts` | 患者状态、筛选参数、`PatientListItem` 契约；含年龄和最近血糖字段 |

### 5.3 后端与数据

| 文件 | 作用 |
|---|---|
| `apps/server/src/modules/patient/patient.service.ts` | 数据权限过滤、分页、年龄计算、最近血糖关联、稳定排序 |
| `apps/server/prisma/schema.prisma` | `Patient`、最小 `GlucoseRecord` 模型 |
| `apps/server/prisma/migrations/20261023120000_add_glucose_record/migration.sql` | 新增 `GlucoseRecord` 表 |
| `apps/server/prisma/seed.ts` | 1000 位患者与血糖记录演示数据 |

### 5.4 `GlucoseRecord` 当前定位

当前只保留住院患者列表展示“最近一次血糖”所需的最小模型：

- `patientId`
- `valueMmolL`，`Decimal(4,1)`，统一 mmol/L
- `mealContext`
- `measuredAt`，`timestamptz`
- `createdAt`
- 索引：`(patientId, measuredAt DESC)`
- 患者删除时级联删除

注意：这不是完整的血糖业务模块，不要据此恢复旧的血糖录入、统计、导出等页面。

---

## 6. 卡片内容与展示规则

| 内容 | 规则 |
|---|---|
| 床号 | 加粗；缺失显示“暂无床号” |
| 更多 | 与床号同一行，左右分布；复用列表“更多操作”菜单 |
| 姓名、性别、年龄 | 同一行；姓名/性别靠左，间隔 30px；年龄靠右；缺失显示 `-` |
| 住院号 | 独立一行，带 label；缺失显示 `-` |
| 住院天数 | 独立一行，带 label；缺失显示 `-` |
| 科室、责任医生 | 同一行，左右分布；缺失显示 `-` |
| 最近血糖时间 | 独立一行，格式 `MM-DD HH:mm` |
| 血糖值、时段 | 同一行，左右分布；值显示 `x.x mmol/L`；时段用共享字典中文 |

卡片网格：

```text
repeat(auto-fill, minmax(280px, 1fr))
```

即随内容宽度自动调整列数并铺满。

---

## 7. C-TABS 当前样式

组件：`apps/web/src/components/common/Tabs.tsx`

患者页使用：

```tsx
<Tabs
  items={VIEW_TABS}
  value={query.viewMode}
  onChange={...}
  variant="background"
/>
```

当前 `background` 模式：

- 激活项背景：`token.colorPrimary`。
- 激活项文字：`token.colorTextLightSolid`（白色）。
- 非激活项背景：透明，文字使用普通文本色。
- 圆角：`0`。
- Tab 之间间距：`0`。
- 外边框：`1px solid #cdcdcd`。
- 容器宽度：`fit-content`，边框只包裹两个 Tab，不横向铺满。
- `underline` 模式保持原样。

---

## 8. 已知偏差与风险

### 8.1 白字与项目规范冲突（需确认）

项目 `ui-design-tokens.md` 第 4 条明确要求：

> 主色 `#6ad3d8` 上禁止用白字，对比度仅 1.76:1；主按钮/主色标签文字统一用 `brandColor.primaryInk`（`#08333a`）。

本次按用户明确要求使用了白字。这是对现有设计规则的覆盖，后续需要设计/无障碍负责人确认。

如果要求合规，应把激活项文字改为 `brandColor.primaryInk`。

### 8.2 边框色未纳入设计令牌

`#cdcdcd` 是需求指定的精确色值，但当前不在 `tokens.ts` 中，因此直接写在 `Tabs.tsx` 里。

项目规范要求组件内不出现硬编码色值。若要长期保留，建议：

1. 在 `docs/UI-DESIGN-TOKENS.md` 登记中性边框色。
2. 在 `tokens.ts` 增加对应令牌。
3. `Tabs.tsx` 改用令牌。

### 8.3 “更多”菜单仍是占位

`PatientMoreActions.tsx` 中四个菜单项目前只弹“暂未开发”提示，没有真实业务逻辑。

### 8.4 卡片滚动加载仍是 offset 分页

当前使用 `page` / `pageSize` 增量加载，并加了 `id` 稳定排序。正常演示数据下不会重复/漏人，但极端情况下如果用户滚动期间有新患者插入，仍可能出现页漂移。

如果未来要求强一致，需要后端提供 cursor / keyset 分页。

### 8.5 尚未做浏览器视觉验收

代码与接口验证通过，但没有截图级确认以下效果：

- Tabs 边框是否紧贴卡片/表格。
- 卡片区域滚动条是否影响布局。
- 暗色模式下边框色 `#cdcdcd` 是否合适。
- 1366×768 下卡片列数与内容是否溢出。

### 8.6 旧交接文档已过时

`docs/HANDOFF.md` 仍描述“血糖业务已整体删除”，与当前代码不一致。新窗口以本文件为准。

---

## 9. 验证记录

### 9.1 已完成命令

卡片功能完成时，以下命令通过：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @gc/web build
```

最近两次 C-TABS 样式微调后，已通过：

```bash
pnpm --filter @gc/web typecheck
pnpm lint
```

说明：C-TABS 最近改动是纯样式，未重新跑 `test` 和 `build`；如进入提交流程，建议补跑全量门禁。

### 9.2 接口与数据验证

- `sys.admin`：住院 700 / 出院 300，年龄和最近血糖字段正常。
- `dr.wang`：住院 560 / 出院 240，符合本科室数据范围。
- 卡片滚动加载按 28 页、每页 20 条累计，`dr.wang` 最终 560 条，按 `id` 去重后仍为 560，无重复、无遗漏。

### 9.3 前端开发服务

- 后端已重启，前端 Vite 已热更新。
- 新窗口不要假设服务仍在运行，先检查 3000 / 5173 端口或重新启动。

---

## 10. 新窗口启动与验收步骤

```bash
cd d:/Codes/AIProjects
pnpm install
pnpm dev
```

如果本地数据库没有数据：

```bash
pnpm db:generate
pnpm db:deploy
pnpm db:seed
```

验收路径：

1. 登录。
2. 进入“住院管理 - 患者管理 - 住院患者”。
3. 确认默认是“卡片”。
4. 确认筛选区、C-TABS 固定，只有卡片区域滚动。
5. 滚动到底部，确认自动加载下一批，且无重复患者。
6. 切换“列表”，确认表格和分页正常。
7. 切换“出院患者”，确认仍是原表格，没有卡片/列表 Tabs。
8. 检查卡片字段缺失时是否显示 `-` / “暂无床号”。
9. 检查“更多”菜单是否正常弹出占位提示。

---

## 11. 建议下一步

1. 先确认第 8.1、8.2 节两处视觉规范例外。
2. 做一次 1366×768 + 暗色模式的人工视觉验收。
3. 等“编辑患者信息 / 添加血糖 / 加入虚拟病区 / 查看详情”规格明确后，再实现 `PatientMoreActions`。
4. 如需长期稳定滚动分页，评估后端 cursor 分页。
5. 若继续迭代该页面，补一个卡片滚动加载的组件级测试或端到端测试。

---

## 12. 边界提醒

- 本次只开发“住院管理 - 患者管理 - 住院患者”，不要顺手改出院患者 UI。
- 不要改动与患者管理无关的模块。
- 患者数据查询必须继续走后端数据权限过滤，不要在前端或 service 内手写绕过 `buildScopeWhere` 的科室条件。
- 不要依赖旧 `docs/HANDOFF.md` 的“血糖模块已删除”描述。
- 不要向 AI 提供真实患者数据；本地演示数据来自 `seed.ts`。
