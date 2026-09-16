import { Expose, Transform, Type } from 'class-transformer';

export class CategoryResponseDto {
  @Expose() id: string;
  @Expose() name: string;
}

export class SubCategoryResponseDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() category_id: string;
}

export class BrandResponseDto {
  @Expose() id: string;
  @Expose() name: string;
}

export class ArticleImageResponseDto {
  @Expose()
  @Transform(({ value }) => value?.toString())
  id: string;

  @Expose()
  @Transform(({ value }) => {
    if (!value) return null;
    const baseUrl = process.env.APP_URL || 'http://192.168.18.26:3000';
    if (value.startsWith('http')) {
      return value.replace(/http:\/\/localhost:\d+/g, baseUrl);
    }
    return `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
  })
  url: string;

  @Expose() position: number;
  @Expose() is_main: boolean;
}

export class ArticleResponseDto {
  @Expose() type: string;
  @Expose() id: number;
  @Expose() description: string;
  
  @Expose()
  @Transform(({ obj }) => obj.description || obj.name)
  name: string;
  
  @Expose() cod_fab: string;

  @Expose()
  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : null))
  public_price: number;

  @Expose()
  slug: string;

  @Expose()
  @Transform(({ value }) => (value !== undefined && value !== null ? parseFloat(value) : 0))
  average_rating: number;

  @Expose()
  total_reviews: number;

  @Expose()
  @Type(() => ArticleImageResponseDto)
  images: ArticleImageResponseDto[];

  @Expose() sold_count: number;
  @Expose() category_id: number;
  @Expose() sub_category_id: number;
  @Expose() brand_id: number;
  @Expose() stock: number;
  @Expose() status: number;
  @Expose() venta: boolean;
  @Expose() created_at: Date;
  @Expose() updated_at: Date;

  @Expose()
  categories: CategoryResponseDto;

  @Expose()
  sub_categories: SubCategoryResponseDto;

  @Expose()
  brands: BrandResponseDto;

  @Expose() min_stock: number;

  @Expose()
  @Type(() => ArticleImageResponseDto)
  article_images: ArticleImageResponseDto[];

  @Expose()
  @Transform(({ value }) => {
    if (!value) return null;
    const baseUrl = process.env.APP_URL || 'http://192.168.18.26:3000';
    if (value.startsWith('http')) return value;
    return `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
  })
  image_build: string;

  @Expose()
  precio_public_soles: number;

  @Expose()
  precio_public_dolares: number;

  @Expose()
  precio_porcentaje: number;

  @Expose()
  precio_porcentaje_dolares: number;

  @Expose()
  is_new_for_web: number;

  @Expose()
  has_offer: number;

  @Expose()
  offer_price_percent: number;

  @Expose()
  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : null))
  precio_final: number;

  @Expose()
  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : null))
  precio_final_soles: number;

  @Expose()
  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : null))
  precio_final_dolares: number;

  @Expose()
  items: any[];
}