import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  formatDateTime,
  PATIENT_STATUS,
  RESOURCE,
  WARD_LEAVE_REASON,
  WARD_TAB,
} from '@gc/shared';
import type {
  VirtualWardListItem,
  WardJoinResult,
  WardLeaveResult,
  WardListQuery,
} from '@gc/shared';
import { Prisma } from '@prisma/client';
import { encryptDeterministic } from '../../common/crypto/field-crypto';
import { assertInScope, buildScopeWhere } from '../../common/data-scope/scope.util';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import { isUniqueConstraintViolation } from '../../common/utils/prisma-error';
import { PATIENT_PUBLIC_SELECT, toListItem } from '../patient/patient.service';

/**
 * 虚拟病区服务。
 *
 * 数据模型：一条 `VirtualWardRecord` = 一次进出，`leftAt` 为空表示当前在区。
 * 重复进出每次新建记录、历史全留，因此同一患者可有多条历史 + 至多一条在区
 * （后者由部分唯一索引 `virtual_ward_record_one_active` 保证）。
 *
 * 数据权限：**沿用患者域**（`RESOURCE.PATIENT`），不新增资源类型。
 * 过滤落在患者的科室上，所以列表的 scope 挂在 `where.patient` 下，
 * 单行操作用 `assertInScope(user, PATIENT, patient)`。
 * 设备管理员（NONE 档）由 `assertInScope` 直接拒 30006，无需在此特判。
 *
 * 完整规格：docs/specs/virtual-ward.md
 */

/** 列表行选择器：进出记录本身 + 患者公开字段（脱敏，不含任何 *Cipher 列） */
const WARD_LIST_SELECT = Prisma.validator<Prisma.VirtualWardRecordSelect>()({
  id: true,
  joinedAt: true,
  leftAt: true,
  leaveReason: true,
  patient: { select: PATIENT_PUBLIC_SELECT },
});
type WardListRow = Prisma.VirtualWardRecordGetPayload<{ select: typeof WARD_LIST_SELECT }>;

/** 服务层返回形状；控制器用 page() 包成 { items, total, page, pageSize } 信封 */
export interface WardListResult {
  items: VirtualWardListItem[];
  total: number;
}

/** 行 → 虚拟病区列表项。患者部分直接复用患者域的 toListItem，保证两处口径一致 */
function toWardListItem(row: WardListRow): VirtualWardListItem {
  return {
    ...toListItem(row.patient),
    wardRecordId: row.id,
    // joinedAt 库层 NOT NULL，?? '' 只为满足类型，实际不会走到
    wardJoinedAt: formatDateTime(row.joinedAt) ?? '',
    wardLeftAt: formatDateTime(row.leftAt),
    wardLeaveReason: row.leaveReason,
  };
}

@Injectable()
export class WardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 当前 / 历史虚拟病区列表。
   *
   * 口径与患者管理列表保持一致（决策 4）：不加 archivedAt 过滤、不加 status 过滤。
   * 加入/移出仍会拒绝已归档患者（40001），与患者编辑、办理住院、添加血糖同口径。
   */
  async list(user: AuthenticatedUser, query: WardListQuery): Promise<WardListResult> {
    const isCurrent = query.tab === WARD_TAB.CURRENT;
    const scope = buildScopeWhere(user, RESOURCE.PATIENT) as unknown as Prisma.PatientWhereInput;

    const patientWhere: Prisma.PatientWhereInput = { ...scope };
    if (query.departmentId) {
      patientWhere.departmentId = query.departmentId;
    }
    if (query.doctorId) {
      patientWhere.doctorId = query.doctorId;
    }
    if (query.patientNo) {
      patientWhere.patientNo = { contains: query.patientNo, mode: 'insensitive' };
    }
    if (query.bedNo) {
      patientWhere.bedNo = { contains: query.bedNo, mode: 'insensitive' };
    }
    if (query.name) {
      // 姓名为密文存储，只能做确定性等值匹配（不支持模糊），与患者列表同口径
      patientWhere.nameCipher = encryptDeterministic(query.name);
    }

    const where: Prisma.VirtualWardRecordWhereInput = { patient: patientWhere };
    if (isCurrent) {
      where.leftAt = null;
      // 跨 Tab 多传的 leaveFrom/leaveTo 直接忽略（当前 Tab 只看加入时间）
      if (query.joinFrom || query.joinTo) {
        where.joinedAt = {
          ...(query.joinFrom ? { gte: query.joinFrom } : {}),
          ...(query.joinTo ? { lte: query.joinTo } : {}),
        };
      }
    } else {
      // gte/lte 本身即隐含"非空"，只有没传区间时才需要显式 not: null
      where.leftAt =
        query.leaveFrom || query.leaveTo
          ? {
              ...(query.leaveFrom ? { gte: query.leaveFrom } : {}),
              ...(query.leaveTo ? { lte: query.leaveTo } : {}),
            }
          : { not: null };
    }

    // 追加 id 保证分页顺序稳定，避免滚动加载重复/漏人（同患者列表）
    const orderBy: Prisma.VirtualWardRecordOrderByWithRelationInput[] = isCurrent
      ? [{ joinedAt: 'desc' }, { id: 'asc' }]
      : [{ leftAt: 'desc' }, { id: 'asc' }];

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.virtualWardRecord.findMany({
        where,
        select: WARD_LIST_SELECT,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.virtualWardRecord.count({ where }),
    ]);

    return { items: rows.map(toWardListItem), total };
  }

  /**
   * 加入虚拟病区。历史 Tab 的「加入虚拟病区」（= 重新加入）走的是同一个方法：
   * 新建一条记录，旧的历史行原样保留（决策 7a）。
   */
  async join(user: AuthenticatedUser, patientId: string): Promise<WardJoinResult> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { departmentId: true, status: true, archivedAt: true },
    });
    // 已归档按"不存在"处理，与患者编辑 / 办理住院 / 添加血糖口径一致
    if (!patient || patient.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    // 越权（30002 跨科室 / 30006 无患者数据权）由审计拦截器自动记为 DENIED
    assertInScope(user, RESOURCE.PATIENT, { departmentId: patient.departmentId });
    // 决策 4a：仅住院患者可加入
    if (patient.status !== PATIENT_STATUS.INPATIENT) {
      throw new BusinessException(ERROR_CODES.PATIENT_INVALID_STATE);
    }

    const existing = await this.prisma.virtualWardRecord.findFirst({
      where: { patientId, leftAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new BusinessException(ERROR_CODES.WARD_ALREADY_JOINED);
    }

    let record: { id: string; joinedAt: Date };
    try {
      record = await this.prisma.virtualWardRecord.create({
        data: { patientId, joinedById: user.userId },
        select: { id: true, joinedAt: true },
      });
    } catch (error) {
      // 并发兜底：两人同时点「加入」会双双通过上面的先查后判，
      // 后到者撞部分唯一索引 virtual_ward_record_one_active（P2002）
      if (isUniqueConstraintViolation(error)) {
        throw new BusinessException(ERROR_CODES.WARD_ALREADY_JOINED);
      }
      throw error;
    }

    // 回读更新后的列表项，供前端局部更新该行而不整表重查（决策 15）
    const row = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: PATIENT_PUBLIC_SELECT,
    });
    if (!row) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }

    return {
      patientId,
      wardRecordId: record.id,
      joinedAt: formatDateTime(record.joinedAt) ?? '',
      item: toListItem(row),
    };
  }

  /**
   * 移出虚拟病区。
   *
   * 与加入不同，**不校验患者状态**：出院患者也应能被移出，
   * 这正是决策 8「出院/归档时自动移出」将来要复用的同一条代码路径。
   */
  async leave(user: AuthenticatedUser, patientId: string): Promise<WardLeaveResult> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { departmentId: true, archivedAt: true },
    });
    if (!patient || patient.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    assertInScope(user, RESOURCE.PATIENT, { departmentId: patient.departmentId });

    const active = await this.prisma.virtualWardRecord.findFirst({
      where: { patientId, leftAt: null },
      select: { id: true },
    });
    if (!active) {
      throw new BusinessException(ERROR_CODES.WARD_NOT_JOINED);
    }

    const leftAt = new Date();
    // 用 updateMany + `leftAt: null` 条件做原子更新：并发下第二个人 count 为 0，
    // 映射为 44002，而不是把对方的移出时间/操作人悄悄覆盖掉
    const { count } = await this.prisma.virtualWardRecord.updateMany({
      where: { id: active.id, leftAt: null },
      data: { leftAt, leftById: user.userId, leaveReason: WARD_LEAVE_REASON.MANUAL },
    });
    if (count === 0) {
      throw new BusinessException(ERROR_CODES.WARD_NOT_JOINED);
    }

    return {
      patientId,
      wardRecordId: active.id,
      leftAt: formatDateTime(leftAt) ?? '',
      leaveReason: WARD_LEAVE_REASON.MANUAL,
    };
  }
}
