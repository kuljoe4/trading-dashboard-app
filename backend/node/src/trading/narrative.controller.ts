import { Controller, Get, Query, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { NarrativeService } from './narrative.service';

@Controller('narrative')
@UseGuards(ApiKeyGuard)
export class NarrativeController {
  constructor(private readonly narrativeService: NarrativeService) {}

  @Get(':sessionId')
  async getNarrative(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.narrativeService.generateNarrative(sessionId);
  }
}
