---
description: 血糖领域业务口径与 CGM 扩展约束。涉及血糖记录、单位、时间、告警、统计时必读。
globs:
  - 'apps/server/src/modules/glucose/**'
  - 'apps/server/src/modules/time-slot/**'
  - 'apps/web/src/api/glucose.ts'
  - 'apps/web/src/pages/inpatient/patients/GlucoseCreateModal.tsx'
  - 'apps/web/src/pages/inpatient/patients/LastGlucose.tsx'
  - 'apps/web/src/components/glucose/**'
  - 'apps/web/src/pages/inpatient/patient-detail/**'
  - 'packages/shared/src/glucose/**'
  - 'packages/shared/src/dict/time-slots.ts'
  - 'apps/server/prisma/**'
---

# 血糖领域规则

> 与 `AGENTS.md` §4 同源，冲突以 `AGENTS.md` 为准。最后核对：2026-11-23（对齐 R25 软删除与部分唯一索引、R26 公共模块迁移；
> `AGENTS.md` §4.5 / §4.6 已同日同步，两处口径一致，无例外）。

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
- 停用时段：**历史可展示、新录入拒绝**（`GET /time-slots` 仍下发停用项，供历史血糖回显名称）。
  血糖报告中的展示形式（R22，2026-11-19 裁定）：弃用时段**不再成列**，历史记录按检测时间合并进启用的普通列
  并带弃用时段名后缀（`GlucoseReportEntry.sourceSlotName` + `sourceType` 保留原类型），无启用宿主时兜底随机列；
  详见 `docs/specs/glucose-report.md` R22
- `@gc/shared` 的 `TIME_SLOTS` 已降级为**仅 seed 数据源**，`getFallbackTimeSlots` / `getTimeSlotLabel` 已删除；
  **禁止**在运行时用它做校验或展示兜底（会与库数据漂移）
- 因此库里新增/停用时段**无需改代码、无需发版**

## 住院记录与科室停留（R24，2026-11-20）
- 患者是**多次住院**模型：`Admission`（一行 = 一次住院，`seq` 第几次，`dischargedAt NULL` = 在院）+
  `AdmissionDepartment`（转科轨迹，一行 = 一段科室停留，`endedAt NULL` = 当前在科，
  「每次住院至多一条进行中」由部分唯一索引 `admission_department_one_active` 保证）。
  **实现转科/出院功能前必读** `docs/specs/glucose-report-query.md`（含双写口径与防御性关闭）
- `Patient.admissionAt/dischargeAt/status` 旧字段**保留且必须双写**（裁定 Q2）：建档 → `Admission(seq=1)`；
  办理住院 `admit()` → `seq=max+1` + 关闭上一次进行中记录；出院功能落地时须关闭
  `Admission.dischargedAt` + 进行中停留 `endedAt`（当前无出院接口）
- 血糖报告查询是**秒粒度闭区间** `startTime/endTime`（`YYYY-MM-DD HH:mm:ss` 本地时间，
  原天粒度 `startDate/endDate` 已废弃）；行分组/统计/分页全部基于过滤后记录；
  `buildReportRows` 窗口查询**必须叠加范围条件**（窗口内可能有范围外记录）
- 报表查询表单联动（住院 → 科室 → 时间默认值与上下限）是纯前端状态机，
  见 `apps/web/src/components/glucose/GlucoseQueryForm.tsx` 导出的纯函数（`derive*` / `build*` / `toQueryRange`）
  与其同目录 spec；服务端只认时间范围，不认住院/科室 id。
  ⚠️ R26（2026-11-20）已由 `patient-detail/ReportQueryForm.tsx` **改名迁移**
  （`ReportQueryFormState`→`GlucoseQueryFormState`、`toReportRange`→`toQueryRange`），旧文件已删除；
  联动口径与 18 项裁定一字未改。该表单现为血糖数据三页（报表/记录/趋势图）共用，
  特有条件走 `extra` 插槽，**不要在各页复制一份**

## 去重（唯一约束兜底）
- 实现（**R25，2026-11-20 变更**）：**部分唯一索引** `glucose_record_active_unique`
  = `UNIQUE ("patientId", "measuredAt") WHERE "voidedAt" IS NULL`，**只约束有效记录**。
  原全表 `@@unique([patientId, measuredAt])`（索引 `GlucoseRecord_patientId_measuredAt_key`）
  已由迁移 `20261120120000_add_glucose_void` **DROP**——否则作废行仍占用时间戳，同一检测时间无法补录。
  Prisma 不支持部分索引，SQL 在 `prisma/sql/glucose_record_active_unique.sql`
  （`migrate deploy` 后手工执行一次，幂等；与 `ward_one_active.sql` / `binding_partial_unique.sql` 同一套约定）
- **没有 `dedupeKey` 字段**，也不要再拼 `manual:{...}` / `device:{...}` 键
- 同一患者同一 `measuredAt` 只允许一条**有效**记录；已作废行不占位，可在同一时间点补录新记录
- **添加**时重复提交（连点、网络重试）命中 P2002 → **幂等跳过**，不得抛错：
  返回 `code=0` + `data.skipped=true` 并回读已有记录；前端必须提示"未重复保存"，**不得提示成功**。
  ⚠️ 复合唯一键已不存在，回读必须用 `findFirst` + `voidedAt: null`（**不是 `findUnique`**），
  见 `glucose.service.ts:506-521`；部分索引下命中 P2002 必然存在有效重复行，幂等语义不变
- **编辑**时把检测时间改成另一条有效记录的时间 → `41003`（字段级挂 `measuredAt`），
  与添加的 `skipped` 口径**不同**：那不是重复提交，是用户改错了时间，必须报错
- 为什么仍需唯一索引兜底：应用层"先查后写"在并发下不安全（两个请求同时查到"无记录"会双双写入）
- 迁移遇历史重复组**直接失败并报出组数**，不静默删除医疗记录，需人工确认后清理
- 将来若要允许"同一时间点多来源各一条"（设备 + 手工），必须先改本约束，属契约变更

## 作废（软删除，R25 2026-11-20）
- 医疗记录**不得物理删除**（等保三级）：删除按作废实现，置 `voidedAt` + `voidedById` 留痕，行保留在库
- ⚠️ **所有读路径一律排除已作废记录**（`where.voidedAt = null`）：报表单元格、日期分组、统计聚合、
  极值、最新血糖、单条回读均已加；**新增任何血糖查询（如血糖记录列表）必须同样加**，漏加即数据错误
- 并发兜底：作废与编辑都用 `updateMany where { id, patientId, voidedAt: null }`，
  受影响 0 行 → `10008`（已被他人作废，**不返回成功**，避免误导操作者）；`voidedAt: null` 兼作乐观锁。
  记录不存在 → `41001`
- 权限：作废需 `glucose:delete`（DOCTOR / NURSE **无**，NURSE_HEAD / SYS_ADMIN 有）；编辑需 `glucose:update`
- 审计：作废记 `GLUCOSE_VOID`；编辑记 `GLUCOSE_UPDATE`，`detail.changedFields` **只记字段名不记值**（裁定 Q5）；
  单条回读 `GET /patients/:id/glucose/:recordId` **不挂审计**（裁定 Q4）
- 「含作废」历史视图属新需求：需先明确权限边界与展示口径（作废人 / 作废时间）再做，不要默认放开

## CGM 扩展（**当前未预留，属目标态**）
- 现状：`GlucoseRecord` 仅 `resultType / valueMmolL / mealContext / measuredAt / operatorId / testStrip / remark`
  加 `createdAt` 与 R25 软删除 `voidedAt / voidedById`；
  **没有** `kind`、`rawPayload`、`GlucoseDailySummary`，**没有** `GlucoseIngestionService`（现为 `GlucoseService`），
  `prisma/sql/glucose_record_partition.sql` **不存在**
- 上线 CGM 前一次性补齐 schema（`kind` / `rawPayload Json?` / 汇总表 / 分区预案），走人工评审，**禁止按本节直接加字段**
- 数据接入统一入口以届时实际服务为准，新增 CGM adapter 不得改动上层
- 分区触发条件 = 启用 CGM 或单表超过 5000 万行；当前 BGM 规模**不要分区**，执行前先补该 SQL 文件

## 图表
- 趋势图用 ECharts；大数据量开启 `sampling: 'lttb'`、`large: true`
- 图表 tooltip 必须同时展示测量时间与录入人（手工录入场景）
- 已作废记录不得进图（同「作废」节读路径口径）
- 全屏切换后容器尺寸突变，图表必须 `resize`：R26 的 `useFullscreen({ onResize })` 已在 `requestAnimationFrame`
  后触发回调，直接在里面调 `chart.resize()`，**不要自己另写 resize 监听或 Fullscreen API**
  （全屏是纯 CSS 覆盖层，不触发浏览器 fullscreen 事件）
