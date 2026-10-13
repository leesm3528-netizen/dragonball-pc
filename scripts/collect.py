"""PC 부품 최저가 수집기 (k-skill danawa-price-search 헬퍼를 api/_kskill_danawa.py 로 직접 호출).

- 다나와: 검색 + 쇼핑몰별 오퍼(배송비 포함 실구매가) 조회
- 네이버/쿠팡: k-skill-proxy 상태를 1회 점검하고 응답이 정상일 때만 원본 저장
- 결과: data/raw/**, data/processed/*.csv, data/collection_log.json, public/data/parts.json

개인 조회 용도. 요청 사이에 지연을 두고, 검색어당 상위 후보 일부만 오퍼를 조회한다.

실행:  py -X utf8 pc-build/scripts/collect.py              (이전 결과 재사용, 빈 항목만 새로 받음)
       py -X utf8 pc-build/scripts/collect.py --fresh      (모두 새로 받음)
       py -X utf8 pc-build/scripts/collect.py --rebuild-only (네트워크 없이 raw 파일로 결과만 다시 생성)
"""
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
PARTS_JSON = ROOT / "public" / "data" / "parts.json"
LOG = ROOT / "data" / "collection_log.json"
sys.path.insert(0, str(ROOT / "api"))

PROXY = os.environ.get("KSKILL_PROXY_BASE_URL", "https://k-skill-proxy.nomadamas.org")
DELAY = 1.5           # 요청 간 지연(초)
TIMEOUT = 20          # 다나와 요청당 제한 시간(초)
SEARCH_LIMIT = 5      # 검색어당 후보 수(완제품 제외 후)
FETCH_LIMIT = 10      # 필터링 전 검색 결과 수
OFFER_TOP = 3         # 오퍼 조회할 상위 후보 수
OFFER_LIMIT = 40      # 상품당 쇼핑몰 오퍼 수 (상위가 모두 현금가여도 일반결제 최저가를 찾도록 넉넉히)
OLD_OFFER_LIMIT = 8   # 예전 수집본의 오퍼 수 상한
MIN_KEEP = 0.5        # 이전 결과 대비 이 비율 미만이면 실패로 보고 덮어쓰지 않는다

try:
    from zoneinfo import ZoneInfo
    KST = ZoneInfo("Asia/Seoul")
except Exception:
    KST = timezone(timedelta(hours=9))

# 카테고리 -> 검색어 목록 (게이밍 가성비 조합 후보군)
QUERIES = {
    "01_CPU": ["라이젠5 9600X 정품", "라이젠7 9700X 정품", "라이젠7 7800X3D 정품",
               "라이젠7 9800X3D 정품", "인텔 코어i5 14400F 정품", "인텔 코어 울트라5 225F"],
    "02_GPU": ["RTX 5060 Ti 16GB", "RTX 5070 12GB", "RX 9070 XT", "RTX 5070 Ti"],
    "03_메인보드": ["B650M 메인보드", "B850M", "B760M 메인보드 DDR5", "B860M 메인보드"],
    "04_RAM": ["DDR5 6000 32GB", "DDR5 16GB 5600"],
    "05_SSD": ["NVMe SSD 1TB Gen4", "NVMe SSD 2TB Gen4"],
    "06_파워": ["750W 골드 풀모듈러", "850W 골드 풀모듈러"],
    "07_쿨러": ["CPU 공랭 쿨러 듀얼타워", "CPU 공랭 쿨러 싱글타워"],
    "08_케이스": ["미들타워 PC 케이스 강화유리"],
}

FIELDS = ["category", "query", "rank", "pcode", "title", "spec", "url", "search_price",
          "normal_best_total", "normal_best_mall", "normal_best_url",
          "best_total", "best_mall", "best_url", "best_condition",
          "card_price", "card_name", "free_shipping", "installment", "offer_count"]

# 부품이 아닌 완제품/노트북 검색 결과 제외 (api/_core.py 와 같은 규칙)
EXCLUDE = re.compile(r"조립PC|조립컴퓨터|영웅컴퓨터|레보PC|CODEX|AI BOX|노트북|게이밍울트라", re.I)
PREBUILT_SPEC = re.compile(r"OS미포함|윈도우|운영체제|FreeDOS|노트북", re.I)
PCODE = re.compile(r"\d{4,12}")


def is_part(item):
    return not EXCLUDE.search(item.get("title") or "") and not PREBUILT_SPEC.search(item.get("spec") or "")


def kst_now():
    return datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S")


def slug(s: str) -> str:
    return re.sub(r"[^\w가-힣]+", "_", s).strip("_")


def save(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def proxy_get(path, params):
    url = f"{PROXY}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0 k-skill"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"error": f"HTTP {e.code}"}
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}"}


def probe_sources(sample="RTX 5070"):
    nv = proxy_get("/v1/naver-shopping/search", {"q": sample, "limit": 3})
    cp = proxy_get("/v1/coupang/products/search", {"keyword": sample, "limit": 3, "subId": "k-skill"})
    save(RAW / "naver" / "_probe.json", nv)
    save(RAW / "coupang" / "_probe.json", cp)
    return {
        "naver": bool(nv.get("items")) and "error" not in nv,
        "coupang": bool(cp.get("items")),
        "naver_detail": nv.get("message") or nv.get("error") or "ok",
        "coupang_detail": "ok" if cp.get("items") else
                          (cp.get("error") or f"upstream {(cp.get('upstream') or {}).get('response_code')}"),
    }


class Collector:
    def __init__(self, rebuild_only, fresh):
        self.rebuild_only, self.fresh = rebuild_only, fresh
        self.dw = None
        self.max_ts = 0
        if not rebuild_only:
            import _kskill_danawa  # bs4 필요
            self.dw = _kskill_danawa

    def cached(self, path: Path, key: str):
        """이전 실행 결과가 있고 비어 있지 않으면 재사용 (--fresh 면 무시, --rebuild-only 면 항상 사용)."""
        if self.fresh and not self.rebuild_only:
            return None
        data = read_json(path)
        if isinstance(data, dict) and data.get(key):
            self.max_ts = max(self.max_ts, int((data.get("meta") or {}).get("ts") or 0))
            return data
        return None

    def fetch(self, fn, *args, **kw):
        try:
            return fn(*args, timeout=TIMEOUT, **kw)
        finally:
            time.sleep(DELAY)

    def search(self, cat, q):
        path = RAW / "danawa" / cat / f"search_{slug(q)}.json"
        res = self.cached(path, "items")
        if res is not None or self.rebuild_only:
            return res
        # 다나와 검색이 간헐적으로 0건을 반환하므로 재시도 (마지막 시도 뒤에는 기다리지 않음)
        for attempt in range(3):
            try:
                res = self.fetch(self.dw.search, q, limit=FETCH_LIMIT)
            except Exception as e:  # noqa: BLE001
                print(f"  search failed: {type(e).__name__}: {e}", flush=True)
                res = None
            if res and res.get("items"):
                save(path, res)
                self.max_ts = max(self.max_ts, int(time.time()))
                return res
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
        return None

    def offers(self, cat, pcode):
        path = RAW / "danawa" / cat / f"offers_{pcode}.json"
        off = self.cached(path, "offers")
        if self.rebuild_only or (off is not None and not truncated(off)):
            return off
        try:
            new = self.fetch(self.dw.offers, pcode, limit=OFFER_LIMIT)
        except Exception as e:  # noqa: BLE001
            print(f"  offers failed: {pcode} {type(e).__name__}: {e}", flush=True)
            return off
        if not new.get("offers"):
            return off
        new["fetch_limit"] = OFFER_LIMIT
        save(path, new)
        self.max_ts = max(self.max_ts, int(time.time()))
        return new


def truncated(off):
    """예전 상한(8개)으로 잘려 일반결제 오퍼가 하나도 없는 수집본이면 다시 받는다."""
    rows = [o for o in off.get("offers") or [] if isinstance(o, dict)]
    limit = int(off.get("fetch_limit") or OLD_OFFER_LIMIT)
    return (limit < OFFER_LIMIT and len(rows) >= limit
            and not any(not o.get("is_conditional_price") for o in rows))


def build_row(cat, q, rank, item, off):
    row = dict.fromkeys(FIELDS)
    row.update(category=cat, query=q, rank=rank, pcode=item["pcode"], title=item.get("title"),
               spec=item.get("spec"), url=item.get("url"), search_price=item.get("price"))
    offers = [o for o in (off or {}).get("offers") or [] if isinstance(o, dict) and o.get("total_price")]
    if not offers:
        return row
    by_total = sorted(offers, key=lambda o: o["total_price"])
    b = by_total[0]
    row.update(best_total=b["total_price"], best_mall=b.get("mall"), best_url=b.get("url"),
               best_condition=b.get("payment_condition_label") or "일반",
               free_shipping=b.get("is_free_shipping"), installment=b.get("installment"), offer_count=len(offers))
    normal = [o for o in by_total if not o.get("is_conditional_price")]
    if normal:
        n = normal[0]
        row.update(normal_best_total=n["total_price"], normal_best_mall=n.get("mall"), normal_best_url=n.get("url"))
    cards = [o for o in offers if o.get("card_price")]
    if cards:
        c = min(cards, key=lambda o: o["card_price"])
        row.update(card_price=c["card_price"], card_name=c.get("card_name"))
    return row


def write_csv(path: Path, rows):
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def previous_count():
    data = read_json(PARTS_JSON)
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return len(data["items"])
    try:
        with open(OUT / "all_candidates.csv", encoding="utf-8-sig") as f:
            return sum(1 for _ in csv.DictReader(f))
    except OSError:
        return 0


def main():
    rebuild_only = "--rebuild-only" in sys.argv
    started = kst_now()
    try:
        col = Collector(rebuild_only, "--fresh" in sys.argv)
    except ImportError as e:
        print(f"다나와 헬퍼를 불러오지 못했습니다: {e}", file=sys.stderr)
        return 1
    status = None
    if not rebuild_only:
        status = probe_sources()
        print("source status:", status, flush=True)

    rows = []
    for cat, queries in QUERIES.items():
        for q in queries:
            print(f"[{cat}] {q}", flush=True)
            res = col.search(cat, q)
            if res is None:
                print("  no search data")
                continue
            parts = [i for i in res.get("items") or []
                     if isinstance(i, dict) and PCODE.fullmatch(str(i.get("pcode") or "")) and is_part(i)]
            if not parts:
                print("  no part results")
            for rank, item in enumerate(parts[:SEARCH_LIMIT], 1):
                off = col.offers(cat, item["pcode"]) if rank <= OFFER_TOP else None
                rows.append(build_row(cat, q, rank, item, off))

            if status and status["naver"]:
                save(RAW / "naver" / cat / f"{slug(q)}.json",
                     proxy_get("/v1/naver-shopping/search", {"q": q, "limit": 10, "sort": "rel"}))
            if status and status["coupang"]:
                save(RAW / "coupang" / cat / f"{slug(q)}.json",
                     proxy_get("/v1/coupang/products/search", {"keyword": q, "limit": 10, "subId": "k-skill"}))

    prev = previous_count()
    if not rows or len(rows) < prev * MIN_KEEP:
        print(f"수집 결과가 부족합니다 ({len(rows)}행, 이전 {prev}행). 기존 결과를 유지합니다.", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    write_csv(OUT / "all_candidates.csv", rows)
    for cat in QUERIES:
        cat_rows = [r for r in rows if r["category"] == cat]
        if cat_rows:
            write_csv(OUT / f"{cat}.csv", cat_rows)

    collected = (datetime.fromtimestamp(col.max_ts, KST).strftime("%Y-%m-%dT%H:%M:%S")
                 if col.max_ts else kst_now())
    save(PARTS_JSON, {"collected_at": collected, "source": "다나와", "items": rows})
    if not rebuild_only:
        save(LOG, {"started": started, "finished": kst_now(), "collected_at": collected,
                   "source_status": status, "queries": QUERIES, "rows": len(rows)})
    print(f"done: {len(rows)} rows (collected_at {collected})", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
