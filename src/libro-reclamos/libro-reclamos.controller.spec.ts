import { Test, TestingModule } from '@nestjs/testing';
import { ComplaintsController } from './libro-reclamos.controller';
import { LibroReclamosService } from './libro-reclamos.service';

describe('ComplaintsController', () => {
  let controller: ComplaintsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ComplaintsController],
      providers: [LibroReclamosService],
    }).compile();

    controller = module.get<ComplaintsController>(ComplaintsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
