import { SetMetadata } from '@nestjs/common';
export const PlatformOnly = () => SetMetadata('platform:required', true);
