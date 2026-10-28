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
- 换算函数**只允许**使用 `packages/shared/src/glucose/units.ts`，**禁止在别处硬编码 18**

### 4.2 时间
- `measuredAt`：**血糖实际测量时间**（手工录入时由医护填写），业务主时间
- `receivedAt`：服务器接收时间，仅用于排查（**当前 schema 无此字段**，排查用 `createdAt`）
- 数据库统一存 **UTC**（`timestamptz`），前端用 dayjs 按本地时区展示
- **禁止**用 `new Date()` 作为 `measuredAt` 的默认值（AI 高频错误）
- 内网服务器时间必须 NTP 同步（运维项）

### 4.3 取值范围与异常
- 合法范围：**0.6 ~ 33.3 mmol/L**（含边界；与结果类型 `Low`(< 0.6) / `High`(> 33.3) 阈值对齐，边界值仍属合法读数）
- 超范围**不入库**：由 `createGlucoseSchema`（`packages/shared/src/glucose/schema.ts`）直接拒绝（10001）；当前**无 `status` 字段**，无 `PENDING_REVIEW` 流程
- 默认告警阈值：低血糖 `< 3.9 mmol/L`，高血糖 `> 16.7 mmol/L`（阈值需可配置，从系统配置读取，**禁止硬编码在业务代码**）

### 4.4 录入上下文（BGM 必填）
- `mealContext` **应用层必填**（`createGlucoseSchema` 强制），落库**时段码**（`TimeSlot.code`）：普通 `FASTING`/`BREAKFAST_PRE`/`BREAKFAST_POST`/`LUNCH_PRE`/`LUNCH_POST`/`DINNER_PRE`/`DINNER_POST`/`BEDTIME`，特殊 `RANDOM`/`RETEST`，强化 `INTENSIVE_AM`/`INTENSIVE_PM`/`INTENSIVE_NIGHT`
- 库字段 `GlucoseRecord.mealContext` 为 `String?`（`schema.prisma:156`），是给设备上报/历史数据留位；**不得因库可空就放宽前端或接口校验**
- 时段的**名称/起止时间/类型/控糖目标**是动态数据（表 `TimeSlot`，接口 `GET /time-slots`，前端 `useCommonDataStore().timeSlots`）；code 是契约，名称可改，**禁止按名称匹配**
- 已知取舍：`createGlucoseSchema` 的 code 白名单来自 `@gc/shared` 的 `TIME_SLOTS`（静态），库里新增时段必须同步 shared，否则提交被 10001 拒绝（见 `docs/COMMON-DATA.md` 已知约束）
- 手工录入时 `operatorId` 必须记录当前医护 ID（**留痕**）

### 4.5 去重（**当前未实现，属目标态**）
> 现状：`GlucoseRecord`（`schema.prisma:148`）无 `dedupeKey`，服务端无唯一约束兜底，
> 同一患者同一 `measuredAt` 重复提交会落**两条记录**。这是已知缺口，不是允许的行为。

- 落地前必须先走 Prisma schema + migration 人工评审，**不得在业务代码里假装该字段存在**
- 规格（恢复时按此实现）：手工录入 `manual:{patientId}:{measuredAtISO}`，设备上传 `device:{deviceId}:{measuredAtISO}`
- 唯一约束冲突时**静默跳过**（幂等），不得抛错

### 4.6 CGM 扩展（**当前未预留，属目标态**）
> 现状（2026-10-22 重构后简化重建，见 `docs/ARCHITECTURE.md:43-60`）：`GlucoseRecord` 仅
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
- **护士只能看本科室患者**，医生看管辖患者，设备管理员看设备不看患者数据
- **权限校验必须在后端**，前端隐藏按钮只是体验
- **所有患者数据查询必须统一经过"数据权限过滤"**，禁止每个接口各自写 where 条件
- 越权访问返回 `403` 并**记录审计日志**

### 5.2 审计日志（等保三级硬要求）
- 记录：操作人 / 时间 / IP / 操作类型 / 对象（患者 ID）/ 变更前后的关键字段 / 结果
- **查询患者血糖数据属于"敏感操作"，必须逐条留痕**
- 审计日志表 **append-only**：只增，不改，不删（数据库层回收 UPDATE/DELETE 权限）
- 留存 **≥ 180 天**，导出与删除操作同样留痕

### 5.3 个人信息保护
- 患者姓名、身份证号、手机号：**加密存储**，列表接口默认返回**脱敏**值（`张*三`、`138****1234`）
- 最小必要：详情页才展示完整信息，且访问即留痕
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
