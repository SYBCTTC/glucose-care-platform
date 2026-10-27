# 公共数据清单（Common Data Catalog）

> 用途：登记项目内**高频复用、统一维护**的公共数据。后续向 AI 提需求时，直接引用「代号」即可，
> 无需重复描述取值，也禁止在业务代码里硬编码这些取值。
> 最后更新：2026-10-27（D-TIMESLOT 由静态字典改为动态数据 DY-TIMESLOT，落库 `TimeSlot`，含起止时间、类型、控糖目标）。

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
| `D-TIMESLOT` | 时段**码**（契约） | `dict/time-slots.ts` | `TIME_SLOT_CATEGORY` / `TIME_SLOTS`（仅 seed 源 + 兜底） / `pickTimeSlotByTime` / `getTimeSlotLabel` | 普通：`FASTING`/`BREAKFAST_PRE`/`BREAKFAST_POST`/`LUNCH_PRE`/`LUNCH_POST`/`DINNER_PRE`/`DINNER_POST`/`BEDTIME`；特殊：`RANDOM`(随机)/`RETEST`(复测)；强化：`INTENSIVE_AM`/`INTENSIVE_PM`/`INTENSIVE_NIGHT` | **code 是落库契约**（`GlucoseRecord.mealContext`），改名不改码；名称/区间/目标走 `DY-TIMESLOT` |
| `D-ALERT` | 预警范围默认值 | `dict/time-slots.ts` | `DEFAULT_ALERT_RANGE` | `{ low: 3.9, high: 16.7 }`（mmol/L） | 低血糖/高血糖阈值占位；接口就绪后改为读 `SystemConfig`，禁止硬编码 |
| `D-GENDER` | 性别 | `patient/schema.ts` | `GENDER` / `GENDER_LABELS` / `GENDER_SELECTABLE` | `MALE`(男)/`FEMALE`(女)/`UNSPECIFIED`(未说明)/`UNKNOWN`(未知，历史数据兜底，不进下拉) | 患者建档性别下拉（用 `GENDER_SELECTABLE`） |
| `D-DIABETES` | 糖尿病类型 | `patient/schema.ts` | `DIABETES_TYPE` / `DIABETES_TYPE_LABELS` | `TYPE_1`(I型糖尿病)/`TYPE_2`(II型糖尿病)/`GESTATIONAL`(妊娠型糖尿病)/`SPECIAL`(特殊型糖尿病)/`OTHER`(其他) | 患者建档糖尿病类型下拉；库内存 code |
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
| `DY-RESULT` | 血糖监测结果（0~9，含颜色） | `GET /dicts/GLUCOSE_RESULT`（`DICT_VIEW`，全院可见） | `useCommonDataStore().dictItems(DICT_TYPE.GLUCOSE_RESULT)` | 血糖录入结果选项（只渲染 `checkable=true`）、文案与颜色、统计口径按 `counted` |
| `DY-TIMESLOT` | 时段（含起止时间、类型、控糖目标） | `GET /time-slots`（`DICT_VIEW`，全院可见，**停用项也下发**） | `useCommonDataStore().timeSlots` / `getTimeSlotName(code)` | 血糖录入的「检测时段」下拉（只渲染 `enabled`）、按检测时间自动选中、列表/报表按时段回显名称 |

### `DY-TIMESLOT` 字段与口径

| 字段 | 说明 |
|---|---|
| `code` | 时段码，落库值，**不可随意改**（历史血糖靠它关联） |
| `name` | 时段名，可在库里改，改完即时生效（需重新登录刷新公共数据） |
| `type` | `0` 强化 / `1` 普通 / `4` 特殊，见 `TIME_SLOT_CATEGORY` |
| `startTime` / `endTime` | `HH:mm`；**普通时段要求 00:00~24:00 全覆盖、不重叠、不跨零点**，区间左闭右开 `[start, end)`，`24:00` 表示当日终点 |
| `timeScope` | 派生字段 `${startTime}-${endTime}`，服务端拼接、不落库；无区间为 `null` |
| `valueDown` / `valueUp` | 该时段控糖目标（mmol/L）；特殊/强化为空。注意：与 `D-ALERT`（全局预警阈值）不是同一概念 |

- 特殊时段（随机/复测）与强化时段**不要求区间**，`startTime/endTime/timeScope/valueDown/valueUp` 均为 `null`。
- 展示顺序只由 `sortOrder` 决定：普通（10~80）→ 特殊（90~100）→ 强化（110~130）；服务端不按 `type` 分组，前端分组只是 UI 呈现。
- 录入弹窗按「检测时间」自动选中所属**普通**时段（`pickTimeSlotByTime`，左闭右开）；用户手动改过时段后不再覆盖。
- 强化时段后续按检测时间落点归入对应普通时段展示、特殊时段表头显式标记：**展示逻辑尚未实现**。

#### 当前时段数据（seed 口径，`prisma/seed.ts` 为写入源）

| code | 名称 | 区间 | 控糖目标 |
|---|---|---|---|
| `FASTING` | 空腹 | 00:00-07:00 | 4.4~7.0 |
| `BREAKFAST_PRE` | 早餐前 | 07:00-08:00 | 4.4~7.0 |
| `BREAKFAST_POST` | 早餐后 | 08:00-11:00 | 4.4~10.0 |
| `LUNCH_PRE` | 午餐前 | 11:00-12:00 | 4.4~7.0 |
| `LUNCH_POST` | 午餐后 | 12:00-17:00 | 4.4~10.0 |
| `DINNER_PRE` | 晚餐前 | 17:00-18:00 | 4.4~7.0 |
| `DINNER_POST` | 晚餐后 | 18:00-22:00 | 4.4~10.0 |
| `BEDTIME` | 睡前 | 22:00-24:00 | 5.0~8.3 |
| `RANDOM` / `RETEST` | 随机 / 复测 | — | — |
| `INTENSIVE_AM` / `_PM` / `_NIGHT` | 强化-上午 / 下午 / 夜间 | — | — |

**待临床确认（可能是错的，别当既定口径用）：**

- 只有 8 个普通时段码又要求 24h 全覆盖 → `12:00-17:00` 只能归「午餐后」，下午 5 小时都算午餐后。若不可接受需新增时段码（属 `code` 契约变更）。
- `FASTING` 覆盖 00:00-07:00 整个夜间，凌晨起床前的读数都归空腹。
- `valueDown/valueUp` 目前是纯数据字段，**未接入任何判定**；低/高血糖仍按 `D-ALERT`。

**已知约束：**

- `createGlucoseSchema` 仍用 `@gc/shared` `TIME_SLOTS` 的 code 做静态白名单校验：库里新增时段但未同步 shared → 提交会被 10001 拒绝。
- 公共数据一次性加载（`loaded` 幂等），改时段名/区间后需重新登录或刷新页面才生效。

> **患者不纳入公共数据**（按 2026-10-23 决定）：患者选择走业务接口，不进 `useCommonDataStore`。
> 未开发任何前端下拉 UI 组件；本表只描述数据来源与取值方式。

---

## 五、提取示例（后续提需求时这样引用）

- "添加血糖表单的**结果选项**用 `DY-RESULT`（`dictItems(DICT_TYPE.GLUCOSE_RESULT)`，RadioGroup 只渲染 `checkable=true` 的项，并在最前面加一个不在字典里的「检测」占位项），**操作人**用 `DY-OPERATOR`（默认带出 `CURRENT_USER`，若当前账号不在其中则前端临时补一条，不写回 DY-OPERATOR）。"
- "患者血糖展示按 `DY-TIMESLOT` 的时段作为表头（普通时段 + 特殊时段，强化按检测时间落点归入普通时段），超 `D-ALERT` 范围标红；录入弹窗的「检测时段」取 `useCommonDataStore().timeSlots`，并按检测时间自动选中。"
- "设备列表的状态列用 `D-DEVSTATUS` 映射中文；设备选择用 `DY-DEVICE`（`useCommonDataStore().devices`）。"
- "建档表单的性别用 `D-GENDER`（可选值取 `GENDER_SELECTABLE`），糖尿病类型用 `D-DIABETES`，责任医生用 `DY-DOCTOR`（`staffByRole('DOCTOR')`），责任护士用 `DY-OPERATOR`，科室用 `DY-DEPT`。"
- "糖化血红蛋白：范围常量 `HBA1C_MIN/HBA1C_MAX/HBA1C_UNIT`（`patient/schema.ts`），0~100、最多 1 位小数、单位 `%`，禁止在页面写死范围和单位。"
- "公共数据已在登录后加载，组件里**不要再调接口**，直接从 `useCommonDataStore` 取。"

---

## 六、维护规则

- 新增/修改静态字典取值：改 `packages/shared/src` 对应文件 → `pnpm --filter @gc/shared build` → `pnpm sync:shared` → 清前端 `.vite` 缓存 → 重启 dev。
- 新增公共数据项：在此文档登记一行（含代号、来源、取值、用途），并同步更新本节。
- 新增动态公共数据接口：必须挂 `@RequirePermissions` + `@RequireDataScope`，并加入 `useCommonDataStore().load()` 的 `Promise.all`，保证登录后一次性加载。
- 取值如有业务调整（如新增结果类型），走需求评审，不要散落在各页面硬编码。
- 动态字典取值调整（label / color / checkable / counted / 顺序）：改 `DictItem` 数据即可（seed 或后台），**不改代码、不发版**；色值变更同步更新 `docs/UI-DESIGN-TOKENS.md` 5.1。
- 动态字典**不返回 id**：业务表仍存 `code`，`enabled=false` 表示下线（历史数据里的 code 仍需可展示），不要物理删除。
