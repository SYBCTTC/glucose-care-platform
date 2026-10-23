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

## 4. 数据模型要点（通用）

> 血糖相关模型（`GlucoseRecord` / `GlucoseDailySummary`）已于 2026-10-22 重构中整体移除。
> 以下要点仅作历史参考，恢复血糖功能时再据此重建。

- 统一存储 `mmol/L`（`valueMmolL`），原始值另存 `rawValue / rawUnit`
- `measuredAt` 为业务主时间（医护填写），`receivedAt` 为接收时间
- `dedupeKey` 保证幂等：手工 `manual:{patientId}:{ISO}`，设备 `device:{deviceId}:{ISO}`
- `kind` 区分 BGM / CGM，`rawPayload` 承载 CGM 扩展字段
- `GlucoseDailySummary` 为 CGM 的 TIR / CV 指标预留

## 5. CGM 演进路径（历史规划，功能已移除）

1. 新增数据接入 adapter，统一走数据接入服务（当前为 `GlucoseService`）
2. `kind = CGM`，趋势箭头等信息写入 `rawPayload`
3. 日汇总改为任务调度预计算，前端只读 `GlucoseDailySummary`
4. 数据量超阈值时按月分区（见 `prisma/sql/glucose_record_partition.sql`）
5. 前端图表开启 `sampling: 'lttb'` 与 `large: true`

## 6. 审计设计

- 触发方式：接口标注 `@Audit(action)`
- 记录字段：操作人、科室快照、动作、对象类型/ID、IP、UA、结果、白名单详情
- 存储：`AuditLog` 表，只增不改不删（DB 层回收 UPDATE/DELETE）
- 复用：登录失败次数也从该表统计，避免额外状态表

## 7. 部署与交付

- 开发：`docker compose up -d postgres redis` + `pnpm dev`
- 生产：单机 `apps/server`（Node 20）+ `apps/web/dist`（Nginx）+ PostgreSQL
- 内网离线：依赖走 pnpm store 离线包，镜像走 `docker save` 或私有仓库
