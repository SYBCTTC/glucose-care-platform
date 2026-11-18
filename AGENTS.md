# AGENTS.md — 血糖管理系统的 AI 协作总纲

> 本文件是给 AI（CodeBuddy / Claude / Cursor 等）的**最高优先级上下文**。
> 任何 AI 在生成本项目代码前，必须先读取本文件，再读取 `.codebuddy/rules/` 下的规则。
> 与本文档冲突的建议，一律以本文档为准。

---

## 1. 项目定位

- **系统名称**：血糖数据与设备管理平台（内部代号 `gc`，Glucose Care）
- **使用人群**：医院内**医生、护士、护士长、设备管理员、系统管理员**，总账号数 < 2000
- **核心功能**：
  1. 患者档案管理
  2. **血糖数据查看**（列表 / 趋势图 / 统计报表 / 导出）
  3. **血糖仪设备管理**（注册、绑定患者、状态监控、校准记录）
- **当前数据来源**：**医护手工录入**（尚无 `channel` 字段，见 §4.5）
- **未来扩展**：接入血糖仪自动上传（`DEVICE`）、厂商平台 API（`VENDOR_API`）、CGM 持续监测（`CGM`）
- **部署环境**：**医院内网服务器**，需满足**等级保护三级**要求

---

## 2. 技术栈（禁止随意更换，禁止升级大版本）

| 层 | 技术 | 版本约束 |
|---|---|---|
| 语言 | TypeScript（strict 全开） | ^5.7 |
| 前端 | Vite + React + Ant Design 5 + TanStack Query + Zustand | React 18.x |
| 图表 | ECharts（echarts-for-react） | ^5.5 |
| 后端 | **NestJS**（模块化 + 守卫 + 拦截器） | ^10.4 |
| 数据库 | **PostgreSQL** | 16.x |
| ORM | **Prisma** | ^5.22 |
| 缓存 | Redis | 7.x |
| 校验 | **Zod**（前后端共享，位于 `packages/shared`） | ^3.23 |
| 包管理 | pnpm workspace monorepo | ^9 |
| 部署 | Docker Compose（内网） | — |

**禁止事项**：
- ❌ 不得引入新依赖，除非明确要求（新增依赖需人工批准并锁版本）
- ❌ 不得把 React 18 升到 19、NestJS 10 升到 11 等大版本升级
- ❌ 不得引入 Tailwind / shadcn / Material UI 等第二套 UI 体系（统一 Antd）
- ❌ 不得引入 Redux / MobX（状态用 TanStack Query + Zustand）

---

## 3. 目录结构（严格遵守）

```
apps/
  web/                 前端（Vite + React）
    src/
      api/             接口请求封装（统一走 request 客户端）
      pages/           页面组件
      components/      通用业务组件
      layouts/         布局
      hooks/           自定义 Hook
      store/           Zustand 全局状态（仅少量）
      router/          路由与权限守卫
  server/              后端（NestJS）
    prisma/
      schema.prisma    数据库 schema（唯一事实来源）
      sql/             需手工执行的 SQL（分区等 Prisma 不能力挺的能力）
      seed.ts          脱敏演示数据
    src/
      common/          通用能力：prisma / guards / interceptors / decorators / utils
      modules/         业务模块：auth / patient / device / glucose / audit / system
packages/
  shared/              前后端共享（Zod schema、枚举、单位换算、字典常量）
    src/glucose/       血糖领域：单位、范围、校验
    src/dict/          角色、字典常量
```

**分层职责（后端）**：
- `controller`：仅做参数校验、鉴权、转发，**不写业务逻辑**
- `service`：业务逻辑唯一归属层
- `prisma`：数据访问，禁止在 service 外直接 new PrismaClient
- 跨模块调用必须走 module 导出，**禁止循环依赖**

---

## 4. 血糖业务口径（AI 最容易搞错，必须逐条遵守）

### 4.1 单位
- **数据库统一存储 `mmol/L`**（字段 `valueMmolL`，精度 1 位小数）
- `rawValue` + `rawUnit`（原始值与单位）：**当前 schema 未实现**，恢复需走 schema 评审；接口只收 `mmol/L`
- 换算：**1 mmol/L = 18 mg/dL**；`mg/dL → mmol/L` 除以 18
- 换算函数**只允许**放在 `packages/shared/src/glucose/`（该目录当前**仅有 `schema.ts`，尚无换算函数**）；
  需要支持 `mg/dL` 时先在此新建换算入口并走共享包流程，**禁止在别处硬编码 18**

### 4.2 时间
- `measuredAt`：**血糖实际测量时间**（手工录入时由医护填写），业务主时间
- `receivedAt`：服务器接收时间，仅用于排查（**当前 schema 无此字段**，排查用 `createdAt`）
- 数据库统一存 **UTC**（`timestamptz`），前端用 dayjs 按本地时区展示
- **禁止**用 `new Date()` 作为 `measuredAt` 的默认值（AI 高频错误）
- 内网服务器时间必须 NTP 同步（运维项）

### 4.3 取值范围与异常
- 合法范围：**0.6 ~ 33.3 mmol/L**（含边界；与结果类型 `Low`(< 0.6) / `High`(> 33.3) 阈值对齐，边界值仍属合法读数）
- 超范围**不入库**：由 `createGlucoseSchema`（`packages/shared/src/glucose/schema.ts`）直接拒绝（10001）；当前**无 `status` 字段**，无 `PENDING_REVIEW` 流程
- 告警阈值**存 `SystemConfig` 表**（key `glucose.low_threshold` / `glucose.high_threshold`，seed 默认 `3.9` / `16.7 mmol/L`），
  由 `SystemConfigService.getGlucoseAlertThreshold()` 读取（2026-11-17 落地）。
  **禁止硬编码，也禁止引入默认常量兜底**——原 `@gc/shared` 的 `DEFAULT_ALERT_RANGE` 已删除，不要重新加回来。
  配置缺失/非法/`low >= high` 时服务端抛 `10000` **拒绝写入**，不退回默认值：按错误阈值分类比拒绝录入更危险，结果类型直接进病历

### 4.4 录入上下文（BGM 必填）
- `mealContext` **应用层必填**（`createGlucoseSchema` 强制），落库**时段码**（`TimeSlot.code`）：普通 `FASTING`/`BREAKFAST_PRE`/`BREAKFAST_POST`/`LUNCH_PRE`/`LUNCH_POST`/`DINNER_PRE`/`DINNER_POST`/`BEDTIME`，特殊 `RANDOM`/`RETEST`，强化 `INTENSIVE_AM`/`INTENSIVE_PM`/`INTENSIVE_NIGHT`
- 库字段 `GlucoseRecord.mealContext` 为 `String?`（`schema.prisma:156`），是给设备上报/历史数据留位；**不得因库可空就放宽前端或接口校验**
- 时段的**名称/起止时间/类型/控糖目标**是动态数据（表 `TimeSlot`，接口 `GET /time-slots`，前端 `useCommonDataStore().timeSlots`）；code 是契约，名称可改，**禁止按名称匹配**
- code 的**可用性由服务端查库判定**（2026-11-17 起）：`createGlucoseSchema` 只校验格式（trim 后 1~32，与 `TimeSlot.code VarChar(32)` 对齐），`GlucoseService.assertTimeSlotUsable` 经 `TimeSlotService.findByCode` 校验该 code **存在且 `enabled`**，否则 10001 + `details[{field:'mealContext'}]`
- 停用时段：**历史可展示、新录入拒绝**（`GET /time-slots` 仍下发停用项供回显名称）
- `@gc/shared` 的 `TIME_SLOTS` 已降级为**仅 seed 数据源**，静态兜底函数 `getFallbackTimeSlots` / `getTimeSlotLabel` 已删除；**禁止**在运行时用它做校验或展示兜底（会与库数据漂移）
- 手工录入时 `operatorId` 必须记录当前医护 ID（**留痕**）

### 4.5 去重（唯一约束兜底，已落地 2026-10-28）
> 实现：`@@unique([patientId, measuredAt])`（唯一索引 `GlucoseRecord_patientId_measuredAt_key`）。
> **没有** `dedupeKey` 字段，也不要再拼 `manual:{...}` / `device:{...}` 键。

- 同一患者同一 `measuredAt` 只允许一条记录；重复提交（连点、网络重试）命中 P2002 时**幂等跳过**，不得抛错
- 命中时接口返回 `skipped: true` 并回读已有记录；前端必须提示"未重复保存"，**不得提示成功**
- 迁移遇历史重复组会**直接失败并报出组数**，不静默删除医疗记录，需人工确认后清理
- 将来若要允许"同一时间点多来源各一条"（设备+手工），必须先改本约束，属契约变更

### 4.6 CGM 扩展（**当前未预留，属目标态**）
> 现状（2026-10-22 重构后简化重建，见 `docs/ARCHITECTURE.md` §4；引用章节而非行号，避免行号漂移后指错）：`GlucoseRecord` 仅
> `resultType / valueMmolL / mealContext / measuredAt / operatorId / testStrip / remark`；
> **没有** `kind`、`rawPayload`、`GlucoseDailySummary`，**没有** `GlucoseIngestionService`
> （现为 `GlucoseService`），`prisma/sql/glucose_record_partition.sql` **不存在**。

- 上线 CGM 前一次性补齐 schema（`kind` / `rawPayload Json?` / 汇总表 / 分区预案），走人工评审，**禁止按本节直接加字段**
- 数据接入统一入口以届时实际服务为准，新增 CGM adapter 不得改动上层
- 分区**触发条件** = 启用 CGM 或单表超过 5000 万行；当前 BGM 规模**不要分区**；执行前先补该 SQL 文件

---

## 5. 安全、权限与合规（最高优先级，人工把关）

### 5.1 权限（RBAC + 数据行级）
- 角色（以 `@gc/shared` 的 `ROLE_CODE` 为准）：`DOCTOR` 医生 / `NURSE` 护士 / `NURSE_HEAD` 护士长（**不是 `HEAD_NURSE`**；shared 常量 key 为 `ROLE_CODE.HEAD_NURSE`，值是 `NURSE_HEAD`）/ `DEVICE_ADMIN` 设备管理员 / `SYS_ADMIN` 系统管理员
- **数据范围按角色定档**（`ROLE_DATA_SCOPE`，唯一权威实现 `apps/server/src/common/data-scope/scope.util.ts`，
  四档语义表见 `docs/PERMISSION-DESIGN.md` §4）：医生 / 护士 / 护士长 → **本科室**（`DEPARTMENT`）；
  设备管理员 → 无患者数据（`NONE`）；系统管理员 → **全院**（`ALL`，2026-11-17 需求人裁定确认，
  含全部 23 个权限点与患者数据的查看/建档/编辑/归档/办理住院；2026-11-18 虚拟病区上线后
  新增 `ward:view` / `ward:manage`，医生/护士/护士长/系统管理员均授予，数据范围仍按 `DEPARTMENT` 收敛）
- ⚠️ **医生看的是本科室全部患者，不是"自己管辖的患者"**：`DEPARTMENT` 档只按 `departmentId` 过滤。
  `Patient.doctorId`（责任医生）仅是列表的**可选筛选项**（`patient.service.ts` 的 `query.doctorId`），
  **不是数据权限边界**——不要据此实现按责任医生过滤，也不要以为医生看不到同科室其他医生的患者
- **权限校验必须在后端**，前端隐藏按钮只是体验
- **所有患者数据查询必须统一经过"数据权限过滤"**，禁止每个接口各自写 where 条件
- 越权访问返回 `403` 并**记录审计日志**

### 5.2 审计日志（等保三级硬要求）
- 记录：操作人 / 时间 / IP / 操作类型 / 对象（患者 ID）/ 变更前后的关键字段 / 结果
- `result` 三值语义（2026-11-17 起真正生效）：`SUCCESS` / `DENIED` / `FAILED`。
  **`DENIED` 按错误码号段判定**（`3xxxx` = 授权与数据权限），不是按异常类型——
  项目规范要求业务错误一律抛 `BusinessException`，全仓无人抛 `ForbiddenException`，
  按类型判会让越权全部落成 `FAILED`、审计表筛不出越权尝试。失败时 `detail.errorCode` 带具体码
- `detail.requestId` 必须与响应头 `X-Request-Id` 同值（取自 `request.requestId`），用于串联审计行、服务端日志与用户报障
- `targetId` 默认取 URL `params.id`；**创建类接口没有 `:id`**，必须显式声明从响应信封取，
  如 `@Audit('PATIENT_CREATE', { targetType: 'PATIENT', targetIdFrom: 'data.id' })`，否则审计对象恒为空、事后无法按患者追溯。
  给非患者对象的 `:id` 路由加 `@Audit` 时也必须显式传 `targetType`，否则会被误记成 `'PATIENT'`
- **查询患者血糖数据属于"敏感操作"，必须逐条留痕**
- 审计日志表 **append-only**：只增，不改，不删（数据库层回收 UPDATE/DELETE 权限）
- 留存 **≥ 180 天**，导出与删除操作同样留痕

### 5.3 个人信息保护
- 患者姓名、身份证号、手机号：**加密存储**，列表接口默认返回**脱敏**值（`张**`、`138****1234`）
- 脱敏**唯一实现是 `packages/shared/src/mask`**（`import { maskName, maskPhone, maskIdCard } from '@gc/shared'`）：
  姓名只保留姓氏（复姓保留前两字，`欧阳明`→`欧阳*`）、身份证保留前 3 后 4、手机号保留前 3 后 4。
  **禁止另写脱敏函数**（`field-crypto` 曾有一套同名不同规则的副本，2026-11-17 已删除）。
  两条不变量：脱敏值**绝不等于原值**、**输出长度等于输入长度**。
  ⚠️ `*Masked` 是**落库字段**，改脱敏规则必须同时跑 `pnpm db:remask -- --apply` 刷新存量，否则新旧格式混杂
- 加密方案（2026-11-17 起）：**确定性 AES-256-GCM**，密钥取环境变量 `PATIENT_FIELD_KEY`（经 HKDF 派生加密钥与 nonce 钥）。
  **唯一实现是 `apps/server/src/common/crypto/field-crypto.ts`，`prisma/seed.ts` 也走它**，禁止另写一份
- 为什么必须**确定性**（nonce 由明文派生，同明文→同密文）：患者列表的姓名筛选靠密文等值匹配
  （`where.nameCipher = encryptDeterministic(query.name)`），随机 IV 会让搜索直接失效。
  已知代价：能看出"两条记录同名"。要消除需改随机 IV + 独立盲索引列，属表结构变更需评审
- 生产环境**必须**配置 `PATIENT_FIELD_KEY`：缺失时加密会静默降级成 base64（等于明文入库），
  故 `main.ts` 的 `assertFieldCryptoReady` 在生产直接拒绝启动。存量数据在配置密钥后需跑 `pnpm db:reencrypt -- --apply`
- ⚠️ **改 `.env` 里的 `PATIENT_FIELD_KEY` 后必须重启后端**：密钥只在进程启动时读入，改文件不影响已运行进程。
  未重启时新建患者会写成 base64 或旧钥密文，造成方案混杂、姓名搜索漏行，且**全程不报错**。
  本项 2026-11-17 一天内踩坑两次（后端 14:04 启动 / `.env` 14:33 修改；以及 14:38 / 14:58）。
  核对方式：**进程启动时间必须晚于 `.env` 修改时间**
- **换密钥（re-key）**：设 `PATIENT_FIELD_KEY_OLD` 为旧钥，跑 `pnpm db:reencrypt`（试运行）→ `pnpm db:reencrypt -- --apply`（写库）。
  脚本用旧钥解密、新钥（`PATIENT_FIELD_KEY`）加密，并回显新旧钥的 SHA-256 前 8 位**指纹**（不回显密钥本身）供操作者核对。
  跑完立即清除 `PATIENT_FIELD_KEY_OLD`，并重启后端。要点：
  - ⚠️ **旧钥一旦丢失，存量密文永久不可解密**。换钥前必须先备份旧钥与数据库
  - **失败即安全**：拿错旧钥或新旧钥写反时，全部 GCM 校验失败被跳过、**零写入**，据此可发现拿错钥
  - re-key 模式**不幂等**（方案迁移模式幂等）：跑完后存量已是新钥密文，再用同一把旧钥跑会全部跳过
  - 历史 `enc:hmac:` 密文不可逆，任何模式下都只会被跳过并计数
  - 标准流程、2026-11-17 的完整轮换演练记录（A→B→A 往返后密文逐字节相同）见 `docs/DB-MIGRATION-NOTES.md` §6
- **删除患者数据时一律不得连带删审计**：`AuditLog` 是 append-only（等保三级：只增不改不删、留存 ≥180 天），
  且其 `targetId` 不建外键。删患者只处理 `PatientDeviceBinding`（必填关系默认 Restrict，须先解绑）→ `Patient`
  （`GlucoseRecord` 是 `onDelete: Cascade`，随主表删除），审计行保留作为"该患者曾存在"的追溯凭证
- 最小必要：详情页才展示完整信息，且访问即留痕。
  ⚠️ **当前未实现**：`decryptField` 已具备解密能力但无任何接口调用；接入明文回显时必须同时加"访问即留痕"审计，属独立需求需单独出规格
- 导出 Excel/PDF 必须：走审批流程（或至少记录导出人/时间/范围）、文件加患者信息时附水印

### 5.4 账号与会话
- 密码：≥8 位，含大小写字母+数字，定期更换
- 登录失败 5 次锁定 30 分钟
- 会话 **30 分钟无操作自动登出**
- 全站 HTTPS；内网也需开启 TLS
- 预留双因子（OTP）扩展位

### 5.5 AI 数据边界（写给 AI 自己）
- ❌ **禁止把真实患者数据粘贴给 AI**，一律使用 `prisma/seed.ts` 生成的脱敏演示数据
- ❌ AI 不得连接生产/内网数据库
- ❌ AI 不得生成含真实密钥、密码、证书的代码

---

## 6. AI 协作工作流（强制）

1. **规格先行**：先有接口契约 / Zod schema / 测试用例，再让 AI 写代码
2. **一次一任务**：单个原子任务（一个接口 / 一个页面 / 一个函数），改完立即验证
3. **禁止整体重写大文件**：必须定点替换，减少回归风险
4. **提交前必过**：`pnpm lint && pnpm typecheck && pnpm test`
5. **AI 不得自行修改**（需人工审查）：
   - Prisma schema 与 migration
   - 鉴权、权限过滤、审计逻辑
   - CI / Docker / 依赖清单 / 环境变量
6. **上下文管理**：用 `@文件`、`@目录` 精准喂上下文，上下文变长就新开会话
7. **测试优先**：权限、越权、边界值、单位换算必须有单元测试

---

## 7. 命名与编码约定

- 文件/目录：`kebab-case`；React 组件文件：`PascalCase.tsx`
- 数据库字段：`camelCase`，表名复数或按 Prisma 默认
- 枚举：大写下划线定义（`POST_MEAL`），前端展示用中文映射表
- 接口响应统一结构：`{ code: number; message: string; data: T }`
- 错误码集中管理，禁止在业务代码里散落魔法数字
- 单文件建议 ≤ 300 行，超限即拆分

---

## 8. 常用命令

```bash
pnpm install
pnpm db:generate        # 生成 Prisma Client
pnpm db:migrate         # 开发环境建迁移
pnpm db:seed            # 灌脱敏演示数据
pnpm dev                # 前后端并行启动
pnpm build              # 全量构建
pnpm lint && pnpm typecheck && pnpm test
```
