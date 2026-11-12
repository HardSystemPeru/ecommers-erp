import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import Pusher from 'pusher';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createNew(
    orderId: bigint,
    message?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    return client.notifications.create({
      data: {
        order_id: orderId,
        type: 'nuevo',
        message: message ?? 'Nueva orden de compra',
      },
    });
  }

  async publishNew(orderId: bigint, notificationId: bigint) {
    const channel = this.config.get('ERP_NOTIFICATIONS_CHANNEL');

    if (!channel) {
      return;
    }

    const appId = this.config.get('REVERB_APP_ID');
    const key = this.config.get('REVERB_APP_KEY');

    if (!appId || !key) {
      return;
    }

    const client = new Pusher({
      appId,
      key,
      secret: this.config.get('REVERB_APP_SECRET', ''),
      host: this.config.get('REVERB_HOST', '127.0.0.1'),
      port: this.config.get('REVERB_PORT', '8080'),
      useTLS: this.config.get('REVERB_SCHEME', 'http') === 'https',
    });

    try {
      await client.trigger(channel, 'notification.created', {
        id: Number(notificationId),
        order_id: orderId,
        action: 'created',
        type: 'nuevo',
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo emitir a Reverb: ${(error as Error).message}`,
      );
    }
  }
}
