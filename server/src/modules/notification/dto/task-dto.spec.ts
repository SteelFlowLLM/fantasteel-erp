import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';
import { ListNotificationsDto } from './list-notifications.dto';
import { UpdateTaskDto } from './update-task.dto';

const errorsOf = async <T extends object>(cls: new () => T, plain: object) => (await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe('업무 DTO 검증', () => {
  const ok = { title: '할 일', assigneeId: 2 };

  it('필수값만 있으면 통과한다', async () => {
    expect(await errorsOf(CreateTaskDto, ok)).toEqual([]);
  });

  it.each(['2026-02-31', '2026-13-01', '2026/10/05', '10-05', 'abc'])('실제 날짜가 아닌 마감일 %s를 거부한다', async (dueDate) => {
    expect(await errorsOf(CreateTaskDto, { ...ok, dueDate })).toEqual(['dueDate']);
  });

  it('달력에 있는 날짜는 통과한다 (윤일 포함)', async () => {
    expect(await errorsOf(CreateTaskDto, { ...ok, dueDate: '2028-02-29' })).toEqual([]);
  });

  it.each(['sales-orders/1', '//evil.example.com', 'https://evil.example.com', '/a b'])('화면 경로가 아닌 linkPath %s를 거부한다', async (linkPath) => {
    expect(await errorsOf(CreateTaskDto, { ...ok, linkPath })).toEqual(['linkPath']);
  });

  it('화면 경로(쿼리 포함)는 통과한다', async () => {
    expect(await errorsOf(CreateTaskDto, { ...ok, linkPath: '/production/plans?plan=3' })).toEqual([]);
  });

  it('제목이 비었거나 담당자가 없으면 거부한다', async () => {
    expect((await errorsOf(CreateTaskDto, { title: '', assigneeId: 2 })).sort()).toEqual(['title']);
    expect(await errorsOf(CreateTaskDto, { title: 'x' })).toEqual(['assigneeId']);
  });

  it('클라이언트가 creatorId를 보내면 거부한다 (서버가 로그인 사원으로 정한다)', async () => {
    expect(await errorsOf(CreateTaskDto, { ...ok, creatorId: 5 })).toEqual(['creatorId']);
  });

  it('수정에서는 마감일·설명을 null로 비울 수 있지만 제목은 비울 수 없다', async () => {
    expect(await errorsOf(UpdateTaskDto, { dueDate: null, description: null, linkPath: null })).toEqual([]);
    expect(await errorsOf(UpdateTaskDto, { title: null })).toEqual(['title']);
  });

  it('알림 목록 쿼리: unreadOnly 문자열과 숫자 변환', async () => {
    const dto = plainToInstance(ListNotificationsDto, { unreadOnly: 'true', limit: '30', cursor: '7' });
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ unreadOnly: true, limit: 30, cursor: 7 });
    expect(plainToInstance(ListNotificationsDto, { unreadOnly: 'false' }).unreadOnly).toBe(false);
    expect(await errorsOf(ListNotificationsDto, { limit: '500' })).toEqual(['limit']);
  });
});
