"""API 키 정하는 규칙 시험 (표준 라이브러리만): python3 -m unittest discover -s tools/voice-sidecar"""
import io
import logging
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402


class ResolveApiKeyTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.key_file = Path(tmp.name) / "fantasteel-voice" / "api-key"
        for patcher in (
            mock.patch.object(server, "KEY_FILE", self.key_file),
            mock.patch.dict(os.environ, {}, clear=False),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        os.environ.pop("SIDECAR_API_KEY", None)

    def test_다른_PC에_열면_키를_만들고_처음부터_본인만_읽는다(self) -> None:
        with mock.patch("pathlib.Path.chmod", side_effect=AssertionError("만든 뒤 chmod에 기대면 안 된다")):
            key = server.resolve_api_key("0.0.0.0")
        self.assertTrue(key and key.startswith("fsv-"))
        self.assertEqual(stat.S_IMODE(self.key_file.stat().st_mode), 0o600)
        self.assertEqual(server.resolve_api_key("0.0.0.0"), key)

    def test_이미_있는_키_파일이_느슨하면_600으로_바로잡는다(self) -> None:
        self.key_file.parent.mkdir(parents=True)
        self.key_file.write_text("fsv-saved\n", encoding="utf-8")
        self.key_file.chmod(0o644)
        self.assertEqual(server.resolve_api_key("0.0.0.0"), "fsv-saved")
        self.assertEqual(stat.S_IMODE(self.key_file.stat().st_mode), 0o600)

    def test_127_0_0_1로만_열면_남아_있는_키_파일을_읽지_않는다(self) -> None:
        self.key_file.parent.mkdir(parents=True)
        self.key_file.write_text("fsv-saved\n", encoding="utf-8")
        self.assertIsNone(server.resolve_api_key("127.0.0.1"))

    def test_127_0_0_1이어도_환경변수로_준_키는_쓴다(self) -> None:
        os.environ["SIDECAR_API_KEY"] = "fsv-env"
        self.assertEqual(server.resolve_api_key("127.0.0.1"), "fsv-env")

    def test_127_0_0_1로만_열면_키를_만들지_않는다(self) -> None:
        self.assertIsNone(server.resolve_api_key("127.0.0.1"))
        self.assertFalse(self.key_file.exists())

    def test_키_파일이_링크면_따라가지_않고_알아보기_쉬운_오류로_끝낸다(self) -> None:
        self.key_file.parent.mkdir(parents=True)
        target = self.key_file.parent / "other"
        target.write_text("남의 파일\n", encoding="utf-8")
        target.chmod(0o644)
        self.key_file.symlink_to(target)
        with self.assertRaises(SystemExit) as raised:
            server.resolve_api_key("0.0.0.0")
        self.assertIn("키 파일을 열 수 없어요", str(raised.exception))
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o644)
        self.assertEqual(target.read_text(encoding="utf-8"), "남의 파일\n")

    def test_남의_키_파일이라_권한을_못_바로잡으면_알아보기_쉬운_오류로_끝낸다(self) -> None:
        self.key_file.parent.mkdir(parents=True)
        self.key_file.write_text("fsv-saved\n", encoding="utf-8")
        with mock.patch("os.fchmod", side_effect=PermissionError):
            with self.assertRaises(SystemExit) as raised:
                server.resolve_api_key("0.0.0.0")
        self.assertIn("다른 사용자 것", str(raised.exception))

    def test_비어_있는_키_파일은_같은_파일에_새_키를_쓴다(self) -> None:
        self.key_file.parent.mkdir(parents=True)
        self.key_file.write_text("\n", encoding="utf-8")
        key = server.resolve_api_key("0.0.0.0")
        self.assertEqual(self.key_file.read_text(encoding="utf-8").strip(), key)
        self.assertEqual(stat.S_IMODE(self.key_file.stat().st_mode), 0o600)


class AnnounceKeyTest(unittest.TestCase):
    KEY = "fsv-secret-value"

    def _announce(self, tty: bool) -> str:
        err = io.StringIO()
        err.isatty = lambda: tty  # type: ignore[method-assign]
        handler = logging.StreamHandler(err)
        server.log.addHandler(handler)
        server.log.setLevel(logging.INFO)
        try:
            with mock.patch.object(sys, "stderr", err), mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("SIDECAR_API_KEY", None)
                server.announce_key(self.KEY)
        finally:
            server.log.removeHandler(handler)
        return err.getvalue()

    def test_터미널에는_키를_보인다(self) -> None:
        self.assertIn(self.KEY, self._announce(tty=True))

    def test_파일이나_로그로_가는_실행에는_키를_남기지_않는다(self) -> None:
        out = self._announce(tty=False)
        self.assertNotIn(self.KEY, out)
        self.assertIn(str(server.KEY_FILE), out)


if __name__ == "__main__":
    unittest.main()
