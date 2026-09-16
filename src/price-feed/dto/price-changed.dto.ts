import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export type PriceChangedType = 'price' | 'fx' | 'web-status';

/**
 * Payload que envía backend-hsgestion cuando cambia un precio,
 * el tipo de cambio o la visibilidad web de un artículo.
 *
 * companyId es opcional: si viene, el evento solo se reparte a los
 * suscriptores de ese tenant. Si no viene (caso tipo de cambio global),
 * se difunde a todos (broadcast).
 */
export class PriceChangedDto {
  @IsOptional()
  @IsIn(['price', 'fx', 'web-status'])
  type?: PriceChangedType;

  /** company_type_id del tenant (string porque viaja como BigInt). */
  @IsOptional()
  @IsString()
  companyId?: string;

  /** IDs de artículos afectados (acepta number o string por PHP/MySQL). */
  @IsOptional()
  @IsArray()
  articleIds?: (number | string)[];

  /** Slugs afectados para revalidación fina en el front. */
  @IsOptional()
  @IsArray()
  slugs?: string[];

  /** Nuevo parallel_rate cuando type='fx'. */
  @IsOptional()
  fxRate?: number | string;
}
