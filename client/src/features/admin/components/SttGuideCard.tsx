// 음성 인식 연결 안내 (문서에 없는 기능, 이슈 #432): LLM을 API로 바꿔도 음성 설정은 따로라는 것, 다른 PC의 음성 서버에 붙는 법.
// 실행 명령은 docs/voice2erp/voice-server-connect.md와 같다.
import { Card, CardBody, CardHead } from '@/components/Card';

export function SttGuideCard() {
  return (
    <Card petKey="card:sttSettings.guide">
      <CardHead title="음성 연결 안내" />
      <CardBody className="text-sm leading-relaxed text-ink-2">
        <p>
          <b>LLM을 API로 바꿔도 음성은 여기 설정을 써요.</b> 위 AI 연결(LLM)과 따로 저장돼요.
        </p>
        <p className="text-xs text-ink-3">
          주소는 ERP 서버가 부르므로 127.0.0.1은 <b>ERP 서버를 돌리는 컴퓨터</b>예요. 사용자 PC에는 음성 서버가 없어도 돼요.
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">다른 PC의 음성 서버에 붙으려면</span>
          <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-xs">
            <li>
              그 PC에서 서버를 <b>0.0.0.0</b>으로 띄워요 (whisper-server는 <code>--host 0.0.0.0</code>, 화자 분리 서버는 <code>SIDECAR_HOST=0.0.0.0</code>).
            </li>
            <li>그 PC 방화벽에서 포트(8000·8001)를 열어요. 같은 망에서만 열고 인터넷에는 열지 않아요.</li>
            <li>
              같은 망이면 <b>192.168.x.x</b>(또는 10.x) 주소를 써요.
            </li>
            <li>
              집·출장처럼 다른 망이면 두 컴퓨터에 <b>Tailscale</b>을 깔고 <b>100.x.x.x</b> 또는 <b>이름.ts.net</b> 주소를 써요. 방화벽을 열 필요가 없어서 더 안전해요.
            </li>
            <li>
              위 카드에서 <b>연결 확인</b> → <b>저장</b> → <b>파일로 시험</b>.
            </li>
          </ol>
        </div>
        <p className="text-xs text-ink-3">음성 서버에는 로그인이 없어요. 회의 내용이 오가니 믿는 망(같은 망·Tailscale)에서만 열어요.</p>
      </CardBody>
    </Card>
  );
}
