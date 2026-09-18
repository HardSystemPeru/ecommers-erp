import { BadRequestException, ConflictException, Injectable, RequestTimeoutException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService,private readonly httpService: HttpService) {}

  private stripPassword<T extends { password?: any }>(client: T | null): T | null {
    if (!client) return client;
    const { password, ...safe } = client as any;
    return safe as T;
  }

  async findAllPaginationInfinity(params: {
    id?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { id, page = 1, limit = 10, search } = params;

    const skip = (page - 1) * limit;

    const where: any = { status: 1 };

    if (id) {
      where.id = BigInt(id);
    }

    if (search) {
      where.name = { contains: search };
    }

    const [data, total] = await Promise.all([
      this.prisma.clients.findMany({
        where,
        skip,
        take: limit,
        // orderBy: { name: 'asc' },
      }),
      this.prisma.clients.count({ where }),
    ]);

    return {
      data: data.map((client) => {
        const { password, ...safe } = client as any;
        return { ...safe, id: client.id.toString() };
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }

  async findByEmail(email: string) {
    const client = await this.prisma.clients.findUnique({ where: { email } });
    return this.stripPassword(client) as any;
  }

  async findByEmailWithPassword(email: string) {
    return this.prisma.clients.findUnique({ where: { email } });
  }

  async findByGoogleId(googleId: string) {
    const client = await this.prisma.clients.findUnique({ where: { google_id: googleId } });
    return this.stripPassword(client) as any;
  }

  async create(data: {
    names: string;
    lastnames: string;
    email: string;
    phone?: string;
    document_type?: string;
    document_number?: string;
    password?: string;
    googleId?: string;
  }) {
    return this.prisma.clients.create({
      data: {
        names: data.names,
        lastnames: data.lastnames,
        email: data.email,
        phone: data.phone,
        document_type: data.document_type,
        document_number: data.document_number,
        password: data.password,
        google_id: data.googleId,
      },
    });
  }

  async createFromGoogle(data: {
    name: string;
    email: string;
    googleId: string;
  }) {
    const parts = data.name.split(' ');
    const names = parts[0] || '';
    const lastnames = parts.slice(1).join(' ') || '';

    return this.create({
      names,
      lastnames,
      email: data.email,
      googleId: data.googleId,
    });
  }

  async findOne(id: number) {
    const data = await this.prisma.clients.findUnique({ where: { id } });
    if (!data) return null;
    
    let unatVerified =false
   try {
        const response = await this.httpService.axiosRef.get(
        `${process.env.EXTERNAL_API_URL}/${data?.document_number}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PUBLICTOKEN}`,
          },
        },
        
      );
      unatVerified = response?.data?.success ?? false;
   } catch (error) {
          console.log(error);
   }

    const { password, ...safe } = data as any;
    return { ...safe, id: data.id.toString(), sunat_verfied:unatVerified }
  }

  async update(id: number, data: any) {
    const updated = await this.prisma.clients.update({
      where: { id },
      data,
    });
    const { password, ...safe } = updated as any;
    return { ...safe, id: updated.id.toString() };
  }

  async consultaEditarClientSunat(user:any,data:any){
    
    const { id,email,name } = user
    const { document_number, phone, address, ...rest } = data; 
    

    const consultaClient = await this.findOne(id)

        if ( document_number == undefined  ) throw new RequestTimeoutException(`Tiene que registrarse con un DNI valido ${name}`)
        if ( document_number?.length !== 8 ) throw new UnauthorizedException(`el DNI debe tener 8 numeros ${name}`)
        if ( consultaClient?.document_number ) throw new ConflictException(`Ya estas registrado ${name}`)
        try {
        const response = await this.httpService.axiosRef.get(
        `${process.env.EXTERNAL_API_URL}/${document_number}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PUBLICTOKEN}`,
          },
        },
      );
      // console.log(response?.data)
    if (!response?.data?.success) throw new ConflictException(`Este numero de DNI no es valido`)

    const editarClient = await this.prisma.clients.update({
      where:{ id },
       data:{document_number:response?.data.data?.document_number}
    })
    const { password, ...data } = editarClient

    return {...data, sunat_verfied:response?.data?.success};
      // return response.data;
    } catch (error) {
      throw new BadRequestException('Este numero de DNI no es valido');
    }
    
   }

   async findById(id:number){
      const client = await this.prisma.clients.findUnique({
        where: {id:id}
      })
      return this.stripPassword(client) as any;
   }

}
