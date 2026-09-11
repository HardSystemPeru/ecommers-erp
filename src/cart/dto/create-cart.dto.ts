import { IsInt, IsNotEmpty, IsIn, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCartDto {
  @IsNotEmpty()
  article_id: string;

  @IsNotEmpty()
  @IsIn(['article', 'combo'])
  type: 'article' | 'combo';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}
