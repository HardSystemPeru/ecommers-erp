import { Controller, Post, Body, Query, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Chat } from './chat.service'; 
import { ChatbootService } from './chatboot.service';
 
@Controller('chatboot')
export class ChatbootController {
  constructor(
    private readonly chatService: ChatbootService,) {}

 @Get('ver-mas/:consultaId')
  async consult(@Param('consultaId') consultaId: string, @Query('pagina', ParseIntPipe) pagina: number,){
    return this.chatService.verMas(consultaId,pagina)
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60000 } }) 
  async chat( @Body('message') message: string, ) {
    return this.chatService.chat(message);
  }

}
