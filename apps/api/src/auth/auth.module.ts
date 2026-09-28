import { Global, Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller.js';
import { AuthGuard } from './guards/auth.guard.js';
import { RbacGuard } from './guards/rbac.guard.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  controllers: [AdminAuthController],
  providers: [SessionService, AuthGuard, RbacGuard],
  exports: [SessionService, AuthGuard, RbacGuard],
})
export class AuthModule {}
