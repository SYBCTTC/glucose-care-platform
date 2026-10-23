import { Controller, Get, Module } from '@nestjs/common';
import { formatDateTime } from '@gc/shared';
import { Public } from '../../common/decorators/public.decorator';
import { ok } from '../../common/utils/response';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  check() {
    return ok({ status: 'up', time: formatDateTime(new Date()) ?? '' });
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}