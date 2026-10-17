import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { AuditQueryService } from './audit-query.service';
import { auditQuery } from './audit.dto';
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditQueryService) {}
  @Get() @RequirePermissions('audit.view') list(@Query() query: unknown) {
    return this.service.list(auditQuery(query));
  }
  @Get(':id') @RequirePermissions('audit.view') get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get(id);
  }
}
