# 患者详情「出入院记录」Tab — 功能规格

> 状态：**已落地**（2026-11-26，三件套全绿 + playwright 全链路实测通过）
> 裁定过程与实施验证见 §8 变更记录。模板：`docs/FEATURE-SPEC-TEMPLATE.md`。

## 1. 需求（2026-11-26 需求人原始描述）

作为用户，希望可以查看患者的出入院记录，方便管理患者。

- 做：患者详情主 Tabs 第三个模块「出入院记录」（替换现占位页）
- 不做：主 Tabs 中的其他模块
- 列表表头：**日期、科室、住院号、责任医生、责任护士、操作人**
- 日期 = `住院开始时间（YYYY-MM-DD HH:mm:ss）至 结束时间（YYYY-MM-DD HH:mm:ss）`；
  在院患者第一条为 `开始时间 至 -`；按时间**倒序**展示
- 操作人 = 当时办理住院的账号
- **不分页**，直接展示全部记录

## 2. 数据模型（裁定 1：schema 变更，已批准）

`Admission` 表现状只有 seq / admittedAt / dischargedAt / departmentId，**没有**住院号、
责任医护、操作人——这些值只存 `Patient` 且每次办理住院覆盖式写入（P2-6），历史值已丢。

新增 4 个**可空**列（存量旧行不回填、显示「-」，不拿现值造假历史）：

| 列           | 类型         | 写入时机                                       |
| ------------ | ------------ | ---------------------------------------------- |
| `patientNo`  | VarChar(32)? | 建档（seq=1）/ 办理住院（seq+1），取当次住院号 |
| `doctorId`   | Uuid? → User | 同上，取当次责任医生（可空）                   |
| `nurseId`    | Uuid? → User | 同上，取当次责任护士（可空）                   |
| `operatorId` | Uuid? → User | 同上，取当次操作的登录账号（裁定 3）           |

- 关系命名 `AdmissionDoctor` / `AdmissionNurse` / `AdmissionOperator`（同 `PatientDoctor` 模式），
  User 侧加三条反向关系；`onDelete` 默认 Restrict（同 Patient.doctorId 口径，用户被引用不可删）
- **操作人口径（裁定 3）**：办理住院 = 点提交的账号；建档直接建为住院患者的 seq=1 记录，
  操作人 = 建档操作人。两条创建 Admission 的路径都写当前登录账号
- **seed.ts 同步补齐**：seed 原本不创建 Admission 行（存量靠 R24 迁移内的一次性回填 SQL，
  全新环境 migrate deploy 时 Patient 表为空、回填为空转 → 新库患者无住院记录）。
  本轮 seed 为每个患者幂等 upsert seq=1 的 Admission + 首条科室停留，并写入四列
  （operatorId 用李护士）。**本地开发库不重置**（裁定 2），旧行照旧显「-」

## 3. 接口（复用扩展，不新增端点）

复用 `GET /patients/:id/admissions`（R24 住院记录树，`patient:view` + 数据范围 +
`ADMISSION_QUERY` 审计，已按 admittedAt 倒序 NULLS LAST、不分页——与需求逐条吻合）。

`AdmissionOption` 增加 4 个可空字段（向后兼容，血糖三个子 Tab 不受影响）：

```ts
patientNo: string | null; // 当次住院号
doctorName: string | null; // 责任医生姓名（User.name，医护姓名非患者 PII，不脱敏）
nurseName: string | null; // 责任护士姓名
operatorName: string | null; // 操作人姓名
```

服务端 select 带 `department.name`（**科室列口径 = 入院科室 `Admission.departmentId`**，
裁定 4；转科功能落地后再议轨迹展示）与三个 User 关系的 `name`。

## 4. 前端

- 新组件 `AdmissionRecordTab.tsx` 替换 `routes.tsx` 中该子路由的 `DetailPlaceholder`
  （组件本体保留，供将来新 Tab 复用）
- antd Table，`pagination={false}`；列：
  1. **日期**：`{admittedAt ?? '-'} 至 {dischargedAt ?? '-'}`（在院行 dischargedAt 为 null → 「至 -」）
  2. **科室**：入院科室名（取 `departments[0]`？否——直接用响应新增的科室名。见 §3：
     服务端在 AdmissionOption 上补 `departmentName`，避免前端从停留数组推导）
  3. **住院号** / 4. **责任医生** / 5. **责任护士** / 6. **操作人**：null → 「-」
- 数据源：`useAdmissions(id, version)`——hook 增加可选 `version` 参数
  （详情页办理出院/住院成功 bump `glucoseVersion`，经 Outlet context 传入，本 Tab 随流转刷新；
  血糖三个子 Tab 不传 version，行为不变）
- 加载/错误态：Spin / Alert+重试，同血糖子页口径
- 权限：能进详情页（`patient:view`）即可看本 Tab，无新增权限点

## 5. 边界与约束

- 时间展示走服务端已格式化的本地 `YYYY-MM-DD HH:mm:ss` 字符串（`formatDateTime`），前端不再转换
- `admittedAt` 可空（裁定 Q7 存量口径）：日期列显示 `- 至 …`
- 出院患者的脏数据行（dischargedAt 为空但非在院）：仍显示「至 -」，以行数据为准
- 审计：本 Tab 每次挂载请求一次 `ADMISSION_QUERY`（既有口径，StrictMode 双调守卫已在 hook 内）
- 单文件 ≤ 300 行；数字/时间用 `gc-num`

## 6. 测试要求

- [x] server 单测（361 例全绿）：admissions() 返回 departmentName + 4 个快照字段
      （新行有值/旧行 null 两态）；create()/admit() 断言 admission.create 写入
      patientNo/doctorId/nurseId/operatorId（含医护入参用例）
- [x] web 单测（266 例全绿）：`AdmissionRecordTab.spec.tsx` 9 例——日期拼接三态
      （完整区间/在院「至 -」/admittedAt null）、快照列 null → 「-」、六表头顺序、
      gc-num。容器组件按仓库口径（同 PatientGlucoseTargetTab）靠 typecheck + playwright 覆盖
- [x] playwright（nurse.li，2026-11-26）：第三 Tab 列表 4 行倒序、日期 `YYYY-MM-DD HH:mm:ss`、
      存量行四列「-」；详情页办理出院 → 首行就地补结束时间；办理住院 → 新首行
      六列完整（操作人 = 当前账号李护士）；血糖报告子 Tab「本次住院」下拉无回归
- [x] 三件套全绿（lint / typecheck / test：shared 103、server 361、web 266）

## 7. 验收标准

- [x] 迁移在本地开发库执行成功（`20261126100000_add_admission_snapshot_columns`，
      migrate deploy），旧 Admission 行四列为 NULL
- [x] 新办理的住院记录四列完整（住院号/医生/护士/操作人 = 当次值）
- [x] 列表倒序、不分页、日期格式符合 §1
- [x] 血糖三个子 Tab（报表/记录/趋势）行为不回归（`useAdmissions` version 参数可选、
      默认 0，报表「本次住院」下拉实测正常）
- [x] 文档：ROADMAP P2-2 备注更新、本规格变更记录回写

## 8. 变更记录

| #   | 日期       | 内容                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 2026-11-26 | 需求人原始需求（§1）                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | 2026-11-26 | 需求人四项裁定：① 批准 Admission 加 4 可空列，旧行显「-」不回填；② seed.ts 同步更新但开发库不重置；③ 操作人 = 当次办理账号（建档 seq=1 = 建档人）；④ 科室列 = 入院科室                                                                                                                                                                                                                     |
| 3   | 2026-11-26 | 实施细节（AI 按先例自定，可逆）：复用扩展 `GET /patients/:id/admissions` 不新增端点；`useAdmissions` 加可选 version 参数；seed 补 Admission upsert（顺带修复全新环境无住院记录的既有缺口）；AdmissionOption 补 `departmentName` 平铺字段免前端推导；详情页刷新信号走 Outlet context 新增 `statusVersion`（= detailVersion，与 glucoseVersion 分离，避免血糖变更误触发本 Tab 重拉多写审计） |
| 4   | 2026-11-26 | 落地与全链路验证通过。**顺带发现并修复 P2-6 遗留 bug**：`PatientAdmitModal` 的 Form 带 `preserve={false}`，Modal body 首帧后再挂载一次时字段值被清空——列表页异步回填路径侥幸躲过，详情页 `prefetchedDetail` 同步回填路径必现「科室/住院号全空」（GlucoseCreateModal 注释早有同款教训记载）。修复 = 去掉 `preserve={false}`，独立 fix 提交                                                  |
