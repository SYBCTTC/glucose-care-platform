# 公共业务组件清单（Common Components Catalog）

> 用途：登记跨页面复用、统一维护的**前端业务组件**，与 `COMMON-DATA.md`（数据/字典）配套。
> 后续提需求时直接引用「代号」；AI 开发前先查本表：已存在则复用，不存在则先建组件并登记。
> 最后更新：2026-10-23（患者管理顶部组件落地：Tabs / 科室 / 医生 / 时间区间 / 查询重置）。

## 一、使用约定

- **公共组件目录**：
  - `apps/web/src/components/common/`：与业务无关的基础封装（表格、状态标签、脱敏文本等）。
  - `apps/web/src/components/business/`：带业务语义的公共组件（患者/医生/设备选择器等）。
  - 页面私有组件放 `apps/web/src/pages/<module>/`，**不进本表**。
- **代号规范**：`C-*`（Component），如 `C-DATA-TABLE`、`C-PATIENT-SELECT`。
- **引用方式**：提需求时直接说代号，例如
  - "患者列表用 `C-DATA-TABLE`，状态列用 `C-STATUS-TAG`。"
  - "责任医生用 `C-DOCTOR-SELECT`（依赖 `DY-DOCTOR`）。"
- **修改公共组件**：先 grep 使用处做影响面分析；API 变更需同步更新本表，并回归所有使用页面。
- **不要过度抽象**：只出现一次、或强耦合某页面逻辑的，不登记为公共组件。

## 二、判定标准（满足多数才登记）

1. 至少 2 个页面/场景复用，或明确预期会复用；
2. Props 契约稳定、窄，不直接依赖某个页面的 store / 路由；
3. 无业务副作用（数据请求由页面或 hook 注入，组件只负责展示与交互）；
4. 可独立测试 / 独立预览；
5. 去掉它会导致多处重复代码。

反例：页面布局块、一次性弹窗内容、强耦合单页表单的字段组合。

## 三、分层

| 层 | 目录 | 示例 | 说明 |
|---|---|---|---|
| 基础封装 | `components/common/` | `C-DATA-TABLE`、`C-STATUS-TAG`、`C-MASKED-TEXT`、`C-PERMISSION-BUTTON` | 与具体业务无关 |
| 业务公共 | `components/business/` | `C-PATIENT-SELECT`、`C-DOCTOR-SELECT`、`C-OPERATOR-SELECT`、`C-DEVICE-SELECT`、`C-DEPT-SELECT` | 依赖公共数据 / 业务语义 |
| 页面私有 | `pages/<module>/` | 患者管理页内的局部组件 | 不登记 |

## 四、组件清单

> 状态：`规划` / `开发中` / `已实现` / `废弃`。
> `依赖` 列引用 `COMMON-DATA.md` 的代号（`D-*` / `DY-*` / `CURRENT_USER`）或权限点。
> **初始清单为患者管理预判，待页面需求 / FEATURE-SPEC 确认后增删；未确认前不提前实现。**

| 代号 | 名称 | 路径 | 职责 | 关键 Props | 依赖 | 状态 | 使用页面 |
|---|---|---|---|---|---|---|---|
| `C-TABS` | 顶部 Tab | `components/common/Tabs.tsx` | Tab 切换，支持下划线/背景两种主题色高亮 | `items` / `value` / `onChange` / `variant` | — | 已实现 | 患者管理 |
| `C-DATE-RANGE-PICKER` | 日期区间 | `components/common/DateRangePicker.tsx` | 日期/秒级区间，禁选未来 | `value` / `onChange` / `precision` / `disabled` | — | 已实现 | 患者管理 |
| `C-SEARCH-ACTIONS` | 查询 / 重置 | `components/common/SearchActions.tsx` | 查询、重置按钮组 | `onSearch` / `onReset` / `loading` | — | 已实现 | 患者管理 |
| `C-DEPT-SELECT` | 科室筛选 | `components/business/DeptSelect.tsx` | 科室下拉，始终含"所有科室" | `value` / `onChange` / `options` / `disabled` | `DY-DEPT` | 已实现 | 患者管理 |
| `C-DOCTOR-SELECT` | 医生筛选 | `components/business/DoctorSelect.tsx` | 医生下拉，始终含"所有医生" | `value` / `onChange` / `options` / `disabled` | `DY-DOCTOR` | 已实现 | 患者管理 |
| `C-DATA-TABLE` | 通用数据表格 | `components/common/DataTable.tsx` | 分页 / loading / 空态 / 列配置 | `columns` / `rows` / `total` / `loading` / `onChange` | — | 规划 | 患者管理等列表 |
| `C-PATIENT-SELECT` | 患者选择器 | `components/business/PatientSelect.tsx` | 远程搜索选患者（脱敏展示） | `value` / `onChange` / `multiple` / `disabled` | 患者查询接口、`PATIENT_VIEW` | 规划 | 患者管理 / 绑定 |
| `C-OPERATOR-SELECT` | 操作人选择器 | `components/business/OperatorSelect.tsx` | 选护士 / 护士长 | `value` / `onChange` / `disabled` | `DY-OPERATOR`、`CURRENT_USER` | 规划 | 质控 / 未来血糖 |
| `C-DEVICE-SELECT` | 设备选择器 | `components/business/DeviceSelect.tsx` | 选设备 | `value` / `onChange` / `disabled` | `DY-DEVICE` | 规划 | 质控 / 患者绑定 |
| `C-STATUS-TAG` | 状态标签 | `components/common/StatusTag.tsx` | 状态 → 中文 / 颜色 | `type` / `value` | `D-DEVSTATUS` / `D-USERSTATUS` 等 | 规划 | 各列表 |
| `C-MASKED-TEXT` | 脱敏文本 | `components/common/MaskedText.tsx` | 姓名 / 手机号脱敏展示 | `value` / `type` | — | 规划 | 患者列表 / 详情 |
| `C-PERMISSION-BUTTON` | 权限按钮 | `components/common/PermissionButton.tsx` | 无权限隐藏 / 禁用 | `permission` / `children` / `mode` | `CURRENT_USER` 权限 | 规划 | 各页面操作列 |
| `C-CONFIRM` | 二次确认 | `components/common/Confirm.tsx` | 删除 / 停用确认 | `title` / `content` / `onOk` | — | 规划 | 各页面危险操作 |
| `C-FORM-DRAWER` | 表单抽屉 | `components/common/FormDrawer.tsx` | 新增 / 编辑容器 | `open` / `title` / `onClose` / `onSubmit` | — | 规划 | 患者建档 / 编辑 |

## 五、引用示例

- "患者管理顶部用 `C-TABS`（`variant='underline'`），筛选区用 `C-DEPT-SELECT` + `C-DOCTOR-SELECT` + `C-DATE-RANGE-PICKER`，查询/重置用 `C-SEARCH-ACTIONS`。"
- "患者管理列表用 `C-DATA-TABLE`，状态列用 `C-STATUS-TAG`，操作按钮用 `C-PERMISSION-BUTTON`。"
- "患者建档的责任医生用 `C-DOCTOR-SELECT`（`DY-DOCTOR`），科室用 `C-DEPT-SELECT`（`DY-DEPT`）。"
- "删除患者用 `C-CONFIRM` 做二次确认。"

## 六、工作流

1. 页面需求 → 先写 FEATURE-SPEC（页面 / 接口 / 权限 / 数据范围）。
2. **组件盘点**：列出页面所需组件，标注「复用已有 / 新建公共 / 页面私有」。
3. 先实现公共组件（每个独立可验证），再组装页面。
4. 新建 / 修改公共组件后更新本表；修改 API 需回归所有使用页面。
5. 一次只推进一个原子任务（一个组件或一个页面模块）。

## 七、维护规则

- 新增公共组件：登记一行（代号 / 路径 / 职责 / Props / 依赖 / 状态）。
- 组件从「规划」转「已实现」时更新状态与路径。
- 废弃组件保留记录并标注「废弃」，避免旧引用断链。
