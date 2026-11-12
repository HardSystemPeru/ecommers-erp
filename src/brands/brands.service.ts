import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

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

  async create(createBrandDto: CreateBrandDto, file?: Express.Multer.File) {
    let imageUrl = createBrandDto.image_url;
    if (file) {
      imageUrl = `/storage/brands/${file.filename}`;
    }

    const brand = await this.prisma.brands.create({
      data: {
        name: createBrandDto.name,
        image_url: imageUrl,
      },
    });

    return {
      ...brand,
      id: brand.id.toString(),
      image_url: this.formatImageUrl(brand.image_url),
    };
  }

  async update(
    id: string,
    updateBrandDto: UpdateBrandDto,
    file?: Express.Multer.File,
  ) {
    const brandId = BigInt(id);
    const existing = await this.prisma.brands.findUnique({
      where: { id: brandId },
    });

    if (!existing) {
      throw new NotFoundException('Marca no encontrada');
    }

    let imageUrl = updateBrandDto.image_url;
    if (file) {
      imageUrl = `/storage/brands/${file.filename}`;
    }

    const brand = await this.prisma.brands.update({
      where: { id: brandId },
      data: {
        ...updateBrandDto,
        image_url: imageUrl !== undefined ? imageUrl : existing.image_url,
      },
    });

    return {
      ...brand,
      id: brand.id.toString(),
      image_url: this.formatImageUrl(brand.image_url),
    };
  }

  async remove(id: string) {
    const brandId = BigInt(id);
    const brand = await this.prisma.brands.update({
      where: { id: brandId },
      data: { status: 0 },
    });

    return {
      ...brand,
      id: brand.id.toString(),
    };
  }

  async findOne(id: string) {
    const brand = await this.prisma.brands.findUnique({
      where: { id: BigInt(id) },
    });

    if (!brand) return null;

    return {
      ...brand,
      id: brand.id.toString(),
      image_url: this.formatImageUrl(brand.image_url),
    };
  }

  private async getInStockIds(): Promise<bigint[] | null> {
    const stockRows: any[] = await this.prisma
      .$queryRaw`SELECT article_id FROM v_article_stock_global WHERE saldo > 0`;
    return stockRows.map((r) => BigInt(r.article_id));
  }

  async findAll(params: { search?: string }) {
    const { search } = params;
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

    if (search) {
      where.name = { contains: search };
    }

    const brands = await this.prisma.brands.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return brands.map((brand) => ({
      ...brand,
      id: brand.id.toString(),
      image_url: this.formatImageUrl(brand.image_url),
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
    const inStockIds = await this.getInStockIds();
    if (inStockIds && inStockIds.length === 0) {
      return {
        data: [],
        meta: {
          total: 0,
          page: Number(page),
          limit: Number(limit),
          totalPages: 0,
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

    if (search) {
      where.name = { contains: search };
    }

    const [brands, total] = await Promise.all([
      this.prisma.brands.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.brands.count({ where }),
    ]);

    return {
      data: brands.map((brand) => ({
        ...brand,
        id: brand.id.toString(),
        image_url: this.formatImageUrl(brand.image_url),
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
    const inStockIds = await this.getInStockIds();
    if (inStockIds && inStockIds.length === 0) {
      return {
        data: [],
        meta: {
          total: 0,
          page: Number(page),
          limit: Number(limit),
          totalPages: 0,
          hasNextPage: false,
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

    if (search) {
      where.name = { contains: search };
    }

    const [data, total] = await Promise.all([
      this.prisma.brands.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.brands.count({ where }),
    ]);

    return {
      data: data.map((brand) => ({
        ...brand,
        id: brand.id.toString(),
        image_url: this.formatImageUrl(brand.image_url),
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
}
