# 드래곤볼 PC 연구소

배포 주소: https://dragonball-pc.vercel.app — 가격표와 빌더는 누구나 볼 수 있고, AI·웹 조사 기능은 접근 코드(`shoppingMall/.env`의 `SITE_ACCESS_CODE`)가 있어야 쓸 수 있습니다.

새 컴퓨터 조립용 부품 최저가 조사와 가성비 꿀조합("드래곤볼")을 찾는 사이트입니다. 로컬에서 실행할 수 있고, Vercel(Hobby, 서울 리전 `icn1`)에 배포할 수 있습니다.

## 폴더 구조

```
pc-build/
├─ public/                   # 정적 사이트 (Vercel outputDirectory)
│  ├─ index.html, app.js, style.css, vendor/
│  └─ data/parts.json        # 수집한 부품 가격 (collect.py가 생성)
├─ api/
│  ├─ index.py               # Vercel Python 함수 진입점 (모든 /api/* 처리)
│  ├─ _core.py               # 공용 로직: 접근 코드, 요청 제한, 다나와·Firecrawl·Gemini 호출
│  └─ _kskill_danawa.py      # k-skill 다나와 헬퍼 (MIT, LICENSES/k-skill-MIT.txt)
├─ web/server.py             # 로컬 개발 서버 (public/ 제공 + /api/* 처리)
├─ scripts/collect.py        # 다나와 부품 가격 수집기
├─ data/
│  ├─ collection_log.json    # 수집 시각, 소스 상태, 검색어 목록
│  ├─ raw/danawa/<카테고리>/  # 검색·쇼핑몰 가격 원본 (search_*.json, offers_*.json)
│  └─ processed/             # all_candidates.csv, 카테고리별 CSV (엑셀로 열림)
├─ vercel.json, requirements.txt, .python-version
└─ start-site.bat            # 더블클릭하면 로컬 사이트 실행
```

## 환경 변수

로컬에서는 `shoppingMall/.env`(또는 `pc-build/.env`)에서 읽고, Vercel에서는 프로젝트 환경 변수로 넣습니다. `.env`는 저장소에 올리지 않습니다(`.gitignore`).

| 키 | 용도 |
|---|---|
| `SITE_ACCESS_CODE` | 사이트 접근 코드. 다나와 실시간 조회와 AI 기능은 요청 헤더 `X-Access-Code`가 이 값과 같아야 동작합니다. **비어 있으면 해당 기능은 모두 잠깁니다.** 길고 무작위인 값을 쓰세요. |
| `FIRECRAWL_API_KEY` | 웹 리서치, 유튜브 영상 검색 (firecrawl.dev) |
| `GOOGLE_API_KEY` | Gemini 요약·조합 평가 (Google AI Studio) |
| `GEMINI_MODEL` | 먼저 시도할 Gemini 모델 (기본 `gemini-flash-latest`) |
| `GEMINI_FALLBACK_MODELS` | (선택) 다음으로 쓸 모델, 쉼표 구분. 기본 `gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite` |
| `AI_GLOBAL_PER_10MIN` | (선택) 모든 사용자 합산 AI·웹 검색 요청 한도, 10분당. 기본 120 |
| `VIDEO_PER_DAY` | (선택) 모든 사용자 합산 유튜브 영상 요약 한도, 하루당(캐시 적중 제외). 기본 150 |
| `DANAWA_LIVE` | (선택) `0`이면 다나와 실시간 조회를 끄고 화면에 안내를 띄웁니다. 배포판(Vercel)은 `0`으로 둡니다. 기본 켜짐 |

키는 서버에서만 쓰고 브라우저나 응답, 로그에 내보내지 않습니다. 값을 바꾼 뒤에는 로컬 서버를 재시작하거나 Vercel을 다시 배포하세요.

## 로컬 실행

1. 의존성: `py -m pip install -r requirements.txt` (BeautifulSoup, 다나와 파싱용)
2. 실행: `start-site.bat` 더블클릭, 또는 `py -X utf8 web/server.py` → http://127.0.0.1:8000 (`PORT`로 변경)

로컬 서버는 127.0.0.1에만 열리고, 다른 사이트에서 보낸 요청은 거절합니다.

## 데이터 갱신

- `py -X utf8 scripts/collect.py`: 이전에 받은 원본은 재사용하고 빈 항목만 다나와에서 새로 받습니다(예전 8개 상한으로 잘려 일반결제 오퍼가 없는 쇼핑몰 가격 원본도 다시 받음). 모두 새로 받으려면 `--fresh`.
- `py -X utf8 scripts/collect.py --rebuild-only`: 네트워크 없이 `data/raw` 원본으로 CSV와 `public/data/parts.json`만 다시 만듭니다.
- 결과가 비었거나 이전보다 절반 미만이면 기존 파일을 덮어쓰지 않고 실패(종료 코드 1)로 끝납니다.
- 완제품 PC·노트북(제목에 조립PC/노트북 등, 스펙에 OS 표기)은 제외합니다. 검색어는 `collect.py`의 `QUERIES`에서 바꿉니다.
- 갱신 후 `public/data/parts.json`을 커밋하면 배포 사이트에도 반영됩니다.

## Vercel 배포

- 저장소 루트 = `pc-build`. Framework Preset은 Other(`vercel.json`의 `framework: null`), 빌드 명령 없음, 출력 폴더 `public`.
- `/api/*`는 리라이트로 `api/index.py` 하나가 처리합니다. 최대 실행 시간 300초, 리전 `icn1`.
- Python 3.14(`.python-version`), 의존성은 `requirements.txt`(beautifulsoup4, soupsieve).
- 환경 변수 4개(`SITE_ACCESS_CODE`, `FIRECRAWL_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_MODEL`)를 Production(필요하면 Preview에도)에 넣고 다시 배포하세요.
- 배포 후 `/api/status`가 `{"ok": true, "locked": true, ...}`를 돌려주는지 확인합니다.
- 다나와는 Vercel(데이터센터) IP의 접속을 403으로 막습니다(2026-10-13 확인, 서울 리전 포함). 차단을 우회하지 않고, 배포판은 `DANAWA_LIVE=0`으로 실시간 조회를 끈 채 수집해 둔 가격표(`parts.json`)를 보여줍니다. 실시간 조회는 로컬 실행에서 씁니다.
- 가격 갱신 흐름: 내 PC에서 `scripts/collect.py` 실행 → `public/data/parts.json` 커밋·푸시 → Vercel이 다시 배포(GitHub 연결 시 자동, 아니면 `vercel deploy --prod`).
- GitHub 자동 배포를 쓰려면 Vercel GitHub 앱이 이 저장소에 접근할 수 있어야 합니다(github.com/settings/installations → Vercel → Repository access에 `dragonball-pc` 추가). 그다음 `vercel git connect`.

## API

모든 응답은 JSON입니다. 오류는 `{"error": "<한국어 메시지>", "code": "<코드>"}` 형식입니다.

| 경로 | 설명 |
|---|---|
| `GET /api/status` | 공개. 잠금 여부와 기능 설정 상태 |
| `POST /api/auth/check` | 접근 코드 확인 |
| `GET /api/danawa/search?q=` | 다나와 실시간 검색 (2~60자) |
| `GET /api/danawa/offers?pcode=` | 쇼핑몰별 가격 (숫자 상품 코드) |
| `POST /api/research` | `{query, summarize}` 웹 검색 5건, 요약은 선택 |
| `POST /api/page/summary` | `{url, question}` 웹 페이지(유튜브면 영상) 요약 |
| `POST /api/youtube/search` | `{query}` 유튜브 리뷰 영상 검색 |
| `POST /api/youtube/summary` | `{url}` 유튜브 영상 요약 (앞 20분 기준) |
| `POST /api/build/advise` | `{purpose, budget, parts}` 조합 평가 |

`/api/status`를 뺀 모든 경로는 `X-Access-Code` 헤더가 필요합니다(없거나 틀리면 401, 서버에 코드가 없으면 503). IP별 요청 제한(AI 기능 10분 30회, 다나와 10분 90회, IPv6는 /64 단위로 셈), 전체 합산 제한(AI 기능 10분 120회, 영상 요약 하루 150회), 초과 시 429, 본문 64KB 제한(413)이 있습니다. Gemini는 모델이 막히면 다음 모델로 넘어가며, 요청 하나당 약 4분 안에 끝냅니다.

## 비용 보호 (꼭 설정하세요)

코드 안의 요청 제한(IP별·전체 합산)은 Vercel 함수 인스턴스 메모리에 있어 **인스턴스마다 따로 셉니다.** 동시에 여러 인스턴스가 뜨거나 재시작되면 한도가 새로 시작되므로, 비용의 확실한 상한이 아닙니다. 실제 비용 방어는 코드 밖에서 하세요.

- **Gemini**: Google Cloud Console(또는 AI Studio)에서 해당 API 키 프로젝트에 분당·일일 요청 할당량을 낮게 설정하고, 결제 계정에 예산 알림(가능하면 상한)을 겁니다.
- **Firecrawl**: 요금제의 크레딧 한도를 확인하고, 자동 충전은 끄거나 상한을 둡니다.
- **접근 코드 유출 시**: Vercel 프로젝트 환경 변수에서 `SITE_ACCESS_CODE`를 새 값으로 바꾸고 바로 다시 배포합니다. 이전 코드는 그 즉시 막힙니다.

## 탭별 기능

- **부품 가격표**: 수집한 다나와 가격. 일반결제 최저가와 현금·조건부 최저가를 따로 보여 주고, 실시간 검색과 쇼핑몰별 가격 조회도 됩니다.
- **드래곤볼 빌더**: 예산 안에서 CPU×GPU 조합을 계산해 최고 성능 조합을 추천하고, 소켓·파워 용량 호환성을 검사하며, Gemini가 조합을 평가합니다.
- **웹 리서치**: Firecrawl로 벤치마크·비교 글을 찾고 Gemini가 출처 번호를 붙여 요약합니다.
- **유튜브 리뷰**: 리뷰 영상을 찾고 Gemini가 영상을 직접 보고 요약합니다.

## 참고 / 한계

- 가격은 수집 시점 다나와 공개 가격비교 기준이며, 회원 쿠폰·옵션 추가금은 반영되지 않습니다.
- 성능 점수는 대략적인 게이밍 티어 값입니다(`app.js`). 정확한 수치는 웹 리서치나 유튜브 탭에서 확인하세요.
- 캐시는 서버 인스턴스 메모리에만 있어 Vercel에서는 인스턴스마다 따로 둡니다.
- k-skill의 네이버 쇼핑·쿠팡 프록시는 수집 시점에 오류(네이버 404, 쿠팡 403)라 데이터가 없습니다. 수집기는 실행할 때마다 상태를 확인하고, 복구되면 `data/raw/naver`, `data/raw/coupang`에 저장합니다.
- 개인 조회 용도입니다. 요청 사이에 지연을 두며, 대량·고빈도 수집에는 쓰지 마세요.

## 라이선스

`api/_kskill_danawa.py`는 [k-skill](https://github.com/NomaDamas/k-skill)(NomaDamas, MIT)의 `danawa-price-search` 헬퍼를 가져와 조금 고친 것입니다. 전문은 `LICENSES/k-skill-MIT.txt`에 있습니다.
