---
description: 血糖领域业务口径与 CGM 扩展约束。涉及血糖记录、单位、时间、告警、统计时必读。
globs:
  - 'apps/server/src/modules/glucose/**'
  - 'apps/web/src/pages/glucose/**'
  - 'packages/shared/src/glucose/**'
  - 'apps/server/prisma/**'
---

# 血糖领域规则

## 单位
- 存储唯一单位：`mmol/L`，字段 `valueMmolL`，`Decimal(4,1)`
- 换算常量 `1 mmol/L = 18 mg/dL`，**只能**引用 `@gc/shared` 的 `convertToMmolL`
- 前端展示允许按用户偏好切换单位，但**提交一律传 mmol/L**

## 时间语义
- `measuredAt` = 实际测量时间（医护填写），业务主时间，必填
- `receivedAt` = 服务器接收时间，仅排查用
- 禁止用 `new Date()` 充当 `measuredAt`
- 存储 UTC，展示本地（Asia/Shanghai）

## 取值与异常
- 合法区间 `[0.6, 33.3] mmol/L`，边界含（与 `Low < 0.6` / `High > 33.3` 对齐）
- 越界 → 不入库业务表，标记 `PENDING_REVIEW` 等待人工确认
- 阈值（低 < 3.9、高 > 16.7）从系统配置读取，禁止硬编码

## BGM 上下文
`mealContext` 必填，落库**时段码**（`code`）。时段是动态数据（表 `TimeSlot`，接口 `GET /time-slots`，前端 `useCommonDataStore().timeSlots`），
名称/区间/控糖目标在库里维护；code 是契约，只能取 `@gc/shared` `TIME_SLOTS` 登记过的值（含 `RANDOM` 随机 / `RETEST` 复测），禁止自定义或按名称匹配。
普通时段（`type=1`）区间必须 00:00~24:00 全覆盖、不重叠、不跨零点，左闭右开；特殊（`4`）/强化（`0`）无区间。

## 去重
- `dedupeKey` 必须唯一；冲突时幂等跳过

## CGM 预留（不动表结构即可扩展）
- `kind` 字段已区分 `BGM` / `CGM`
- 扩展字段放 `rawPayload`（趋势箭头、传感器、采样间隔）
- 数据接入统一走 `GlucoseIngestionService`
- **当前阶段不要启用分区**；触发条件见 `prisma/sql/glucose_record_partition.sql`

## 图表
- 趋势图用 ECharts；大数据量开启 `sampling: 'lttb'`、`large: true`
- 图表 tooltip 必须同时展示测量时间与录入人（手工录入场景）
