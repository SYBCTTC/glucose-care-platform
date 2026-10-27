import { Module } from '@nestjs/common';
import { GlucoseController } from './glucose.controller';
import { GlucoseService } from './glucose.service';

@Module({
  controllers: [GlucoseController],
  providers: [GlucoseService],
})
export class GlucoseModule {}
