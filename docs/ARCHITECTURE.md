# 架构说明

## 1. 总体架构

```
浏览器（医护）
   │ HTTPS / 内网
   ▼
Nginx（静态资源 + 反向代理 /api）
   │
   ▼
NestJS 单体服务 ──► PostgreSQL 16
   │                  ├─ 业务表（患者/设备/账号）
   │                  └─ 审计表（append-only）
   └─► Redis（会话黑名单 / 限流 / 验证码，可选）
```

**为什么是单体**：医护 < 2000，峰值并发 < 200，微服务带来的运维复杂度远超收益。

## 2. 分层

| 层 | 职责 | 约束 |
|---|---|---|
| Controller | 参数校验、鉴权标注、转发 | 不写业务逻辑 |
| Service | 业务逻辑 + 数据权限校验 | 唯一业务归属 |
| Prisma | 数据访问 | 禁止在 service 外实例化 |
| Guard / Interceptor | 横切：鉴权、权限、审计 | 全局注册，顺序固定 |

请求处理链：
`JwtAuthGuard → PermissionsGuard → ZodValidationPipe → Handler → AuditLogInterceptor → HttpExceptionFilter`

## 3. 权限模型

- 认证：JWT（Bearer）。载荷含 `sub`(= userId) / `username` / `displayName` / `departmentId` /
  `departmentName` / `permissions` / `roles` / `dataScope` / `mustChangePassword` / `permissionVersion`。
  `permissionVersion` 取用户 `updatedAt`，用于权限变更后使旧 token 失效
- 鉴权：`PermissionsGuard` 校验 `@RequirePermissions(...)` 声明的权限点
- **数据权限**：`@RequireDataScope(RESOURCE.X)` 标注接口，`ROLE_DATA_SCOPE` 决定可见范围。
  新增受数据权限约束的资源类型必须在 `roles.ts` 的 `RESOURCE` 中登记，否则数据权限不生效

角色 → 数据范围与关键权限差异：

| 角色 | 数据范围 | 权限要点 |
|---|---|---|
| 医生 `DOCTOR` | `DEPARTMENT` 本科室 | 可建档（2026-11-17 需求人决定），但**不含** `patient:update` / `patient:admit` |
| 护士 `NURSE` | `DEPARTMENT` 本科室 | 含建档、编辑、办理住院 |
| 护士长 `NURSE_HEAD` | `DEPARTMENT` 本科室 | 另含 `patient:manage`（归档）、`audit:view`、`quality:manage` |
| 设备管理员 `DEVICE_ADMIN` | `NONE` 无患者数据 | 只有设备 / 质控 / 公共数据权限 |
| 系统管理员 `SYS_ADMIN` | **`ALL` 全院** | **全部 22 个权限点**，含患者数据的查看 / 建档 / 编辑 / 归档 / 办理住院 |

> ⚠️ **系统管理员是全院数据范围，不是"仅系统管理"**。本节原表述"系统管理员 → 仅系统管理，
> 不自动拥有患者数据查看权"与代码长期相反，2026-11-17 经需求人裁定：**文档错、代码对**，已按
> `roles.ts` 实况（`ROLE_DATA_SCOPE.SYS_ADMIN = DATA_SCOPE.ALL`、`ROLE_PERMISSIONS.SYS_ADMIN` 含全部权限点）修正。
>
> 这与等保三级的最小必要原则存在张力，属**有意的设计取舍**而非缺陷——演示与运维需要单一账号可见全部功能。
> 若将来要收紧，须改 `roles.ts` 的 `ROLE_DATA_SCOPE` 与 `ROLE_PERMISSIONS`，属鉴权变更需人工评审，
> **不要只改文档**（本次事故正是文档与代码各说一套造成的）。

- `SELF`（仅本人）档已在 `apps/server/src/common/data-scope/scope.util.ts` 实现并有单测，
  但**当前无角色使用**，属预留
- 数据权限的唯一权威实现是 `apps/server/src/common/data-scope/scope.util.ts`
  （`buildScopeWhere` 生成列表 where、`assertInScope` 做单行越权校验、`canAccessResource` 前置快速失败）。
  **service 中禁止手写 `x.departmentId !== user.departmentId` 之类判断**，否则新模块极易漏掉数据权限。
  四档 × 各资源的完整语义表见 `docs/PERMISSION-DESIGN.md` §4
- 多角色时 `resolveDataScope` 取**最宽松**一档；无有效角色返回 `NONE`（最小权限兜底）；
  非法角色码直接忽略，避免脏数据扩大权限
- `NONE` 档角色访问 `PATIENT_SCOPED_RESOURCES`（当前为 `PATIENT`）一律拒绝；`SELF` 档同样不得访问 `PATIENT`
- 设计原则（见 `roles.ts` 注释）：**不留"超管后门"式的隐式放行**，权限一律用权限点显式表达。
  角色 → 权限映射集中在 `packages/shared/src/dict/roles.ts`，前后端同源
  （前端菜单/按钮显隐仅是体验，后端 `PermissionsGuard` 才是强制校验）

## 4. 数据模型要点

> ⚠️ 本节曾长期停留在 2026-10-22 重构后的"血糖模型已整体移除"状态，与实库严重不符——
> 而 `AGENTS.md` §4.6 还把本节当作现状的权威来源，AI 顺着指针读到的全是反的。
> 2026-11-17 按 `prisma/schema.prisma` 实况重写。**改 schema 后必须同步本节。**

**血糖模型现状**：`GlucoseRecord` **存在且在用**（`modules/glucose`），字段仅
`resultType / valueMmolL / mealContext / measuredAt / operatorId / testStrip / remark`（加 `id / patientId / createdAt`）。

- 统一存储 `mmol/L`（`valueMmolL Decimal? @db.Decimal(4,1)`）；**没有** `rawValue / rawUnit`，接口只收 mmol/L
- `measuredAt` 是业务主时间（`Timestamptz(3)`，医护填写）；**没有** `receivedAt`，排查用 `createdAt`
- 幂等靠唯一约束 `@@unique([patientId, measuredAt])`；**没有** `dedupeKey` 字段，
  也不要再拼 `manual:{patientId}:{ISO}` / `device:{deviceId}:{ISO}` 键
- **没有** `kind` / `rawPayload` / `GlucoseDailySummary`——CGM 扩展属目标态（见 §5），
  上线前一次性补 schema 并走人工评审，**禁止按 §5 直接加字段**
- `mealContext` 落库时段码（`TimeSlot.code`）。库层可空是给设备上报/历史数据留位，**应用层必填**；
  code 可用性由服务端查 `TimeSlot` 表判定（存在且 `enabled`），不用静态白名单
- 告警阈值存 `SystemConfig`（`glucose.low_threshold` / `glucose.high_threshold`），由 `SystemConfigService` 读取；
  配置缺失/非法/`low >= high` 时拒绝写入，**不退回默认常量**
- 关系删除语义：`patient` 是 `onDelete: Cascade`；`operator` 是 `onDelete: Restrict`
  （删用户不得抹掉录入人，医疗留痕优先）

**全部模型**：`Department / User / Role / UserRole / Patient / GlucoseRecord / Device /
PatientDeviceBinding / AuditLog / SystemConfig / DictItem / TimeSlot`。
患者敏感字段（姓名/身份证/手机号）加密存为 `*Cipher`，另存**落库**脱敏值 `*Masked`，见 `AGENTS.md` §5.3。

## 5. CGM 演进路径（目标态，当前未预留任何字段）

1. 新增数据接入 adapter，统一走 `GlucoseService`，不得改动上层
2. 一次性补齐 schema：`kind`（BGM/CGM）、`rawPayload Json?`（趋势箭头等）、日汇总表（TIR / CV）
3. 日汇总改为任务调度预计算，前端只读汇总表
4. **分区触发条件** = 启用 CGM 或单表超 5000 万行；当前 BGM 规模**不要分区**。
   执行前先补 `prisma/sql/glucose_record_partition.sql`——⚠️ **该文件当前不存在**，
   `prisma/sql/` 下只有 `binding_partial_unique.sql`
5. 前端图表开启 `sampling: 'lttb'` 与 `large: true`

## 6. 审计设计

- 触发方式：接口标注 `@Audit(action)`
- 记录字段：操作人、科室快照、动作、对象类型/ID、IP、UA、结果、白名单详情
- 存储：`AuditLog` 表，只增不改不删（DB 层回收 UPDATE/DELETE）
- 复用：登录失败次数也从该表统计，避免额外状态表

## 7. 部署与交付

- **开发（日常首选）**：`pnpm dev:up` —— 由 `.codebuddy/skills/gc-dev` 拉起**嵌入式 PostgreSQL** +
  后端(3000) + 前端(5173)，带增量判断，比 `pnpm dev` 快约 5-8 秒；`pnpm dev:down` 停止
  （保留数据库以加快下次启动）。日志在 `.devtools/logs/`
- 开发（Docker 方式，可选）：`docker compose up -d postgres redis` + `pnpm dev`
- 生产：单机 `apps/server`（Node 20）+ `apps/web/dist`（Nginx）+ PostgreSQL
- 内网离线：依赖走 pnpm store 离线包，镜像走 `docker save` 或私有仓库
- ⚠️ **仓库当前无 Dockerfile**：`docker-compose.yml` 里的 `gc-server:1.0.0` / `gc-web:1.0.0`
  是生产交付占位（已注释），镜像构建属 ROADMAP 的"Docker 化"待立项项
