// 조회 결과의 불러오는 중·오류를 처리하고, 성공하면 children(data)을 그린다. 권한 없음(COM-002)은 잠금 상태로 보인다.
import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/Button';
import { StateView } from '@/components/StateView';

export interface QueryLike<T> {
  data: T | undefined;
  isPending: boolean;
  error: unknown;
  refetch: () => unknown;
}

export interface QueryBoundaryProps<T> {
  query: QueryLike<T>;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}

export function QueryBoundary<T>({ query, loadingLabel, children }: QueryBoundaryProps<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error) {
    const error = query.error;
    const isLock = error instanceof ApiError && error.code === 'COM-002';
    return (
      <StateView
        kind={isLock ? 'lock' : 'error'}
        text={error instanceof ApiError ? [error.message, error.detail].filter(Boolean).join(' · ') : error instanceof Error ? error.message : undefined}
        code={error instanceof ApiError ? error.code : undefined}
        actions={
          <Button size="sm" onClick={() => void query.refetch()}>
            다시 시도
          </Button>
        }
      />
    );
  }
  if (query.isPending) return <StateView kind="loading" title={loadingLabel} />;
  return null;
}
