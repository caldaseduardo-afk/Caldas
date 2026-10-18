import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { AIConfigurationService } from './ai-configuration.service';
import { AIConfigurationSimulationService } from './ai-configuration.simulation';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
@Controller('ai-configuration')
export class AIConfigurationController {
  constructor(
    private readonly service: AIConfigurationService,
    private readonly simulation: AIConfigurationSimulationService,
  ) {}
  @Get() @RequirePermissions('settings.view') overview() {
    return this.service.overview();
  }
  @Get('models') @RequirePermissions('settings.view') models() {
    return { models: this.service.allowedModels() };
  }
  @Get('versions') @RequirePermissions('settings.view') versions() {
    return this.service.versions();
  }
  @Get('versions/:id') @RequirePermissions('settings.view') version(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.version(id);
  }
  @Post('versions') @RequirePermissions('settings.manage') create(
    @Body() body: unknown,
  ) {
    return this.service.create(body);
  }
  @Patch('versions/:id') @RequirePermissions('settings.manage') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(id, body);
  }
  @Post('versions/clone-active') @RequirePermissions('settings.manage') clone(
    @Body() body: unknown,
  ) {
    return this.service.clone(body);
  }
  @Post('versions/:id/publish')
  @RequirePermissions('ai_config.publish')
  publish(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.publish(id, body);
  }
  @Post('versions/:id/restore')
  @RequirePermissions('ai_config.publish')
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.restore(id);
  }
  @Post('compare') @RequirePermissions('settings.view') compare(
    @Body() body: unknown,
  ) {
    return this.service.compare(body);
  }
  @Post('versions/:id/simulate')
  @RequirePermissions('settings.manage')
  @RateLimit(10)
  simulate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.simulation.simulate(id, body);
  }
}
