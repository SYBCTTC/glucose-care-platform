import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PERMISSION, RESOURCE } from '@gc/shared';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { TimeSlotService } from './time-slot.service';

@Controller('time-slots')
export class TimeSlotController {
  constructor(private readonly timeSlotService: TimeSlotService) {}

  /** 时段（公共数据）：登录后随科室/人员/设备一次性加载 */
  @Get()
  @RequirePermissions(PERMISSION.DICT_VIEW)
  @RequireDataScope(RESOURCE.DICT)
  async list(@Req() request: Request) {
    return ok(await this.timeSlotService.list(request.user as AuthenticatedUser));
  }
}
