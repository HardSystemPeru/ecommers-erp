import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubCategoriesService {
  constructor(private prisma: PrismaService) {}

  private async getInStockIds(): Promise<bigint[] | null> {
    const stockRows: any[] = await this.prisma
      .$queryRaw`SELECT article_id FROM v_article_stock_global WHERE saldo > 0`;
    return stockRows.map((r) => BigInt(r.article_id));
  }

  async findAll(params: { categoryId?: string; search?: string }) {
    const { categoryId, search } = params;
    const inStockIds = await this.getInStockIds();
    if (inStockIds && inStockIds.length === 0) return [];

    const where: any = {
      status: 1,
      articles: {
        some: {
          status: 1,
          venta: true,
          habilitado_web: true,
          slug: { not: null },
          ...(inStockIds && inStockIds.length > 0
            ? { id: { in: inStockIds } }
            : {}),
        },
      },
    };

    if (categoryId) {
      where.category_id = BigInt(categoryId);
    }

    if (search) {
      where.name = { contains: search };
    }

    const subCategories = await this.prisma.sub_categories.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return subCategories.map((sub) => ({
      ...sub,
      id: sub.id.toString(),
      category_id: sub.category_id.toString(),
    }));
  }

  async findAllPaginationInfinity(params: {
    page?: number;
    limit?: number;
    categoryId?: string;
    search?: string;
  }) {
    const { page = 1, limit = 10, categoryId, search } = params;

    const skip = (page - 1) * limit;
    const inStockIds = await this.getInStockIds();
    if (inStockIds && inStockIds.length === 0) {
      return {
        data: [],
        meta: { total: 0, page, limit, totalPages: 0, hasNextPage: false },
      };
    }

    const where: any = {
      status: 1,
      articles: {
        some: {
          status: 1,
          venta: true,
          habilitado_web: true,
          slug: { not: null },
          ...(inStockIds && inStockIds.length > 0
            ? { id: { in: inStockIds } }
            : {}),
        },
      },
    };

    if (categoryId) {
      where.category_id = BigInt(categoryId);
    }

    if (search) {
      where.name = { contains: search };
    }

    const [data, total] = await Promise.all([
      this.prisma.sub_categories.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.sub_categories.count({ where }),
    ]);

    return {
      data: data.map((sub) => ({
        ...sub,
        id: sub.id.toString(),
        category_id: sub.category_id.toString(),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }
  async findAllPagination(params: {
    page?: number;
    limit?: number;
    categoryId?: string;
    search?: string;
  }) {
    const { page = 1, limit = 10, categoryId, search } = params;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const inStockIds = await this.getInStockIds();
    if (inStockIds && inStockIds.length === 0) {
      return {
        data: [],
        meta: {
          total: 0,
          page: Number(page),
          limit: Number(limit),
          lastPage: 0,
        },
      };
    }

    const where: any = {
      status: 1,
      articles: {
        some: {
          status: 1,
          venta: true,
          habilitado_web: true,
          slug: { not: null },
          ...(inStockIds && inStockIds.length > 0
            ? { id: { in: inStockIds } }
            : {}),
        },
      },
    };

    if (categoryId) {
      where.category_id = BigInt(categoryId);
    }

    if (search) {
      where.name = { contains: search };
    }

    const [data, total] = await Promise.all([
      this.prisma.sub_categories.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.sub_categories.count({ where }),
    ]);

    return {
      data: data.map((sub) => ({
        ...sub,
        id: sub.id.toString(),
        category_id: sub.category_id.toString(),
      })),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        lastPage: Math.ceil(total / limit),
      },
    };
  }
  async uploadImage(id: string, file: Express.Multer.File) {
    const subCategory = await this.prisma.sub_categories.findUnique({
      where: { id: BigInt(id) },
    });

    if (!subCategory) {
      throw new NotFoundException('Subcategoria no encontrada');
    }

    const baseUrl = process.env.APP_URL;
    const imageUrl = `${baseUrl}/storage/sub-categories/${file.filename}`;

    await this.prisma.sub_categories.update({
      where: { id: BigInt(id) },
      data: {
        image_url: imageUrl,
      },
    });

    return {
      message: 'Imagen subida exitosamente',
      image_url: imageUrl,
    };
  }
}
