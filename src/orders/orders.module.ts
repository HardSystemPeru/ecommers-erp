import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule, HttpModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}