import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Prisma } from '../../generated/prisma/client';

/**
 * 성공 응답 `{ success: true, data }`를 한 곳에서 만든다 (코드 컨벤션 5장).
 * 응답 모양은 각 모듈의 매퍼 함수(예: toSalesOrderResponse)가 정한다 (컨벤션 6장).
 * 여기서는 매퍼가 놓친 값만 안전하게 바꾼다: Decimal → 문자열, Date → ISO 8601, passwordHash 제거.
 */
export function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object' && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'passwordHash') continue;
      out[key] = serialize(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => (data instanceof StreamableFile ? data : { success: true, data: serialize(data ?? null) })));
  }
}
