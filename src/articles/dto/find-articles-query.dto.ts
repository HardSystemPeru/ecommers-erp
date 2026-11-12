import {
  IsOptional,
  IsString,
  IsInt,
  IsNumber,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class FindArticlesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subCategoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  brandId?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  exclude?: number;

  @IsOptional()
  @Transform(
    ({ value }) =>
      value === 'true' || value === true || value === 1 || value === '1',
  )
  @IsBoolean()
  nuevos?: boolean;

  @IsOptional()
  @Transform(
    ({ value }) =>
      value === 'true' || value === true || value === 1 || value === '1',
  )
  @IsBoolean()
  ofertas?: boolean;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  aleatorio?: boolean;
}
