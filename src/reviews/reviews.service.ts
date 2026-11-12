import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async create(clientId: number, createReviewDto: CreateReviewDto) {
    const existing = await this.prisma.reviews.findUnique({
      where: {
        client_id_article_id: {
          client_id: BigInt(clientId),
          article_id: BigInt(createReviewDto.article_id),
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'Ya has dejado una reseña para este producto. Solo puedes dejar una reseña por producto.',
      );
    }

    const review = await this.prisma.reviews.create({
      data: {
        client_id: BigInt(clientId),
        article_id: BigInt(createReviewDto.article_id),
        rating: createReviewDto.rating,
        comment: createReviewDto.comment,
      },
      include: {
        clients: {
          select: {
            names: true,
            lastnames: true,
          },
        },
      },
    });

    return this.serialize(review);
  }

  async findByArticle(articleId: string) {
    const reviews = await this.prisma.reviews.findMany({
      where: {
        article_id: BigInt(articleId),
        status: 1,
      },
      include: {
        clients: {
          select: {
            names: true,
            lastnames: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return reviews.map((review) => this.serialize(review));
  }

  async findByClient(clientId: number) {
    const reviews = await this.prisma.reviews.findMany({
      where: { client_id: BigInt(clientId) },
      include: {
        articles: {
          select: {
            description: true,
            image_url: true,
          },
        },
      },
    });

    return reviews.map((review) => this.serialize(review));
  }

  async update(
    id: string,
    clientId: number,
    updateReviewDto: UpdateReviewDto,
    requesterId?: number | string,
  ) {
    const review = await this.prisma.reviews.findUnique({
      where: { id: BigInt(id) },
    });

    if (!review) {
      throw new NotFoundException('Reseña no encontrada');
    }

    if (
      requesterId !== undefined &&
      String(review.client_id) !== String(requesterId)
    ) {
      throw new ForbiddenException('No tienes permiso para editar esta reseña');
    }

    const updatedReview = await this.prisma.reviews.update({
      where: { id: BigInt(id) },
      data: {
        rating: updateReviewDto.rating,
        comment: updateReviewDto.comment,
        updated_at: new Date(),
      },
    });

    return this.serialize(updatedReview);
  }

  async remove(id: string, clientId: number) {
    const review = await this.prisma.reviews.findUnique({
      where: { id: BigInt(id) },
    });

    if (!review) {
      throw new NotFoundException('Reseña no encontrada');
    }

    if (review.client_id !== BigInt(clientId)) {
      throw new ForbiddenException(
        'No tienes permiso para eliminar esta reseña',
      );
    }

    await this.prisma.reviews.delete({
      where: { id: BigInt(id) },
    });

    return { message: 'Reseña eliminada correctamente' };
  }

  private serialize(obj: any) {
    if (!obj) return null;
    const serialized = {
      ...obj,
      id: obj.id?.toString(),
      client_id: obj.client_id?.toString(),
      article_id: obj.article_id?.toString(),
    };

    if (obj.articles) {
      serialized.articles = {
        ...obj.articles,
        id: obj.articles.id?.toString(),
        image_url: obj.articles.image_url
          ? obj.articles.image_url.startsWith('http')
            ? obj.articles.image_url
            : `${process.env.APP_URL || 'http://localhost:3000'}${obj.articles.image_url}`
          : null,
      };
    }

    return serialized;
  }
}
