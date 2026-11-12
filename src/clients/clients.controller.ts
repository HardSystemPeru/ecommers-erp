import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Patch,
  Body,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import { UpdateClientDto } from './dto/update-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { GetClient } from '../auth/decorators/get-client.decorator';

@Controller('clientes')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  private assertOwnershipOrAdmin(user: any, resourceId: string | number) {
    if (user.role === 'admin') return;
    if (String(user.id) === String(resourceId)) return;
    throw new ForbiddenException(
      'No tienes permiso para acceder a este recurso',
    );
  }

  @Patch('sunat')
  @UseGuards(JwtAuthGuard)
  consulltaConSunat(@Request() req: any, @Body() query: any) {
    return this.clientsService.consultaEditarClientSunat(req?.user, query);
  }

  @Get('by-google-id/:googleId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  findByGoogleId(@Param('googleId') googleId: string) {
    return this.clientsService.findByGoogleId(googleId);
  }

  @Get('filter-email')
  @UseGuards(JwtAuthGuard, AdminGuard)
  findByEmail(@Query('email') email: string) {
    if (!email) {
      throw new BadRequestException('El correo es requerido');
    }
    return this.clientsService.findByEmail(email);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string, @GetClient() user: any) {
    this.assertOwnershipOrAdmin(user, id);
    return await this.clientsService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
    @GetClient() user: any,
  ) {
    this.assertOwnershipOrAdmin(user, id);
    return this.clientsService.update(+id, dto);
  }
}
