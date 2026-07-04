import { Injectable } from '@nestjs/common';
import type { AppInfo } from '@hermes/shared';

@Injectable()
export class AppService {
  getInfo(): AppInfo {
    return { name: 'hermes-deployer', version: '0.1.0' };
  }
}
