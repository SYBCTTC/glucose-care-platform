---
description: 医疗数据合规、权限与审计强制要求。涉及鉴权、患者数据查询、导出、日志时必读。
globs:
  - 'apps/server/src/common/**'
  - 'apps/server/src/modules/auth/**'
  - 'apps/server/src/modules/patient/**'
  - 'apps/server/src/modules/audit/**'
---

# 安全、权限与审计规则（等保三级）

## 权限
- 角色枚举只能用 `@gc/shared` 的 `RoleCode`
- **所有患者数据查询必须经过统一的数据权限过滤器**，禁止各自写 where
- 护士 → 本科室患者；医生 → 管辖患者；设备管理员 → 仅设备
- 医生**可建档**（`PATIENT_CREATE`，2026-11-17 授予），但数据范围仍是 `DEPARTMENT`，
  只能建本科室患者；未授予 `PATIENT_UPDATE` / `PATIENT_ADMIT`
- 越权返回 403 + 写审计日志

## 审计（硬要求）
- 覆盖：登录、登出、查看患者详情、查看血糖数据、导出、增删改患者/设备/记录
- 字段：操作人、时间、IP、UA、操作类型、对象类型+ID、关键字段变更前后、结果
- **append-only**：禁止提供 UPDATE / DELETE 接口
- 留存 ≥ 180 天

### `result` 三值语义（2026-11-17 起真正生效，改拦截器前必读）
- `DENIED` **按错误码号段判定**：`3xxxx`（授权与数据权限）→ `DENIED`，其余异常 → `FAILED`。
  见 `AuditLogInterceptor` 的 `resolveAuditResult`
- **禁止改回按异常类型判**（`error instanceof ForbiddenException`）：项目规范要求业务错误一律抛
  `BusinessException`，全仓无任何守卫/service 抛 `ForbiddenException`，按类型判会让该分支不可达、
  越权全部落成 `FAILED`，审计表就筛不出越权尝试（这是 2026-11-17 修掉的真实缺陷，实测 `DENIED` 仅 1 行）
- 失败时 `detail.errorCode` 必须带具体码；取不到码时**不写该键**，不要塞 `null`
- 只认数字码：Prisma 的 `PrismaClientKnownRequestError.code` 是 `'P2002'` 这类字符串，不得当业务码
- `detail.requestId` 必须取 `request.requestId`（`RequestIdMiddleware` 生成，与响应头 `X-Request-Id` 同值）。
  **不是** `context.getClass().name`——那是修掉的旧 bug，会导致审计行无法与日志、用户报障关联

### `targetType` / `targetId` 取值（2026-11-17 起）
- 默认从 URL `params.id` 取；未显式声明 `targetType` 时，取到 ID 即记 `'PATIENT'`（沿用旧口径）
- **创建类接口 URL 没有 `:id`**，新对象 ID 只在响应信封里，必须显式声明：
  `@Audit('PATIENT_CREATE', { targetType: 'PATIENT', targetIdFrom: 'data.id' })`
- `targetIdFrom` 是相对**响应信封** `{ code, message, data }` 的点号路径（拦截器在 `ResponseInterceptor` 外层，
  看到的是已包装的信封）。取值用手写遍历，**禁止 `eval` / `new Function`**
- 只接受非空字符串：路径写错时表现为审计字段留空（可发现），而不是写进一个错误的值（难发现）
- 给**非患者**对象的 `:id` 路由加 `@Audit` 时**必须显式传 `targetType`**，否则会被误记成 `'PATIENT'`
- 存量审计行不回改：`db8f363` 之前的行越权仍记 `FAILED`、`requestId` 仍是类名、无 `errorCode`，按 `createdAt` 分界解读

## 个人信息
- 姓名/身份证/手机号：加密存储 + 列表脱敏
- **加密唯一实现**：`apps/server/src/common/crypto/field-crypto.ts`，`prisma/seed.ts` 也走它，
  **禁止另写一份**（seed 曾自带 `cipher()` 副本，会绕过加密写 base64）
- **脱敏唯一实现**：`packages/shared/src/mask`（从 `@gc/shared` 导入）。
  `field-crypto` 曾有一套同名但规则不同的副本，2026-11-17 已删除，**禁止重新实现**。
  规则与两条不变量（不得回显原值、输出长度等于输入长度）见 `permissions.md` 第 6 条。
  改脱敏规则必须同时跑 `pnpm db:remask -- --apply` 刷新存量 `*Masked`（落库字段）
- 算法：**确定性 AES-256-GCM**（SIV 式，nonce 由明文派生），密钥取 `PATIENT_FIELD_KEY`。
  必须确定性——姓名筛选靠密文等值匹配，随机 IV 会让搜索失效。**禁止改成随机 IV**，
  除非同时加独立盲索引列（表结构变更，需评审）
- 密文前缀带版本号（`enc:aes256gcm:v1:` / 历史 `enc:hmac:` / 开发兜底 `enc:`），换算法时靠它共存与迁移
- 生产必须配 `PATIENT_FIELD_KEY`：缺失时加密静默降级成 base64（等于明文入库），
  故 `main.ts` 的 `assertFieldCryptoReady` 在生产拒绝启动。存量数据配钥后跑 `pnpm db:reencrypt -- --apply`
- `decryptField` 解密失败一律返回 `null` 并打警告，**不抛错**（展示路径不该让列表接口 500），
  也**绝不返回错误明文**
- 明文回显到详情页**尚未实现**：接入时必须同时加"访问即留痕"审计，属独立需求需单独出规格
- 列表接口默认不返回完整身份信息
- 导出必须留痕（导出人、时间、范围、条数）

## 账号与会话
- 密码策略、失败锁定、30 分钟空闲超时、HTTPS、预留 OTP

### 密码策略（已落地）
- 唯一实现：`packages/shared/src/auth/password.ts` 的 `checkPasswordStrength`，前后端共用，**禁止另写一套正则**
- 规则：长度 8–64，小写/大写/数字/符号**四类至少三项**，不得包含用户名或姓名
- 登录与改密共用 `passwordSchema`（`packages/shared/src/auth/schema.ts`）
- 首次登录/被重置后 `mustChangePassword = true`：除改密、登出、profile 外，
  `MustChangePasswordGuard` 一律拒绝并返回 `20005`（前端弹不可关闭的改密框，这只是体验，边界在服务端）
- 改密必须：校验原密码（`20007`）、校验强度（`10001`/`20006`）、禁止与旧密码相同（`20009`）、
  写入 `passwordChangedAt`、审计 `PASSWORD_CHANGE`
- 已知遗留：改密后旧 JWT 无法立即失效，P2 `pv` 机制解决；不要在本阶段引入临时黑名单方案

## AI 边界
- 禁止将真实患者数据喂给 AI；一律用 seed 脱敏数据
- 禁止 AI 生成含真实密钥/证书的代码
- 鉴权、审计、权限过滤的改动必须人工逐行评审
