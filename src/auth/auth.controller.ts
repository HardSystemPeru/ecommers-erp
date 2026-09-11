import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Res, 
  Patch,
  Req,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GetClient } from './decorators/get-client.decorator';
import { TokenRevocationService } from './revocation/revocation.service';
import { UpdateClientDto } from '../clients/dto/update-client.dto';
import { LoginAdminDto } from './dto/login-admin.dto';
import { BruteForceInterceptor } from './brute-force/brute-force.interceptor';
import { UAParser } from 'ua-parser-js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenRevocation: TokenRevocationService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register( @Body() body: RegisterDto, @Req() req: Request,@Res({ passthrough: true }) response: Response,) {
    const { accessToken, refreshToken, user } = await this.authService.register( body, this.extractMeta(req));

    this.setAccessCookie(response, accessToken);
    this.setRefreshCookie(response, refreshToken);

    return { success: true, user }
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(BruteForceInterceptor)
  async login( @Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) response: Response,) {
    const { accessToken, refreshToken, user } = await this.authService.login(body, this.extractMeta(req));

    this.setAccessCookie(response, accessToken);
    this.setRefreshCookie(response, refreshToken);

    return { success: true, user };
  }

  @Post('google')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async googleLogin( @Body() body: GoogleAuthDto, @Req() req: Request, @Res({ passthrough: true }) response: Response,) {
    const { accessToken, refreshToken, user } = await this.authService.loginWithGoogle( body.token, this.extractMeta(req) );

    this.setAccessCookie(response, accessToken);
    this.setRefreshCookie(response, refreshToken);

    return { success: true, user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.CREATED)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response,) {

    const accessToken = (request as any).cookies?.access_token as string | undefined;
    if (accessToken) {
      try {
        const payload: any = this.jwtService.verify(accessToken, {
          secret: this.configService.get<string>('JWT_SECRET'),
          ignoreExpiration: true,
        } as any);
        if (payload?.jti) {
          const expMs = (payload.exp ?? Math.floor(Date.now() / 1000) + 3600) * 1000;
          this.tokenRevocation.revoke(payload.jti, expMs);
        }
      } catch {}
    }

    const refreshToken = (request as any).cookies?.refresh_token;
    if (refreshToken) {
      await this.authService.revokeRefreshToken(refreshToken);
    }

    response.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api',
    });
 
    response.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api',
    });

    return { success: true, message: 'Sesión cerrada correctamente.' };
  }
 
  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@GetClient() client: any) {
    return client;
  }

  @Post('login-admin')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(BruteForceInterceptor)
  async loginAdmin( @Body() dto: LoginAdminDto, @Req() req: Request, @Res({ passthrough: true }) response: Response,) {
    const { message, accessToken, refreshToken, user } =
      await this.authService.loginAdminUpdateImage( dto.username, dto.password, this.extractMeta(req) );

    this.setAccessCookie(response, accessToken);
    this.setRefreshCookie(response, refreshToken);

    return { success: true, message, user };
  }

  @Patch('profile')
  @UseGuards(AuthGuard('jwt'))
  updateProfile(@GetClient() client: any, @Body() dto: UpdateClientDto) {
    return this.authService.updateProfile(Number(client.id), dto);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  forgotPassword(@Body('email') email: string) {
    return this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  resetPassword( @Body('token') token: string, @Body('password') password: string ) {
    return this.authService.resetPassword(token, password);
  }

  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response,) {
  const refreshToken = request.cookies?.refresh_token;

  if (!refreshToken) {
    throw new UnauthorizedException('No hay sesión activa');
  }

  const { accessToken, refreshToken: newRefreshToken, user } = await this.authService.refreshAccessToken(refreshToken, this.extractMeta(request));

  this.setAccessCookie(response, accessToken);
  this.setRefreshCookie(response, newRefreshToken);

  return { success: true, user };
}

  // ────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────

  private setAccessCookie(response: Response, accessToken: string) {
    response.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 10 * 1000, // DEBUG asimétrico: 10s para probar refresh
      path: '/api',
    });
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // DEBUG asimétrico: 5min para probar refresh tras expirar access
      path: '/api',
    });
  }

private extractMeta(req: Request) {
  const userAgent = (req.headers['user-agent'] as string)?.slice(0, 500);
  const parser = new UAParser(userAgent);
  const browser = parser.getBrowser();
  const os = parser.getOS();

  const deviceName = browser.name && os.name ? `${browser.name} en ${os.name}` : undefined;

  return {
    ip: this.extractIp(req)?.slice(0, 45),
    userAgent,
    deviceName,
  };
}

private extractIp(req: any): string {
  const forwarded = req.headers['x-forwarded-for'] as string;
  return forwarded ? forwarded.split(',')[0].trim() : req.ip;
  }

}