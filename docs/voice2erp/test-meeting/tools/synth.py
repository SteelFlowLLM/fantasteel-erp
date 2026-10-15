# 대본(script.txt)을 화자별 다른 macOS 한국어 음성으로 읽혀 회의 음성 하나와 화자 정답 시간표를 만든다.
#   python tools/synth.py basic     → audio/basic/meeting.wav·.m4a·truth.tsv
#   python tools/synth.py premium   → audio/premium/… (고급 음성: 시스템 설정 › 손쉬운 사용 › 읽기 및 말하기에서 받아 둔다)
# 한국어 음성은 전체 이름으로 불러야 한다. 'Reed'만 쓰면 영어 음성이 골라져 빈 소리가 난다.
import pathlib, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parents[1]
VOICES = {
    'basic': {'김도윤': 'Reed (한국어(한국))', '박서영': 'Yuna', '강민석': 'Rocko (한국어(한국))', '최준혁': 'Eddy (한국어(한국))', '오지훈': 'Grandpa (한국어(한국))', '신현우': 'Sandy (한국어(한국))'},
    'premium': {'김도윤': 'Minsu (Enhanced)', '박서영': 'Yuna (Premium)', '강민석': 'Jian (Premium)', '최준혁': 'Suhyun (Enhanced)', '오지훈': 'Sora (Enhanced)', '신현우': 'Rocko (한국어(한국))'},
}
GAP = 0.5

def run(*args): subprocess.run(args, check=True)

def main(kind: str) -> None:
    voice = VOICES[kind]
    out = HERE / 'audio' / kind
    out.mkdir(parents=True, exist_ok=True)
    lines = (HERE / 'script.txt').read_text(encoding='utf-8').splitlines()
    with tempfile.TemporaryDirectory() as tmp:
        parts = pathlib.Path(tmp)
        run('ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', str(GAP), str(parts / 'gap.wav'))
        listing, truth, t = [], [], 0.0
        for i, line in enumerate(lines, 1):
            name, text = line.split(': ', 1)
            aiff, wav = parts / f'{i:03d}.aiff', parts / f'{i:03d}.wav'
            run('say', '-v', voice[name], '-o', str(aiff), text)
            run('ffmpeg', '-loglevel', 'error', '-y', '-i', str(aiff), '-ar', '16000', '-ac', '1', str(wav))
            dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(wav)], capture_output=True, text=True).stdout)
            truth.append(f'{t:.2f}\t{t + dur:.2f}\t{name}\t{i}')
            t += dur + GAP
            listing += [f"file '{wav}'", f"file '{parts / 'gap.wav'}'"]
        (parts / 'list.txt').write_text('\n'.join(listing))
        run('ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(parts / 'list.txt'), '-c', 'copy', str(out / 'meeting.wav'))
    run('ffmpeg', '-loglevel', 'error', '-y', '-i', str(out / 'meeting.wav'), '-c:a', 'aac', '-b:a', '48k', str(out / 'meeting.m4a'))
    (out / 'truth.tsv').write_text('start\tend\tspeaker\tline\n' + '\n'.join(truth))
    print(f'{kind}: {len(lines)}줄, {t / 60:.1f}분 → {out}')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'basic')
