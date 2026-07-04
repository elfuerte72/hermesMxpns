import { Body, Controller, Post, UsePipes } from '@nestjs/common';
import type { ValidateInitResponse } from '@hermes/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { validateInitSchema, type ValidateInitDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('validate-init')
  @UsePipes(new ZodValidationPipe(validateInitSchema))
  async validateInit(@Body() dto: ValidateInitDto): Promise<ValidateInitResponse> {
    const user = await this.authService.validateInitAndUpsert(dto.initData);
    return { user };
  }
}
