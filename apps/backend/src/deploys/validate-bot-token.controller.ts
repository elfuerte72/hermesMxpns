import { Body, Controller, Post, UseGuards, UsePipes } from '@nestjs/common';
import type { ValidateBotTokenResponse } from '@hermes/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { ValidateBotTokenService } from './validate-bot-token.service';
import { validateBotTokenSchema, type ValidateBotTokenDto } from './validate-bot-token.dto';

@Controller('validate-bot-token')
@UseGuards(TmaAuthGuard)
export class ValidateBotTokenController {
  constructor(private readonly validateBotTokenService: ValidateBotTokenService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(validateBotTokenSchema))
  validate(@Body() dto: ValidateBotTokenDto): Promise<ValidateBotTokenResponse> {
    return this.validateBotTokenService.validate(dto.bot_token);
  }
}
