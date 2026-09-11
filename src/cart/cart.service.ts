import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CartService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private serialize(row: any) {
    if (!row) return null;
    return {
      id: row.id?.toString(),
      client_id: row.client_id?.toString(),
      article_id: row.article_id?.toString(),
      type: row.type,
      quantity: row.quantity,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private serializeArticle(article: any, dollarRate: number) {
    if (!article) return null;
    return {
      type: 'article' as const,
      name: article.description,
      ...article,
      id: article.id.toString(),
      brand_id: article.brand_id?.toString(),
      category_id: article.category_id?.toString(),
      sub_category_id: article.sub_category_id?.toString(),
      measurement_unit_id: article.measurement_unit_id?.toString(),
      currency_type_id: article.currency_type_id?.toString(),
      company_type_id: article.company_type_id?.toString(),
      user_id: article.user_id?.toString(),
      precio_public_soles: article.public_price
        ? parseFloat(
            (
              article.currency_type_id?.toString() === '1'
                ? Number(article.public_price)
                : Number(article.public_price) * dollarRate
            ).toFixed(2),
          )
        : null,
      precio_porcentaje: article.public_price
        ? Number(
            (
              (article.currency_type_id?.toString() === '1'
                ? Number(article.public_price)
                : Number(article.public_price) * dollarRate) *
              (1 - Number(article.offer_price_percent || 0) / 100)
            ).toFixed(2),
          )
        : null,
      public_price: article.public_price ? parseFloat(article.public_price.toString()) : null,
      article_images: (article.article_images || []).map((img: any) => ({
        ...img,
        id: img.id?.toString(),
        article_id: img.article_id?.toString(),
        url: this.formatImageUrl(img.url),
      })),
      categories: article.categories
        ? { ...article.categories, id: article.categories.id.toString() }
        : null,
      brands: article.brands
        ? { ...article.brands, id: article.brands.id.toString() }
        : null,
    };
  }

  private async serializeCombo(combo: any, dollarRate: number) {
    if (!combo) return null;
    // Precios desde artículos (igual que ArticlesService) — evita total_price 0
    // y saldo desde v_article_stock_global para que el frontend sepa stock por componente
    const articleIds = (combo.build_detail_pc_tabla || []).map((d: any) => d.articles.id);
    const { Prisma } = await import('@prisma/client');
    const stockRows: any[] = articleIds.length ? await this.prisma.$queryRaw`SELECT article_id, saldo FROM v_article_stock_global WHERE article_id IN (${Prisma.join(articleIds)})` : [];
    const stockMap = new Map<string, number>();
    stockRows.forEach((r: any) => stockMap.set(String(r.article_id), Number(r.saldo)));
    let calcTotalDolares = 0;
    let calcTotalSoles = 0;
    const items = (combo.build_detail_pc_tabla || []).map((detail: any) => {
      const art = detail.articles;
      const publicPrice = art.public_price ? parseFloat(art.public_price.toString()) : null;
      const currencyStr = art.currency_type_id?.toString();
      const pubSoles = publicPrice
        ? parseFloat((currencyStr === '1' ? publicPrice : publicPrice * dollarRate).toFixed(2))
        : 0;
      const pubDolares = publicPrice
        ? parseFloat((currencyStr === '2' ? publicPrice : dollarRate > 0 ? publicPrice / dollarRate : 0).toFixed(2))
        : 0;
      calcTotalSoles += pubSoles * detail.quantity;
      calcTotalDolares += pubDolares * detail.quantity;
      return {
        quantity: detail.quantity,
        article_id: art.id.toString(),
        cod_fab: art.cod_fab,
        description: art.description,
        slug: art.slug,
        name: art.description,
        public_price: publicPrice,
        public_price_soles: publicPrice
          ? parseFloat(
              (currencyStr === '1' ? publicPrice : publicPrice * dollarRate).toFixed(2),
            )
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
    const calcTotalPrice = parseFloat(calcTotalDolares.toFixed(2));
    const calcTotalPriceSoles = parseFloat(calcTotalSoles.toFixed(2));
    const finalTotalPrice = calcTotalPrice > 0 ? calcTotalPrice : combo.total_price;
    const finalTotalPriceSoles =
      calcTotalSoles > 0 ? calcTotalPriceSoles : dollarRate > 0 ? parseFloat((combo.total_price * dollarRate).toFixed(2)) : null;
    return {
      id: combo.id.toString(),
      type: 'combo' as const,
      name: combo.name,
      slug: combo.slug,
      description: combo.description,
      image_build: this.formatImageUrl(combo.image_build),
      total_price: finalTotalPrice,
      total_price_soles: finalTotalPriceSoles,
      created_at: combo.created_at,
      updated_at: combo.updated_at,
      items,
    };
  }

  private formatImageUrl(url: string | null): string | null {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    const baseUrl = this.configService.get('APP_URL') || 'http://192.168.18.26:3000';
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private async getDollarRate(): Promise<number> {
    const exchangeRate = await this.prisma.exchange_rates.findFirst({
      orderBy: { date: 'desc' },
    });
    return exchangeRate ? Number((exchangeRate as any).parallel_rate) || 0 : 0;
  }

  private async buildCartResponse(row: any, dollarRate: number) {
    const base = this.serialize(row);
    let articleData: any = null;

    if (row.type === 'combo') {
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
      articleData = await this.serializeCombo(combo, dollarRate);
    } else {
      const article = await this.prisma.articles.findUnique({
        where: { id: row.article_id },
        include: {
          categories: true,
          brands: true,
          article_images: true,
        },
      });
      articleData = this.serializeArticle(article, dollarRate);
    }

    return { ...base, article: articleData };
  }

  async getCart(clientId: number | string) {
    const rows = await this.prisma.cart.findMany({
      where: { client_id: BigInt(clientId) },
      orderBy: { created_at: 'desc' },
    });
    const dollarRate = await this.getDollarRate();
    const result = await Promise.all(rows.map((r) => this.buildCartResponse(r, dollarRate)));
    return result;
  }

  async addToCart(
    clientId: number | string,
    dto: { article_id: string; type: 'article' | 'combo'; quantity?: number },
  ) {
    const articleId = dto.article_id;
    const type = dto.type;
    const quantity = dto.quantity ?? 1;

    if (!articleId) throw new BadRequestException('article_id es requerido');
    if (!['article', 'combo'].includes(type))
      throw new BadRequestException('type debe ser article o combo');
    if (quantity < 1) throw new BadRequestException('quantity debe ser >= 1');

    // Validar existencia del artículo/combo
    let exists = false;
    if (type === 'article') {
      try {
        const art = await this.prisma.articles.findUnique({
          where: { id: BigInt(articleId) },
        });
        exists = !!art;
      } catch {
        exists = false;
      }
      if (!exists) throw new NotFoundException('Artículo no encontrado');
    } else {
      const combo = await this.prisma.build_pc_tabla.findUnique({
        where: { id: BigInt(articleId) },
      });
      if (!combo) throw new NotFoundException('Combo no encontrado');
    }

    // Ver si ya existe en carrito para este usuario + tipo + article_id
    const existing = await this.prisma.cart.findFirst({
      where: {
        client_id: BigInt(clientId),
        article_id: BigInt(articleId),
        type,
      },
    });

    const dollarRate = await this.getDollarRate();

    if (existing) {
      // Incrementar cantidad (upsert semántico de carrito)
      const updated = await this.prisma.cart.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + quantity },
      });
      return this.buildCartResponse(updated, dollarRate);
    }

    try {
      const created = await this.prisma.cart.create({
        data: {
          client_id: BigInt(clientId),
          article_id: BigInt(articleId),
          type,
          quantity,
        },
      });
      return this.buildCartResponse(created, dollarRate);
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Este producto ya está en tu carrito');
      }
      throw error;
    }
  }

  async updateQuantity(
    clientId: number | string,
    cartId: string,
    quantity: number,
  ) {
    if (!quantity || quantity < 1) throw new BadRequestException('quantity debe ser >= 1');

    let row: any;
    try {
      row = await this.prisma.cart.findUnique({ where: { id: BigInt(cartId) } });
    } catch {
      throw new BadRequestException('ID de carrito inválido');
    }

    if (!row) throw new NotFoundException('Item del carrito no encontrado');
    if (row.client_id.toString() !== String(clientId))
      throw new NotFoundException('Item del carrito no encontrado');

    const updated = await this.prisma.cart.update({
      where: { id: BigInt(cartId) },
      data: { quantity },
    });
    const dollarRate = await this.getDollarRate();
    return this.buildCartResponse(updated, dollarRate);
  }

  async removeFromCart(clientId: number | string, cartId: string) {
    let row: any;
    try {
      row = await this.prisma.cart.findUnique({ where: { id: BigInt(cartId) } });
    } catch {
      throw new BadRequestException('ID de carrito inválido');
    }
    if (!row) throw new NotFoundException('Item del carrito no encontrado');
    if (row.client_id.toString() !== String(clientId))
      throw new NotFoundException('Item del carrito no encontrado');

    await this.prisma.cart.delete({ where: { id: BigInt(cartId) } });
    return { message: 'Producto eliminado del carrito' };
  }
}
