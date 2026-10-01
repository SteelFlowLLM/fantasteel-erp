// 변경 요청이 입력 오류(InputError)로 거부되면 입력칸 아래에 보일 안내를 꺼낸다.
import { InputError } from '@/api/errors';

export function fieldErrorsOf(error: unknown): Readonly<Record<string, string>> {
  return error instanceof InputError ? error.fieldErrors : {};
}
