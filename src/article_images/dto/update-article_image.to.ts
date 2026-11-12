import { Transform } from 'class-transformer';

export class UpdateArticleImageDto {
  url?: string;
  article_id?: number;
  public_id?: string;
  position?: number;
  @Transform(({ value }) => value === 'true' || value === true)
  is_main?: boolean;
}
