// src/libro-reclamos/libro-reclamos.module.ts
import { Module } from '@nestjs/common';

import { LibroReclamosService } from './libro-reclamos.service';
import { ComplaintCounterService } from './services/complaint-counter.service';
import { StorageService } from './services/storage.service';
import { RecaptchaService } from './services/recaptcha.service';
import { MailService } from './services/mail.service';
import { ComplaintListener } from './listeners/complaint.listener';
import { PrismaModule } from '../prisma/prisma.module';
import { ComplaintsController } from './libro-reclamos.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ComplaintsController],
  providers: [
    LibroReclamosService,
    ComplaintCounterService,
    StorageService,
    RecaptchaService,
    MailService,
    ComplaintListener,
  ],
})
export class ComplaintsModule {}
