import { Module } from '@nestjs/common';
import { TimeSlotController } from './time-slot.controller';
import { TimeSlotService } from './time-slot.service';

@Module({
  controllers: [TimeSlotController],
  providers: [TimeSlotService],
  // 血糖录入要按 code 校验时段是否可用，跨模块调用走导出，不直查对方的表
  exports: [TimeSlotService],
})
export class TimeSlotModule {}
