// 밀시트 조회·PDF 생성 표시 훅 (TanStack Query)
import { useQuery } from '@tanstack/react-query';
import { millSheetApi, millSheetKeys } from '@/api/millSheets';
import { useAction } from '@/hooks/useAction';

export function useMillSheetList() {
  return useQuery({ queryKey: millSheetKeys.list(), queryFn: millSheetApi.list });
}

export function useMillSheetDetail(id: number | null) {
  return useQuery({
    queryKey: millSheetKeys.detail(id ?? 0),
    queryFn: () => millSheetApi.detail(id ?? 0),
    enabled: id !== null,
  });
}

export function useMarkMillSheetPdf() {
  return useAction(millSheetApi.markPdfGenerated, { success: 'PDF를 만들었어요', invalidate: [millSheetKeys.all] });
}
