"""긴 회의 조각 전사 시험 (표준 라이브러리만, 가짜 엔진): python3 -m unittest discover -s tools/voice-sidecar"""
import json
import math
import os
import shutil
import struct
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
import uuid
import wave
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402

RATE = 16000


def write_wav(path: str, pattern: list[tuple[float, bool]]) -> float:
    """(초, 소리 있음) 순서대로 440Hz 소리와 무음을 이어 16kHz 모노 WAV를 쓴다. 전체 길이(초)를 돌려준다"""
    frames = bytearray()
    for seconds, loud in pattern:
        for i in range(int(seconds * RATE)):
            value = int(8000 * math.sin(2 * math.pi * 440 * i / RATE)) if loud else 0
            frames += struct.pack("<h", value)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))
    return len(frames) / 2 / RATE


class FakeWhisper:
    """whisper_transcribe 대신: 받은 조각 길이·프롬프트를 적고, 조각마다 '조각N' 한 구간을 돌려준다"""

    def __init__(self, delay: float = 0.0) -> None:
        self.calls: list[dict[str, Any]] = []
        self.delay = delay
        self.lock = threading.Lock()
        self.first_started = threading.Event()
        self.hold_first: Optional[threading.Event] = None

    def __call__(self, path: str, language: str, prompt: Optional[str] = None) -> dict[str, Any]:
        duration = server.wav_duration(path)
        with self.lock:
            index = len(self.calls)
            self.calls.append({"duration": duration, "prompt": prompt, "language": language})
        if index == 0:
            self.first_started.set()
            if self.hold_first is not None:
                self.hold_first.wait(5)
        if self.delay:
            time.sleep(self.delay)
        return {"duration": duration, "segments": [{"start": 0.1, "end": duration - 0.1, "text": f"조각{index + 1}"}]}


class ChunkPlanTest(unittest.TestCase):
    def test_짧은_녹음은_한_조각이다(self) -> None:
        self.assertEqual(server.plan_chunks(200.0, [], target=180, window=30), [(0.0, 200.0)])

    def test_목표_시각_근처의_말_없는_곳_가운데에서_자른다(self) -> None:
        chunks = server.plan_chunks(500.0, [(170.0, 172.0), (195.0, 196.0), (350.0, 353.0)], target=180, window=30)
        self.assertEqual(chunks, [(0.0, 171.0), (171.0, 351.5), (351.5, 500.0)])

    def test_2초가_넘는_틈은_같게_보고_목표에_가까운_곳을_고른다(self) -> None:
        chunks = server.plan_chunks(400.0, [(155.0, 160.0), (178.0, 181.0)], target=180, window=30)
        self.assertEqual(chunks[0], (0.0, 179.5))

    def test_말_없는_곳이_없으면_목표_시각에서_자르고_마지막_조각이_너무_짧지_않다(self) -> None:
        chunks = server.plan_chunks(390.0, [], target=180, window=30)
        self.assertEqual(chunks, [(0.0, 180.0), (180.0, 390.0)])
        self.assertTrue(all(end > start for start, end in chunks))

    def test_화자_분리_결과에서_아무도_말하지_않는_구간을_찾는다(self) -> None:
        turns = [(1.0, 5.0, "A"), (4.0, 8.0, "B"), (10.0, 12.0, "A")]
        self.assertEqual(server.gaps_between(turns, 15.0), [(0.0, 1.0), (8.0, 10.0), (12.0, 15.0)])

    def test_소리_크기로_조용한_곳과_말소리_길이를_센다(self) -> None:
        levels = [-90.0] * 5 + [-20.0] * 10 + [-90.0] * 5
        gaps, speech = server.quiet_gaps(levels, frame_sec=0.1)
        self.assertEqual(gaps, [(0.0, 0.5), (1.5, 2.0)])
        self.assertAlmostEqual(speech, 1.0)

    def test_무음만_있으면_말소리가_없다(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "silence.wav")
            write_wav(path, [(2.0, False)])
            _, speech = server.quiet_gaps(server.frame_levels(path))
        self.assertEqual(speech, 0.0)

    def test_조각_파일은_원본의_그_구간이다(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = os.path.join(tmp, "a.wav"), os.path.join(tmp, "b.wav")
            write_wav(src, [(1.0, True), (1.0, False)])
            server.write_chunk(src, dst, 0.5, 1.25)
            self.assertAlmostEqual(server.wav_duration(dst), 0.75, places=3)


class OptionsTest(unittest.TestCase):
    def test_참석자_수는_최대_화자_수로_넘긴다(self) -> None:
        self.assertEqual(server.speaker_options({"max_speakers": "6"}), {"max_speakers": 6})

    def test_ERP가_두_값을_같이_보내면_최대_화자_수를_먼저_쓴다(self) -> None:
        self.assertEqual(server.speaker_options({"max_speakers": "6", "num_speakers": "6"}), {"max_speakers": 6})

    def test_옛_ERP의_정확한_화자_수도_받는다(self) -> None:
        self.assertEqual(server.speaker_options({"num_speakers": "3"}), {"num_speakers": 3})

    def test_이상한_화자_수는_버린다(self) -> None:
        self.assertEqual(server.speaker_options({"max_speakers": "0"}), {})
        self.assertEqual(server.speaker_options({"max_speakers": "abc"}), {})
        self.assertEqual(server.speaker_options({"max_speakers": "21"}), {})

    def test_용어_힌트는_줄바꿈과_제어_문자를_빼고_상한까지만_쓴다(self) -> None:
        self.assertEqual(server.clean_prompt("참석자 김도윤\n강종\tSM355B\x00"), "참석자 김도윤 강종 SM355B")
        self.assertEqual(len(server.clean_prompt("가" * 1000) or ""), server.PROMPT_MAX_CHARS)
        self.assertIsNone(server.clean_prompt("  \n "))

    def test_whisper_요청에_용어_힌트를_prompt로_넣는다(self) -> None:
        sent: list[bytes] = []

        class Response:
            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def read(self) -> bytes:
                return b'{"text": "", "segments": []}'

        def fake_urlopen(request: urllib.request.Request, timeout: float) -> Response:
            sent.append(request.data or b"")
            return Response()

        with tempfile.TemporaryDirectory() as tmp, mock.patch("urllib.request.urlopen", fake_urlopen):
            path = os.path.join(tmp, "a.wav")
            write_wav(path, [(0.5, True)])
            server.whisper_transcribe(path, "ko", "참석자 김도윤. 강종 SM355B")
            server.whisper_transcribe(path, "ko")
        self.assertIn('name="prompt"\r\n\r\n참석자 김도윤. 강종 SM355B'.encode(), sent[0])
        self.assertNotIn(b'name="prompt"', sent[1])


class SpeakerMergeTest(unittest.TestCase):
    """참석자 수로 나눈 뒤 목소리가 아주 비슷한 화자를 합친다 (말하지 않은 참석자 몫만큼 한 사람이 둘로 쪼개지지 않게)"""

    TURNS = [(0.0, 10.0, "A"), (10.0, 12.0, "B"), (12.0, 20.0, "C"), (20.0, 21.0, "B")]

    def test_최대_화자_수는_그_수로_나눈_뒤_합치고_정확한_수는_그대로_쓴다(self) -> None:
        self.assertEqual(server.pipeline_options({"max_speakers": 6}), ({"num_speakers": 6}, 6))
        self.assertEqual(server.pipeline_options({"num_speakers": 3}), ({"num_speakers": 3}, None))
        self.assertEqual(server.pipeline_options(None), ({}, None))

    def test_아주_비슷한_화자는_오래_말한_쪽으로_합친다(self) -> None:
        # A와 B는 같은 사람(코사인 0.95), C는 다른 사람
        centroids = [[1.0, 0.0, 0.0], [0.95, math.sqrt(1 - 0.95**2), 0.0], [0.0, 0.0, 1.0]]
        merged = server.merge_similar_speakers(self.TURNS, ["A", "B", "C"], centroids, 0.85)
        self.assertEqual([t[2] for t in merged], ["A", "A", "C", "A"])

    def test_기준보다_덜_비슷하면_합치지_않는다(self) -> None:
        centroids = [[1.0, 0.0, 0.0], [0.8, 0.6, 0.0], [0.0, 0.0, 1.0]]
        merged = server.merge_similar_speakers(self.TURNS, ["A", "B", "C"], centroids, 0.85)
        self.assertEqual(merged, self.TURNS)

    def test_여럿이_나뉘었으면_가장_비슷한_쌍부터_차례로_합친다(self) -> None:
        turns = [(0.0, 5.0, "A"), (5.0, 6.0, "B"), (6.0, 7.0, "C"), (7.0, 12.0, "D")]
        centroids = [[1.0, 0.0], [0.99, math.sqrt(1 - 0.99**2)], [0.9, math.sqrt(1 - 0.9**2)], [0.0, 1.0]]
        merged = server.merge_similar_speakers(turns, ["A", "B", "C", "D"], centroids, 0.85)
        self.assertEqual([t[2] for t in merged], ["A", "A", "A", "D"])

    def test_중심이_없거나_수가_맞지_않으면_그대로_둔다(self) -> None:
        self.assertEqual(server.merge_similar_speakers(self.TURNS, ["A", "B", "C"], [[0.0, 0.0], [0.0, 0.0], [1.0, 0.0]], 0.85), self.TURNS)
        self.assertEqual(server.merge_similar_speakers(self.TURNS, ["A", "B", "C"], [[1.0, 0.0]], 0.85), self.TURNS)


class SplitBySpeakerTest(unittest.TestCase):
    """whisper가 두 사람의 말을 한 구간으로 묶으면 낱말 시각으로 화자가 바뀌는 곳에서 나눈다"""

    TURNS = [(0.0, 3.0, "A"), (3.2, 8.0, "B")]

    @staticmethod
    def seg(words: list[tuple[str, float, float]]) -> dict:
        return {"start": words[0][1], "end": words[-1][2], "text": "".join(w for w, _, _ in words).strip(), "words": [{"word": w, "start": a, "end": b} for w, a, b in words]}

    def test_화자가_바뀌는_곳에서_나누고_글은_그대로_잇는다(self) -> None:
        seg = self.seg([(" 네", 0.0, 0.5), (" 알겠습니다", 0.6, 1.8), (" 그럼", 3.4, 3.9), (" 제가", 4.0, 4.6), (" 하죠", 4.7, 5.5)])
        result = server.split_by_speaker([seg], self.TURNS)
        self.assertEqual([(r["text"], r["speaker"]) for r in result], [("네 알겠습니다", "A"), ("그럼 제가 하죠", "B")])
        self.assertEqual((result[0]["start"], result[1]["end"]), (0.0, 5.5))
        self.assertEqual(" ".join(r["text"] for r in result), seg["text"])

    def test_짧은_덩이는_앞_화자에_붙이고_나누지_않는다(self) -> None:
        seg = self.seg([(" 네", 0.0, 0.5), (" 알겠습니다", 0.6, 2.8), (" 음", 3.3, 3.5), (" 네", 3.6, 3.7)])
        result = server.split_by_speaker([seg], self.TURNS)
        self.assertEqual(result, [seg])

    def test_낱말_시각이_없거나_글과_다르면_나누지_않는다(self) -> None:
        plain = {"start": 0.0, "end": 5.0, "text": "통째 글", "words": []}
        self.assertEqual(server.split_by_speaker([plain], self.TURNS), [plain])
        self.assertEqual(server.whisper_words({"text": "가나", "words": [{"word": "가", "start": 0, "end": 1}]}), [])
        self.assertEqual(len(server.whisper_words({"text": " 가나", "words": [{"word": " 가", "start": 0, "end": 1}, {"word": "나", "start": 1, "end": 2}]})), 2)

    def test_나눈_구간은_회의_전체_화자_번호로_다시_매긴다(self) -> None:
        seg = self.seg([(" 네", 0.0, 0.5), (" 알겠습니다", 0.6, 1.8), (" 그럼", 3.4, 3.9), (" 제가", 4.0, 4.6), (" 하죠", 4.7, 5.5)])
        fake = {"text": seg["text"], "segments": [{"start": 0.0, "end": 5.5, "text": seg["text"], "words": seg["words"]}]}
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "a.wav")
            write_wav(path, [(0.7, True), (0.3, False)] * 6)
            with mock.patch.object(server, "whisper_transcribe", return_value=fake), mock.patch.object(server, "diarize", return_value=self.TURNS), mock.patch.object(server, "QUICK_AUDIO_SEC", 2.0):
                segments, _ = server.run_whisper_engine(path, "ko", diarization=True, tmp_dir=tmp)
        self.assertEqual([(s["text"], s["speaker"]) for s in segments], [("네 알겠습니다", "SPEAKER_1"), ("그럼 제가 하죠", "SPEAKER_2")])


class ChunkedRunTest(unittest.TestCase):
    """CHUNK_SEC 등을 작게 줄여 몇 초짜리 소리로 긴 회의 흐름을 본다"""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for name, value in (("SHORT_AUDIO_SEC", 0.5), ("QUICK_AUDIO_SEC", 2.0), ("CHUNK_SEC", 1.0), ("CHUNK_SEARCH_SEC", 0.25), ("QUICK_WAIT_SEC", 5.0)):
            patcher = mock.patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        # 0.7초 소리 + 0.3초 무음을 네 번: 1초 조각마다 끝에 말 없는 곳이 있다
        self.long_wav = os.path.join(self.tmp.name, "long.wav")
        self.duration = write_wav(self.long_wav, [(0.7, True), (0.3, False)] * 4)

    def test_말_없는_곳에서_나눠_받아쓰고_회의_시각으로_옮긴다(self) -> None:
        fake = FakeWhisper()
        progress: list[tuple[str, int, int]] = []
        with mock.patch.object(server, "whisper_transcribe", fake):
            segments, duration = server.run_whisper_engine(
                self.long_wav, "ko", diarization=False, prompt="강종 SM355B", progress=lambda *p: progress.append(p), tmp_dir=self.tmp.name
            )
        self.assertAlmostEqual(duration, 4.0, places=2)
        self.assertGreaterEqual(len(fake.calls), 3)
        self.assertTrue(all(call["prompt"] == "강종 SM355B" for call in fake.calls))
        self.assertEqual([p[0] for p in progress], ["transcribe"] * len(fake.calls))
        self.assertEqual([(p[1], p[2]) for p in progress], [(i + 1, len(fake.calls)) for i in range(len(fake.calls))])
        # 조각 시각을 이어 붙여 뒤 조각일수록 늦다
        starts = [s["start"] for s in segments]
        self.assertEqual(starts, sorted(starts))
        self.assertGreater(segments[-1]["start"], 2.0)
        self.assertEqual([s["text"] for s in segments], [f"조각{i + 1}" for i in range(len(fake.calls))])
        # 조각 파일은 남기지 않는다
        self.assertEqual(sorted(os.listdir(self.tmp.name)), ["long.wav"])

    def test_화자_분리는_회의_전체에_한_번_돌려_조각이_달라도_화자가_이어진다(self) -> None:
        fake = FakeWhisper()
        turns = [(0.0, 1.8, "SPK_B"), (2.0, 4.0, "SPK_A")]
        with mock.patch.object(server, "whisper_transcribe", fake), mock.patch.object(server, "diarize", return_value=turns) as diarize:
            segments, _ = server.run_whisper_engine(self.long_wav, "ko", diarization=True, speakers={"max_speakers": 6}, tmp_dir=self.tmp.name)
        diarize.assert_called_once_with(self.long_wav, {"max_speakers": 6})
        # 처음 나온 순서로 다시 매긴다: 앞쪽(SPK_B)이 SPEAKER_1, 뒤쪽(SPK_A)이 SPEAKER_2
        self.assertEqual(segments[0]["speaker"], "SPEAKER_1")
        self.assertEqual(segments[-1]["speaker"], "SPEAKER_2")
        self.assertEqual({s["speaker"] for s in segments}, {"SPEAKER_1", "SPEAKER_2"})

    def test_화자_분리가_말소리를_못_찾으면_받아쓰지_않고_빈_결과다(self) -> None:
        fake = FakeWhisper()
        with mock.patch.object(server, "whisper_transcribe", fake), mock.patch.object(server, "diarize", return_value=[]):
            segments, _ = server.run_whisper_engine(self.long_wav, "ko", diarization=True, tmp_dir=self.tmp.name)
        self.assertEqual(segments, [])
        self.assertEqual(fake.calls, [])

    def test_1분_안쪽_짧은_녹음도_화자_분리가_말소리를_못_찾으면_받아쓰지_않는다(self) -> None:
        short = os.path.join(self.tmp.name, "short.wav")
        write_wav(short, [(1.5, False)])
        fake = FakeWhisper()
        with mock.patch.object(server, "whisper_transcribe", fake), mock.patch.object(server, "diarize", return_value=[]):
            segments, _ = server.run_whisper_engine(short, "ko", diarization=True, tmp_dir=self.tmp.name)
        self.assertEqual((segments, fake.calls), ([], []))

    def test_받아쓰기만_할_때도_무음뿐이면_받아쓰지_않는다(self) -> None:
        silent = os.path.join(self.tmp.name, "silent.wav")
        write_wav(silent, [(4.0, False)])
        fake = FakeWhisper()
        with mock.patch.object(server, "whisper_transcribe", fake):
            segments, _ = server.run_whisper_engine(silent, "ko", diarization=False, tmp_dir=self.tmp.name)
        self.assertEqual(segments, [])
        self.assertEqual(fake.calls, [])

    def test_같은_말을_되풀이하면_그_자리부터_새_문맥으로_다시_받아쓴다(self) -> None:
        calls: list[tuple[Optional[str], float]] = []

        def looping(path: str, language: str, prompt: Optional[str] = None) -> dict[str, Any]:
            duration = server.wav_duration(path)
            calls.append((prompt, round(duration, 1)))
            if len(calls) == 1:
                ok = [{"start": 0.1, "end": 0.9, "text": "앞의 멀쩡한 말이에요", "words": []}]
                loop = [{"start": 1.0 + i * 0.2, "end": 1.2 + i * 0.2, "text": "철관석의 공유해 주세요."} for i in range(5)]
                return {"segments": ok + loop}
            return {"segments": [{"start": 0.1, "end": 0.9, "text": "철광석 재고는 열흘치예요"}]}

        wav = os.path.join(self.tmp.name, "one.wav")
        write_wav(wav, [(3.0, True)])
        with mock.patch.object(server, "whisper_transcribe", looping):
            segments = server.transcribe_chunks(wav, [(0.0, 3.0)], "ko", "원료 철광석 ORE01", False, server.no_progress, self.tmp.name)
        # 되풀이가 시작된 1.0초부터 끝까지 힌트 없이 다시
        self.assertEqual(calls, [("원료 철광석 ORE01", 3.0), (None, 2.0)])
        self.assertEqual([(s["start"], s["text"]) for s in segments], [(0.1, "앞의 멀쩡한 말이에요"), (1.1, "철광석 재고는 열흘치예요")])
        self.assertEqual(sorted(os.listdir(self.tmp.name)), ["long.wav", "one.wav"])

    def test_다시_해도_더_되풀이하면_처음_것을_쓴다(self) -> None:
        loop = {"segments": [{"start": i * 0.2, "end": i * 0.2 + 0.2, "text": "같은 말을 또 합니다"} for i in range(6)]}
        wav = os.path.join(self.tmp.name, "one.wav")
        write_wav(wav, [(3.0, True)])
        with mock.patch.object(server, "whisper_transcribe", return_value=loop):
            segments = server.transcribe_chunks(wav, [(0.0, 3.0)], "ko", None, False, server.no_progress, self.tmp.name)
        self.assertEqual(len(segments), 6)

    def test_짧은_대답이_이어지는_것은_되풀이로_보지_않는다(self) -> None:
        self.assertEqual(server.repeated_run([{"text": "네."}] * 6), 0)
        self.assertEqual(server.repeated_run([{"text": "알겠습니다 바로 할게요"}] * 3 + [{"text": "다른 말이에요 정말로"}]), 3)

    def test_whisper_서버가_잠깐_끊기면_그_조각만_한_번_더_해_본다(self) -> None:
        fake = FakeWhisper()
        calls = {"n": 0}

        def flaky(path: str, language: str, prompt: Optional[str] = None) -> dict[str, Any]:
            calls["n"] += 1
            if calls["n"] == 2:
                raise server.SidecarError(502, "whisper 서버에 연결할 수 없어요")
            return fake(path, language, prompt)

        with mock.patch.object(server, "whisper_transcribe", flaky), mock.patch.object(server, "WHISPER_RETRY_DELAY_SEC", 0):
            segments, _ = server.run_whisper_engine(self.long_wav, "ko", diarization=False, tmp_dir=self.tmp.name)
        self.assertEqual(len(segments), len(fake.calls))
        self.assertEqual(calls["n"], len(fake.calls) + 1)

    def test_조각_사이에_잠금을_놓아_기다리던_짧은_요청이_먼저_지나간다(self) -> None:
        fake = FakeWhisper()
        fake.hold_first = threading.Event()
        short_wav = os.path.join(self.tmp.name, "wake.wav")
        write_wav(short_wav, [(0.3, True)])
        results: dict[str, Any] = {}

        def long_job() -> None:
            results["long"] = server.run_whisper_engine(self.long_wav, "ko", diarization=False, prompt="긴 회의", tmp_dir=self.tmp.name)

        def quick_job() -> None:
            results["quick"] = server.run_whisper_engine(short_wav, "ko", diarization=False, tmp_dir=self.tmp.name)

        with mock.patch.object(server, "whisper_transcribe", fake):
            long_thread = threading.Thread(target=long_job)
            long_thread.start()
            self.assertTrue(fake.first_started.wait(5))
            quick_thread = threading.Thread(target=quick_job)
            quick_thread.start()
            # 짧은 요청이 차례를 기다리기 시작할 때까지
            deadline = time.time() + 5
            while server.engine_gate._quick_waiting == 0 and time.time() < deadline:
                time.sleep(0.01)
            fake.hold_first.set()
            long_thread.join(10)
            quick_thread.join(10)
        prompts = [call["prompt"] for call in fake.calls]
        # 긴 회의 첫 조각 → 짧은 요청 → 긴 회의 나머지 조각
        self.assertEqual(prompts[0], "긴 회의")
        self.assertIsNone(prompts[1])
        self.assertTrue(all(p == "긴 회의" for p in prompts[2:]))
        self.assertEqual(len(results["long"][0]), len(prompts) - 1)

    def test_짧은_요청은_오래_기다리지_않고_바쁘다고_알린다(self) -> None:
        fake = FakeWhisper()
        fake.hold_first = threading.Event()
        short_wav = os.path.join(self.tmp.name, "wake.wav")
        write_wav(short_wav, [(0.3, True)])
        with mock.patch.object(server, "whisper_transcribe", fake), mock.patch.object(server, "QUICK_WAIT_SEC", 0.2):
            long_thread = threading.Thread(target=lambda: server.run_whisper_engine(self.long_wav, "ko", diarization=False, tmp_dir=self.tmp.name))
            long_thread.start()
            self.assertTrue(fake.first_started.wait(5))
            with self.assertRaises(server.SidecarError) as raised:
                server.run_whisper_engine(short_wav, "ko", diarization=False, tmp_dir=self.tmp.name)
            fake.hold_first.set()
            long_thread.join(10)
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(raised.exception.message, server.BUSY_MESSAGE)


class GateTest(unittest.TestCase):
    """엔진·화자 분리 차례를 실패·포기·끊김에서도 제대로 놓는지 (PR #528 리뷰)"""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for name, value in (("SHORT_AUDIO_SEC", 0.5), ("QUICK_AUDIO_SEC", 2.0), ("CHUNK_SEC", 1.0), ("CHUNK_SEARCH_SEC", 0.25), ("QUICK_WAIT_SEC", 0.3)):
            patcher = mock.patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.long_wav = os.path.join(self.tmp.name, "long.wav")
        write_wav(self.long_wav, [(0.7, True), (0.3, False)] * 4)

    def test_502가_아닌_실패에도_엔진_차례를_놓는다(self) -> None:
        def broken(path: str, language: str, prompt: Optional[str] = None) -> dict[str, Any]:
            raise ValueError("깨진 응답")

        with mock.patch.object(server, "whisper_transcribe", broken):
            with self.assertRaises(ValueError):
                server.run_whisper_engine(self.long_wav, "ko", diarization=False, tmp_dir=self.tmp.name)
        self.assertTrue(server.engine_gate.acquire(quick=True, timeout=0.1))
        server.engine_gate.release()

    def test_짧은_요청이_기다리다_포기하면_긴_전사가_다음_조각을_이어_간다(self) -> None:
        gate = server.EngineGate()
        self.assertTrue(gate.acquire(quick=False))
        long_got: list[bool] = []
        quick_thread = threading.Thread(target=lambda: gate.acquire(quick=True, timeout=0.3))
        quick_thread.start()
        time.sleep(0.05)
        # 짧은 요청이 기다리는 동안 다른 긴 전사도 줄을 선다(짧은 요청이 있어 양보 중). 짧은 요청이 시간이 지나 포기해도 긴 전사는 계속 기다렸다 차례를 얻어야 한다
        long_thread = threading.Thread(target=lambda: long_got.append(gate.acquire(quick=False, timeout=2)))
        long_thread.start()
        quick_thread.join(2)
        gate.release()
        long_thread.join(2)
        self.assertEqual(long_got, [True])

    def test_짧은_화자_분리_요청은_오래_기다리지_않고_바쁘다고_알린다(self) -> None:
        short = os.path.join(self.tmp.name, "short.wav")
        write_wav(short, [(1.5, True)])
        server.diarize_lock.acquire()
        try:
            with self.assertRaises(server.SidecarError) as raised:
                server.run_whisper_engine(short, "ko", diarization=True, tmp_dir=self.tmp.name)
        finally:
            server.diarize_lock.release()
        self.assertEqual((raised.exception.status, raised.exception.message), (503, server.BUSY_MESSAGE))

    def test_다시_받아쓴_결과가_비면_처음_것을_쓴다(self) -> None:
        calls = {"n": 0}

        def looping(path: str, language: str, prompt: Optional[str] = None) -> dict[str, Any]:
            calls["n"] += 1
            if calls["n"] == 1:
                return {"segments": [{"start": i * 0.2, "end": i * 0.2 + 0.2, "text": "같은 말을 또 합니다"} for i in range(5)] + [{"start": 1.5, "end": 2.5, "text": "뒤의 진짜 말이에요"}]}
            return {"segments": []}

        wav = os.path.join(self.tmp.name, "one.wav")
        write_wav(wav, [(3.0, True)])
        with mock.patch.object(server, "whisper_transcribe", looping):
            segments = server.transcribe_chunks(wav, [(0.0, 3.0)], "ko", None, False, server.no_progress, self.tmp.name)
        self.assertEqual(segments[-1]["text"], "뒤의 진짜 말이에요")

    def test_ERP가_연결을_끊으면_남은_조각을_받아쓰지_않는다(self) -> None:
        fake = FakeWhisper()
        seen: list[int] = []

        def progress(stage: str, current: int, total: int) -> None:
            seen.append(current)
            if current == 2:
                raise server.ClientGone()

        with mock.patch.object(server, "whisper_transcribe", fake):
            with self.assertRaises(server.ClientGone):
                server.run_whisper_engine(self.long_wav, "ko", diarization=False, progress=progress, tmp_dir=self.tmp.name)
        self.assertEqual((seen, len(fake.calls)), ([1, 2], 1))


class StreamTest(unittest.TestCase):
    """stream=progress 요청은 진행 줄과 결과 줄을 차례로 받고, 받아쓰는 동안 /health가 긴 녹음 수를 알린다"""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for name, value in (("SHORT_AUDIO_SEC", 0.5), ("QUICK_AUDIO_SEC", 2.0), ("CHUNK_SEC", 1.0), ("CHUNK_SEARCH_SEC", 0.25), ("API_KEY", None)):
            patcher = mock.patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        # ffmpeg 없이: 올린 파일이 이미 16kHz 모노 WAV라 그대로 옮긴다
        patcher = mock.patch.object(server, "to_wav16k_mono", shutil.copyfile)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.port = self.httpd.server_address[1]
        self.wav = os.path.join(self.tmp.name, "meeting.wav")
        write_wav(self.wav, [(0.7, True), (0.3, False)] * 4)

    def _post(self, fields: dict[str, str]) -> urllib.request.addinfourl:
        boundary = uuid.uuid4().hex
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="m.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode())
        parts.append(Path(self.wav).read_bytes())
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/v1/audio/transcriptions",
            data=b"".join(parts),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        return urllib.request.urlopen(request, timeout=20)

    def _health(self) -> dict[str, Any]:
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health", timeout=5) as res:
            return json.loads(res.read())

    def test_진행과_결과를_한_줄씩_보낸다(self) -> None:
        fake = FakeWhisper()
        fake.hold_first = threading.Event()
        seen_health: list[dict[str, Any]] = []
        with mock.patch.object(server, "whisper_transcribe", fake):
            lines: list[dict[str, Any]] = []
            with self._post({"model": "whisper", "stream": "progress", "prompt": "강종 SS275"}) as res:
                self.assertIn("application/x-ndjson", res.headers["Content-Type"])
                first = json.loads(res.readline())
                lines.append(first)
                self.assertTrue(fake.first_started.wait(5))
                seen_health.append(self._health())
                fake.hold_first.set()
                lines.extend(json.loads(line) for line in res if line.strip())
        progress = [line for line in lines if line["type"] == "progress"]
        self.assertEqual(progress[0], {"type": "progress", "stage": "transcribe", "current": 1, "total": len(fake.calls)})
        self.assertEqual(progress[-1]["current"], len(fake.calls))
        self.assertEqual(lines[-1]["type"], "result")
        self.assertEqual(len(lines[-1]["result"]["segments"]), len(fake.calls))
        self.assertEqual(seen_health, [{"status": "ok", "transcribing": 1}])
        self.assertEqual(self._health(), {"status": "ok", "transcribing": 0})

    def test_실패는_오류_줄로_알린다(self) -> None:
        def broken(path: str, language: str, prompt: Optional[str] = None) -> dict[str, Any]:
            raise server.SidecarError(400, "모르는 오류")

        with mock.patch.object(server, "whisper_transcribe", broken):
            with self._post({"model": "whisper", "stream": "progress"}) as res:
                lines = [json.loads(line) for line in res if line.strip()]
        self.assertEqual(lines[-1], {"type": "error", "status": 400, "message": "모르는 오류"})

    def test_stream을_주지_않으면_예전처럼_JSON_한_번이다(self) -> None:
        fake = FakeWhisper()
        with mock.patch.object(server, "whisper_transcribe", fake):
            with self._post({"model": "whisper"}) as res:
                self.assertIn("application/json", res.headers["Content-Type"])
                body = json.loads(res.read())
        self.assertEqual(len(body["segments"]), len(fake.calls))


if __name__ == "__main__":
    unittest.main()
