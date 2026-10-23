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
- 越权返回 403 + 写审计日志

## 审计（硬要求）
- 覆盖：登录、登出、查看患者详情、查看血糖数据、导出、增删改患者/设备/记录
- 字段：操作人、时间、IP、UA、操作类型、对象类型+ID、关键字段变更前后、结果
- **append-only**：禁止提供 UPDATE / DELETE 接口
- 留存 ≥ 180 天

## 个人信息
- 姓名/身份证/手机号：加密存储 + 列表脱敏
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
