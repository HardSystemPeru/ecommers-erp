import { Module, Global } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { HttpModule } from '@nestjs/axios';

@Global()
@Module({
  imports: [HttpModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
