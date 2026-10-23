import { Injectable } from '@nestjs/common';
import { RESOURCE } from '@gc/shared';
import type { Prisma } from '@prisma/client';
import { buildScopeWhere } from '../../common/data-scope/scope.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';

/** 设备下拉项（质控记录添加设备，公共数据） */
export interface DeviceOption {
  id: string;
  sn: string;
  model: string;
  status: string;
  departmentId: string | null;
  departmentName: string | null;
}

@Injectable()
export class DeviceService {
  constructor(private readonly prisma: PrismaService) {}

  /** 启用中的设备，按设备数据范围（科室）过滤 */
  async list(user: AuthenticatedUser): Promise<DeviceOption[]> {
    const scope = buildScopeWhere(user, RESOURCE.DEVICE) as unknown as Prisma.DeviceWhereInput;
    const rows = await this.prisma.device.findMany({
      where: { ...scope, enabled: true },
      select: {
        id: true,
        sn: true,
        model: true,
        status: true,
        departmentId: true,
        department: { select: { name: true } },
      },
      orderBy: { sn: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      sn: row.sn,
      model: row.model,
      status: row.status,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
    }));
  }
}
