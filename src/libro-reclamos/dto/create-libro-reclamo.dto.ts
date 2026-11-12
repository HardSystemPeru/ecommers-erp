// src/complaints/dto/create-complaint.dto.ts
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export enum WellHired {
  PRODUCTO = 'producto',
  SERVICIO = 'servicio',
}

export enum TypeComplaint {
  RECLAMO = 'reclamo',
  QUEJA = 'queja',
}

export class CreateLibroReclamoDto {
  @IsString()
  @IsNotEmpty()
  customer_name!: string;

  @IsString()
  @IsNotEmpty()
  customer_lastname!: string;

  @IsString()
  @Length(8, 11)
  dni_ruc!: string;

  @IsEmail()
  email!: string;

  @Matches(/^\d{9}$/, { message: 'phone must be 9 digits' })
  phone!: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsOptional()
  @IsString()
  parent_data?: string;

  @IsEnum(WellHired)
  well_hired!: WellHired;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  detail_complaint!: string;

  @IsOptional()
  @IsString()
  order?: string;

  @IsNumberString()
  amount!: string;

  @IsEnum(TypeComplaint)
  type_complaint!: TypeComplaint;

  @IsOptional()
  @IsString()
  observations?: string;

  @IsString()
  @IsNotEmpty()
  recaptcha_token!: string;
}
