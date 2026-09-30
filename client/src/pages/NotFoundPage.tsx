import { Link } from 'react-router';
import { StateView } from '@/components/ui';

export function NotFoundPage() {
  return (
    <main className="hl-main">
      <StateView kind="empty" title="없는 화면이에요" text="주소를 다시 확인해 주세요." actions={<Link className="hl-btn hl-btn--primary" to="/dashboard">대시보드로</Link>} />
    </main>
  );
}
