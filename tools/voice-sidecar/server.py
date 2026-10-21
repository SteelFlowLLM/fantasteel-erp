#!/usr/bin/env python3
"""Voice2ERP 화자 분리 사이드카 (개발용 도구, 파이썬 표준 라이브러리 서버).

ERP 서버가 부르는 OpenAI 호환 `POST /v1/audio/transcriptions`를 흉내 내되, 응답 구간에 `speaker`를 붙인다.
  model=whisper-pyannote (기본)  whisper.cpp 서버(전사) + pyannote(화자 분리)를 시간 겹침으로 합친다
  model=whisper                  whisper.cpp 서버로 받아쓰기만 한다 (화자 없음, 빠름)
  model=vibevoice                VibeVoice-ASR MLX 4-bit 한 모델이 전사와 화자 분리를 한 번에 한다
`GET /v1/models`는 위 셋을 화면에 보일 이름과 함께 알려 준다.

API 키(`Authorization: Bearer …`): 키가 있으면 모든 /v1 요청에 요구한다. 다른 PC에 열 때(SIDECAR_HOST가 127.0.0.1이 아닐 때)는
키가 꼭 있어야 하고, 없으면 만들어 KEY_FILE에 둔다. whisper.cpp에는 키 기능이 없어 그쪽은 127.0.0.1에만 열고 밖에는 이 서버만 연다.

음성은 임시 파일로만 다루고 요청이 끝나면(성공이든 실패든) 모두 지운다 (BP-VOC-01).
실행: ~/voice-env/bin/python tools/voice-sidecar/server.py
"""
from __future__ import annotations

import hmac
import json
import logging
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
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

ENGINES: list[dict[str, Any]] = [
    {"id": "whisper-pyannote", "label": "받아쓰기 + 화자 분리 (whisper + pyannote)", "diarization": True},
    {"id": "whisper", "label": "받아쓰기만 (whisper, 빠름)", "diarization": False},
    {"id": "vibevoice", "label": "받아쓰기 + 화자 분리 (VibeVoice, 느림)", "diarization": True},
]
ENGINE_IDS = tuple(e["id"] for e in ENGINES)
REPO_ENV = Path(__file__).resolve().parents[2] / "server" / ".env"

log = logging.getLogger("voice-sidecar")

# 엔진은 한 번에 요청 하나만 돌린다: GPU 메모리를 나눠 쓰는 모델 둘을 겹쳐 부르지 않는다
engine_lock = threading.Lock()
_pipeline: Any = None
_vibevoice: Any = None
API_KEY: Optional[str] = None


class SidecarError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


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


def resolve_api_key(host: str) -> Optional[str]:
    """SIDECAR_API_KEY → KEY_FILE 순서. 다른 PC에 열면서 둘 다 없으면 새로 만들어 KEY_FILE에 둔다(본인만 읽기)."""
    key = os.environ.get("SIDECAR_API_KEY", "").strip()
    if key:
        return key
    if KEY_FILE.exists():
        saved = KEY_FILE.read_text(encoding="utf-8").strip()
        if saved:
            return saved
    if host in LOOPBACK_HOSTS:
        return None
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    key = "fsv-" + secrets.token_urlsafe(32)
    KEY_FILE.write_text(key + "\n", encoding="utf-8")
    KEY_FILE.chmod(0o600)
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


def whisper_transcribe(wav_path: str, language: str) -> dict[str, Any]:
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []

    def field(name: str, value: str) -> None:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())

    field("model", "whisper-1")
    field("language", language)
    field("response_format", "verbose_json")
    field("temperature", "0")
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


def diarize(wav_path: str, num_speakers: Optional[int] = None) -> list[tuple[float, float, str]]:
    import numpy as np
    import soundfile as sf
    import torch

    audio, sample_rate = sf.read(wav_path, dtype="float32", always_2d=True)
    mono = np.ascontiguousarray(audio.mean(axis=1))
    # 참석자 수를 알려 주면 비슷한 목소리를 한 사람으로 합치는 일이 크게 준다 (45분 시험: 71% → 92%)
    options = {"num_speakers": num_speakers} if num_speakers else {}
    result = get_pipeline()({"waveform": torch.from_numpy(mono).unsqueeze(0), "sample_rate": sample_rate}, **options)
    annotation = getattr(result, "speaker_diarization", result)
    return [(float(turn.start), float(turn.end), str(speaker)) for turn, _, speaker in annotation.itertracks(yield_label=True)]


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


def whisper_segments(raw: dict[str, Any]) -> list[dict[str, Any]]:
    segments = [
        {"start": float(s.get("start", 0.0)), "end": float(s.get("end", 0.0)), "text": str(s.get("text", "")).strip()}
        for s in raw.get("segments", [])
        if str(s.get("text", "")).strip()
    ]
    if not segments and str(raw.get("text", "")).strip():
        segments = [{"start": 0.0, "end": float(raw.get("duration") or 0.0), "text": str(raw["text"]).strip()}]
    return segments


def whisper_duration(raw: dict[str, Any], segments: list[dict[str, Any]]) -> float:
    return float(raw.get("duration") or (segments[-1]["end"] if segments else 0.0))


def run_whisper(wav_path: str, language: str) -> tuple[list[dict[str, Any]], float]:
    raw = whisper_transcribe(wav_path, language)
    segments = whisper_segments(raw)
    for seg in segments:
        seg["speaker"] = None
    return segments, whisper_duration(raw, segments)


def run_whisper_pyannote(wav_path: str, language: str, num_speakers: Optional[int] = None) -> tuple[list[dict[str, Any]], float]:
    raw = whisper_transcribe(wav_path, language)
    segments = whisper_segments(raw)
    duration = whisper_duration(raw, segments)
    if duration < SHORT_AUDIO_SEC:
        # ERP의 연결 확인(1초 무음)처럼 짧은 소리는 화자를 나눌 것이 없어 pyannote를 올리지 않는다 (첫 확인이 1분 가까이 걸렸다)
        for seg in segments:
            seg["speaker"] = "SPEAKER_1"
        return segments, duration
    labels = renumber(assign_speakers(segments, diarize(wav_path, num_speakers))) if segments else []
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


def run_vibevoice(wav_path: str) -> tuple[list[dict[str, Any]], float]:
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


def transcribe_request(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    tmp = tempfile.mkdtemp(prefix="voice-sidecar-")
    try:
        body_path, upload_path, wav_path = (os.path.join(tmp, n) for n in ("body.bin", "upload.bin", "audio.wav"))
        _read_body_to_file(handler, body_path)
        fields, has_file = parse_multipart(body_path, handler.headers.get("Content-Type", ""), upload_path)
        os.remove(body_path)
        if not has_file:
            raise SidecarError(400, "file 칸에 오디오를 넣어 주세요")
        to_wav16k_mono(upload_path, wav_path)
        os.remove(upload_path)

        engine = (fields.get("model") or "whisper-pyannote").strip()
        if engine in ("", "whisper-1"):
            engine = "whisper-pyannote"
        if engine not in ENGINE_IDS:
            raise SidecarError(400, f"model은 {', '.join(ENGINE_IDS)} 중 하나여야 해요 (받은 값: {engine})")
        language = (fields.get("language") or "ko").strip() or "ko"
        hint = (fields.get("num_speakers") or "").strip()
        num_speakers = int(hint) if hint.isdigit() and 1 <= int(hint) <= 20 else None

        started = time.time()
        # 짧은 소리(ERP 연결 확인)는 긴 회의 전사가 끝날 때까지 기다리지 않고 바로 바쁘다고 알린다 (기다리면 확인이 시간 초과로 끝난다)
        short = (os.path.getsize(wav_path) - 44) / (16000 * 2) < SHORT_AUDIO_SEC
        if not engine_lock.acquire(blocking=not short):
            raise SidecarError(503, "지금 다른 녹음을 받아쓰는 중이에요. 주소·키는 맞으니 끝난 뒤 다시 확인해 주세요")
        try:
            if engine == "vibevoice":
                segments, duration = run_vibevoice(wav_path)
            elif engine == "whisper":
                segments, duration = run_whisper(wav_path, language)
            else:
                segments, duration = run_whisper_pyannote(wav_path, language, num_speakers)
        finally:
            engine_lock.release()
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
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


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

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/health":
            self._send(200, {"status": "ok"})
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
        try:
            self._send(200, transcribe_request(self))
        except SidecarError as e:
            self._send(e.status, {"error": {"message": e.message}})
        except Exception as e:  # noqa: BLE001 - 어떤 실패든 JSON 오류로 돌려준다 (내용은 로그에 남기지 않는다)
            log.error("처리 실패: %s", type(e).__name__)
            self._send(500, {"error": {"message": f"사이드카 오류: {type(e).__name__}"}})


def main() -> None:
    global API_KEY
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stderr)
    API_KEY = resolve_api_key(HOST)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("voice-sidecar가 http://%s:%d 에서 기다려요 (엔진: %s)", HOST, PORT, ", ".join(ENGINE_IDS))
    if API_KEY is None:
        log.info("API 키 없이 열었어요 (이 컴퓨터에서만 쓸 수 있어요)")
    else:
        where = KEY_FILE if not os.environ.get("SIDECAR_API_KEY") else "SIDECAR_API_KEY"
        if sys.stderr.isatty():
            # 이 컴퓨터의 터미널에만 보인다. ERP의 음성 인식 카드 API 키 칸에 넣는다
            print(f"\nERP에 넣을 API 키: {API_KEY}\n(저장 위치: {where})\n", file=sys.stderr, flush=True)
        else:
            # 자동 켜기(launchd)는 로그 파일로 나가므로 키를 남기지 않는다
            log.info("API 키를 요구해요 (키: %s)", where)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
