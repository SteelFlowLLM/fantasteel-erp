# 화자 분리·전사 결과를 정답(truth.tsv·script.txt)과 비교한다.
#   python tools/score.py audio/basic/result.json
# result.json: {"segments": [{"start": 초, "end": 초, "speaker": "SPEAKER_1", "text": "..."}]}
#   ERP 회의록 상세의 transcriptSegments, 화자 분리 사이드카(/v1/audio/transcriptions verbose_json) 응답 모두 이 모양이다.
import collections, csv, json, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parents[1]

def norm(s: str) -> str: return re.sub(r'[\s.,?!~"\'·…\-]', '', s)

def cer(ref: str, hyp: str) -> float:
    a, b = norm(ref), norm(hyp)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1): cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] / max(1, len(a))

def speaker_accuracy(truth: list[dict], segs: list[dict]) -> tuple[float, int]:
    # 정답 줄마다 가장 많이 겹친 화자 라벨 → 라벨을 이름에 다수결로 연결 → 맞은 줄 비율
    votes, labels = collections.defaultdict(collections.Counter), []
    for t in truth:
        ts, te, ov = float(t['start']), float(t['end']), collections.Counter()
        for s in segs:
            o = min(te, s['end']) - max(ts, s['start'])
            if o > 0 and s.get('speaker') is not None: ov[s['speaker']] += o
        lab = ov.most_common(1)[0][0] if ov else None
        labels.append(lab)
        if lab is not None: votes[lab][t['speaker']] += 1
    mapping = {l: c.most_common(1)[0][0] for l, c in votes.items()}
    ok = sum(1 for t, l in zip(truth, labels) if l is not None and mapping.get(l) == t['speaker'])
    return ok / len(truth), len({s['speaker'] for s in segs if s.get('speaker') is not None})

def main(result_path: str) -> None:
    result = pathlib.Path(result_path).resolve()
    data = json.loads(result.read_text(encoding='utf-8'))
    segs = data.get('segments') or data.get('transcriptSegments') or []
    truth = list(csv.DictReader(open(result.parent / 'truth.tsv', encoding='utf-8'), delimiter='\t'))
    ref = ''.join(l.split(': ', 1)[1] for l in (HERE / 'script.txt').read_text(encoding='utf-8').splitlines())
    acc, found = speaker_accuracy(truth, segs)
    print(f'화자 정확도 {acc * 100:.1f}% · 찾은 화자 {found}명 (정답 6) · 글자 오류율 {cer(ref, "".join(s["text"] for s in segs)) * 100:.1f}%')

if __name__ == '__main__':
    main(sys.argv[1])
