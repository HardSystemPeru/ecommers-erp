import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

@Injectable()
export class ConsultaService {
  private readonly sunatUrl = process.env.EXTERNAL_API_URL;
  private readonly token = process.env.EXTERNAL_API_TOKEN ?? '';

  async consultarRuc(ruc: string) {
    if (!/^\d{11}$/.test(ruc)) {
      throw new BadRequestException(
        'El RUC debe tener exactamente 11 dígitos numéricos',
      );
    }
    const d = await this.fetch(`${this.sunatUrl}/${ruc}`, 'SUNAT');

    return {
      ruc: d.ruc ?? ruc,
      razon_social: d.razsoc ?? d.razonSocial ?? '',
      estado: d.estado_contribuyente ?? d.estado ?? '',
      condicion: d.condicion_contribuyente ?? d.condicion ?? '',
      direccion: d.direccion ?? '',
      ubigeo: d.ubigeo ?? '',
      departamento: d.departamento ?? '',
      provincia: d.provincia ?? '',
      distrito: d.distrito ?? '',
      tipo_contribuyente: d.tipo_contribuyente ?? '',
      es_agente_retencion: d.es_agente_retencion ?? 0,
      es_buen_contribuyente: d.es_buen_contribuyente ?? 0,
      es_agente_percepcion: d.es_agente_percepcion ?? 0,
    };
  }
  private async fetch(url: string, origen: 'RENIEC' | 'SUNAT'): Promise<any> {
    let res: Response;
    try {
      res = await globalThis.fetch(url, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
    } catch {
      throw new BadGatewayException(
        `No se pudo conectar con el servicio ${origen}`,
      );
    }

    if (res.status === 404) {
      throw new NotFoundException(`Registro no encontrado en ${origen}`);
    }
    if (!res.ok) {
      throw new BadGatewayException(
        `El servicio ${origen} respondió con error ${res.status}`,
      );
    }

    const json = await res.json();
    return json.data ?? json;
  }
}
