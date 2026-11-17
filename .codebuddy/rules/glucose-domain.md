---
description: 血糖领域业务口径与 CGM 扩展约束。涉及血糖记录、单位、时间、告警、统计时必读。
globs:
  - 'apps/server/src/modules/glucose/**'
  - 'apps/server/src/modules/time-slot/**'
  - 'apps/web/src/api/glucose.ts'
  - 'apps/web/src/pages/inpatient/patients/GlucoseCreateModal.tsx'
  - 'apps/web/src/pages/inpatient/patients/LastGlucose.tsx'
  - 'packages/shared/src/glucose/**'
  - 'packages/shared/src/dict/time-slots.ts'
  - 'apps/server/prisma/**'
---

# 血糖领域规则

> 与 `AGENTS.md` §4 同源，冲突以 `AGENTS.md` 为准。最后核对：2026-11-17（对齐唯一约束去重方案与实库字段）。

## 单位
- 存储唯一单位：`mmol/L`，字段 `GlucoseRecord.valueMmolL`，`Decimal(4,1)`
- 接口只收 `mmol/L`；`rawValue` / `rawUnit` **当前 schema 未实现**，恢复需走 schema 评审
- 换算常量 `1 mmol/L = 18 mg/dL`。**`@gc/shared` 目前没有换算函数**（`src/glucose/` 只有 `schema.ts`）；
  一旦需要 mg/dL，必须先在 `packages/shared/src/glucose/` 建换算入口并走共享包流程，**禁止在业务代码硬编码 18**
- 前端展示允许按用户偏好切换单位，但**提交一律传 mmol/L**

## 时间语义
- `measuredAt` = 实际测量时间（医护填写），业务主时间，必填，`timestamptz`
- `receivedAt` **当前 schema 无此字段**；排查用 `createdAt`
- 禁止用 `new Date()` 充当 `measuredAt`
- 存储 UTC，展示本地（Asia/Shanghai）

## 取值与异常
- 合法区间 `[0.6, 33.3] mmol/L`，边界含（与 `Low < 0.6` / `High > 33.3` 对齐）
- 越界 → 由 `createGlucoseSchema` 直接拒绝（`10001`），**不入库**；当前**无 `status` 字段、无 `PENDING_REVIEW` 复核流程**
- 告警阈值**已落地到数据库**（2026-11-17）：存 `SystemConfig` 表，key 为
  `glucose.low_threshold` / `glucose.high_threshold`（seed 默认 `3.9` / `16.7`），
  由 `SystemConfigService.getGlucoseAlertThreshold()` 读取。
  ⚠️ 键名不是 `alert.low` / `alert.high`（本条旧版写错了），以 `SYSTEM_CONFIG_KEY` 常量为准
- `@gc/shared` 的 `DEFAULT_ALERT_RANGE` 占位常量**已删除，禁止重新引入**，也禁止在业务代码硬编码阈值
- 判定口径：`value < low` → `'0'` 偏低，`low <= value <= high` → `'1'` 正常，`value > high` → `'2'` 偏高
- 只有结果类型为「检测」时才读配置；`3~9` 是人工选择的类型，无需阈值
- **配置缺失/非法/`low >= high` 时抛 `10000` 拒绝写入，不退回任何默认值**：
  按错误阈值分类比拒绝录入更危险，结果类型直接进病历
- 阈值不做内存缓存（改动即时生效）；等 P5-3 维护接口落地再考虑带失效通知的缓存

## BGM 上下文
`mealContext` 必填，落库**时段码**（`code`）。时段是动态数据（表 `TimeSlot`，接口 `GET /time-slots`，前端 `useCommonDataStore().timeSlots`），
名称/区间/控糖目标在库里维护；code 是契约，**禁止按名称匹配**。
普通时段（`type=1`）区间必须 00:00~24:00 全覆盖、不重叠、不跨零点，左闭右开；特殊（`4`）/强化（`0`）无区间。

可用性校验（2026-11-17 起，**查库，不查静态清单**）：
- `createGlucoseSchema` 只校验格式（trim 后 1~32，与 `TimeSlot.code VarChar(32)` 对齐）
- `GlucoseService.assertTimeSlotUsable` 经 `TimeSlotService.findByCode` 校验该 code **存在且 `enabled`**，
  否则 `10001` + `details[{field:'mealContext'}]`，**不写库**
- 停用时段：**历史可展示、新录入拒绝**（`GET /time-slots` 仍下发停用项，供历史血糖回显名称）
- `@gc/shared` 的 `TIME_SLOTS` 已降级为**仅 seed 数据源**，`getFallbackTimeSlots` / `getTimeSlotLabel` 已删除；
  **禁止**在运行时用它做校验或展示兜底（会与库数据漂移）
- 因此库里新增/停用时段**无需改代码、无需发版**

## 去重（唯一约束兜底）
- 实现：`@@unique([patientId, measuredAt])`（索引 `GlucoseRecord_patientId_measuredAt_key`）。
  **没有 `dedupeKey` 字段**，也不要再拼 `manual:{...}` / `device:{...}` 键
- 同一患者同一 `measuredAt` 只允许一条记录；重复提交（连点、网络重试）命中 P2002 时**幂等跳过**，不得抛错
- 命中时接口返回 `code=0` + `data.skipped=true` 并回读已有记录；前端必须提示"未重复保存"，**不得提示成功**
- 迁移遇历史重复组**直接失败并报出组数**，不静默删除医疗记录，需人工确认后清理
- 将来若要允许"同一时间点多来源各一条"（设备 + 手工），必须先改本约束，属契约变更

## CGM 扩展（**当前未预留，属目标态**）
- 现状：`GlucoseRecord` 仅 `resultType / valueMmolL / mealContext / measuredAt / operatorId / testStrip / remark`；
  **没有** `kind`、`rawPayload`、`GlucoseDailySummary`，**没有** `GlucoseIngestionService`（现为 `GlucoseService`），
  `prisma/sql/glucose_record_partition.sql` **不存在**
- 上线 CGM 前一次性补齐 schema（`kind` / `rawPayload Json?` / 汇总表 / 分区预案），走人工评审，**禁止按本节直接加字段**
- 数据接入统一入口以届时实际服务为准，新增 CGM adapter 不得改动上层
- 分区触发条件 = 启用 CGM 或单表超过 5000 万行；当前 BGM 规模**不要分区**，执行前先补该 SQL 文件

## 图表
- 趋势图用 ECharts；大数据量开启 `sampling: 'lttb'`、`large: true`
- 图表 tooltip 必须同时展示测量时间与录入人（手工录入场景）
