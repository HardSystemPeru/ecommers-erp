import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthDto {
  @ApiProperty({ description: 'Google ID Token (credential) obtenido con GIS / One Tap / google.accounts.id', example: 'eyJhbGciOiJSUzI1NiIs...' })
  @IsString()
  token!: string;
}

