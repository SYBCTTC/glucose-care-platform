import { Injectable } from '@nestjs/common';
import { RESOURCE, ROLE_CODE } from '@gc/shared';
import type { Prisma } from '@prisma/client';
import { buildScopeWhere } from '../../common/data-scope/scope.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';

/** 人员下拉项（操作人/责任医生，公共数据） */
export interface StaffOption {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  roleCodes: string[];
}

/** 仅返回医护角色（操作人/责任医生候选），排除纯管理/设备角色 */
const STAFF_ROLE_CODES: string[] = [ROLE_CODE.DOCTOR, ROLE_CODE.NURSE, ROLE_CODE.HEAD_NURSE];

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 本部门医护列表（操作人/责任医生下拉）。
   * 数据范围：STAFF → 本科室（ALL 档全院，NONE/SELF 档退化为本科室）。
   */
  async list(user: AuthenticatedUser): Promise<StaffOption[]> {
    const scope = buildScopeWhere(user, RESOURCE.STAFF) as unknown as Prisma.UserWhereInput;
    const rows = await this.prisma.user.findMany({
      where: {
        ...scope,
        status: 'ACTIVE',
        roles: { some: { role: { code: { in: STAFF_ROLE_CODES } } } },
      },
      select: {
        id: true,
        name: true,
        departmentId: true,
        department: { select: { name: true } },
        roles: { select: { role: { select: { code: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      departmentId: row.departmentId,
      departmentName: row.department.name,
      roleCodes: row.roles.map((item) => item.role.code),
    }));
  }
}
