#!/usr/bin/env python3
"""Voice2ERP 화자 분리 사이드카 (개발용 도구, 파이썬 표준 라이브러리 서버).

ERP 서버가 부르는 OpenAI 호환 `POST /v1/audio/transcriptions`를 흉내 내되, 응답 구간에 `speaker`를 붙인다.
  model=whisper-pyannote (기본)  whisper.cpp 서버(전사) + pyannote(화자 분리)를 시간 겹침으로 합친다
  model=whisper                  whisper.cpp 서버로 받아쓰기만 한다 (화자 없음, 빠름)
  model=vibevoice                VibeVoice-ASR MLX 4-bit 한 모델이 전사와 화자 분리를 한 번에 한다
`GET /v1/models`는 위 셋을 화면에 보일 이름과 함께 알려 준다.

긴 회의(1분 이상)는 whisper 엔진에서 말 없는 곳을 골라 약 3분 조각으로 나눠 차례로 받아쓰고, 조각마다 엔진 차례를 놓아
그 사이 기다리는 짧은 요청(철강맨 부르기 조각·연결 확인)을 먼저 처리한다. 화자 분리(pyannote)는 회의 전체에 한 번만 돌려
조각이 달라도 화자가 이어진다. 요청에 stream=progress를 주면 진행(조각 n/m)과 결과를 한 줄 JSON(NDJSON)으로 차례로 보낸다.

API 키(`Authorization: Bearer …`): 키가 있으면 모든 /v1 요청에 요구한다. 다른 PC에 열 때(SIDECAR_HOST가 127.0.0.1이 아닐 때)는
키가 꼭 있어야 하고, 없으면 만들어 KEY_FILE에 둔다. 127.0.0.1로만 열면 SIDECAR_API_KEY를 직접 줄 때만 키를 요구한다. whisper.cpp에는 키 기능이 없어 그쪽은 127.0.0.1에만 열고 밖에는 이 서버만 연다.

음성은 임시 파일로만 다루고 요청이 끝나면(성공이든 실패든) 모두 지운다 (BP-VOC-01).
실행: ~/voice-env/bin/python tools/voice-sidecar/server.py
"""
from __future__ import annotations

import array
import contextlib
import hmac
import json
import logging
import math
import mmap
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator, Optional
from urllib.parse import urlparse

HOST = os.environ.get("SIDECAR_HOST", "127.0.0.1")
PORT = int(os.environ.get("SIDECAR_PORT", "8001"))
WHISPER_URL = os.environ.get("WHISPER_URL", "http://127.0.0.1:8000/v1/audio/transcriptions")
PYANNOTE_PIPELINE = os.environ.get("PYANNOTE_PIPELINE", "pyannote/speaker-diarization-community-1")
VIBEVOICE_MODEL = os.environ.get(
    "VIBEVOICE_MODEL", str(Path.home() / ".lmstudio/models/mlx-community/VibeVoice-ASR-4bit")
)
VIBEVOICE_MAX_TOKENS = int(os.environ.get("VIBEVOICE_MAX_TOKENS", "65536"))
MAX_UPLOAD_BYTES = 600 * 1024 * 1024
KEY_FILE = Path(os.environ.get("SIDECAR_API_KEY_FILE", str(Path.home() / ".config/fantasteel-voice/api-key")))
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")
SHORT_AUDIO_SEC = 3.0
# 부르기 조각(8초)·명령 덩어리(30초)·연결 확인(1초)처럼 짧은 소리. 긴 전사 조각 사이에 먼저 끼워 주고, 오래 기다리게 하지 않는다
QUICK_AUDIO_SEC = 60.0
# ERP가 부르기 조각을 20초에 끊으므로 그보다 짧게만 기다리고 바쁘다고 알린다
QUICK_WAIT_SEC = float(os.environ.get("SIDECAR_QUICK_WAIT_SEC", "15"))
# whisper.cpp는 요청을 하나씩 처리하므로 조각 하나의 전사 시간이 짧은 요청이 기다리는 최대 시간이다.
# 🟡 2026-10-22 이 Mac(부하 큼)에서 10분 조각이 39초 걸려 부르기 제한(20초) 안에 들도록 3분으로 정했다
CHUNK_SEC = float(os.environ.get("SIDECAR_CHUNK_SEC", "180"))
# 조각 경계를 고를 때 목표 시각 앞뒤로 말 없는 곳을 찾는 폭
CHUNK_SEARCH_SEC = 30.0
# whisper 초기 프롬프트(용어 힌트) 상한. whisper는 앞 문맥을 224토큰까지만 보므로 넘치는 것은 버린다
PROMPT_MAX_CHARS = 400
# 이만큼도 말소리가 없으면 받아쓰지 않는다 (whisper는 무음에도 "감사합니다." 같은 글을 지어낸다)
MIN_SPEECH_SEC = 1.0
WHISPER_RETRY_DELAY_SEC = 2.0
# 같은 사람이 둘로 나뉜 화자로 보는 목소리 유사도(코사인). 🟡 2026-10-22 합성 회의로 정했다: 서로 다른 사람 가운데 가장 비슷한 쌍 0.79,
# 화자 수를 실제보다 크게 줘 한 사람이 나뉜 쌍 0.82~0.94. 0.82면 나뉜 것이 모두 합쳐졌지만 다른 사람과 너무 가까워, 틀리게 합치기보다 덜 합치는 쪽(0.85)을 골랐다
SPEAKER_MERGE_SIMILARITY = float(os.environ.get("SIDECAR_SPEAKER_MERGE", "0.85"))

ENGINES: list[dict[str, Any]] = [
    {"id": "whisper-pyannote", "label": "받아쓰기 + 화자 분리 (whisper + pyannote)", "diarization": True},
    {"id": "whisper", "label": "받아쓰기만 (whisper, 빠름)", "diarization": False},
    {"id": "vibevoice", "label": "받아쓰기 + 화자 분리 (VibeVoice, 느림)", "diarization": True},
]
ENGINE_IDS = tuple(e["id"] for e in ENGINES)
REPO_ENV = Path(__file__).resolve().parents[2] / "server" / ".env"

log = logging.getLogger("voice-sidecar")

BUSY_MESSAGE = "지금 다른 녹음을 받아쓰는 중이에요. 주소·키는 맞으니 끝난 뒤 다시 확인해 주세요"


class EngineGate:
    """받아쓰기 엔진 차례 (whisper.cpp·VibeVoice). 한 번에 하나만 돌리고, 긴 전사는 조각마다 잡고 놓는다.
    놓은 사이 짧은 요청이 기다리고 있으면 긴 전사는 다음 조각을 잡지 않고 먼저 내준다 (Lock만으로는 놓자마자 다시 잡을 수 있다)."""

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._busy = False
        self._quick_waiting = 0

    def acquire(self, quick: bool, timeout: Optional[float] = None) -> bool:
        with self._cond:
            if quick:
                self._quick_waiting += 1
            try:
                ok = self._cond.wait_for(lambda: not self._busy and (quick or self._quick_waiting == 0), timeout)
                if ok:
                    self._busy = True
                return ok
            finally:
                if quick:
                    self._quick_waiting -= 1
                    # 시간이 다 돼 포기한 짧은 요청을 기다리던 긴 전사를 깨운다
                    self._cond.notify_all()

    def release(self) -> None:
        with self._cond:
            self._busy = False
            self._cond.notify_all()

    @contextlib.contextmanager
    def hold(self, quick: bool, timeout: Optional[float] = None) -> Iterator[None]:
        if not self.acquire(quick, timeout):
            raise SidecarError(503, BUSY_MESSAGE)
        try:
            yield
        finally:
            self.release()


# 받아쓰기 엔진은 한 번에 하나만 돌린다: GPU 메모리를 나눠 쓰는 모델 둘을 겹쳐 부르지 않는다
engine_gate = EngineGate()
# pyannote는 이 프로세스 안에서 돌아 화자 분리끼리만 겹치지 않게 한다 (whisper.cpp는 따로 돌아 부르기 조각이 화자 분리를 기다리지 않는다)
diarize_lock = threading.Lock()
_active_lock = threading.Lock()
# 받아쓰는 중인 긴 녹음 수 (/health). ERP가 음성 서버를 다시 켜기 전에 본다
_active_long_jobs = 0
_pipeline: Any = None
_vibevoice: Any = None
API_KEY: Optional[str] = None

# (단계, 몇 번째, 모두 몇) — stage는 diarize(화자 나누기)·transcribe(받아쓰기)
Progress = Callable[[str, int, int], None]


class SidecarError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@contextlib.contextmanager
def long_job() -> Iterator[None]:
    global _active_long_jobs
    with _active_lock:
        _active_long_jobs += 1
    try:
        yield
    finally:
        with _active_lock:
            _active_long_jobs -= 1


def active_long_jobs() -> int:
    with _active_lock:
        return _active_long_jobs


# ── 멀티파트 읽기 ──────────────────────────────────────────────────────────────────────────


def _read_body_to_file(handler: BaseHTTPRequestHandler, path: str) -> int:
    length_header = handler.headers.get("Content-Length")
    if length_header is None:
        raise SidecarError(411, "Content-Length가 필요해요")
    length = int(length_header)
    if length > MAX_UPLOAD_BYTES:
        raise SidecarError(413, "파일이 너무 커요")
    remaining = length
    with open(path, "wb") as out:
        while remaining > 0:
            chunk = handler.rfile.read(min(1 << 20, remaining))
            if not chunk:
                raise SidecarError(400, "요청이 중간에 끊겼어요")
            out.write(chunk)
            remaining -= len(chunk)
    return length


def parse_multipart(body_path: str, content_type: str, file_out: str) -> tuple[dict[str, str], bool]:
    """본문 파일에서 글 칸은 dict로, `file` 칸은 file_out으로 옮긴다. 메모리에는 올리지 않는다."""
    match = re.search(r'boundary="?([^";]+)"?', content_type)
    if not match:
        raise SidecarError(400, "multipart/form-data로 보내 주세요")
    delimiter = b"--" + match.group(1).encode()
    fields: dict[str, str] = {}
    has_file = False
    if os.path.getsize(body_path) == 0:
        raise SidecarError(400, "빈 요청이에요")
    with open(body_path, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as data:
        pos = data.find(delimiter)
        while pos != -1:
            start = pos + len(delimiter)
            if data[start : start + 2] == b"--":
                break
            start += 2  # CRLF
            header_end = data.find(b"\r\n\r\n", start)
            if header_end == -1:
                raise SidecarError(400, "multipart 형식이 올바르지 않아요")
            headers = data[start:header_end].decode("utf-8", "replace")
            body_start = header_end + 4
            next_pos = data.find(b"\r\n" + delimiter, body_start)
            if next_pos == -1:
                raise SidecarError(400, "multipart 형식이 올바르지 않아요")
            name_match = re.search(r'name="([^"]*)"', headers)
            name = name_match.group(1) if name_match else ""
            if name == "file":
                has_file = True
                with open(file_out, "wb") as out:
                    offset = body_start
                    while offset < next_pos:
                        end = min(offset + (1 << 20), next_pos)
                        out.write(data[offset:end])
                        offset = end
            elif name:
                fields[name] = data[body_start:next_pos].decode("utf-8", "replace")
            pos = next_pos + 2
    return fields, has_file


# ── 공통: ffmpeg, 화자 이름표 ──────────────────────────────────────────────────────────────


def to_wav16k_mono(src: str, dst: str) -> None:
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dst],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not os.path.exists(dst):
        raise SidecarError(400, "오디오 파일을 읽을 수 없어요 (ffmpeg 변환 실패)")


def wav_duration(path: str) -> float:
    with wave.open(path, "rb") as r:
        return r.getnframes() / float(r.getframerate())


def write_chunk(src: str, dst: str, start: float, end: float) -> None:
    """16kHz 모노 WAV의 [start, end)초를 새 WAV로 쓴다 (조각 하나라 메모리에 3분 남짓만 오른다)"""
    with wave.open(src, "rb") as r, wave.open(dst, "wb") as w:
        rate = r.getframerate()
        w.setnchannels(r.getnchannels())
        w.setsampwidth(r.getsampwidth())
        w.setframerate(rate)
        first = int(start * rate)
        r.setpos(min(first, r.getnframes()))
        w.writeframes(r.readframes(max(0, int(end * rate) - first)))


LEVEL_FRAME_SEC = 0.1
SILENT_DB = -90.0


def frame_levels(path: str, frame_sec: float = LEVEL_FRAME_SEC) -> list[float]:
    """frame_sec마다의 소리 크기(dBFS). numpy가 있으면(~/voice-env) 쓰고, 없으면(시험용 python3) 표준 라이브러리로 센다"""
    with wave.open(path, "rb") as r:
        rate, total = r.getframerate(), r.getnframes()
        step = max(1, int(rate * frame_sec))
        levels: list[float] = []
        try:
            import numpy as np  # 41분이면 표준 라이브러리로는 수십 초 걸린다
        except ImportError:
            np = None
        block = step * 600  # 1분씩 읽는다
        read = 0
        while read < total:
            data = r.readframes(min(block, total - read))
            if not data:
                break
            read += len(data) // 2
            if np is not None:
                samples = np.frombuffer(data, dtype="<i2").astype(np.float64)
                usable = len(samples) // step * step
                if usable:
                    rms = np.sqrt(np.mean(samples[:usable].reshape(-1, step) ** 2, axis=1))
                    levels.extend(float(20 * math.log10(v / 32768.0)) if v > 0 else SILENT_DB for v in rms)
                continue
            samples = array.array("h", data)
            if sys.byteorder != "little":
                samples.byteswap()
            for i in range(0, len(samples) - step + 1, step):
                power = sum(s * s for s in samples[i : i + step]) / step
                levels.append(20 * math.log10(math.sqrt(power) / 32768.0) if power > 0 else SILENT_DB)
    return levels


def quiet_gaps(levels: list[float], frame_sec: float = LEVEL_FRAME_SEC, min_gap_sec: float = 0.3) -> tuple[list[tuple[float, float]], float]:
    """(조용한 구간들, 말소리로 볼 만한 초). 크기의 기준은 녹음마다 다른 바닥 소음(아래 10%)에 맞춘다:
    바닥 + 6dB 아래가 이어지면 조용한 곳, 바닥 + 15dB 위(그리고 -55dBFS 위)면 말소리로 센다"""
    if not levels:
        return [], 0.0
    floor = sorted(levels)[len(levels) // 10]
    loud = sum(1 for v in levels if v > max(floor + 15, -55.0)) * frame_sec
    gaps: list[tuple[float, float]] = []
    start: Optional[int] = None
    for i, v in enumerate(levels + [math.inf]):
        if v < floor + 6:
            if start is None:
                start = i
        elif start is not None:
            if (i - start) * frame_sec >= min_gap_sec:
                gaps.append((start * frame_sec, i * frame_sec))
            start = None
    return gaps, loud


def gaps_between(turns: list[tuple[float, float, str]], duration: float) -> list[tuple[float, float]]:
    """화자 분리 결과에서 아무도 말하지 않는 구간"""
    gaps: list[tuple[float, float]] = []
    cursor = 0.0
    for start, end, _ in sorted(turns):
        if start > cursor:
            gaps.append((cursor, start))
        cursor = max(cursor, end)
    if duration > cursor:
        gaps.append((cursor, duration))
    return gaps


def plan_chunks(duration: float, gaps: list[tuple[float, float]], target: Optional[float] = None, window: Optional[float] = None) -> list[tuple[float, float]]:
    """target초쯤마다 앞뒤 window초 안의 말 없는 곳 가운데(2초 넘으면 같게 보고) 목표에 가장 가까운 곳의 가운데에서 자른다.
    찾지 못하면 목표 시각에서 자른다. 마지막 조각이 너무 짧아지지 않게 남은 길이가 target + window 이하면 더 자르지 않는다."""
    target = CHUNK_SEC if target is None else target
    window = min(CHUNK_SEARCH_SEC, target / 4) if window is None else window
    if duration <= target + window:
        return [(0.0, duration)]
    cuts: list[float] = []
    pos = 0.0
    while duration - pos > target + window:
        ideal = pos + target
        near = [g for g in gaps if ideal - window <= (g[0] + g[1]) / 2 <= ideal + window]
        if near:
            best = max(near, key=lambda g: (min(g[1] - g[0], 2.0), -abs((g[0] + g[1]) / 2 - ideal)))
            cut = (best[0] + best[1]) / 2
        else:
            cut = ideal
        cuts.append(cut)
        pos = cut
    bounds = [0.0, *cuts, duration]
    return list(zip(bounds, bounds[1:]))


def clean_prompt(value: Optional[str]) -> Optional[str]:
    """ERP가 보낸 용어 힌트. 줄바꿈·제어 문자를 빼고 상한까지만 쓴다 (넘치면 뒤를 버린다: ERP가 중요한 것부터 보낸다)"""
    if not value:
        return None
    text = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", value)).strip()
    return text[:PROMPT_MAX_CHARS] or None


def speaker_options(fields: dict[str, str]) -> dict[str, int]:
    """max_speakers(참석자 수, 말하지 않은 사람이 있어도 한 사람을 둘로 쪼개지 않는다)를 쓰고, 옛 ERP의 num_speakers(정확값)도 받는다"""
    for name in ("max_speakers", "num_speakers"):
        hint = (fields.get(name) or "").strip()
        if hint.isdigit() and 1 <= int(hint) <= 20:
            return {name: int(hint)}
    return {}


def renumber(labels: list[Optional[str]]) -> list[Optional[str]]:
    """처음 나온 순서대로 SPEAKER_1, SPEAKER_2 … 로 다시 매긴다. None은 그대로 둔다."""
    mapping: dict[str, str] = {}
    result: list[Optional[str]] = []
    for label in labels:
        if label is None:
            result.append(None)
            continue
        if label not in mapping:
            mapping[label] = f"SPEAKER_{len(mapping) + 1}"
        result.append(mapping[label])
    return result


def load_hf_token() -> str:
    token = os.environ.get("HF_TOKEN")
    if token:
        return token
    if REPO_ENV.exists():
        for line in REPO_ENV.read_text(encoding="utf-8").splitlines():
            if line.startswith("HF_TOKEN="):
                value = line.split("=", 1)[1].strip().strip('"').strip("'")
                if value:
                    return value
    raise SidecarError(500, "HF_TOKEN이 없어요. server/.env에 HF_TOKEN=… 을 넣어 주세요")


def has_hf_token() -> bool:
    try:
        load_hf_token()
        return True
    except SidecarError:
        return False


# ── API 키 ─────────────────────────────────────────────────────────────────────────────────


def _read_key_file() -> tuple[bool, Optional[str]]:
    """(파일이 있는가, 저장된 키). 링크는 따라가지 않고, 있는 파일은 읽기 전에 600으로 바로잡는다."""
    try:
        fd = os.open(KEY_FILE, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return False, None
    except OSError as e:
        raise SystemExit(f"키 파일을 열 수 없어요 ({KEY_FILE}): {e.strerror}. 링크이면 지우고 다시 켜 주세요") from e
    with os.fdopen(fd, "r", encoding="utf-8") as f:
        try:
            os.fchmod(f.fileno(), 0o600)
        except PermissionError as e:
            raise SystemExit(f"키 파일이 다른 사용자 것이라 권한을 바로잡지 못해요 ({KEY_FILE}). 지우고 다시 켜거나 SIDECAR_API_KEY로 키를 주세요") from e
        return True, f.read().strip() or None


def resolve_api_key(host: str) -> Optional[str]:
    """SIDECAR_API_KEY가 있으면 그 키. 127.0.0.1로만 열면 그 밖에는 키 없이 연다(이전에 다른 PC용으로 만든 KEY_FILE이 남아 있어도).
    다른 PC에 열면 KEY_FILE 키를 쓰고, 없으면 새로 만든다."""
    key = os.environ.get("SIDECAR_API_KEY", "").strip()
    if key:
        return key
    if host in LOOPBACK_HOSTS:
        return None
    exists, saved = _read_key_file()
    if saved:
        return saved
    KEY_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    key = "fsv-" + secrets.token_urlsafe(32)
    # 만들 때부터 본인만 읽게 한다(write_text 뒤 chmod하면 그 사이에 다른 사용자가 읽을 수 있다). 링크는 따라가지 않고, 새로 만들 때는 이미 있으면 실패한다
    flags = os.O_WRONLY | os.O_NOFOLLOW | (os.O_TRUNC if exists else os.O_CREAT | os.O_EXCL)
    fd = os.open(KEY_FILE, flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(key + "\n")
    return key


def authorized(header: Optional[str]) -> bool:
    if API_KEY is None:
        return True
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer ") :].strip().encode(), API_KEY.encode())


# ── 엔진 준비 상태 (모델 목록에 같이 보인다) ──────────────────────────────────────────────


def whisper_reachable() -> bool:
    url = urlparse(WHISPER_URL)
    try:
        with socket.create_connection((url.hostname or "127.0.0.1", url.port or 80), timeout=1):
            return True
    except OSError:
        return False


def model_list() -> dict[str, Any]:
    whisper_ok = whisper_reachable()
    notes = {
        "whisper": None if whisper_ok else f"whisper 서버({WHISPER_URL})가 꺼져 있어요",
        "whisper-pyannote": (
            f"whisper 서버({WHISPER_URL})가 꺼져 있어요" if not whisper_ok else None if has_hf_token() else "HF_TOKEN이 없어 화자 분리를 못 해요"
        ),
        "vibevoice": None if Path(VIBEVOICE_MODEL).exists() else "VibeVoice 모델 폴더가 없어요",
    }
    return {
        "object": "list",
        "data": [
            {
                "id": e["id"],
                "object": "model",
                "owned_by": "voice-sidecar",
                "label": e["label"],
                "diarization": e["diarization"],
                "available": notes[e["id"]] is None,
                "note": notes[e["id"]],
            }
            for e in ENGINES
        ],
    }


# ── 엔진 A: whisper.cpp + pyannote ─────────────────────────────────────────────────────────


def whisper_transcribe(wav_path: str, language: str, prompt: Optional[str] = None) -> dict[str, Any]:
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []

    def field(name: str, value: str) -> None:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())

    field("model", "whisper-1")
    field("language", language)
    field("response_format", "verbose_json")
    field("temperature", "0")
    if prompt:
        # 용어 힌트(강종·고객사·참석자 이름 등). whisper.cpp·OpenAI 모두 initial prompt로 쓴다
        field("prompt", prompt)
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
    )
    parts.append(Path(wav_path).read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    request = urllib.request.Request(
        WHISPER_URL,
        data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60 * 60) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise SidecarError(502, f"whisper 서버 오류 (HTTP {e.code})") from e
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise SidecarError(502, f"whisper 서버에 연결할 수 없어요 ({WHISPER_URL})") from e


def get_pipeline() -> Any:
    global _pipeline
    if _pipeline is None:
        import torch  # 무거워서 첫 요청에서 불러온다
        from pyannote.audio import Pipeline

        pipeline = Pipeline.from_pretrained(PYANNOTE_PIPELINE, token=load_hf_token())
        if pipeline is None:
            raise SidecarError(500, "pyannote 모델을 불러올 수 없어요. HF_TOKEN과 모델 약관 동의를 확인해 주세요")
        try:
            pipeline.to(torch.device("mps"))
        except Exception:  # noqa: BLE001 - MPS가 없으면 CPU로 돌린다
            log.warning("MPS를 쓸 수 없어 pyannote를 CPU로 돌려요")
        _pipeline = pipeline
    return _pipeline


def merge_similar_speakers(
    turns: list[tuple[float, float, str]], labels: list[str], centroids: list[list[float]], threshold: Optional[float] = None
) -> list[tuple[float, float, str]]:
    """목소리 중심(임베딩)이 아주 비슷한 화자를 한 사람으로 합친다. 가장 비슷한 쌍부터 하나씩 합치고, 합친 중심은 말한 시간으로 가중 평균한다.
    중심이 없는(0) 화자는 그대로 둔다"""
    limit = SPEAKER_MERGE_SIMILARITY if threshold is None else threshold
    if len(labels) < 2 or len(centroids) != len(labels):
        return turns
    spoken = {label: 0.0 for label in labels}
    for start, end, label in turns:
        if label in spoken:
            spoken[label] += end - start

    def unit(vector: list[float]) -> Optional[list[float]]:
        size = math.sqrt(sum(v * v for v in vector))
        return [v / size for v in vector] if size > 0 else None

    groups: dict[str, tuple[list[float], float]] = {}
    for label, vector in zip(labels, centroids):
        normalized = unit(vector)
        if normalized is not None:
            groups[label] = (normalized, spoken[label])
    owner = {label: label for label in labels}
    while len(groups) > 1:
        keys = list(groups)
        similarity, first, second = max(
            (sum(a * b for a, b in zip(groups[x][0], groups[y][0])), x, y) for i, x in enumerate(keys) for y in keys[i + 1 :]
        )
        if similarity < limit:
            break
        keep, drop = (first, second) if groups[first][1] >= groups[second][1] else (second, first)
        (kv, kd), (dv, dd) = groups[keep], groups[drop]
        total = kd + dd
        mixed = unit([(a * kd + b * dd) / total for a, b in zip(kv, dv)] if total > 0 else [a + b for a, b in zip(kv, dv)])
        groups[keep] = (mixed or kv, total)
        del groups[drop]
        for label, current in owner.items():
            if current == drop:
                owner[label] = keep
    return [(start, end, owner.get(label, label)) for start, end, label in turns]


def pipeline_options(options: Optional[dict[str, int]]) -> tuple[dict[str, int], Optional[int]]:
    """(pyannote에 줄 값, 비슷한 화자를 합칠 상한). 최대 화자 수는 그 수로 나눈 뒤 합치고, 옛 ERP의 정확한 화자 수는 그대로 쓴다"""
    request = dict(options or {})
    limit = request.pop("max_speakers", None)
    if limit:
        request["num_speakers"] = limit
    return request, limit


def diarize(wav_path: str, options: Optional[dict[str, int]] = None) -> list[tuple[float, float, str]]:
    import numpy as np
    import soundfile as sf
    import torch

    audio, sample_rate = sf.read(wav_path, dtype="float32", always_2d=True)
    mono = np.ascontiguousarray(audio.mean(axis=1))
    # 참석자 수를 알려 주면 비슷한 목소리를 한 사람으로 합치는 일이 크게 준다 (45분 시험: 71% → 92%).
    # 다만 정확값으로 나누면 말하지 않은 참석자 몫만큼 한 사람이 둘로 쪼개진다. pyannote의 max_speakers는 비슷한 목소리를 다시 합쳐 버려
    # (합성 34분: 6명 → 4명, 91% → 72%) 상한 수로 나눈 뒤 목소리 중심이 아주 비슷한 화자만 합친다
    request, limit = pipeline_options(options)
    result = get_pipeline()({"waveform": torch.from_numpy(mono).unsqueeze(0), "sample_rate": sample_rate}, **request)
    annotation = getattr(result, "speaker_diarization", result)
    turns = [(float(turn.start), float(turn.end), str(speaker)) for turn, _, speaker in annotation.itertracks(yield_label=True)]
    embeddings = getattr(result, "speaker_embeddings", None)
    if limit and embeddings is not None:
        turns = merge_similar_speakers(turns, [str(label) for label in annotation.labels()], [[float(v) for v in row] for row in embeddings])
    return turns


def assign_speakers(segments: list[dict[str, Any]], turns: list[tuple[float, float, str]]) -> list[Optional[str]]:
    """구간마다 시간이 가장 많이 겹치는 화자. 겹치는 화자가 없으면 가장 가까운 화자."""
    labels: list[Optional[str]] = []
    for seg in segments:
        start, end = float(seg["start"]), float(seg["end"])
        overlap: dict[str, float] = {}
        for t_start, t_end, speaker in turns:
            common = min(end, t_end) - max(start, t_start)
            if common > 0:
                overlap[speaker] = overlap.get(speaker, 0.0) + common
        if overlap:
            labels.append(max(overlap, key=lambda k: overlap[k]))
        elif turns:
            labels.append(min(turns, key=lambda t: max(t[0] - end, start - t[1], 0.0))[2])
        else:
            labels.append(None)
    return labels


def whisper_words(raw_segment: dict[str, Any]) -> list[dict[str, Any]]:
    """whisper.cpp verbose_json의 낱말 시각. 낱말을 이으면 구간 글과 같을 때만 쓴다 (다르면 나눌 때 글이 바뀐다)"""
    words: list[dict[str, Any]] = []
    for w in raw_segment.get("words") or []:
        try:
            words.append({"word": str(w["word"]), "start": float(w["start"]), "end": float(w["end"])})
        except (KeyError, TypeError, ValueError):
            return []
    return words if "".join(w["word"] for w in words).strip() == str(raw_segment.get("text", "")).strip() else []


def whisper_segments(raw: dict[str, Any]) -> list[dict[str, Any]]:
    segments = [
        {"start": float(s.get("start", 0.0)), "end": float(s.get("end", 0.0)), "text": str(s.get("text", "")).strip(), "words": whisper_words(s)}
        for s in raw.get("segments", [])
        if str(s.get("text", "")).strip()
    ]
    if not segments and str(raw.get("text", "")).strip():
        segments = [{"start": 0.0, "end": float(raw.get("duration") or 0.0), "text": str(raw["text"]).strip(), "words": []}]
    return segments


# 한 구간 안에서 화자가 바뀌어도 이보다 짧은 덩이(초·낱말 수)는 앞뒤 화자에 붙인다 (낱말 시각은 수백 ms 어긋날 수 있다)
SPLIT_MIN_SEC = 1.0
SPLIT_MIN_WORDS = 2


def split_by_speaker(segments: list[dict[str, Any]], turns: list[tuple[float, float, str]]) -> list[dict[str, Any]]:
    """whisper는 말이 이어지면 두 사람의 말을 한 구간으로 묶기도 한다. 낱말마다 화자를 보고 화자가 바뀌는 곳에서 구간을 나눈다.
    나뉜 구간에는 speaker를 붙여 돌려주고, 나누지 않은 구간은 그대로(speaker 없이) 둔다"""
    result: list[dict[str, Any]] = []
    for seg in segments:
        words = seg.get("words") or []
        runs = speaker_runs(words, turns) if len(words) >= 2 * SPLIT_MIN_WORDS else []
        if len(runs) < 2:
            result.append(seg)
            continue
        for index, (label, run) in enumerate(runs):
            result.append(
                {
                    "start": seg["start"] if index == 0 else round(run[0]["start"], 2),
                    "end": seg["end"] if index == len(runs) - 1 else round(run[-1]["end"], 2),
                    "text": "".join(w["word"] for w in run).strip(),
                    "words": run,
                    "speaker": label,
                }
            )
    return result


def speaker_runs(words: list[dict[str, Any]], turns: list[tuple[float, float, str]]) -> list[tuple[str, list[dict[str, Any]]]]:
    """같은 화자가 이어 말한 낱말 덩이들. 화자를 모르는 낱말과 너무 짧은 덩이는 앞(없으면 뒤) 덩이에 붙인다"""
    labels: list[Optional[str]] = []
    for w in words:
        overlap: dict[str, float] = {}
        for t_start, t_end, speaker in turns:
            common = min(w["end"], t_end) - max(w["start"], t_start)
            # 시각이 한 점인 낱말도 그 시각을 덮는 화자를 찾는다
            if common > 0 or t_start <= w["start"] <= t_end:
                overlap[speaker] = overlap.get(speaker, 0.0) + max(common, 0.0)
        labels.append(max(overlap, key=lambda k: overlap[k]) if overlap else None)
    runs: list[tuple[Optional[str], list[dict[str, Any]]]] = []
    for w, label in zip(words, labels):
        if runs and (label is None or label == runs[-1][0]):
            runs[-1][1].append(w)
        else:
            runs.append((label, [w]))
    merged: list[tuple[Optional[str], list[dict[str, Any]]]] = []
    for label, run in runs:
        short = len(run) < SPLIT_MIN_WORDS or run[-1]["end"] - run[0]["start"] < SPLIT_MIN_SEC
        if merged and (short or label is None or label == merged[-1][0]):
            merged[-1][1].extend(run)
        else:
            merged.append((label, list(run)))
    # 맨 앞 덩이가 짧거나 화자를 모르면 다음 덩이에 붙인다
    if len(merged) > 1:
        first_label, first_run = merged[0]
        if first_label is None or len(first_run) < SPLIT_MIN_WORDS or first_run[-1]["end"] - first_run[0]["start"] < SPLIT_MIN_SEC:
            merged[1] = (merged[1][0], first_run + merged[1][1])
            merged.pop(0)
    return [(label, run) for label, run in merged if label is not None]


def no_progress(stage: str, current: int, total: int) -> None:
    del stage, current, total


def whisper_with_retry(path: str, language: str, prompt: Optional[str], quick: bool) -> dict[str, Any]:
    """조각 하나를 받아쓴다. 엔진 차례는 이 호출 동안만 쥔다. 긴 전사는 whisper 서버가 잠깐 끊겨도 처음부터 다시 하지 않게 한 번 더 해 본다"""
    attempts = 1 if quick else 2
    for attempt in range(1, attempts + 1):
        try:
            with engine_gate.hold(quick, QUICK_WAIT_SEC if quick else None):
                return whisper_transcribe(path, language, prompt)
        except SidecarError as e:
            if e.status != 502 or attempt == attempts:
                raise
            log.warning("whisper 조각 실패, 다시 해요: %s", e.message)
            time.sleep(WHISPER_RETRY_DELAY_SEC)
    raise SidecarError(502, "whisper 서버 오류")


def transcribe_chunks(
    wav_path: str, chunks: list[tuple[float, float]], language: str, prompt: Optional[str], quick: bool, progress: Progress, tmp_dir: str
) -> list[dict[str, Any]]:
    """조각마다 받아써 회의 전체 시각으로 옮겨 잇는다. 조각 파일은 받아쓴 뒤 바로 지운다"""
    segments: list[dict[str, Any]] = []
    for index, (start, end) in enumerate(chunks):
        progress("transcribe", index + 1, len(chunks))
        path = wav_path
        if len(chunks) > 1:
            path = os.path.join(tmp_dir, f"chunk-{index}.wav")
            write_chunk(wav_path, path, start, end)
        try:
            raw = whisper_with_retry(path, language, prompt, quick)
        finally:
            if path != wav_path:
                os.remove(path)
        for seg in whisper_segments(raw):
            words = [{"word": w["word"], "start": w["start"] + start, "end": w["end"] + start} for w in seg["words"]]
            segments.append({"start": round(seg["start"] + start, 2), "end": round(seg["end"] + start, 2), "text": seg["text"], "words": words})
    return segments


def run_whisper_engine(
    wav_path: str,
    language: str,
    *,
    diarization: bool,
    speakers: Optional[dict[str, int]] = None,
    prompt: Optional[str] = None,
    progress: Progress = no_progress,
    tmp_dir: Optional[str] = None,
) -> tuple[list[dict[str, Any]], float]:
    """whisper(받아쓰기)와 whisper-pyannote(받아쓰기 + 화자). 긴 녹음은 말소리부터 찾고(화자 분리 또는 소리 크기) 말 없는 곳에서 조각을 나눈다"""
    duration = wav_duration(wav_path)
    work_dir = tmp_dir or os.path.dirname(wav_path)
    if duration < SHORT_AUDIO_SEC:
        # ERP의 연결 확인(1초 무음)처럼 짧은 소리는 화자를 나눌 것이 없어 pyannote를 올리지 않는다 (첫 확인이 1분 가까이 걸렸다)
        segments = transcribe_chunks(wav_path, [(0.0, duration)], language, prompt, True, progress, work_dir)
        for seg in segments:
            seg["speaker"] = "SPEAKER_1" if diarization else None
        return segments, duration

    quick = duration < QUICK_AUDIO_SEC
    turns: Optional[list[tuple[float, float, str]]] = None
    gaps: list[tuple[float, float]] = []
    if not quick:
        if diarization:
            # 회의 전체를 한 번에 나눠야 조각이 달라도 같은 사람이 같은 화자로 이어진다. whisper.cpp 차례는 쥐지 않아 그동안 부르기 조각이 지나간다
            progress("diarize", 1, 1)
            with diarize_lock:
                turns = diarize(wav_path, speakers)
            if not turns:
                return [], duration
            gaps = gaps_between(turns, duration)
        else:
            gaps, speech_sec = quiet_gaps(frame_levels(wav_path))
            if speech_sec < MIN_SPEECH_SEC:
                return [], duration

    segments = transcribe_chunks(wav_path, plan_chunks(duration, gaps), language, prompt, quick, progress, work_dir)
    if not diarization:
        for seg in segments:
            seg["speaker"] = None
        return segments, duration
    if turns is None:
        with diarize_lock:
            turns = diarize(wav_path, speakers) if segments else []
    segments = split_by_speaker(segments, turns)
    labels = renumber([seg.get("speaker") or assigned for seg, assigned in zip(segments, assign_speakers(segments, turns))]) if segments else []
    for seg, label in zip(segments, labels):
        seg["speaker"] = label
    return segments, duration


# ── 엔진 B: VibeVoice-ASR (MLX) ────────────────────────────────────────────────────────────


def get_vibevoice() -> Any:
    global _vibevoice
    if _vibevoice is None:
        if not Path(VIBEVOICE_MODEL).exists():
            raise SidecarError(500, f"VibeVoice 모델 폴더가 없어요: {VIBEVOICE_MODEL}")
        from mlx_audio.stt.utils import load_model

        _vibevoice = load_model(VIBEVOICE_MODEL)
    return _vibevoice


def run_vibevoice(wav_path: str, progress: Progress = no_progress) -> tuple[list[dict[str, Any]], float]:
    quick = wav_duration(wav_path) < QUICK_AUDIO_SEC
    progress("transcribe", 1, 1)
    # 한 모델이 전사와 화자 분리를 한 번에 해 나누지 않는다. 메모리가 커 다른 엔진과 겹치지 않게 둘 다 쥔다
    with engine_gate.hold(quick, QUICK_WAIT_SEC if quick else None), diarize_lock:
        output = get_vibevoice().generate(wav_path, max_tokens=VIBEVOICE_MAX_TOKENS, verbose=False)
    segments: list[dict[str, Any]] = []
    raw_labels: list[Optional[str]] = []
    for s in output.segments or []:
        text = str(s.get("text", "")).strip()
        if not text:
            continue
        try:
            start, end = float(s.get("start", 0.0)), float(s.get("end", 0.0))
        except (TypeError, ValueError):
            start, end = 0.0, 0.0
        segments.append({"start": start, "end": end, "text": text})
        speaker = s.get("speaker_id")
        raw_labels.append(None if speaker is None else str(speaker))
    for seg, label in zip(segments, renumber(raw_labels)):
        seg["speaker"] = label
    return segments, segments[-1]["end"] if segments else 0.0


# ── HTTP ───────────────────────────────────────────────────────────────────────────────────


def read_upload(handler: BaseHTTPRequestHandler, tmp: str) -> tuple[dict[str, str], str]:
    """요청 본문을 임시 폴더에 받아 글 칸과 16kHz 모노 WAV 경로를 돌려준다"""
    body_path, upload_path, wav_path = (os.path.join(tmp, n) for n in ("body.bin", "upload.bin", "audio.wav"))
    _read_body_to_file(handler, body_path)
    fields, has_file = parse_multipart(body_path, handler.headers.get("Content-Type", ""), upload_path)
    os.remove(body_path)
    if not has_file:
        raise SidecarError(400, "file 칸에 오디오를 넣어 주세요")
    to_wav16k_mono(upload_path, wav_path)
    os.remove(upload_path)
    return fields, wav_path


def engine_of(fields: dict[str, str]) -> str:
    engine = (fields.get("model") or "whisper-pyannote").strip()
    if engine in ("", "whisper-1"):
        engine = "whisper-pyannote"
    if engine not in ENGINE_IDS:
        raise SidecarError(400, f"model은 {', '.join(ENGINE_IDS)} 중 하나여야 해요 (받은 값: {engine})")
    return engine


def run_transcription(fields: dict[str, str], wav_path: str, tmp: str, progress: Progress = no_progress) -> dict[str, Any]:
    engine = engine_of(fields)
    language = (fields.get("language") or "ko").strip() or "ko"
    started = time.time()
    if engine == "vibevoice":
        segments, duration = run_vibevoice(wav_path, progress)
    else:
        segments, duration = run_whisper_engine(
            wav_path,
            language,
            diarization=engine == "whisper-pyannote",
            speakers=speaker_options(fields),
            prompt=clean_prompt(fields.get("prompt")),
            progress=progress,
            tmp_dir=tmp,
        )
    log.info("%s: 구간 %d개, %.1f초 걸림", engine, len(segments), time.time() - started)

    if fields.get("response_format") == "json":
        return {"text": " ".join(s["text"] for s in segments)}
    return {
        "task": "transcribe",
        "language": language,
        "duration": duration,
        "text": " ".join(s["text"] for s in segments),
        "segments": [
            {"id": i, "start": s["start"], "end": s["end"], "text": s["text"], "speaker": s.get("speaker")}
            for i, s in enumerate(segments)
        ],
    }


class ClientGone(Exception):
    """진행을 보내다 ERP가 연결을 끊었다 (제한 시간·서버 종료). 남은 조각을 받아쓰지 않고 멈춘다"""


class Handler(BaseHTTPRequestHandler):
    server_version = "VoiceSidecar/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - 요청 줄만 남긴다 (본문·음성은 남기지 않는다)
        log.info("%s %s", self.command, self.path)

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _deny(self) -> bool:
        """키가 틀리면 401로 끊는다. 본문을 읽기 전에 막아 큰 파일을 받지 않는다"""
        if authorized(self.headers.get("Authorization")):
            return False
        self.close_connection = True
        self._send(401, {"error": {"message": "API 키가 맞지 않아요"}})
        return True

    def _line(self, payload: dict[str, Any]) -> None:
        try:
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\n")
            self.wfile.flush()
        except OSError as e:
            raise ClientGone() from e

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/health":
            # 받아쓰는 중인 긴 녹음 수: ERP가 음성 서버를 다시 켜기 전에 확인을 받는다 (내용은 알리지 않는다)
            self._send(200, {"status": "ok", "transcribing": active_long_jobs()})
        elif path in ("/v1/models", "/models"):
            if not self._deny():
                self._send(200, model_list())
        else:
            self._send(404, {"error": {"message": "없는 경로예요"}})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] not in ("/v1/audio/transcriptions", "/audio/transcriptions"):
            self._send(404, {"error": {"message": "없는 경로예요"}})
            return
        if self._deny():
            return
        tmp = tempfile.mkdtemp(prefix="voice-sidecar-")
        try:
            try:
                fields, wav_path = read_upload(self, tmp)
                engine_of(fields)
            except SidecarError as e:
                self._send(e.status, {"error": {"message": e.message}})
                return
            # 짧은 소리는 다시 켜기 확인에 세지 않는다 (부르기 조각은 몇 초면 끝난다)
            with long_job() if wav_duration(wav_path) >= QUICK_AUDIO_SEC else contextlib.nullcontext():
                if fields.get("stream") == "progress":
                    self._stream(fields, wav_path, tmp)
                else:
                    self._respond(fields, wav_path, tmp)
        except Exception as e:  # noqa: BLE001 - 어떤 실패든 JSON 오류로 돌려준다 (내용은 로그에 남기지 않는다)
            log.error("처리 실패: %s", type(e).__name__)
            self._send(500, {"error": {"message": f"사이드카 오류: {type(e).__name__}"}})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _respond(self, fields: dict[str, str], wav_path: str, tmp: str) -> None:
        try:
            self._send(200, run_transcription(fields, wav_path, tmp))
        except SidecarError as e:
            self._send(e.status, {"error": {"message": e.message}})

    def _stream(self, fields: dict[str, str], wav_path: str, tmp: str) -> None:
        """진행과 결과를 한 줄씩 보낸다: {"type":"progress","stage","current","total"} … {"type":"result","result":{…}}.
        머리글을 먼저 보내므로 그 뒤 실패는 {"type":"error","status","message"} 줄로 알린다. 본문 길이를 모르니 다 보내면 연결을 닫는다"""
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        def progress(stage: str, current: int, total: int) -> None:
            self._line({"type": "progress", "stage": stage, "current": current, "total": total})

        try:
            self._line({"type": "result", "result": run_transcription(fields, wav_path, tmp, progress)})
        except ClientGone:
            log.warning("ERP가 연결을 끊어 받아쓰기를 멈췄어요")
        except SidecarError as e:
            with contextlib.suppress(ClientGone):
                self._line({"type": "error", "status": e.status, "message": e.message})
        except Exception as e:  # noqa: BLE001
            log.error("처리 실패: %s", type(e).__name__)
            with contextlib.suppress(ClientGone):
                self._line({"type": "error", "status": 500, "message": f"사이드카 오류: {type(e).__name__}"})


def announce_key(key: Optional[str]) -> None:
    """키는 이 컴퓨터의 터미널에만 보인다. 파일·로그로 가는 실행(자동 시작 등)에는 키를 쓰지 않고 키 파일 위치만 남긴다."""
    if key is None:
        log.info("API 키 없이 열었어요 (이 컴퓨터에서만 쓸 수 있어요)")
        return
    where = "SIDECAR_API_KEY" if os.environ.get("SIDECAR_API_KEY") else str(KEY_FILE)
    if sys.stderr.isatty():
        print(f"\nERP에 넣을 API 키: {key}\n(저장 위치: {where})\n", file=sys.stderr, flush=True)
    else:
        log.info("API 키로 열었어요. 키는 %s 에서 확인해요 (로그에는 남기지 않아요)", where)


def main() -> None:
    global API_KEY
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stderr)
    API_KEY = resolve_api_key(HOST)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("voice-sidecar가 http://%s:%d 에서 기다려요 (엔진: %s)", HOST, PORT, ", ".join(ENGINE_IDS))
    announce_key(API_KEY)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
