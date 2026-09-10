import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsService } from '../clients/clients.service';
import { TokenRevocationService } from './revocation/revocation.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly clientsService: ClientsService,
    private readonly tokenRevocationService: TokenRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: any) => req?.cookies?.access_token || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }
 
  async validate(payload: any) {
    if (payload.jti && (await this.tokenRevocationService.isRevoked(payload.jti))) {
      throw new UnauthorizedException('Sesión revocada');
    }
 
    if (payload.role === 'admin') {
      const admin = await this.clientsService.findById(Number(payload.sub));

      if (!admin || admin.role !== 'admin') {
        throw new UnauthorizedException('Sesión inválida');
      }

      return {
        id: admin.id.toString(),
        username: payload.username ?? admin.names,
        role: 'admin',
        jti: payload.jti,
        exp: payload.exp,
      };
    }

    const client: any = await this.clientsService.findById(Number(payload.sub));

    if (!client) {
      throw new UnauthorizedException('Cliente no encontrado');
    }
 
    return {
      id: client.id.toString(),
      email: client.email,
      name: `${client.names || ''} ${client.lastnames || ''}`.trim(),
      role: client.role || 'client',
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}