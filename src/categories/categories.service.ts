import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import slugify from 'slugify';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) { }

  private formatImageUrl(url: string | null): string | null {
    if (!url) return null;
    if (url.startsWith('http')) {
      return url.replace(
        /http:\/\/localhost:\d+/g,
        this.configService.get('APP_URL') || 'http://192.168.18.26:3000',
      );
    }
    const baseUrl =
      this.configService.get('APP_URL') || 'http://192.168.18.26:3000';
    return `${baseUrl}${url}`;
  }

  static generateCategorySlug(name: string, id: number | bigint): string {
    const base = name
      .toLowerCase()
      .replace(/\|/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const truncated = base.length <= 50 ? base : base.slice(0, 50).replace(/-[^-]*$/, '');
    return `${truncated}-${id}`;
  }

  private generateCategorySlug(name: string, id: number | bigint): string {
    return CategoriesService.generateCategorySlug(name, id);
  }

  // alternativa usando slugify lib manteniendo compat con articulos
  private generateSlugWithLib(name: string, id: number | bigint): string {
    const base = slugify(name, { lower: true, strict: true });
    const truncated = base.length <= 50 ? base : base.slice(0, 50).replace(/-[^-]*$/, '');
    return `${truncated}-${id}`;
  }

  private async getValidSubCategoryIds(): Promise<bigint[]> {
    const stockRows: any[] = await this.prisma.$queryRaw`SELECT article_id FROM v_article_stock_global WHERE saldo > 0`;
    const inStockIds = stockRows.map((r) => BigInt(r.article_id));
    if (inStockIds.length === 0) return [];
    const articles = await this.prisma.articles.findMany({
      where: { status: 1, venta: true, habilitado_web: true, slug: { not: null }, sub_category_id: { not: null }, id: { in: inStockIds } },
      select: { sub_category_id: true },
    });
    const ids = [...new Set(articles.map((a) => a.sub_category_id))];
    return ids.filter(Boolean) as bigint[];
  }

  private async getInStockIds(): Promise<bigint[] | null> {
    const stockRows: any[] = await this.prisma.$queryRaw`SELECT article_id FROM v_article_stock_global WHERE saldo > 0`;
    const ids = stockRows.map((r) => BigInt(r.article_id));
    return ids;
  }

  async create(
    createCategoryDto: CreateCategoryDto,
    file?: Express.Multer.File,
  ) {
    let imageUrl = createCategoryDto.image_url;
    if (file) {
      imageUrl = `/storage/categories/${file.filename}`;
    }

    const category = await this.prisma.categories.create({
      data: {
        name: createCategoryDto.name,
        st_concept: createCategoryDto.st_concept || false,
        image_url: imageUrl,
      },
    });

    // Generar slug estable tipo "notebook-17" (mismo criterio que articulos)
    const slug = this.generateCategorySlug(category.name!, Number(category.id));
    const updated = await this.prisma.categories.update({
      where: { id: category.id },
      data: { slug },
    });

    return {
      ...updated,
      id: updated.id.toString(),
      image_url: this.formatImageUrl(updated.image_url),
    };
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    file?: Express.Multer.File,
  ) {
    const categoryId = BigInt(id);
    const existing = await this.prisma.categories.findUnique({
      where: { id: categoryId },
    });

    if (!existing) {
      throw new NotFoundException('Categoría no encontrada');
    }

    let imageUrl = updateCategoryDto.image_url;
    if (file) {
      imageUrl = `/storage/categories/${file.filename}`;
    }

    const finalData: any = {};
    if (updateCategoryDto.name !== undefined) finalData.name = updateCategoryDto.name;
    if ((updateCategoryDto as any).st_concept !== undefined) finalData.st_concept = (updateCategoryDto as any).st_concept;
    if ((updateCategoryDto as any).status !== undefined) finalData.status = (updateCategoryDto as any).status;
    // slug: si viene explícito usarlo, si cambia nombre generarlo, si no mantener existente
    if ((updateCategoryDto as any).slug !== undefined) {
      finalData.slug = (updateCategoryDto as any).slug || null;
    } else if (updateCategoryDto.name && updateCategoryDto.name !== existing.name) {
      finalData.slug = this.generateCategorySlug(updateCategoryDto.name, Number(categoryId));
    }
    if (imageUrl !== undefined) finalData.image_url = imageUrl;

    const category = await this.prisma.categories.update({
      where: { id: categoryId },
      data: finalData,
    });

    return {
      ...category,
      id: category.id.toString(),
      image_url: this.formatImageUrl(category.image_url),
    };
  }

  async remove(id: string) {
    const categoryId = BigInt(id);
    const category = await this.prisma.categories.update({
      where: { id: categoryId },
      data: { status: 0 },
    });

    return {
      ...category,
      id: category.id.toString(),
    };
  }

  async findOne(id: string) {
    const category = await this.prisma.categories.findUnique({
      where: { id: BigInt(id) },
    });

    if (!category) return null;

    return {
      ...category,
      id: category.id.toString(),
      image_url: this.formatImageUrl(category.image_url),
    };
  }

  async findAll(params: { search?: string }) {
    const { search } = params;
    const validSubIds = await this.getValidSubCategoryIds();
    const inStockIds = await this.getInStockIds();
    if (inStockIds && inStockIds.length === 0) return [];

    const where: any = {
      status: 1,
      articles: { some: { status: 1, venta: true, habilitado_web: true, slug: { not: null }, ...(inStockIds && inStockIds.length > 0 ? { id: { in: inStockIds } } : {}) } },
      // sub_categories: { some: { id: { in: validSubIds } } },
    };

    if (search) {
      where.name = { contains: search };
    }

    const categories = await this.prisma.categories.findMany({
      where,
      include: {
        sub_categories: {
          where: {
            status: 1,
            id: { in: validSubIds },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return categories.map((cat) => ({
      ...cat,
      id: cat.id.toString(),
      image_url: this.formatImageUrl(cat.image_url),
      sub_categories: cat.sub_categories.map((sub) => ({
        ...sub,
        id: sub.id.toString(),
        category_id: sub.category_id.toString(),
      })),
    }));
  }

  async findAllPagination(params: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { page = 1, limit = 10, search } = params;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const validSubIds = await this.getValidSubCategoryIds();
    const inStockIds = await this.getInStockIds();
    if (inStockIds && inStockIds.length === 0) {
      return { data: [], meta: { total: 0, page: Number(page), limit: Number(limit), totalPages: 0 } };
    }

    const where: any = {
      status: 1,
      articles: { some: { status: 1, venta: true, habilitado_web: true, slug: { not: null }, ...(inStockIds && inStockIds.length > 0 ? { id: { in: inStockIds } } : {}) } },
      // sub_categories: { some: { id: { in: validSubIds } } },
    };

    if (search) {
      where.name = { contains: search };
    }

    const [categories, total] = await Promise.all([
      this.prisma.categories.findMany({
        where,
        include: {
          sub_categories: {
            where: {
              status: 1,
              id: { in: validSubIds },
            },
          },
        },
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.categories.count({ where }),
    ]);

    return {
      data: categories.map((cat) => ({
        ...cat,
        id: cat.id.toString(),
        image_url: this.formatImageUrl(cat.image_url),
        sub_categories: cat.sub_categories.map((sub) => ({
          ...sub,
          id: sub.id.toString(),
          category_id: sub.category_id.toString(),
        })),
      })),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findAllPaginationInfinity(params: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { page = 1, limit = 10, search } = params;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const validSubIds = await this.getValidSubCategoryIds();
    const inStockIds = await this.getInStockIds();
    if (inStockIds && inStockIds.length === 0) {
      return { data: [], meta: { total: 0, page: Number(page), limit: Number(limit), totalPages: 0, hasNextPage: false } };
    }

    const where: any = {
      status: 1,
      articles: { some: { status: 1, venta: true, habilitado_web: true, slug: { not: null }, ...(inStockIds && inStockIds.length > 0 ? { id: { in: inStockIds } } : {}) } },
      sub_categories: { some: { id: { in: validSubIds } } },
    };

    if (search) {
      where.name = { contains: search };
    }

    const [data, total] = await Promise.all([
      this.prisma.categories.findMany({
        where,
        include: {
          sub_categories: {
            where: {
              status: 1,
              id: { in: validSubIds },
            },
          },
        },
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.categories.count({ where }),
    ]);

    return {
      data: data.map((cat) => ({
        ...cat,
        id: cat.id.toString(),
        image_url: this.formatImageUrl(cat.image_url),
        sub_categories: cat.sub_categories.map((sub) => ({
          ...sub,
          id: sub.id.toString(),
          category_id: sub.category_id.toString(),
        })),
      })),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        hasNextPage: Number(page) * Number(limit) < total,
      },
    };
  }
  async filterSubcategories(id: string) {
    const validSubIds = await this.getValidSubCategoryIds();
    const subCategories = await this.prisma.sub_categories.findMany({
      where: {
        category_id: BigInt(id),
        status: 1,
        id: { in: validSubIds },
      },
    });
     console.log(id)
    return subCategories.map((sub) => ({
      ...sub,
      id: sub.id.toString(),
      category_id: sub.category_id.toString(),
    }));
  }
}
