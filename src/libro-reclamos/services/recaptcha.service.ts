// src/complaints/services/recaptcha.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RecaptchaService {
  constructor(private config: ConfigService) {}

  async verify(token: string): Promise<void> {
    const secret: any = this.config.get<string>('RECAPTCHA_SECRET_KEY');

    //     if (this.config.get('NODE_ENV') !== 'production' && token === 'TOKEN_DE_PRUEBA_RECAPTCHA') {
    //   return;
    // }

    //  const secret:any = this.config.get<string>('RECAPTCHA_SECRET_KEY');
    const response = await fetch(
      'https://www.google.com/recaptcha/api/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token }).toString(),
      },
    );

    const data = await response.json();

    if (!data.success || (data.score !== undefined && data.score < 0.5)) {
      throw new BadRequestException('reCAPTCHA verification failed');
    }
  }
}
