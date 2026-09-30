import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Prisma } from '../../generated/prisma/client';

/** Decimal → 문자열(톤은 소수 3자리), Date → ISO 8601. 코드 컨벤션 5장. */
export function serialize(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value;
  if (Prisma.Decimal.isDecimal(value)) {
    const d = value as Prisma.Decimal;
    return key && /Ton$/.test(key) ? d.toFixed(3) : d.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map((v) => serialize(v, key));
  if (typeof value === 'object') {
    if (Buffer.isBuffer(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'passwordHash') continue;
      out[k] = serialize(v, k);
    }
    return out;
  }
  return value;
}

/** 성공 응답 `{ success: true, data }` 를 한 곳에서 만든다. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => (data instanceof StreamableFile ? data : { success: true, data: serialize(data ?? null) })),
    );
  }
}
