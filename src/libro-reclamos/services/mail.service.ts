// src/complaints/services/mail.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST'),
      port: this.config.get('SMTP_PORT'),
      secure: this.config.get('SMTP_SECURE') === 'true',
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
    });
  }
  async onModuleInit() {
    try {
      await this.transporter.verify();
      this.logger.log('Conexión SMTP verificada correctamente ✅');
    } catch (err) {
      this.logger.error('Falló la verificación de conexión SMTP ❌', err);
    }
  }

  async sendComplaintConfirmation(
    to: string,
    name: string,
    numberComplaint: string,
  ) {
    await this.transporter.sendMail({
      from: this.config.get('MAIL_FROM'),
      to,
      subject: `Confirmación de reclamo N° ${numberComplaint}`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="text-align: center; color: #333;">Reclamo registrado con éxito</h2>
        <p>Hola ${name},</p>
        <p>Hemos recibido tu reclamo/queja y ha sido registrado correctamente en nuestro Libro de Reclamaciones.</p>
        <div style="text-align: center; margin: 30px 0;">
          <div style="display: inline-block; background-color: #f4f4f4; padding: 15px 30px; border-radius: 8px;">
            <p style="margin: 0; font-size: 14px; color: #555;">Número de reclamo</p>
            <p style="margin: 5px 0 0; font-size: 24px; font-weight: bold; color: #007bff;">${numberComplaint}</p>
          </div>
        </div>
        <p style="font-size: 14px; color: #555;">Nos pondremos en contacto contigo dentro del plazo legal establecido por la ley N° 29571 (Código de Protección y Defensa del Consumidor). Guarda este número de reclamo como referencia para cualquier consulta futura.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Este es un mensaje automático, por favor no respondas a este correo.</p>
      </div>
    `,
    });
  }

  async sendInternalNotification(numberComplaint: string) {
    await this.transporter.sendMail({
      from: this.config.get('MAIL_FROM'),
      to: this.config.get('SUPPORT_EMAIL'),
      subject: `Nuevo reclamo/queja: ${numberComplaint}`,
      html: `<p>Se registró un nuevo reclamo con número <b>${numberComplaint}</b>. Revísalo en el panel de administración.</p>`,
    });
  }
}
