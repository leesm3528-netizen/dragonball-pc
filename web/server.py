"""드래곤볼 PC 연구소 로컬 개발 서버 (배포에는 쓰지 않음).

- public/ 을 정적으로 제공하고, /api/* 는 api/_core.py 로 넘긴다 (Vercel 함수와 같은 로직).
- 127.0.0.1 에만 바인딩. 다른 사이트에서의 요청(DNS 리바인딩·교차 출처)은 막는다.

실행:  py -X utf8 pc-build/web/server.py   ->  http://127.0.0.1:8000  (PORT 환경변수로 변경)
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PORT = int(os.environ.get("PORT", "8000"))
sys.path.insert(0, str(ROOT / "api"))

import _core  # noqa: E402

ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _foreign(self):
        host = (self.headers.get("Host") or "").lower()
        origin = self.headers.get("Origin")
        cross = (self.headers.get("Sec-Fetch-Site") or "").lower() == "cross-site"
        if host not in ALLOWED_HOSTS or cross or (origin and origin not in {f"http://{h}" for h in ALLOWED_HOSTS}):
            _core.send_json(self, 403, {"error": "허용되지 않은 요청입니다.", "code": "forbidden"})
            return True
        return False

    def do_GET(self):
        if self.path.startswith("/api/"):
            if not self._foreign():
                _core.serve(self, "GET")
            return
        return super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/"):
            return _core.send_json(self, 405, {"error": "허용되지 않는 요청 방식입니다.", "code": "method_not_allowed"})
        return super().do_HEAD()

    def do_POST(self):
        if not self.path.startswith("/api/"):
            return _core.send_json(self, 404, {"error": "요청한 API가 없습니다.", "code": "not_found"})
        if not self._foreign():
            _core.serve(self, "POST")


def main():
    if not PUBLIC.is_dir():
        sys.exit(f"public 폴더가 없습니다: {PUBLIC}")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"드래곤볼 PC 연구소: http://127.0.0.1:{PORT}")
    print(f"  접근 코드: {'설정됨' if _core.access_code() else '없음 (AI·다나와 기능 잠김)'} / "
          f"Firecrawl: {'ON' if _core.firecrawl_key() else 'OFF'} / Gemini: {'ON' if _core.google_key() else 'OFF'}"
          f" / 다나와: {'ON' if _core.dw else 'OFF (pip install beautifulsoup4)'}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
