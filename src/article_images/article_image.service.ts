import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { WatermarkService } from 'src/common/watermark/watermark.service';
import { CreateArticleImageDto } from './dto/create-article_image.dto';
import { UpdateArticleImageDto } from './dto/update-article_image.to';
import { processArticleImage } from './image-processing.util';
import { unlink } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class ArticleImageService {
  private readonly logger = new Logger(ArticleImageService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private watermarkService: WatermarkService,
  ) {}

  private async notifyProductRevalidation(slug?: string): Promise<void> {
    const url = this.configService.get<string>('FRONTEND_REVALIDATE_URL');
    const secret = this.configService.get<string>('REVALIDATE_SECRET');

    if (!url || !secret) return;

    const hasSlug = typeof slug === 'string' && slug.length > 0;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'x-revalidate-secret': secret,
            ...(hasSlug ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(hasSlug ? { body: JSON.stringify({ slug }) } : {}),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) return;
        this.logger.warn(`Revalidación frontend respondió ${response.status}`);
      } catch {
        this.logger.warn(
          `No se pudo revalidar el frontend (intento ${attempt})`,
        );
      }

      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private async getArticleSlug(articleId: bigint): Promise<string | undefined> {
    try {
      const article = await this.prisma.articles.findUnique({
        where: { id: articleId },
        select: { slug: true },
      });
      return article?.slug ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async notifyForArticle(articleId: bigint): Promise<void> {
    const slug = await this.getArticleSlug(articleId);
    await this.notifyProductRevalidation(slug);
  }

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

  private async deleteLocalImage(url?: string | null): Promise<void> {
    if (!url) return;
    const rel = url.replace(/^https?:\/\/[^/]+/, '');
    if (!rel.startsWith('/storage/articles/')) return;
    const abs = join(process.cwd(), rel.replace(/^\//, ''));
    try {
      await unlink(abs);
    } catch {
      // ignore missing
    }
  }

  private baseNameFromUrl(url?: string | null): string | undefined {
    if (!url) return undefined;
    const m = url.match(/\/storage\/articles\/([^/.]+)\.[^.]+$/);
    return m?.[1];
  }

  private formatImage(image: any) {
    return {
      ...image,
      id: image.id.toString(),
      article_id: image.article_id.toString(),
      url: this.formatImageUrl(image.url),
      thumbnail_url: this.formatImageUrl(
        (image as any).thumbnail_url ?? image.url,
      ),
    };
  }

  async create(
    createArticleImageDto: CreateArticleImageDto,
    file?: Express.Multer.File,
  ) {
    const { article_id, is_main } = createArticleImageDto;
    const articleId = BigInt(article_id);

    let imageUrl = createArticleImageDto.url ?? null;
    let thumbnailUrl: string | null = null;

    if (file) {
      if (!file.buffer) {
        throw new BadRequestException('Archivo inválido');
      }
      const processed = await processArticleImage({
        buffer: file.buffer,
        watermarkService: this.watermarkService,
      });
      imageUrl = processed.url;
      thumbnailUrl = processed.thumbnail_url;
    }

    if (!imageUrl) {
      throw new BadRequestException('Debe proporcionar una URL o subir un archivo');
    }

    if (!thumbnailUrl) thumbnailUrl = imageUrl;

    const lastImage = await this.prisma.article_images.findFirst({
      where: { article_id: articleId },
      orderBy: { position: 'desc' },
    });

    const autoPosition = lastImage ? lastImage.position + 1 : 0;
    const finalPosition =
      createArticleImageDto.position === undefined ||
      createArticleImageDto.position === null ||
      Number(createArticleImageDto.position) === 0
        ? autoPosition
        : Number(createArticleImageDto.position);

    const shouldBeMain = is_main ?? autoPosition === 0;
    if (shouldBeMain) {
      await this.prisma.article_images.updateMany({
        where: { article_id: articleId },
        data: { is_main: false },
      });
    }

    const image = await this.prisma.article_images.create({
      data: {
        article_id: articleId,
        url: imageUrl,
        thumbnail_url: thumbnailUrl,
        public_id: createArticleImageDto.public_id,
        position: finalPosition,
        is_main: shouldBeMain,
      } as any,
    });

    if (image.is_main) {
      await this.prisma.articles.update({
        where: { id: articleId },
        data: { image_url: image.url },
      });
    }

    void this.notifyForArticle(articleId);

    return this.formatImage(image);
  }

  async findAll(article_id?: string) {
    const where: any = {};
    if (article_id) {
      where.article_id = BigInt(article_id);
    }

    const images = await this.prisma.article_images.findMany({
      where,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return images.map((image) => this.formatImage(image));
  }

  async findOne(id: string) {
    const image = await this.prisma.article_images.findUnique({
      where: { id: BigInt(id) },
    });
    if (!image) return null;
    return this.formatImage(image);
  }

  async update(
    id: string,
    updateArticleImageDto: UpdateArticleImageDto = {},
    file?: Express.Multer.File,
  ) {
    const imageId = BigInt(id);
    const dto = updateArticleImageDto;
    const current = await this.prisma.article_images.findUnique({
      where: { id: imageId },
    });
    if (!current) {
      throw new NotFoundException('Imagen no encontrada');
    }

    const data: any = {};
    if (dto.public_id !== undefined) data.public_id = dto.public_id;
    if (dto.position !== undefined) data.position = Number(dto.position);
    if (dto.article_id !== undefined) data.article_id = BigInt(dto.article_id);

    if (file) {
      if (!file.buffer) {
        throw new BadRequestException('Archivo inválido');
      }
      const baseName = this.baseNameFromUrl(current.url);
      const processed = await processArticleImage({
        buffer: file.buffer,
        watermarkService: this.watermarkService,
        baseName,
      });
      data.url = processed.url;
      data.thumbnail_url = processed.thumbnail_url;
      if (!baseName) {
        await this.deleteLocalImage(current.url);
        await this.deleteLocalImage((current as any).thumbnail_url);
      }
    }

    const articleIdFromBody = dto.article_id ? BigInt(dto.article_id) : null;
    const isMain = dto.is_main === true;
    if (isMain) {
      const articleId = articleIdFromBody ?? current.article_id;
      await this.prisma.article_images.updateMany({
        where: { article_id: articleId },
        data: { is_main: false },
      });
      data.is_main = true;
    } else if (dto.is_main === false) {
      data.is_main = false;
    }

    const image = await this.prisma.article_images.update({
      where: { id: imageId },
      data,
    });

    if (image.is_main) {
      await this.prisma.articles.update({
        where: { id: image.article_id },
        data: { image_url: image.url },
      });
    }

    void this.notifyForArticle(image.article_id);

    return this.formatImage(image);
  }

  async setMain(id: string) {
    const imageId = BigInt(id);
    const image = await this.prisma.article_images.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      throw new NotFoundException('Imagen no encontrada');
    }

    const articleId = image.article_id;

    await this.prisma.article_images.updateMany({
      where: { article_id: articleId },
      data: { is_main: false },
    });

    const updated = await this.prisma.article_images.update({
      where: { id: imageId },
      data: { is_main: true },
    });

    await this.prisma.articles.update({
      where: { id: articleId },
      data: { image_url: updated.url },
    });

    void this.notifyForArticle(articleId);

    return this.formatImage(updated);
  }

  async remove(id: string) {
    try {
      const image = await this.prisma.article_images.delete({
        where: { id: BigInt(id) },
      });

      await this.deleteLocalImage(image.url);
      await this.deleteLocalImage(image.thumbnail_url);

      if (image.is_main) {
        const nextMain = await this.prisma.article_images.findFirst({
          where: { article_id: image.article_id },
          orderBy: { created_at: 'asc' },
        });

        if (nextMain) {
          await this.prisma.article_images.update({
            where: { id: nextMain.id },
            data: { is_main: true },
          });
          await this.prisma.articles.update({
            where: { id: image.article_id },
            data: { image_url: nextMain.url },
          });
        } else {
          await this.prisma.articles.update({
            where: { id: image.article_id },
            data: { image_url: null },
          });
        }
      }

      void this.notifyForArticle(image.article_id);

      return this.formatImage(image);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException('Imagen no encontrada');
    }
  }
}
