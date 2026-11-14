import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientUserGuard } from '../auth/client-user.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { ClientPortalController } from './client-portal.controller';
import { ClientPortalService } from './client-portal.service';
import { ClientUsersController } from './client-users.controller';
import { ClientUsersService } from './client-users.service';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [AuthModule],
  controllers: [ClientsController, ClientUsersController, ClientPortalController],
  providers: [
    ClientsService,
    ClientUsersService,
    ClientPortalService,
    SuperAdminGuard,
    ClientUserGuard,
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
