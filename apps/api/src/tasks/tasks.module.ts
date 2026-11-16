import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientUserGuard } from '../auth/client-user.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { ClientTasksController, TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [AuthModule],
  controllers: [TasksController, ClientTasksController],
  providers: [TasksService, SuperAdminGuard, ClientUserGuard],
})
export class TasksModule {}
