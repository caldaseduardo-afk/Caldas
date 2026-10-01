import { SetMetadata } from '@nestjs/common';
import type { PermissionName } from '@atendente/database';

export const RequirePermissions = (
  ...permissions: [PermissionName, ...PermissionName[]]
) => SetMetadata('permissions:required', permissions);

// Somente rotas de identidade e seleção de contexto; nunca recursos de negócio.
export const IdentityOnly = () =>
  SetMetadata('permissions:identity-only', true);
