import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';

export const RequireRoles = (...roles: string[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);

export const RequirePermissions = (...permissions: string[]): CustomDecorator<string> =>
  SetMetadata(PERMISSIONS_KEY, permissions);
