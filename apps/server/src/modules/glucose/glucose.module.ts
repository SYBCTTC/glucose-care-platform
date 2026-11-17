import { Module } from '@nestjs/common';
import { SystemModule } from '../system/system.module';
import { TimeSlotModule } from '../time-slot/time-slot.module';
import { GlucoseController } from './glucose.controller';
import { GlucoseService } from './glucose.service';

@Module({
  // TimeSlotModule：时段是动态数据，录入时要查库校验 code 是否存在且启用
  // SystemModule：结果类型 0/1/2 的判定阈值读 SystemConfig，禁止硬编码
  imports: [TimeSlotModule, SystemModule],
  controllers: [GlucoseController],
  providers: [GlucoseService],
})
export class GlucoseModule {}
