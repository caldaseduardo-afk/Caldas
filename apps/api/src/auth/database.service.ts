import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createDatabaseClient } from '@atendente/database';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client = createDatabaseClient(process.env.DATABASE_URL ?? '');
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
