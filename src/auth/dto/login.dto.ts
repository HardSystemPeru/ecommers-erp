import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'juan@example.com' })
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  email!: string;

  @ApiProperty({ example: 'S3cur3P@ss', minLength: 6 })
  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password!: string;

  @ApiProperty({ description: 'Token reCAPTCHA requerido en login (anti-bots)', example: '03AGdBq...' })
  @IsString()
  captchaToken!: string
}

