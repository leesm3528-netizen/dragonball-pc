"""Vercel Python 함수 진입점. vercel.json 리라이트로 모든 /api/* 요청이 여기로 온다."""
import os
import sys
from http.server import BaseHTTPRequestHandler

# Vercel은 이 파일을 spec_from_file_location으로 불러오므로 api/를 직접 import 경로에 넣는다
_here = os.path.dirname(os.path.abspath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

import _core  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        _core.serve(self, "GET")

    def do_POST(self):
        _core.serve(self, "POST")

    def _not_allowed(self):
        _core.send_json(self, 405, {"error": "허용되지 않는 요청 방식입니다.", "code": "method_not_allowed"})

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _not_allowed
