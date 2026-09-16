import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, interval, merge } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PriceChangedDto } from './dto/price-changed.dto';

export interface PriceEvent {
  id: number;
  type: 'price' | 'fx' | 'web-status' | 'sync' | 'heartbeat';
  /** company_type_id normalizado. 'all' = broadcast a todos los tenants. */
  companyId: string;
  articleIds: (number | string)[];
  slugs: string[];
  fxRate: number | null;
  version: string;
  occurredAt: string;
}

const PRICE_CHANGED_EVENT = 'price.changed';

function normalizeCompany(companyId?: string | number | null): string {
  if (companyId === undefined || companyId === null || companyId === '') return 'all';
  return String(companyId);
}

@Injectable()
export class PriceFeedService {
  private seq = 0;
  /** Último evento por tenant para sincronizar al suscribirse (sync inmediata). */
  private readonly lastByCompany = new Map<string, PriceEvent>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Versión liviana del catálogo: ~100 bytes.
   * El front hace polling aquí cada 15-30s y solo pide /articles
   * completo cuando `hash` cambia.
   */
  async getVersion(companyId?: string) {
    const company = normalizeCompany(companyId);
    const fx: any = await this.prisma.exchange_rates.findFirst({
      orderBy: { date: 'desc' },
    });

    const articleWhere: any =
      company !== 'all' ? { company_type_id: BigInt(company) } : {};
    const latest: any = await this.prisma.articles.findFirst({
      where: articleWhere,
      orderBy: { updated_at: 'desc' },
      select: { updated_at: true },
    });

    const fxRate = fx ? Number(fx.parallel_rate) : 0;
    const fxUpdatedAt = fx?.updated_at ? new Date(fx.updated_at).toISOString() : null;
    const maxArticleUpdatedAt = latest?.updated_at
      ? new Date(latest.updated_at).toISOString()
      : null;

    const raw = `${fxRate}|${fxUpdatedAt}|${company}|${maxArticleUpdatedAt}`;
    const hash = createHash('sha1').update(raw).digest('hex').slice(0, 16);

    return {
      companyId: company,
      fxRate,
      fxUpdatedAt,
      maxArticleUpdatedAt,
      hash,
      serverTime: new Date().toISOString(),
    };
  }

  /** Publica un cambio (viene del webhook de hsgestion) y lo reparte por SSE. */
  async publish(dto: PriceChangedDto): Promise<PriceEvent> {
    const companyId = normalizeCompany(dto.companyId);
    const version = await this.getVersion(companyId === 'all' ? undefined : companyId);

    const event: PriceEvent = {
      id: ++this.seq,
      type: dto.type ?? 'price',
      companyId,
      articleIds: dto.articleIds ?? [],
      slugs: dto.slugs ?? [],
      fxRate:
        dto.fxRate !== undefined && dto.fxRate !== null
          ? Number(dto.fxRate)
          : version.fxRate,
      version: version.hash,
      occurredAt: new Date().toISOString(),
    };

    this.lastByCompany.set(companyId, event);
    this.events.emit(PRICE_CHANGED_EVENT, event);
    return event;
  }

  /**
   * Stream SSE filtrado por tenant.
   * - Un suscriptor 'all' recibe todo.
   * - Un suscriptor de un tenant recibe sus eventos + los broadcast ('all', ej. tipo de cambio).
   */
  subscribe(companyId?: string): Observable<{ data: object; id?: string; type?: string }> {
    const company = normalizeCompany(companyId);

    const matches = (e: PriceEvent) =>
      company === 'all' || e.companyId === 'all' || e.companyId === company;

    const live$ = new Observable<PriceEvent>((subscriber) => {
      const handler = (e: PriceEvent) => {
        if (matches(e)) subscriber.next(e);
      };
      this.events.on(PRICE_CHANGED_EVENT, handler);

      // Sync inmediata: el front sabe al conectar si ya está desactualizado.
      const last =
        this.lastByCompany.get(company) ?? (company !== 'all' ? this.lastByCompany.get('all') : undefined);
      if (last) {
        subscriber.next({ ...last, type: 'sync' as const });
      }

      return () => this.events.off(PRICE_CHANGED_EVENT, handler);
    }).pipe(
      filter((e) => matches(e)),
      map((e) => ({ data: e, id: String(e.id), type: e.type })),
    );

    // Heartbeat cada 25s para mantener viva la conexión tras proxies/Nginx.
    const heartbeat$ = interval(25000).pipe(
      map(() => ({
        data: { ts: new Date().toISOString() },
        type: 'heartbeat',
      })),
    );

    return merge(live$, heartbeat$);
  }
}
