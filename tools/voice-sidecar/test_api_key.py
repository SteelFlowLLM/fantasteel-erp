"""API 키 정하는 규칙 시험 (표준 라이브러리만): python3 -m unittest discover -s tools/voice-sidecar"""
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


if __name__ == "__main__":
    unittest.main()
