import { Test } from '@nestjs/testing';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AppService],
    }).compile();
    service = moduleRef.get(AppService);
  });

  it('returns app info', () => {
    const info = service.getInfo();
    expect(info.name).toBe('hermes-deployer');
    expect(info.version).toBe('0.1.0');
  });
});
