// 서버 연결 전이라 아직 받아 오지 못한 값. "없음"(실제로 없음)과 구분해 보인다.
export function PendingValue({ label = '준비 중' }: { label?: string }) {
  return (
    <span className="text-ink-3" title="서버 연결 전이라 아직 받아 오지 못한 값이에요">
      {label}
    </span>
  );
}
