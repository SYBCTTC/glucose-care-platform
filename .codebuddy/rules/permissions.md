---
description: 权限控制（功能权限 + 数据权限）。新增接口、查询、按钮、菜单的改动必读。
globs: ["apps/server/**", "apps/web/**", "packages/shared/**"]
---

# 权限控制规范（强制）

完整方案：`docs/PERMISSION-DESIGN.md`。错误码：`docs/ERROR-CODES.md`。

> 权限字典（`ROLE_PERMISSIONS` / `ROLE_DATA_SCOPE` / `RESOURCE` / `DATA_SCOPE_LABELS`）都在共享包，改完必须走 `.codebuddy/rules/shared-package.md` 的 **build → sync:shared → 清 Vite 缓存** 三步，否则前端取不到新导出会白屏（已发生过一次）。

## 核心原则

**前端判断"能不能点"只是体验，服务端判断"能不能看 / 能不能写"才是安全边界。**

每个受保护接口都要经过三层，缺一不可：

```
① JwtAuthGuard（认证）→ ② @RequirePermissions（功能权限）→ ③ 数据范围过滤（数据权限）
```

## 硬规则

1. **禁止手写部门比较**
   ❌ `if (patient.departmentId !== user.departmentId) throw ...`
   ✅ `assertInScope(user, RESOURCE.PATIENT, patient)`
   ✅ `where = { ...buildScopeWhere(user, RESOURCE.GLUCOSE), patientId }`
   唯一实现在 `apps/server/src/common/data-scope/scope.util.ts`。

2. **新增接口必须挂两个装饰器**
   ```ts
   @RequirePermissions(PERMISSION.GLUCOSE_VIEW)
   @RequireDataScope(RESOURCE.GLUCOSE)
   ```
   只加权限点不加数据范围 = 越权漏洞。

3. **新增资源类型先登记** `packages/shared/src/dict/roles.ts` 的 `RESOURCE` 与 `PATIENT_SCOPED_RESOURCES`，
   `buildScopeWhere` 的 `default` 分支会按最小权限拒绝未登记资源。

4. **权限点/角色/数据范围只能在共享包定义**（`ROLE_PERMISSIONS` / `ROLE_DATA_SCOPE`），
   服务端与前端共用，禁止各自硬编码；改完按 `.codebuddy/rules/shared-package.md` 同步。

5. **多角色取并集**：权限点取并集（`resolvePermissions`），数据范围取**最宽松档**（`resolveDataScope`）；
   无有效角色 → `NONE`（最小权限兜底），非法角色码直接忽略。

6. **敏感字段默认脱敏**：列表与详情默认返回脱敏值；返回完整值必须单独接口 + 权限点 + 审计留痕。

   ⚠️ **当前存在两套同名脱敏实现，规则不一致，待需求人裁定（2026-11-17 发现）**：

   | 实现 | 谁在用 | `maskIdCard('110101199003074512')` | `maskName('欧阳明')` |
   |---|---|---|---|
   | `apps/server/src/common/crypto/field-crypto.ts` | **实际生效**：`patient.service.ts` 建档/编辑、`prisma/seed.ts` | `110********12`（前 3 后 2） | `欧*明`（无复姓检测） |
   | `packages/shared/src/mask`（已从 `@gc/shared` 导出） | **无任何代码引用** | `110***********4512`（前 3 后 4） | `欧阳*`（有复姓检测） |

   本条原先写"一律走 `packages/shared/src/mask`"，但那个模块实际是死代码。
   **在裁定前不要擅自统一**：`*Masked` 是**落库字段**而非读取时计算，换实现会让 1001 条存量行
   与新行格式不一致。新增脱敏需求时先问清用哪套，不要从 `@gc/shared` 顺手 import
   （名字相同、行为不同，极易踩错）。

7. **越权必须落审计**：`30002`（跨科室）、`30006`（角色无患者数据权限）、`30004`（缺权限点）
   都会被审计拦截器记为 `DENIED`，等保检查重点。
   判定依据是**错误码号段 `3xxxx`**（`AuditLogInterceptor.resolveAuditResult`），不是异常类型；
   `detail.errorCode` 带具体码。2026-11-17 之前按 `instanceof ForbiddenException` 判，
   而全仓无人抛该异常，导致越权全记 `FAILED`——已修，**不要改回去**。

8. **过渡期约定**：JWT 目前仍内嵌 `permissions / roles / dataScope`（方案 B 落地前）。
   改权限需重新登录才生效；P2 将改为「JWT 只带 `sub` + `pv`，权限由服务端缓存解析」。
   旧 token 缺 `roles/dataScope` 时一律拒绝并要求重登，**不要**用默认值兜底。

## 数据范围四档

| 档 | 过滤 | 适用 |
|---|---|---|
| `ALL` | 不加限制 | 系统管理员 |
| `DEPARTMENT` | `departmentId`（血糖走 `patient.departmentId`） | 医生/护士/护士长 |
| `SELF` | `operatorId`（患者资源一律拒绝） | 实习/进修 |
| `NONE` | 禁止 `PATIENT` / `GLUCOSE`，设备台账仍按科室 | 设备管理员 |

## 前端

- 权限集合来自 `/auth/profile`（`permissions` / `roles` / `dataScope` / `permissionVersion` / `mustChangePassword`），
  **不要**从 JWT 里解析权限（P2 后 JWT 不再携带）。
- 菜单、路由、按钮三层都要判权限；路由级无权限显示 403 提示页，**不跳登录**。
- **路由与菜单必须同源**：唯一配置是 `apps/web/src/routes/routes.tsx` 的 `APP_ROUTES`
  （`label/icon` 决定菜单项，`permissions` 决定守卫，`menuGroup` 决定归入哪个大模块）。
  新增页面只改这里，禁止在 `BasicLayout` 另写一份菜单数组（两处配置必然出现"菜单藏了、路由没守"的越权入口）。
- 菜单渲染由 `buildMenuTree`（`apps/web/src/routes/menu.tsx`）从 `APP_ROUTES` 聚合：
  按 `menuGroup` 生成分组，**无权限的分组自动剪枝**（不展示空菜单），默认展开全部分组。
- `PermissionRoute` 语义：权限点**任一满足**即可进入；`profile` 未就绪时显示加载态而不是 403
  （刷新页面时权限是异步返回的，直接判 403 会误伤）。
- 收到 `30004` / `30002` 时先重拉一次 `/auth/profile` 再提示（权限可能已变更）：
  由 `error-handler` 派发 `gc:refresh-profile`，`BasicLayout` 负责重拉，3 秒内只触发一次。

## 易错点

- 只给接口加 `@RequirePermissions` 就以为安全了 —— 那只是功能权限，数据权限必须另加。
- 把 `dataScope` 当成前端过滤条件 —— 服务端才是边界，前端只是提示。
- 新增查询时复制旧代码里的 `where`，把科室过滤漏掉了 —— 用 `buildScopeWhere` 就不会漏。
