import { Module } from '@nestjs/common';
import { PatientGlucoseTargetModule } from '../patient/patient-glucose-target.module';
import { TimeSlotModule } from '../time-slot/time-slot.module';
import { GlucoseAlertController } from './glucose-alert.controller';
import { GlucoseAlertService } from './glucose-alert.service';
import { GlucoseController } from './glucose.controller';
import { GlucoseService } from './glucose.service';

@Module({
  // TimeSlotModule：时段是动态数据，录入时要查库校验 code 是否存在且启用
  // PatientGlucoseTargetModule：R4 判定阈值（患者时段目标 → 缺行回退全局 SystemConfig）
  //   与 R8 趋势图阈值线（患者预警值 → 回退全局）都由它解析，本模块不再直接依赖 SystemModule
  //   （全局配置只是回退源，回退口径归解析方独有，避免两处各写一套）。
  //   依赖单向：对方只 import TimeSlotModule / SystemModule，不反向依赖本模块，无循环依赖。
  imports: [TimeSlotModule, PatientGlucoseTargetModule],
  // GlucoseAlertController（P4-7）：跨患者预警列表，与 GlucoseController（/patients/:id 子资源）路径不冲突
  controllers: [GlucoseController, GlucoseAlertController],
  providers: [GlucoseService, GlucoseAlertService],
})
export class GlucoseModule {}
