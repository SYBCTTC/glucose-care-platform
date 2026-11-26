/**
 * 虚拟病区字典（前后端共享）。
 *
 * 形态：2026-11-18 需求人裁定为**单一全局虚拟病区**——全院只有一个"虚拟病区"，
 * 患者要么在要么不在，加入/移出无需选择目标病区。因此没有"病区"实体表，
 * 只有患者的进出记录 `VirtualWardRecord`（一条 = 一次进出，历史全留）。
 *
 * 数据权限：沿用 `RESOURCE.PATIENT`，**不新增资源类型**。
 * 见 docs/specs/virtual-ward.md §3。
 */

/** 虚拟病区列表的两个 Tab */
export const WARD_TAB = {
  /** 当前在区：存在 leftAt 为空的记录 */
  CURRENT: 'CURRENT',
  /** 历史：leftAt 非空的记录 */
  HISTORY: 'HISTORY',
} as const;
export type WardTab = (typeof WARD_TAB)[keyof typeof WARD_TAB];

export const WARD_TAB_LABELS: Record<WardTab, string> = {
  CURRENT: '当前虚拟病区',
  HISTORY: '历史虚拟病区',
};

/**
 * 移出方式，落库到 `VirtualWardRecord.leaveReason`（VarChar(16)）。
 *
 * `DISCHARGE` 已于 P2-6 患者出院接入（2026-11-26）：`POST /patients/:id/discharge`
 * 事务内自动关闭在区记录（docs/specs/patient-discharge.md §4 规则 4）。
 * ⚠️ `ARCHIVE` 仍是**预留值，无代码写入**：归档功能未落地（归档靠 `archivedAt`
 * 时间戳，只能由 seed 产生）。实现归档功能时**必须接上**，
 * 否则「当前虚拟病区」会累积已归档患者。见 docs/specs/virtual-ward.md §4-8。
 */
export const WARD_LEAVE_REASON = {
  /** 人工点击「移除虚拟病区」 */
  MANUAL: 'MANUAL',
  /** 患者转出院时自动移出（P2-6 已接入，出院接口事务内写入） */
  DISCHARGE: 'DISCHARGE',
  /** 患者归档时自动移出（预留，未实现） */
  ARCHIVE: 'ARCHIVE',
} as const;
export type WardLeaveReason = (typeof WARD_LEAVE_REASON)[keyof typeof WARD_LEAVE_REASON];

export const WARD_LEAVE_REASON_LABELS: Record<WardLeaveReason, string> = {
  MANUAL: '手动移除',
  DISCHARGE: '出院自动移出',
  ARCHIVE: '归档自动移出',
};
