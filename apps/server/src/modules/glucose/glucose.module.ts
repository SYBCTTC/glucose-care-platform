import { Module } from '@nestjs/common';
import { TimeSlotModule } from '../time-slot/time-slot.module';
import { GlucoseController } from './glucose.controller';
import { GlucoseService } from './glucose.service';

@Module({
  // 时段是动态数据，录入时要查库校验 code 是否存在且启用
  imports: [TimeSlotModule],
  controllers: [GlucoseController],
  providers: [GlucoseService],
})
export class GlucoseModule {}
