import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { calcComboTotals, priceComboLine } from '../articles/utils/combo-price.util';

type FavoriteType = 'article' | 'combo';

@Injectable()
export class FavoritesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private serialize(obj: any) {
    if (!obj) return null;
    return {
      ...obj,
      id: obj.id?.toString(),
      client_id: obj.client_id?.toString(),
      article_id: obj.article_id?.toString(),
      type: obj.type,
    };
  }

  private async getDollarRate(): Promise<number> {
    const exchangeRate = await this.prisma.exchange_rates.findFirst({
      orderBy: { date: 'desc' },
    });
    return exchangeRate ? Number((exchangeRate as any).parallel_rate) || 0 : 0;
  }

  private normalizeType(type?: string): FavoriteType | undefined {
    if (type === 'article' || type === 'combo') return type;
    if (type) throw new BadRequestException('type debe ser article o combo');
    return undefined;
  }

  private async resolveType(articleId: string, type?: FavoriteType): Promise<FavoriteType> {
    if (type) return type;
    try {
      const art = await this.prisma.articles.findUnique({
        where: { id: BigInt(articleId) },
        select: { id: true },
      });
      if (art) return 'article';
    } catch {
      // id inválido: se prueba combo abajo
    }
    try {
      const combo = await this.prisma.build_pc_tabla.findUnique({
        where: { id: BigInt(articleId) },
        select: { id: true },
      });
      if (combo) return 'combo';
    } catch {
      // ignore
    }
    throw new NotFoundException('No se encontró el artículo o combo seleccionado');
  }

  private async validateExists(articleId: string, type: FavoriteType) {
    if (type === 'article') {
      const art = await this.prisma.articles.findUnique({
        where: { id: BigInt(articleId) },
        select: { id: true },
      });
      if (!art) throw new NotFoundException('Artículo no encontrado');
    } else {
      const combo = await this.prisma.build_pc_tabla.findUnique({
        where: { id: BigInt(articleId) },
        select: { id: true },
      });
      if (!combo) throw new NotFoundException('Combo no encontrado');
    }
  }

  async addFavorite(clientId: number, articleId: string, type?: string) {
    try {
      const normalized = this.normalizeType(type);
      const resolved = await this.resolveType(articleId, normalized);
      await this.validateExists(articleId, resolved);

      const favorite = await this.prisma.favorites.create({
        data: {
          client_id: BigInt(clientId),
          article_id: BigInt(articleId),
          type: resolved,
        },
      });
      return this.serialize(favorite);
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      if (error.code === 'P2002') {
        throw new ConflictException('Este producto ya está en tus favoritos');
      }
      throw new NotFoundException('No se encontró el artículo seleccionado');
    }
  }

  async removeFavorite(clientId: number, articleId: string, type?: string) {
    const normalized = this.normalizeType(type);
    const types: FavoriteType[] = normalized ? [normalized] : ['article', 'combo'];
    let lastNotFound = false;

    for (const t of types) {
      try {
        await this.prisma.favorites.delete({
          where: {
            client_id_article_id_type: {
              client_id: BigInt(clientId),
              article_id: BigInt(articleId),
              type: t,
            },
          },
        });
        return { message: 'Producto eliminado de favoritos' };
      } catch (error: any) {
        if (error.code === 'P2025') {
          lastNotFound = true;
          continue;
        }
        throw error;
      }
    }

    if (lastNotFound) {
      throw new NotFoundException('El producto no estaba en tus favoritos');
    }
    throw new NotFoundException('El producto no estaba en tus favoritos');
  }

  async getFavorites(
    clientId: number,
    pagination?: { page?: string | number; limit?: string | number },
  ) {
    const page = Math.max(1, Math.trunc(Number(pagination?.page)) || 1);
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(pagination?.limit)) || 10));
    const where = { client_id: BigInt(clientId) };

    const [favorites, total] = await Promise.all([
      this.prisma.favorites.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.favorites.count({ where }),
    ]);

    const dollarRate = await this.getDollarRate();
    const data = await Promise.all(
      favorites.map((fav) => this.buildFavoriteResponse(fav, dollarRate)),
    );

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async isFavorite(clientId: number, articleId: string, type?: string) {
    const normalized = this.normalizeType(type);
    const types: FavoriteType[] = normalized ? [normalized] : ['article', 'combo'];
    const dollarRate = await this.getDollarRate();

    for (const t of types) {
      const favorite = await this.prisma.favorites.findUnique({
        where: {
          client_id_article_id_type: {
            client_id: BigInt(clientId),
            article_id: BigInt(articleId),
            type: t,
          },
        },
      });
      if (favorite) {
        return this.buildFavoriteResponse(favorite, dollarRate);
      }
    }
    return null;
  }

  private async buildFavoriteResponse(row: any, dollarRate: number) {
    const base = this.serialize(row);
    const type: FavoriteType = (row.type === 'combo' ? 'combo' : 'article') as FavoriteType;
    let item: any = null;

    if (type === 'combo') {
      const combo = await this.prisma.build_pc_tabla.findUnique({
        where: { id: row.article_id },
        include: {
          build_detail_pc_tabla: {
            include: {
              articles: {
                include: {
                  article_images: { orderBy: { position: 'asc' } },
                  categories: true,
                  brands: true,
                },
              },
            },
          },
        },
      });
      item = await this.serializeCombo(combo, dollarRate);
    } else {
      const article = await this.prisma.articles.findUnique({
        where: { id: row.article_id },
        include: {
          categories: true,
          article_images: true,
          brands: true,
        },
      });
      item = this.serializeArticle(article, dollarRate);
    }

    return { ...base, article: item };
  }

  private async serializeCombo(combo: any, dollarRate: number) {
    if (!combo) return null;
    const articleIds = (combo.build_detail_pc_tabla || []).map((d: any) => d.articles.id);
    const { Prisma } = await import('@prisma/client');
    const stockRows: any[] = articleIds.length
      ? await this.prisma.$queryRaw`SELECT article_id, saldo FROM v_article_stock_global WHERE article_id IN (${Prisma.join(articleIds)})`
      : [];
    const stockMap = new Map<string, number>();
    stockRows.forEach((r: any) => stockMap.set(String(r.article_id), Number(r.saldo)));
    const details = combo.build_detail_pc_tabla || [];
    const items = details.map((detail: any) => {
      const art = detail.articles;
      const publicPrice = art.public_price ? parseFloat(art.public_price.toString()) : null;
      const currencyStr = art.currency_type_id?.toString();
      const line = priceComboLine(art, dollarRate);
      return {
        quantity: detail.quantity,
        article_id: art.id.toString(),
        cod_fab: art.cod_fab,
        description: art.description,
        slug: art.slug,
        name: art.description,
        public_price: publicPrice,
        public_price_soles: publicPrice
          ? parseFloat((currencyStr === '1' ? publicPrice : publicPrice * dollarRate).toFixed(2))
          : null,
        public_price_dolares: publicPrice
          ? parseFloat(
              (currencyStr === '2'
                ? publicPrice
                : dollarRate > 0
                  ? publicPrice / dollarRate
                  : 0
              ).toFixed(2),
            )
          : null,
        precio_final: art.precio_final != null ? Number(art.precio_final) : null,
        has_offer: art.has_offer ? 1 : 0,
        offer_price_percent: Number(art.offer_price_percent || 0),
        effective_price: line.effective_price,
        effective_price_soles: line.effective_price_soles,
        effective_price_dolares: line.effective_price_dolares,
        saldo: stockMap.get(String(art.id)) ?? 0,
        category: art.categories
          ? { id: art.categories.id.toString(), name: art.categories.name }
          : null,
        brand: art.brands ? { id: art.brands.id.toString(), name: art.brands.name } : null,
        article_images: (art.article_images || []).map((img: any) => ({
          id: img.id.toString(),
          url: this.formatImageUrl(img.url),
          position: img.position,
          is_main: img.is_main,
        })),
      };
    });
    const totals = calcComboTotals(details, dollarRate, combo.total_price);
    return {
      id: combo.id.toString(),
      type: 'combo' as const,
      name: combo.name,
      slug: combo.slug,
      description: combo.description,
      image_build: this.formatImageUrl(combo.image_build),
      total_price: totals.total_price,
      total_price_soles: totals.total_price_soles,
      created_at: combo.created_at,
      updated_at: combo.updated_at,
      items,
    };
  }

  private serializeArticle(article: any, dollarRate: number = 0) {
    if (!article) return null;
    const { image_url, ...articleData } = article;
    const publicPrice = article.public_price ? parseFloat(article.public_price.toString()) : null;
    const offerPct = Number(article.offer_price_percent || 0);
    const hasOffer =
      article.has_offer === true || article.has_offer === 1 || offerPct > 0;
    const precioPublicSoles =
      publicPrice != null
        ? parseFloat(
            (article.currency_type_id?.toString() === '1'
              ? publicPrice
              : publicPrice * dollarRate
            ).toFixed(2),
          )
        : null;
    const precioPorcentaje =
      precioPublicSoles != null
        ? parseFloat(
            (hasOffer && offerPct > 0
              ? precioPublicSoles * (1 - offerPct / 100)
              : precioPublicSoles
            ).toFixed(2),
          )
        : null;
    return {
      type: 'article' as const,
      name: article.description,
      ...articleData,
      id: article.id.toString(),
      brand_id: article.brand_id?.toString(),
      category_id: article.category_id?.toString(),
      sub_category_id: article.sub_category_id?.toString(),
      currency_type_id: article.currency_type_id?.toString(),
      precio_public_soles: precioPublicSoles,
      precio_porcentaje: precioPorcentaje,
      article_images: (article.article_images || []).map((img: any) => ({
        ...img,
        id: img.id?.toString(),
        article_id: img.article_id?.toString(),
        url: this.formatImageUrl(img.url),
      })),
      public_price: publicPrice,
      categories: article.categories
        ? { ...article.categories, id: article.categories.id.toString() }
        : null,
      sub_categories: article.sub_categories
        ? {
            ...article.sub_categories,
            id: article.sub_categories.id.toString(),
            category_id: article.sub_categories.category_id.toString(),
          }
        : null,
      brands: article.brands ? { ...article.brands, id: article.brands.id.toString() } : null,
    };
  }

  private formatImageUrl(url: string | null): string | null {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    const baseUrl = this.configService.get('APP_URL') || 'http://192.168.18.26:3000';
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }
}
