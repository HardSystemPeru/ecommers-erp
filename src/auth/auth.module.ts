import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { HttpModule } from '@nestjs/axios';
import { BruteForceService } from './brute-force/brute-force.service';
import { BruteForceInterceptor } from './brute-force/brute-force.interceptor';
import { TokenRevocationService } from './revocation/revocation.service';
import { CsrfGuard } from './csrf/csrf.guard';

@Module({
  imports: [
    HttpModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    BruteForceService,
    BruteForceInterceptor,
    TokenRevocationService,
    CsrfGuard,
  ],
  exports: [
    AuthService,
    JwtStrategy,
    PassportModule,
    BruteForceService,
    TokenRevocationService,
  ],
})
export class AuthModule {}
