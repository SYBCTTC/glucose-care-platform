# 公共数据清单（Common Data Catalog）

> 用途：登记项目内**高频复用、统一维护**的公共数据。后续向 AI 提需求时，直接引用「代号」即可，
> 无需重复描述取值，也禁止在业务代码里硬编码这些取值。
> 最后更新：2026-10-23（动态数据接口 + 前端一次性加载落地；新增患者状态字典）。

## 一、使用约定

- **静态字典**：从 `@gc/shared` 导入（如 `import { RESULT_TYPE } from '@gc/shared'`）。
  改 `@gc/shared` 后必须走 `packages/shared` 改动流程：`build → sync:shared → 清 Vite 缓存`。
- **动态数据**：来自数据库，后端已提供查询接口（科室/人员/设备）。**登录后由 `BasicLayout` 一次性拉取并存入 `useCommonDataStore`，后续所有场景直接从 store 取，禁止重复请求接口**（登出时自动清空）。
- **当前登录账号**：从 `useAuthStore().profile` 直接取，无需查接口。
- **导入兜底**：前端访问字典用可选链 `X?.[code] ?? code`，避免同步失败时白屏。

---

## 二、已落地静态字典

| 代号 | 名称 | 来源文件（`@gc/shared`） | 主要导出 | 取值 | 用途 |
|---|---|---|---|---|---|
| `D-ROLE` | 系统角色 | `dict/roles.ts` | `ROLE_CODE` / `ROLE_LABELS` / `ROLE_PERMISSIONS` | `DOCTOR`/`NURSE`/`NURSE_HEAD`/`DEVICE_ADMIN`/`SYS_ADMIN` | 人员角色、权限、数据范围 |
| `D-RESULT` | 检测结果类型 | `dict/result-types.ts` | `RESULT_TYPE` / `RESULT_TYPE_LABELS` / `RESULT_TYPE_COUNTED` / `getResultTypeLabel` | `NORMAL`(检测)/`LOW`(Low)/`HIGH`(High)/`REFUSED`(拒检)/`OUT`(外出) | 血糖/质控录入结果下拉；`COUNTED` 标记是否计入统计 |
| `D-TIMESLOT` | 时段划分 | `dict/time-slots.ts` | `TIME_SLOTS` / `TIME_SLOT_TYPE` / `getTimeSlotLabel` / `getTimeSlotsByType` | 普通：`FASTING`(空腹)/`BREAKFAST_PRE`(早餐前)/`BREAKFAST_POST`(早餐后)/`LUNCH_PRE`(午餐前)/`LUNCH_POST`(午餐后)/`DINNER_PRE`(晚餐前)/`DINNER_POST`(晚餐后)/`BEDTIME`(睡前)；强化：`INTENSIVE_AM`(强化-上午)/`INTENSIVE_PM`(强化-下午)/`INTENSIVE_NIGHT`(强化-夜间) | 患者血糖展示按"时段"作表头分组；起止不固化，仅分组语义 |
| `D-ALERT` | 预警范围默认值 | `dict/time-slots.ts` | `DEFAULT_ALERT_RANGE` | `{ low: 3.9, high: 16.7 }`（mmol/L） | 低血糖/高血糖阈值占位；接口就绪后改为读 `SystemConfig`，禁止硬编码 |
| `D-GENDER` | 性别 | `patient/schema.ts` | `GENDER` / `GENDER_LABELS` | `MALE`(男)/`FEMALE`(女)/`UNKNOWN`(未知) | 患者建档性别下拉 |
| `D-PATSTATUS` | 患者住院状态 | `patient/schema.ts` | `PATIENT_STATUS` / `PATIENT_STATUS_LABELS` | `INPATIENT`(住院患者)/`DISCHARGED`(出院患者) | 患者管理 Tab、列表状态展示 |
| `D-DEVSTATUS` | 设备状态 | `device/schema.ts` | `DEVICE_STATUS` / `DEVICE_STATUS_LABELS` | `IDLE`(未绑定)/`BOUND`(使用中)/`OFFLINE`(离线)/`DISABLED`(已停用) | 设备列表/详情展示 |
| `D-USERSTATUS` | 用户状态 | `dict/user-status.ts` | `USER_STATUS_LABELS` / `getUserStatusLabel` | `ACTIVE`(启用)/`DISABLED`(禁用)/`LOCKED`(锁定) | 人员列表/详情展示 |

---

## 三、已具备（运行时，非字典）

| 代号 | 名称 | 来源 | 可用字段 | 用途 |
|---|---|---|---|---|
| `CURRENT_USER` | 当前登录账号 | `apps/web/src/store/auth.ts` → `useAuthStore().profile` | `userId` / `displayName` / `departmentId` / `departmentName` / `roles` / `permissions` / `dataScope` | 表单默认操作人、默认科室、权限判断 |

---

## 四、动态数据（后端接口已落地 + 前端一次性缓存）

> 登录后 `BasicLayout` 调用 `useCommonDataStore().load()` 一次性拉取，存入 Zustand；
> 已加载/加载中直接返回（幂等），后续场景从 store 取，**不再请求接口**；登出时 `reset()` 清空。

| 代号 | 名称 | 后端接口 | 前端存储 / 取值 | 用途 |
|---|---|---|---|---|
| `DY-OPERATOR` | 护士/护士长（操作人） | `GET /staff`（`OPERATOR_VIEW`，本科室，仅医护） | `useCommonDataStore().staffByRole('NURSE'/'NURSE_HEAD')` | 添加血糖/质控的操作人下拉 |
| `DY-DOCTOR` | 医生（责任医生） | 同上（同一接口，按 `roleCodes` 区分） | `staffByRole('DOCTOR')` | 添加患者选责任医生 |
| `DY-DEVICE` | 设备 | `GET /devices`（`DEVICE_VIEW`，本科室，仅启用） | `useCommonDataStore().devices` | 质控记录添加设备 |
| `DY-DEPT` | 科室 | `GET /departments`（`DEPARTMENT_VIEW`，全院可见） | `useCommonDataStore().departments` | 患者/设备/用户归属、数据权限 |

> **患者不纳入公共数据**（按 2026-10-23 决定）：患者选择走业务接口，不进 `useCommonDataStore`。
> 未开发任何前端下拉 UI 组件；本表只描述数据来源与取值方式。

---

## 五、提取示例（后续提需求时这样引用）

- "添加血糖表单的**结果下拉**用 `D-RESULT`，**操作人下拉**用 `DY-OPERATOR`（默认带出 `CURRENT_USER`）。"
- "患者血糖展示按 `D-TIMESLOT` 的时段作为表头，超 `D-ALERT` 范围标红。"
- "设备列表的状态列用 `D-DEVSTATUS` 映射中文；设备选择用 `DY-DEVICE`（`useCommonDataStore().devices`）。"
- "建档表单的性别用 `D-GENDER`，责任医生用 `DY-DOCTOR`（`staffByRole('DOCTOR')`），科室用 `DY-DEPT`。"
- "公共数据已在登录后加载，组件里**不要再调接口**，直接从 `useCommonDataStore` 取。"

---

## 六、维护规则

- 新增/修改静态字典取值：改 `packages/shared/src` 对应文件 → `pnpm --filter @gc/shared build` → `pnpm sync:shared` → 清前端 `.vite` 缓存 → 重启 dev。
- 新增公共数据项：在此文档登记一行（含代号、来源、取值、用途），并同步更新本节。
- 新增动态公共数据接口：必须挂 `@RequirePermissions` + `@RequireDataScope`，并加入 `useCommonDataStore().load()` 的 `Promise.all`，保证登录后一次性加载。
- 取值如有业务调整（如新增结果类型），走需求评审，不要散落在各页面硬编码。
