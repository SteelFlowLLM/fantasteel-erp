import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { SetTaskStatusDto } from './dto/set-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskService } from './task.service';

// 업무는 로그인한 누구나 쓴다. 고칠 수 있는 사람(만든 사람·담당자)은 service에서 검사한다.
@Controller('tasks')
export class TaskController {
  constructor(private readonly service: TaskService) {}

  @Get()
  list(@Query() q: ListTasksDto, @CurrentUser() user: AuthUser) {
    return this.service.list(q, user);
  }

  @Post()
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/status') @HttpCode(200)
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetTaskStatusDto, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, dto.taskStatus, user);
  }
}
