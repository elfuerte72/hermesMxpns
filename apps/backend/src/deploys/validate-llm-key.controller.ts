import { Body, Controller, Post, UseGuards, UsePipes } from '@nestjs/common';
import type { ValidateLlmKeyOkResponse } from '@hermes/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { ValidateLlmKeyService } from './validate-llm-key.service';
import { validateLlmKeySchema, type ValidateLlmKeyDto } from './validate-llm-key.dto';

@Controller('validate-llm-key')
@UseGuards(TmaAuthGuard)
export class ValidateLlmKeyController {
  constructor(private readonly validateLlmKeyService: ValidateLlmKeyService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(validateLlmKeySchema))
  validate(@Body() dto: ValidateLlmKeyDto): Promise<ValidateLlmKeyOkResponse> {
    return this.validateLlmKeyService.validate(dto);
  }
}
