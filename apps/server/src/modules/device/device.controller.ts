import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PERMISSION, RESOURCE } from '@gc/shared';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { DeviceService } from './device.service';

@Controller('devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  /** 启用设备列表（公共数据，供质控记录选择设备） */
  @Get()
  @RequirePermissions(PERMISSION.DEVICE_VIEW)
  @RequireDataScope(RESOURCE.DEVICE)
  async list(@Req() request: Request) {
    return ok(await this.deviceService.list(request.user as AuthenticatedUser));
  }
}
