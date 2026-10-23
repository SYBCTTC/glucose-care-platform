/**
 * 用户状态中文映射（公共数据 D-USERSTATUS）。
 * 仅用于列表/详情展示，避免前端硬编码 UserStatus 枚举中文。
 * 枚举定义以 apps/server/prisma/schema.prisma 的 UserStatus 为准（ACTIVE / DISABLED / LOCKED）。
 * 设备状态映射见 device/schema 的 DEVICE_STATUS_LABELS（不在本文件重复）。
 */
export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '启用',
  DISABLED: '禁用',
  LOCKED: '锁定',
};

export function getUserStatusLabel(code: string): string {
  return USER_STATUS_LABELS[code] ?? code;
}
