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

- 认证：JWT（Bearer），载荷含 `userId / departmentId / permissions`
- 鉴权：`PermissionsGuard` 校验 `@RequirePermissions(...)` 声明的权限点
- **数据权限**：`ROLE_DATA_SCOPE` 定义角色可见范围，患者数据强制科室匹配
  - 护士 / 医生 / 护士长 → 本科室
  - 设备管理员 → 无患者数据（`DATA_SCOPE.NONE`）
  - 系统管理员 → 仅系统管理，**不自动拥有患者数据查看权**

角色 → 权限映射集中在 `packages/shared/src/dict/roles.ts`，前后端同源。

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
