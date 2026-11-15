import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientUserGuard } from '../auth/client-user.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { ClientInvoicesController } from './client-invoices.controller';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [AuthModule],
  controllers: [InvoicesController, ClientInvoicesController],
  providers: [InvoicesService, SuperAdminGuard, ClientUserGuard],
})
export class InvoicesModule {}
