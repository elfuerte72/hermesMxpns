import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodIssue, ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ZodValidationError(result.error.issues);
    }
    return result.data;
  }
}

class ZodValidationError extends BadRequestException {
  constructor(issues: ZodIssue[]) {
    super({
      message: 'Validation failed',
      issues: issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
}
