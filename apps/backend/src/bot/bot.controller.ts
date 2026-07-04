import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BotService } from './bot.service';

@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Post(':secret')
  async webhook(@Req() req: Request, @Res() res: Response): Promise<void> {
    const handler = this.botService.getWebhookHandler();
    const secret = this.botService.getWebhookSecret();
    if (!handler || !secret || req.params.secret !== secret) {
      res.status(404).send();
      return;
    }
    await handler(req, res);
  }
}
