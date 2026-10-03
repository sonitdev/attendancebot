import { Global, Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller.js';
import { AuthGuard } from './guards/auth.guard.js';
import { RbacGuard } from './guards/rbac.guard.js';
import { SessionService } from './session.service.js';
import { ProjectAuthorizationService } from './project-authorization.service.js';
import { AdminScopeService } from './admin-scope.service.js';
import { PasswordCredentialService } from './password-credential.service.js';

@Global()
@Module({
  controllers: [AdminAuthController],
  providers: [SessionService, PasswordCredentialService, ProjectAuthorizationService, AdminScopeService, AuthGuard, RbacGuard],
  exports: [SessionService, ProjectAuthorizationService, AdminScopeService, AuthGuard, RbacGuard],
})
export class AuthModule {}
