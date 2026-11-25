import { Module } from '@nestjs/common';
import { PatientGlucoseTargetModule } from './patient-glucose-target.module';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';

@Module({
  // 建档成功后要写控糖目标快照（规格 R9），需注入 PatientGlucoseTargetService。
  // 依赖单向（对方不反向 import 本模块），无循环依赖。
  imports: [PatientGlucoseTargetModule],
  controllers: [PatientController],
  providers: [PatientService],
})
export class PatientModule {}
