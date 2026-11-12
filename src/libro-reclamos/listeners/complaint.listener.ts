// src/libro-reclamos/listeners/complaint.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ComplaintCreatedEvent } from '../events/complaint-created.event';
import { MailService } from '../services/mail.service';

@Injectable()
export class ComplaintListener {
  private readonly logger = new Logger(ComplaintListener.name);

  constructor(private mailService: MailService) {}

  @OnEvent('complaint.created', { async: true })
  async handleComplaintCreated(event: ComplaintCreatedEvent) {
    this.logger.log(`Evento recibido para reclamo ${event.numberComplaint}`);

    try {
      await this.mailService.sendComplaintConfirmation(
        event.email,
        event.customerName,
        event.numberComplaint,
      );
      this.logger.log('Email de confirmación enviado OK');
    } catch (err) {
      this.logger.error('Error enviando email de confirmación', err);
    }

    try {
      await this.mailService.sendInternalNotification(event.numberComplaint);
      this.logger.log('Email interno enviado OK'); // 👈
    } catch (err) {
      this.logger.error('Error enviando email interno', err);
    }
  }
}
