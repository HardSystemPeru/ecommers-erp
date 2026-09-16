import { Module } from '@nestjs/common';
import { PriceFeedController } from './price-feed.controller';
import { PriceFeedService } from './price-feed.service';

@Module({
  controllers: [PriceFeedController],
  providers: [PriceFeedService],
  exports: [PriceFeedService],
})
export class PriceFeedModule {}
