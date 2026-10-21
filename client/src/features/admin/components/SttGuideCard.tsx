// 음성 인식 연결 안내 (문서에 없는 기능, 이슈 #432·#445·#450): LLM을 API로 바꿔도 음성 설정은 따로라는 것, 내 Mac의 음성 서버를 켜고 다른 PC에서 붙는 법.
// 실행 명령은 docs/voice2erp/voice-server-connect.md·tools/voice-sidecar/start.sh와 같다.
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
          <span className="text-xs font-medium text-ink-2">내 Mac에서 음성 서버 켜기</span>
          <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-xs">
            <li>
              Mac의 <b>터미널</b>을 열고 저장소 폴더에서 <code>tools/voice-sidecar/start.sh --install</code>을 <b>한 번</b> 실행해요. 그 뒤로는 로그인하면 저절로 켜져요
              (지우기: <code>--uninstall</code>, 상태: <code>--status</code>).
            </li>
            <li>
              터미널에 나온 <b>주소</b>를, API 키는 <code>cat ~/.config/fantasteel-voice/api-key</code>로 보고 위 카드에 넣어요. 같은 망이면 192.168.x.x, 다른 망이면
              Tailscale(100.x.x.x) 주소예요.
            </li>
            <li>
              <b>연결 확인</b> → 모델 고르기(화자 분리가 필요하면 &lsquo;받아쓰기 + 화자 분리&rsquo;) → <b>저장</b> → <b>파일로 시험</b>.
            </li>
          </ol>
        </div>
        <p className="text-xs text-ink-3">
          ERP 서버도 이 Mac이면 &lsquo;이 Mac의 음성 서버&rsquo; 카드에서 켜고 끌 수 있어요. 다른 PC에 열 필요가 없으면 <code>--install --local</code>로 등록하고 주소{' '}
          <code>http://127.0.0.1:8001/v1</code>, 키는 비워 둬요. 다른 망에서는 두 컴퓨터 모두 Tailscale에
          로그인해야 해요. 회의 음성이 오가니 Tailscale Funnel·공유기 포트 열기로 인터넷에 내놓지 않아요.
        </p>
      </CardBody>
    </Card>
  );
}
