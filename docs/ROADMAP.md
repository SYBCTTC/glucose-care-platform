# 项目开发计划 P0–P6（唯一权威路线图）

> 用途：后续所有开发按本表推进。**README 第八节"待办"已并入本表，以本文档编号为准。**
> 状态更新规则：每完成一项，把 ✅/进展写回本文件，并在 PR/提交说明中引用阶段号（如 `P4-患者建档`）。

## 总览

| 阶段 | 主题 | 进度 | 状态 |
|---|---|---|---|
| P0 | 工程底座与规范 | 100% | ✅ 完成 |
| P1 | 认证与会话 | 100%（双因子待院方确认） | ✅ 完成 | — |
| P2 | 权限体系（功能 + 数据） | 75% | 🟡 服务端 + 前端路由守卫完成；剩按钮守卫、JWT 瘦身、变更生效 |
| P3 | 血糖核心业务（BGM） | 已移除 | ⚪ 2026-10-22 整体移除（路由/页面/API/权限点/表） |
| P4 | 患者管理 | 0% | ⬜ 未开始（后端接口 + 前端页面 + 真实加密） |
| P5 | 设备管理与导出 | 0% | ⬜ 未开始 |
| P6 | 审计、系统管理与生产交付 | 8% | ⬜ 仅阈值配置与 Swagger 生产关闭落地 |

整体完成度约 **50%**（可控范围内）。

```mermaid
flowchart LR
    P0[P0 底座] --> P1[P1 认证] --> P2[P2 权限] --> P3[P3 血糖] --> P4[P4 患者] --> P5[P5 设备+导出] --> P6[P6 审计+交付]
    style P0 fill:#c8e6c9
    style P1 fill:#dcedc8
    style P2 fill:#fff9c4
    style P3 fill:#fff9c4
    style P4 fill:#eeeeee
    style P5 fill:#eeeeee
    style P6 fill:#eeeeee
```

---

## P0 工程底座与规范 —— ✅ 100%

| 交付物 | 位置 |
|---|---|
| pnpm workspace + TS/ESLint/Vitest 门禁 | 根 `package.json`、`eslint.config.mjs` |
| 共享契约包 `@gc/shared` | `packages/shared`（Zod 契约、单位换算、角色权限字典、错误码、脱敏） |
| UI 设计令牌与主题 | `docs/UI-DESIGN-TOKENS.md`、`apps/web/src/styles/tokens.ts` |
| 数据模型 7 张表 | `apps/server/prisma/schema.prisma`（Department/User/Role/UserRole/Patient/Device/PatientDeviceBinding/AuditLog/SystemConfig） |
| 迁移 + 脱敏演示数据 | `prisma/migrations`、`prisma/seed.ts` |
| 架构与合规文档 | `docs/ARCHITECTURE.md`、`docs/COMPLIANCE-CHECKLIST.md` |
| AI 强制规则 | `.codebuddy/rules/*`（错误码、权限、共享包流程、血糖领域、安全审计、UI 令牌） |

**验收**：`pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿 ✅

---

## P1 认证与会话 —— ✅ 100%

### 已完成
- 登录 / 登出 / `profile`；JWT（当前内嵌 `permissions/roles/dataScope`）
- 登录失败 5 次锁定 30 分钟（基于审计表统计，无额外状态表）
- 会话空闲 30 分钟自动登出（前后端一致）
- 统一错误码落地（`20001/20002/20003`…）+ `requestId` + 响应拦截器
- 审计拦截器写 `SUCCESS/DENIED/FAILED`
- **首次登录强制改密**（2026-10-21 完成）：`User.mustChangePassword` + `MustChangePasswordGuard`
  （强制期间仅放行改密/登出/profile）+ 改密接口 + 不可关闭弹窗 + 个人资料弹窗
- **密码策略统一**：长度 8–64，小写/大写/数字/符号四类至少三项，不得包含用户名或姓名
  （共享实现 `packages/shared/src/auth/password.ts`，登录与改密共用）

### 未完成（等院方确认后启动）
| 任务 | 说明 | 涉及 |
|---|---|---|
| 1. 密码有效期提醒 | 已有 `passwordChangedAt`，到期前 N 天提示/强制更换 | `auth.service` + 前端 |
| 2. 双因子（OTP/UKey） | 待院方确认方式 | — |

### 已知遗留（P2 解决）
改密成功后旧 JWT 无法立即失效（令牌不含权限版本）。缓解：`mustChangePassword` 为 true 的旧令牌
仍会被 `MustChangePasswordGuard` 拦在业务接口之外；彻底解决依赖 P2 的 `pv` 机制。

---

## P2 权限体系（功能权限 + 数据权限）—— 🟡 75%

### 已完成（服务端 100%）
- 权限点 16 个（初始 9 个 + 新增 7 个：ward/alert/quality/quality_manage/staff/staff_manage/role）+ 角色 5 个 + 数据范围 4 档，前后端同源字典
- `PermissionsGuard` + `@RequirePermissions`
- **数据权限统一出口**：`buildScopeWhere` / `assertInScope` / `canAccessResource` + `@RequireDataScope`
- `30006` 角色无患者数据权限；跨科室 `30002`；缺权限点 `30004`
- `/auth/profile` 下发 `roles` / `dataScope` / `permissionVersion`，`login` 返回 `expiresAt`
- 脱敏工具 `maskIdCard/maskPhone/maskName/maskPatientNo`
- 单元测试 18 项（`scope.util.spec.ts`）

### 已完成（前端 P2-1，2026-10-21）
- **路由守卫** `PermissionRoute` + 403 页：无权限不再进入页面（不跳登录）
- **路由与菜单同源**：唯一配置 `apps/web/src/routes/routes.tsx` 的 `APP_ROUTES`
- `SYS_ADMIN` 权限点补全为全部 9 个（原仅 2 个，守卫上线后会连业务页都进不去）
- 收到 `30004` / `30002` 先重拉一次 `/auth/profile` 再提示（3 秒内只触发一次）
- 守卫单测 6 项（`permission-route.spec.tsx`）
- **左侧菜单与默认首页**（2026-10-22）：`APP_ROUTES` 以 `menuGroup` 聚合五大模块
  （住院/设备/质控/系统/人员），无权限分组自动隐藏；`buildMenuTree` 纯函数 + 单测。
  **移除工作台**，`/` 重定向至
  `/inpatient/patients`，登录后默认进入「住院管理 - 患者管理」。

### 未完成

| # | 任务 | 阻断风险 |
|---|---|---|
| 2 | **按钮级守卫** `<Auth permission>` 组件 + `usePermission()` | 体验与合规 |
| 3 | **JWT 瘦身**（方案 B：只带 `sub` + `pv`）+ 服务端权限缓存（进程内，多实例改 Redis） | 权限变更滞后 |
| 4 | **权限变更即时生效** + 账号停用强制下线（`jti` 黑名单） | 等保"及时终止会话" |
| 5 | `@RequireAllPermissions`（写操作需全部满足，而非任一） | 细粒度授权 |

---

## P3 血糖核心业务（BGM）—— ⚪ 已整体移除（2026-10-22）

> ⚠️ 本模块（录入/查询/汇总/导出/数据管理）已于 2026-10-22 重构中整体移除：路由/页面/API/
> 权限点（GLUCOSE_VIEW/INPUT/EXPORT）/数据库表（GlucoseRecord、GlucoseDailySummary）均已删除。
> 以下为历史规划，仅供后续重建血糖功能时参考。

### 已完成（历史）
- 手工录入：单位换算 → 统一 `mmol/L`、`dedupeKey` 幂等、超阈值自动置 `PENDING_REVIEW`
- 分页查询、日汇总趋势（ECharts）、阈值从 `SystemConfig` 读取（禁止硬编码）
- 前端录入页 + 工作台

### 未完成

| # | 任务 | 说明 |
|---|---|---|
| 1 | **患者选择器** | 当前手填 `patientId`（`GlucoseEntry.tsx:158`），依赖 P4 患者列表接口 |
| 2 | **异常值复核** | `PENDING_REVIEW → NORMAL/REJECTED` 接口 + 页面；并发处理用 `41002 GLUCOSE_ALREADY_REVIEWED` |
| 3 | **记录作废策略** | 明确"只增不改"：作废 = 置状态 + 留痕，禁止物理删除 |
| 4 | 趋势页增强 | 大字号/打印友好、阈值区间着色、异常点标注 |
| 5 | 接口集成测试 | 目前仅单元测试，需补 supertest 级用例（录入/幂等/越权/复核） |

---

## P4 患者管理 —— 🟡 50%

> 前置：App.tsx 现为 Placeholder；等保要求"列表不返回完整身份信息"。

| # | 任务 | 关键点 |
|---|---|---|
| 1 | **真实加密替换占位** | `Patient.*Cipher` 现为 base64 占位（等保硬项）→ AES-256-GCM 或国密 SM4，密钥由环境变量/院方 KMS 注入，**禁止入库** |
| 2 | 建档接口 ✅ 2026-10-26 | `POST /patients`（权限点 `patient:create`）；住院号唯一（`40002`）、写入 `*Masked`、审计 `PATIENT_CREATE`；责任医护需属所选科室 |
| 3 | 列表接口 ✅ 2026-10-26 | 分页 + 脱敏 + 关键词（按脱敏值/住院号）+ `buildScopeWhere(RESOURCE.PATIENT)` |
| 4 | 详情与按需查看 ⬜ | 默认脱敏；查看完整身份信息需 `PATIENT_MANAGE` + 单独接口 + 审计留痕 |
| 5 | 归档 ⬜ | `archivedAt` 软删除；已归档患者禁止录血糖（`30003 PATIENT_ARCHIVED`） |
| 6 | 前端页面 🟡 | 列表、卡片、筛选、添加患者弹窗 ✅；详情/编辑/归档待做 |

**验收**：`dr.chen`（心内科）访问内分泌患者返回 `30002`；设备管理员访问返回 `30006`；列表不出现明文身份证。

---

## P5 设备管理与导出 —— ⬜ 0%

| # | 任务 | 关键点 |
|---|---|---|
| 1 | 设备注册 | SN 唯一（`42002`）、台账字段（采购/保修）、审计 |
| 2 | 绑定/解绑患者 | 同一设备同时只能绑一个有效患者（partial unique）；`DEVICE_BOUND_TO_OTHER 42003` |
| 3 | 状态与校准 | `DeviceStatus` 流转、校准过期校验（`42005`） |
| 4 | 在线状态 | 基于 `lastReportAt` 判定 |
| 5 | **导出（Excel/PDF）** | 异步任务（`41008 GLUCOSE_EXPORT_RUNNING`）、**水印 + 审批留痕**、限流；PDF 需含导出人与时间 |
| 6 | 厂商接入预留 | `9xxxx` 错误码已定义；adapter 与验签待厂商协议确定 |

---

## P6 审计、系统管理与生产交付 —— ⬜ 8%

### 已完成
- 阈值配置读取、生产环境自动关闭 Swagger

### 未完成

| # | 任务 | 说明 |
|---|---|---|
| 1 | 审计查询页 | 护士长/系统管理员可见；按人/时间/动作/结果筛选；**按错误码统计安全事件**（需 `AuditLog.errorCode` 字段 + 迁移） |
| 2 | 审计留存清理任务 | ≥180 天；定时清理归档（等保） |
| 3 | 用户与角色管理 | 增删改、停用、角色分配；`LAST_ADMIN_PROTECTED 43003`、`CANNOT_MODIFY_SELF_ROLE 43004` |
| 4 | 系统配置页 | 血糖阈值等 `SystemConfig` 可视化维护（改动需审计） |
| 5 | 生产交付资产 | **当前缺失**：`Dockerfile`（server/web）、Nginx 配置（TLS 终止 + 静态资源）、备份与恢复脚本、健康检查与监控、`docker-compose` 现仅有 DB |
| 6 | 告警与统计看板 | 高低血糖预警列表、科室统计（README 原 P2 项） |
| 7 | CGM 演进 | adapter 统一入口、`kind=CGM`、日汇总预计算、按月分区（`prisma/sql/glucose_record_partition.sql`） |
| 8 | 运维手册 | NTP、备份演练、堡垒机、漏洞扫描等（等保第 7 节） |

---

## 建议推进顺序（依赖优先）

```
P2-1/2 前端路由与按钮守卫  ← 越权入口，先堵
P3-2/3 异常复核 + 作废策略  ← 业务闭环
P4-1   真实加密（等保硬项，越晚改迁移成本越高）
P4-2~6 患者模块
P5-1~4 设备模块
P5-5   导出
P6-1~3 审计与用户管理
P6-5   生产交付资产
```

## 非代码事项（需院方/运维确认，不在代码计划内）

- 患者信息采集的告知与同意流程
- 双因子认证方式（短信/OTP/UKey）
- 数据保留期限与删除流程（当前仅归档）
- 服务器 NTP、杀毒、堡垒机、备份演练
- 生产密钥（JWT_SECRET、数据库口令、字段加密密钥）注入方式
