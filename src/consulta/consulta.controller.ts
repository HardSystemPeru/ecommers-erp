import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConsultaService } from './consulta.service';

@Controller('consulta')
export class ConsultaController {
  constructor(private readonly consultaService: ConsultaService) {}

  @Get('sunat/:ruc')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 req/min por IP (previene abuso del proxy externo)
  consultarRuc(@Param('ruc') ruc: string) {
    return this.consultaService.consultarRuc(ruc);
  }
}
