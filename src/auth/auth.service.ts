import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { ClientsService } from '../clients/clients.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateClientDto } from '../clients/dto/update-client.dto';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

interface AuthMetadata {
  ip?: string;
  userAgent?: string;
  deviceName?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  // ─── Registro de Clientes ──────────────────────────────────────────────
  async register(dto: RegisterDto, meta?: AuthMetadata) {
    const email = dto.email.trim().toLowerCase();

    const existingClient = await this.clientsService.findByEmail(email);
    if (existingClient) {
      throw new ConflictException('El correo ya está registrado');
    }

    await this.verifyCaptcha(dto.captchaToken);

    // if (dto.document_number) {
    //   await this.verifyDocumentNumber(dto.document_number);
    // }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    let client;
    try {
      client = await this.clientsService.create({
        names: dto.names,
        lastnames: dto.lastnames,
        email,
        phone: dto.phone,
        document_type: dto.document_type,
        document_number: dto.document_number,
        password: hashedPassword,
      });
    } catch (error:any) {
      if (error.code === 'P2002') {
        throw new ConflictException('El correo ya está registrado');
      }
      throw error;
    }

    return this.generateAuthResponseLogin(client, meta);
  }

  // ─── Login Estándar (Clientes) ──────────────────────────────────────────
  async login(dto: LoginDto, meta?: AuthMetadata) {
     await this.verifyCaptcha(dto.captchaToken);

    const email = dto.email.trim().toLowerCase();
    const client = await this.clientsService.findByEmailWithPassword(email);

    if (!client || !client.password) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, client.password);
    if (!isPasswordValid) { 
      throw new UnauthorizedException('Credenciales inválidas');
    } 

    return this.generateAuthResponseLogin(client, meta);
  }

  // ─── Google login (clientes) ────────────────────────────────────────────
  async loginWithGoogle(idToken: string, meta?: AuthMetadata) {
    let payload: { email?: string; name?: string; sub?: string } | null = null;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload() ?? null;
    } catch {
      throw new UnauthorizedException('Token de Google inválido');
    }

    if (!payload?.email || !payload?.sub) {
      throw new UnauthorizedException('Token de Google inválido.');
    }

    const { email, name = email, sub: googleId } = payload;
    const normalizedEmail = email.trim().toLowerCase();

    let client = await this.clientsService.findByEmail(normalizedEmail);

    if (!client) {
      client = await this.clientsService.createFromGoogle({
        name,
        email: normalizedEmail,
        googleId,
      });
    }

    return this.generateAuthResponseLogin(client, meta);
  }

  // ─── Helpers privados ────────────────────────────────────────────────────

  private async verifyCaptcha(captchaToken?: string) {
    if (!captchaToken) {
      throw new BadRequestException('Captcha requerido');
    }

    const secret = this.configService.get<string>('RECAPTCHA_SECRET_KEY');

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(
          'https://www.google.com/recaptcha/api/siteverify',
          null,
          {
            params: { secret, response: captchaToken },
            timeout: 5000,
          },
        ),
      );
    } catch {
      throw new BadRequestException('Error verificando captcha');
    }

    if (!response.data.success) {
      throw new BadRequestException('Captcha inválido');
    }
  }

  private async verifyDocumentNumber(documentNumber: string) {
    const externalApiUrl = this.configService.get<string>('EXTERNAL_API_URL');
    const publicToken = this.configService.get<string>('PUBLIC_TOKEN');

    let response;
    try {
      response = await this.httpService.axiosRef.get(
        `${externalApiUrl}/${documentNumber}`,
        {
          headers: { Authorization: `Bearer ${publicToken}` },
          validateStatus: () => true,
          timeout: 5000,
        },
      );
    } catch {
      throw new BadRequestException('No se pudo validar el documento en este momento');
    }

    if (response.status === 404) {
      throw new UnauthorizedException('El DNI no es correcto');
    }

    if (!response.data?.success) {
      throw new BadRequestException('El DNI no es correcto');
    }
  }

  private async generateAuthResponseLogin(client: any, meta?: AuthMetadata) {
    const clientId = client.id.toString();
    const username = `${client.names || ''} ${client.lastnames || ''}`.trim();

    const accessToken = this.jwtService.sign({
      sub: clientId,
      email: client.email,
      username,
      jti: randomUUID(),
    });

    const refreshToken = randomBytes(64).toString('hex');
    const hashedToken = createHash('sha256').update(refreshToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        clientId: client.id,
        hashedToken,
        expiresAt,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceName: meta?.deviceName,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: clientId,
        username,
        email: client.email,
      },
    };
  }

  // ─── Login Admin ─────────────────────────────────────────────────────────
  async loginAdminUpdateImage(username: string, password: string, meta?: AuthMetadata) {
    const client = await this.prisma.clients.findFirst({
      where: {
        OR: [{ email: username }, { names: username }],
      },
    });

    if (!client) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isMatch = await bcrypt.compare(password, client.password ?? '');
    if (!isMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (client.role !== 'admin') {
      throw new UnauthorizedException('No tienes permisos de administrador');
    }

    const clientId = client.id.toString();

    const accessToken = this.jwtService.sign({
      sub: clientId,
      username: client.names,
      role: 'admin',
      jti: randomUUID(),
    });

    const refreshToken = randomBytes(64).toString('hex');
    const hashedToken = createHash('sha256').update(refreshToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        clientId: client.id,
        hashedToken,
        expiresAt,
        deviceName: 'Admin Web',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      },
    });

    return {
      message: 'Login correcto',
      accessToken,
      refreshToken,
      user: {
        id: clientId,
        username: client.names,
        role: 'admin',
      },
    };
  }

  async updateProfile(clientId: number, dto: UpdateClientDto) {
    const data: any = { ...dto };
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    return this.clientsService.update(clientId, data);
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const client = await this.clientsService.findByEmail(normalizedEmail);
    if (!client) {
      throw new BadRequestException('El correo no está registrado');
    }

    const token = randomBytes(20).toString('hex');
    const expires = new Date(Date.now() + 3600000);

    await this.clientsService.update(Number(client.id), {
      reset_token: token,
      reset_token_expires: expires,
    });

    const transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com',
      port: Number(this.configService.get('SMTP_PORT')) || 587,
      secure: this.configService.get('SMTP_SECURE') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://192.168.18.35:3000/';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
    const smtpUser = this.configService.get<string>('SMTP_USER');

    try {
      await transporter.sendMail({
        from: `"Soporte ERP" <${smtpUser}>`,
        to: normalizedEmail,
        subject: 'Recuperación de contraseña',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="text-align: center; color: #333;">Restablecer tu contraseña</h2>
            <p>Hola,</p>
            <p>Hemos recibido una solicitud para cambiar la contraseña de tu cuenta. Haz clic en el siguiente botón para asignar una nueva:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background-color: #007bff; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Restablecer contraseña</a>
            </div>
            <p style="font-size: 14px; color: #555;">Este enlace es válido por 1 hora. Si no solicitaste este cambio, puedes ignorar este correo de forma segura.</p>
          </div>
        `,
      });
    } catch (error) {
      throw new BadRequestException(
        'Hubo un problema intentando enviar el correo electrónico. Por favor intenta más tarde o revisa tu configuración.',
      );
    }

    return {
      message: 'Se ha enviado un correo con las instrucciones para restablecer la contraseña',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const client = await this.prisma.clients.findFirst({
      where: {
        reset_token: token,
        reset_token_expires: { gt: new Date() },
      },
    });

    if (!client) {
      throw new BadRequestException('Token inválido o expirado');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.clientsService.update(Number(client.id), {
      password: hashedPassword,
      reset_token: null,
      reset_token_expires: null,
    });

    return { message: 'Contraseña actualizada correctamente' };
  }

  async revokeRefreshToken(refreshToken: string) {
    const hashedToken = createHash('sha256').update(refreshToken).digest('hex');

    const token = await this.prisma.refreshToken.findUnique({
      where: { hashedToken },
    });

    if (!token) {
      return;
    }

    await this.prisma.refreshToken.update({
      where: { id: token.id },
      data: {
        revoked: true,
        revokedReason: 'logout',
        lastUsedAt: new Date(),
      },
    });
  }
  // En el service
async refreshAccessToken(refreshToken: string, meta?: AuthMetadata) {
  const hashedToken = createHash('sha256').update(refreshToken).digest('hex');

  const stored = await this.prisma.refreshToken.findUnique({
    where: { hashedToken },
  });

  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    throw new UnauthorizedException('Refresh token inválido o expirado');
  }

  const client = await this.clientsService.findById(Number(stored.clientId));
  if (!client) {
    throw new UnauthorizedException('Cliente no encontrado');
  }

  // Generar nuevo access token
  const clientId = client.id.toString();
  const username = `${client.names || ''} ${client.lastnames || ''}`.trim();
  const accessToken = this.jwtService.sign({
    sub: clientId,
    email: client.email,
    username,
    jti: randomUUID(),
  });

  // Rotar el refresh token (recomendado por seguridad)
  const newRefreshToken = randomBytes(64).toString('hex');
  const newHashedToken = createHash('sha256').update(newRefreshToken).digest('hex');
  const newExpiresAt = new Date();
  newExpiresAt.setDate(newExpiresAt.getDate() + 7);

  const newTokenRecord = await this.prisma.refreshToken.create({
    data: {
      clientId: client.id,
      hashedToken: newHashedToken,
      expiresAt: newExpiresAt,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      deviceName: meta?.deviceName,
    },
  });

  // Marcar el viejo como usado/reemplazado
  await this.prisma.refreshToken.update({
    where: { id: stored.id },
    data: {
      revoked: true,
      revokedReason: 'rotated',
      lastUsedAt: new Date(),
      replacedById: newTokenRecord.id,
    },
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    user: { id: clientId, username, email: client.email },
  };
}
}