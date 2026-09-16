import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import { PriceChangedDto } from './dto/price-changed.dto';
import { PriceFeedService } from './price-feed.service';

/**
 * Tres endpoints:
 *  - GET  /api/prices/version      -> polling liviano (~100 bytes)
 *  - GET  /api/stream/prices       -> push SSE (EventSource en el front)
 *  - POST /api/internal/price-changed -> webhook server-to-server desde backend-hsgestion
 */
@Controller()
export class PriceFeedController {
  constructor(
    private readonly feed: PriceFeedService,
    private readonly config: ConfigService,
  ) {}

  @Get('prices/version')
  version(@Query('companyId') companyId?: string) {
    return this.feed.getVersion(companyId);
  }

  @SkipThrottle()
  @Sse('stream/prices')
  stream(
    @Query('companyId') companyId?: string,
  ): Observable<{ data: object; id?: string; type?: string }> {
    return this.feed.subscribe(companyId);
  }

  /**
   * Webhook interno llamado por backend-hsgestion.
   * Auth por secreto compartido en header `x-price-secret`.
   * El CsrfGuard global ya permite server-to-server sin Origin/Referer.
   */
  @Post('internal/price-changed')
  async notify(
    @Headers('x-price-secret') secret: string | undefined,
    @Body() dto: PriceChangedDto,
  ) {
    const expected =
      this.config.get<string>('ECOMMERCE_PRICE_SECRET') ||
      this.config.get<string>('REVALIDATE_SECRET');

    if (!expected || secret !== expected) {
      throw new ForbiddenException('Webhook no autorizado');
    }

    const event = await this.feed.publish(dto ?? {});
    return { ok: true, eventId: event.id, version: event.version };
  }
}
