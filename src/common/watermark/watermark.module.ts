import { Global, Module } from '@nestjs/common';
import { WatermarkService } from './watermark.service';

@Global()
@Module({
  providers: [WatermarkService],
  exports: [WatermarkService],
})
export class WatermarkModule {}
