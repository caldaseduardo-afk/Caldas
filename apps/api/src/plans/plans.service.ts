import { Injectable } from '@nestjs/common';
import { PlansRepository } from './plans.repository';

@Injectable()
export class PlansService {
  constructor(
    private readonly repository: PlansRepository,
  ) {}

  async current() {
    return this.repository.current();
  }

  async catalog() {
    return this.repository.catalog();
  }
}
