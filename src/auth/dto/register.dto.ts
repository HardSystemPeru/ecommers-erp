import { IsEmail, IsOptional, IsPhoneNumber, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { Transform } from 'class-transformer';

export class RegisterDto {

  @IsString()
  @Matches(/^[\p{L}\s'-]+$/u, { message: 'El nombre solo puede contener letras' })
  names!: string;

  @IsString()
  lastnames!: string;

  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  @MaxLength(255)
   @Transform(({ value }) => value?.trim().toLowerCase())
  email!: string;

  @IsOptional()
  @IsString()
  // @IsPhoneNumber('PE', { message: 'El teléfono no es válido' }) 
  phone?: string;

  @IsOptional()
  @IsString()
  document_type?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{8,11}$/, { message: 'El número de documento debe tener entre 8 y 11 dígitos' })
  document_number?: string;

  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  @MaxLength(72) // bcrypt trunca a 72 bytes, poner límite evita confusión
//   @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
//   message: 'La contraseña debe incluir mayúscula, minúscula y número',
// })
  password!: string;

  @IsString()
  // @MaxLength(2000)
  captchaToken!: string;
 }

