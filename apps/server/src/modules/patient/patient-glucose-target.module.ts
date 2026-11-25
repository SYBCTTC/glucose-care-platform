import { Module } from '@nestjs/common';
import { SystemModule } from '../system/system.module';
import { TimeSlotModule } from '../time-slot/time-slot.module';
import { PatientGlucoseTargetController } from './patient-glucose-target.controller';
import { PatientGlucoseTargetService } from './patient-glucose-target.service';

/**
 * 患者控糖目标（各时段血糖上下限 + 低/高血糖预警值）。
 *
 * imports（与 `GlucoseModule` 同一套依赖，理由同源）：
 *  - `TimeSlotModule`：展示集合来自 `TimeSlot` **动态数据**（R1：enabled && 普通 && 带阈值），
 *    禁止硬编码 code 白名单或按 name 匹配（`AGENTS.md` §4.4）
 *  - `SystemModule`：全局预警阈值供「恢复默认」按钮与建档快照初始化（R9），
 *    禁止硬编码 3.9 / 16.7（`AGENTS.md` §4.3）
 *
 * exports：`PatientService.create` 建档后要调 `initSnapshot` 写快照（R9），
 * 故 `PatientModule` 需 import 本模块并注入 service。依赖是单向的
 * （本模块不反向依赖 PatientModule），无循环依赖。
 */
@Module({
  imports: [TimeSlotModule, SystemModule],
  controllers: [PatientGlucoseTargetController],
  providers: [PatientGlucoseTargetService],
  exports: [PatientGlucoseTargetService],
})
export class PatientGlucoseTargetModule {}
