// 드래곤볼 PC 연구소 — 프론트엔드
// 위쪽: DOM 없이 동작하는 순수 함수(테스트 가능). 아래쪽: 화면(init에서만 DOM 접근).

// ================================================================ 상수
const CATS = {
  "01_CPU": "CPU", "02_GPU": "그래픽카드", "03_메인보드": "메인보드", "04_RAM": "RAM",
  "05_SSD": "SSD", "06_파워": "파워", "07_쿨러": "쿨러", "08_케이스": "케이스",
};
const CAT_KEYS = Object.keys(CATS);
// 게이밍 상대 성능 지수 (RTX 5060 Ti·라이젠 9600X급 ≈ 100/70; 위에서부터 먼저 매칭)
const GPU_TIERS = [[/5070\s*Ti/i, 165], [/9070\s*XT/i, 155], [/9070(?!\s*(XT|GRE))/i, 135], [/5070/i, 130],
  [/9060\s*XT/i, 100], [/5060\s*Ti/i, 100], [/5060/i, 80]];
const CPU_TIERS = [[/9800X3D/i, 100], [/7800X3D/i, 90], [/9700X/i, 76], [/9600X/i, 70],
  [/7500F/i, 66], [/225F/i, 64], [/14400F/i, 60]];
const PURPOSES = {
  qhd: { label: "게이밍 (QHD)", gpu: 0.65, cpu: 0.35 },
  fhd: { label: "게이밍 (FHD 고주사율)", gpu: 0.5, cpu: 0.5 },
  stream: { label: "게이밍 + 방송", gpu: 0.55, cpu: 0.45, cores: true },
  work: { label: "작업용 (영상편집/AI)", gpu: 0.5, cpu: 0.5, cores: true, vram: true },
};
const BUDGET_PRESETS = [1500000, 2000000, 2500000, 3000000, 4000000];
const PREBUILT_TITLE = /조립PC|조립컴퓨터|영웅컴퓨터|레보PC|CODEX|AI BOX|노트북|게이밍울트라/i;
const PREBUILT_SPEC = /OS미포함|윈도우|운영체제|FreeDOS|노트북/i;
const RAM_TARGET_GB = 32;

// ================================================================ 순수 헬퍼
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = (n) => (n == null || !isFinite(n) ? "-" : Math.round(Number(n)).toLocaleString("ko-KR") + "원");
const manwon = (n) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
const short = (s, n = 28) => { const t = String(s || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const num = (v) => (v == null || v === "" || !isFinite(+v) ? null : +v);
const clampQty = (q) => Math.min(8, Math.max(1, Math.floor(+q) || 1));
const BASE = typeof location !== "undefined" ? location.href : "https://localhost/";
const safeUrl = (u) => {
  if (!u || String(u).trim().startsWith("#")) return "#";
  try { const x = new URL(String(u), BASE); return /^https?:$/.test(x.protocol) ? x.href : "#"; } catch { return "#"; }
};
const danawaUrl = (pcode) => (/^\d{4,12}$/.test(String(pcode || "")) ? `https://prod.danawa.com/info/?pcode=${pcode}` : null);
const isPart = (p) => !PREBUILT_TITLE.test(p.title || "") && !PREBUILT_SPEC.test(p.spec || "");

// 가격 기준: 현금 토글이 꺼져 있으면 일반결제 최저 → 다나와 표시가 (현금가로 몰래 넘어가지 않음)
const priceOf = (p, cash = false) =>
  cash ? (p.best_total ?? p.normal_best_total ?? p.search_price ?? null)
       : (p.normal_best_total ?? p.search_price ?? null);
const priceBasis = (p, cash = false) => {
  if (cash && p.best_total != null) return p.best_condition && p.best_condition !== "일반" ? "cash" : "normal";
  if (p.normal_best_total != null) return "normal";
  return p.search_price != null ? "display" : "none";
};
const basisLabel = (p, cash = false) => {
  const b = priceBasis(p, cash);
  return b === "normal" ? "일반결제" : b === "cash" ? (p.best_condition || "현금") : b === "display" ? "표시가" : "가격 없음";
};
// 그 가격을 파는 쇼핑몰 링크 (없으면 다나와 상세). 표시가 기준이면 조건부(현금) 몰로 보내지 않는다
const buyLink = (p, cash = false) => {
  const b = priceBasis(p, cash);
  const opts = b === "cash" || (b === "normal" && cash && p.best_total != null) ? [[p.best_url, p.best_mall]]
    : b === "normal" ? [[p.normal_best_url, p.normal_best_mall]] : [];
  for (const [u, m] of opts) { const s = safeUrl(u); if (s !== "#") return { url: s, mall: m || "쇼핑몰" }; }
  const d = safeUrl(p.url || danawaUrl(p.pcode));
  return { url: d, mall: "다나와", fallback: true };
};

const socketOf = (p) => {
  const s = (p.spec || "").replace(/\s+/g, "");
  const m = s.match(/소켓(AM5|AM4|1851|1700)/i);
  if (m) return m[1].toUpperCase();
  const t = (p.title || "") + " " + (p.query || "");
  if (/B650|B850|X670|X870|A620|라이젠/i.test(t)) return "AM5";
  if (/B860|Z890|H810|울트라/i.test(t)) return "1851";
  if (/B760|H610|Z790|14400F|13400F/i.test(t)) return "1700";
  return null;
};
const gpuWatt = (p) => +(((p.spec || "").match(/(\d{3,4})\s*W\s*이상/) || (p.title || "").match(/(\d{3,4})\s*W\s*이상/) || [])[1] || 0);
const psuWatt = (p) => +(((p.spec || "").match(/(?:^|\/)\s*(\d{3,4})\s*W\s*(?=\/|$)/) || (p.title || "").match(/(\d{3,4})\s*W\b/i) || [])[1] || 0);
const tierOf = (p, tiers) => tiers.find(([re]) => re.test(p.title || "")) || null;
const tierScore = (p, tiers) => tierOf(p, tiers)?.[1] ?? 0;
const isX3D = (p) => /X3D/i.test(p.title || "");
const isGpuCard = (p) => /지포스|라데온|GeForce|Radeon|RTX\s?\d|RX\s?\d/i.test(p.title || "") && !/노트북/.test(`${p.title} ${p.spec}`);
const cpuCores = (p) => {
  const s = p.spec || "";
  const pe = s.match(/P(\d+)\s*\+\s*E(\d+)\s*코어/);
  if (pe) return +pe[1] + +pe[2] / 2;
  return +(s.match(/(\d+)\s*코어/)?.[1] || 0);
};
const gpuVram = (p) => +((p.title || "").match(/(\d{1,2})\s*GB/i)?.[1] || (p.query || "").match(/(\d{1,2})\s*GB/i)?.[1] || 0);
const coolerTdp = (p) => +((p.spec || "").match(/TDP\s*\/\s*(\d{3})\s*W/)?.[1] || 0);
const bigCooler = (c) => /듀얼|dual/i.test(`${c.query || ""} ${c.title || ""}`) || coolerTdp(c) >= 260;

// RAM: 제품 하나의 총 용량(GB)을 제목 → 검색어 순으로 추정
const ramInfo = (p) => {
  const t = p.title || "", s = p.spec || "", q = p.query || "";
  let m;
  if ((m = t.match(/(\d{1,3})\s*G(?:B)?\s*[x×*]\s*(\d)\b/i))) return { per: +m[1] * +m[2], sticks: +m[2], known: true };
  if ((m = t.match(/\b(\d)\s*[x×*]\s*(\d{1,3})\s*GB/i))) return { per: +m[1] * +m[2], sticks: +m[1], known: true };
  const kit = /패키지|KIT|키트/i.test(t) || /램개수\s*\/\s*[2-9]\s*개/.test(s);
  const tcap = +(t.match(/(\d{1,3})\s*GB/i)?.[1] || 0);
  if (tcap) return { per: tcap, sticks: kit ? 2 : 1, known: true };
  const qcap = +(q.match(/(\d{1,3})\s*GB/i)?.[1] || 0);
  if (qcap) return { per: qcap, sticks: kit ? 2 : 1, known: true };   // 검색어 용량: 패키지면 세트 총용량, 단품이면 1개 용량
  return { per: 0, sticks: kit ? 2 : 1, known: false };
};
const ramQty = (p, target = RAM_TARGET_GB) => { const r = ramInfo(p); return r.known ? clampQty(Math.ceil(target / r.per)) : 1; };
const defaultQty = (p) => (p.category === "04_RAM" ? ramQty(p) : 1);

// 실시간 검색 결과의 분류 추정: 제목 우선, 그다음 스펙
function guessCat(it) {
  const t = it.title || "", s = it.spec || "";
  if (/라이젠|Ryzen|코어\s?i\d|코어\s?울트라|Core\s?(i\d|Ultra)/i.test(t)) return "01_CPU";
  if (/지포스|라데온|GeForce|Radeon|\bRTX\s?\d|\bRX\s?\d{3,4}/i.test(t)) return "02_GPU";
  if (/메인보드|\b[ABHXZ]\d{3}(?:M|E|I)?\b/.test(t)) return "03_메인보드";
  if (/\bDDR[45]\b|DDR[45]-/i.test(t)) return "04_RAM";
  if (/SSD|NVMe|M\.2/i.test(t)) return "05_SSD";
  if (/80\s?PLUS|파워/i.test(t)) return "06_파워";
  if (/쿨러|수랭|공랭/.test(t)) return "07_쿨러";
  if (/케이스/.test(t)) return "08_케이스";
  if (/케이스/.test(s)) return "08_케이스";
  if (/CPU\s?쿨러|공랭|수랭/.test(s)) return "07_쿨러";
  if (/^[^/]*파워/.test(s)) return "06_파워";
  if (/소켓/.test(s) && /코어/.test(s)) return "01_CPU";
  if (/소켓/.test(s)) return "03_메인보드";
  if (/RTX\s?\d|RX\s?\d|지포스|라데온/i.test(s)) return "02_GPU";
  if (/M\.2|NVMe|SSD|SATA/i.test(s)) return "05_SSD";
  if (/데스크탑용|DDR[45]/i.test(s)) return "04_RAM";
  return "";
}

// 수집 시각(KST) → 신선도
const kstParts = (ms) => { const d = new Date(ms + 9 * 3600e3); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
const pad2 = (n) => String(n).padStart(2, "0");
const kstToday = (now = Date.now()) => { const k = kstParts(now); return `${k.y}-${pad2(k.mo)}-${pad2(k.d)}`; };
function freshness(collectedAt, now = Date.now()) {
  if (!collectedAt) return null;
  const s = String(collectedAt);
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "+09:00");
  if (isNaN(t)) return null;
  const k = kstParts(t), h = Math.max(0, (now - t) / 3600e3), days = Math.floor(h / 24);
  return { label: `${k.mo}/${k.d} ${pad2(k.h)}:${pad2(k.mi)}`, full: `${k.y}-${pad2(k.mo)}-${pad2(k.d)} ${pad2(k.h)}:${pad2(k.mi)}`,
    days, stale: days > 3, ago: h < 1 ? "방금" : h < 24 ? `${Math.floor(h)}시간 전` : `${days}일 전` };
}

// ---------------------------------------------------------------- 조합 저장/공유
// 저장 형식 v2: {v:2, items:{cat:{pcode, qty, seen, snap?}}} — 가격은 저장하지 않고 parts.json에서 다시 채움
const SNAP_KEYS = ["category", "query", "pcode", "title", "spec", "url", "search_price", "normal_best_total", "normal_best_mall",
  "normal_best_url", "best_total", "best_mall", "best_url", "best_condition", "at"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, typeof o[k] === "string" ? o[k].slice(0, 300) : o[k]]));
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const validPcode = (p) => typeof p === "string" && /^\d{4,12}$/.test(p);   // 다나와 상품 코드(숫자)만

function parseSavedBuild(raw) {
  let v;
  try { v = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return {}; }
  if (!isObj(v)) return {};
  const src = v.v === 2 && isObj(v.items) ? v.items : v;   // 예전 형식(부품 객체 통째로)도 읽음
  const out = {};
  for (const k of CAT_KEYS) {
    const e = src[k];
    if (!isObj(e) || !validPcode(String(e.pcode ?? ""))) continue;
    const item = { pcode: String(e.pcode), qty: clampQty(e.qty) };
    if (num(e.seen) != null) item.seen = num(e.seen);
    const snap = isObj(e.snap) ? e.snap : e.query === "실시간 검색" ? e : null;
    if (snap && typeof snap.title === "string") item.snap = { ...pick(snap, SNAP_KEYS), category: k, pcode: item.pcode };
    if (!item.snap && typeof e.title === "string") item.title = e.title.slice(0, 200);
    out[k] = item;
  }
  return out;
}

function serializeBuild(build) {
  const items = {};
  for (const k of CAT_KEYS) {
    const b = build[k]; if (!b || !b.pcode) continue;
    const e = { pcode: String(b.pcode), qty: clampQty(b.qty) };
    const seen = priceOf(b, false); if (seen != null) e.seen = seen;
    if (b.live) e.snap = pick(b, SNAP_KEYS);
    else if (b.missing && b.title) e.title = b.title;
    items[k] = e;
  }
  return { v: 2, items };
}

// 저장/공유된 {cat:{pcode,qty,...}}를 최신 가격표로 다시 채움
function hydrateBuild(saved, parts) {
  const byCode = new Map();
  for (const p of parts) if (!byCode.has(p.pcode)) byCode.set(p.pcode, p);
  const build = {};
  for (const k of CAT_KEYS) {
    const e = saved[k]; if (!e) continue;
    const fresh = parts.find((p) => p.pcode === e.pcode && p.category === k) || byCode.get(e.pcode);
    if (fresh) {
      const item = { ...fresh, category: k, qty: clampQty(e.qty) };
      const now = priceOf(item, false);
      if (e.seen != null && now != null && now !== e.seen) item.prev = e.seen;
      build[k] = item;
    } else if (e.snap) {
      build[k] = { ...e.snap, category: k, pcode: e.pcode, qty: clampQty(e.qty), live: true };
    } else {
      build[k] = { category: k, pcode: e.pcode, qty: clampQty(e.qty), missing: true,
        title: e.title || `다나와 상품 ${e.pcode}`, url: danawaUrl(e.pcode) };
    }
  }
  return build;
}

// 공유 해시: #b=<base64url(JSON [[pcode,qty,catIndex],...])>
const b64uEnc = (s) => {
  const bytes = new TextEncoder().encode(s); let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64uDec = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
function encodeBuild(build) {
  const arr = CAT_KEYS.map((k, i) => (build[k]?.pcode ? [String(build[k].pcode), clampQty(build[k].qty), i] : null)).filter(Boolean);
  return arr.length ? b64uEnc(JSON.stringify(arr)) : "";
}
function decodeBuild(str) {
  if (!str || str.length > 2000) return null;
  let arr;
  try { arr = JSON.parse(b64uDec(str)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const out = {};
  for (const e of arr.slice(0, 8)) {
    if (!Array.isArray(e) || !validPcode(String(e[0] ?? ""))) continue;
    const ci = Number.isInteger(e[2]) && e[2] >= 0 && e[2] < CAT_KEYS.length ? e[2] : null;
    if (ci == null) continue;
    out[CAT_KEYS[ci]] = { pcode: String(e[0]), qty: clampQty(e[1]) };
  }
  return Object.keys(out).length ? out : null;
}
const shareHash = (build) => { const c = encodeBuild(build); return c ? `#b=${c}` : ""; };
const hashCode = (hash) => (String(hash || "").match(/[#&]b=([\w-]+)/) || [])[1] || "";

function quoteText(build, { cash = false, collectedAt = "", link = "", now = Date.now() } = {}) {
  const f = freshness(collectedAt, now);
  const lines = [`[드래곤볼 PC 견적] ${kstToday(now)}`,
    `가격 기준: 다나와 ${f ? f.full + " 수집" : "수집가"} · ${cash ? "현금/조건부 포함 최저가" : "일반결제 최저가(없으면 다나와 표시가)"}, 배송비 포함`, ""];
  let total = 0, unknown = 0;
  for (const k of CAT_KEYS) {
    const p = build[k]; if (!p) continue;
    const unit = priceOf(p, cash), q = clampQty(p.qty);
    if (unit == null) unknown++; else total += unit * q;
    const link2 = buyLink(p, cash);
    lines.push(`- ${CATS[k]} | ${p.title} | ${q}개 | ${unit == null ? "가격 정보 없음" : won(unit * q)}${unit != null ? ` (${basisLabel(p, cash)})` : ""} | ${link2.mall} | ${link2.url}`);
  }
  lines.push("", `합계: ${won(total)}${unknown ? ` (가격 정보 없는 부품 ${unknown}개 제외)` : ""}`);
  if (link) lines.push(`공유 링크: ${link}`);
  lines.push("※ 가격은 조회 시점 다나와 기준이며 바뀔 수 있습니다. 구매 전 판매처에서 다시 확인하세요.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- 자동 추천
const minBy = (list, f) => list.reduce((a, b) => (a == null || f(b) < f(a) ? b : a), null);
// 일반결제(또는 현금 모드의 확정가) 행을 우선, 없으면 표시가 행
const pickCheap = (list, cash) => {
  const firm = list.filter((p) => priceBasis(p, cash) !== "display");
  return minBy(firm.length ? firm : list, (p) => priceOf(p, cash));
};
const preferFirm = (list, keyFn, cash) => {
  const groups = new Map();
  for (const p of list) { const k = keyFn(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  return [...groups.values()].flatMap((g) => { const firm = g.filter((p) => priceBasis(p, cash) !== "display"); return firm.length ? firm : g; });
};

function recommend(parts, { budget = Infinity, storage = "1TB", purpose = "qhd", cash = false } = {}) {
  const pu = PURPOSES[purpose] || PURPOSES.qhd;
  const P = (cat) => parts.filter((p) => p.category === cat && isPart(p) && priceOf(p, cash) != null && /^\d+$/.test(String(p.pcode)));
  const cpus = preferFirm(P("01_CPU").filter((p) => tierOf(p, CPU_TIERS)), (p) => tierOf(p, CPU_TIERS)[0].source, cash);
  const gpus = preferFirm(P("02_GPU").filter((p) => isGpuCard(p) && tierOf(p, GPU_TIERS)), (p) => tierOf(p, GPU_TIERS)[0].source, cash);
  const boards = P("03_메인보드").filter((b) => !/DDR4/i.test(b.spec || "") || /DDR5/i.test(b.spec || ""));
  const psus = P("06_파워"), coolers = P("07_쿨러");
  const rams = P("04_RAM").filter((p) => ramInfo(p).known).map((p) => ({ p, qty: ramQty(p), cost: priceOf(p, cash) * ramQty(p), firm: priceBasis(p, cash) !== "display" }));
  const ram = minBy(rams.some((r) => r.firm) ? rams.filter((r) => r.firm) : rams, (r) => r.cost);
  const ssdPool = P("05_SSD").filter((p) => `${p.query} ${p.title}`.includes(storage));
  const ssd = pickCheap(ssdPool.length ? ssdPool : P("05_SSD"), cash);
  const pcCase = pickCheap(P("08_케이스"), cash);
  const cpuS = (c) => tierScore(c, CPU_TIERS) + (pu.cores ? (cpuCores(c) - 6) * 5 : 0);
  const gpuS = (g) => tierScore(g, GPU_TIERS) + (pu.vram ? (gpuVram(g) - 12) * 3 : 0);

  const best = new Map();   // CPU 티어 × GPU 티어별로 가장 싼 조합 (GPU마다 필요한 파워까지 반영)
  for (const cpu of cpus) for (const gpu of gpus) {
    const mb = pickCheap(boards.filter((b) => socketOf(b) === socketOf(cpu)), cash);
    const need = gpuWatt(gpu) || (tierScore(gpu, GPU_TIERS) >= 130 ? 750 : 650);
    const psu = pickCheap(psus.filter((p) => psuWatt(p) >= need), cash);
    const cooler = pickCheap(coolers.filter((c) => (isX3D(cpu) ? bigCooler(c) : true)), cash);
    if (!mb || !psu || !cooler || !ram || !ssd || !pcCase) continue;
    const items = { "01_CPU": [cpu, 1], "02_GPU": [gpu, 1], "03_메인보드": [mb, 1], "04_RAM": [ram.p, ram.qty],
      "05_SSD": [ssd, 1], "06_파워": [psu, 1], "07_쿨러": [cooler, 1], "08_케이스": [pcCase, 1] };
    const total = Object.values(items).reduce((s, [p, q]) => s + priceOf(p, cash) * q, 0);
    const score = pu.gpu * gpuS(gpu) + pu.cpu * cpuS(cpu);
    const key = tierOf(cpu, CPU_TIERS)[0].source + "|" + tierOf(gpu, GPU_TIERS)[0].source;
    const c = { items, total, score, value: score / (total / 1e6), key };
    if (!best.has(key) || total < best.get(key).total) best.set(key, c);
  }
  const combos = [...best.values()];
  const fit = combos.filter((c) => c.total <= budget).sort((a, b) => b.score - a.score || a.total - b.total);
  const bestValue = [...combos].sort((a, b) => b.value - a.value)[0] || null;
  const cheapest = minBy(combos, (c) => c.total);
  return { fit: fit.slice(0, 3), bestValue, cheapest, minTotal: cheapest?.total ?? null, missing: combos.length === 0, count: combos.length };
}

// ---------------------------------------------------------------- 유튜브 주소
function normalizeYt(u) {
  let x;
  try { x = new URL(String(u || "").trim()); } catch { return null; }
  if (!/^https?:$/.test(x.protocol)) return null;
  const host = x.hostname.toLowerCase(), ok = (id) => (/^[\w-]{11}$/.test(id || "") ? `https://www.youtube.com/watch?v=${id}` : null);
  if (host === "youtu.be") return ok(x.pathname.split("/")[1]);
  if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) return null;
  if (x.pathname === "/watch") return ok(x.searchParams.get("v"));
  const m = x.pathname.match(/^\/shorts\/([\w-]{11})\/?$/);
  return m ? ok(m[1]) : null;
}

// ---------------------------------------------------------------- 노드 테스트용 내보내기
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CATS, CAT_KEYS, GPU_TIERS, CPU_TIERS, PURPOSES, esc, won, safeUrl, isPart, priceOf, priceBasis, basisLabel, buyLink,
    socketOf, gpuWatt, psuWatt, tierScore, isGpuCard, cpuCores, gpuVram, ramInfo, ramQty, clampQty, guessCat, freshness, kstToday,
    parseSavedBuild, serializeBuild, hydrateBuild, encodeBuild, decodeBuild, shareHash, hashCode, quoteText, recommend, normalizeYt };
}

// ================================================================ 화면
if (typeof document !== "undefined") init();

function init() {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch { return false; } },
  };
  const ACCESS_KEY = "dragonball-access", BUILD_KEY = "dragonball-build";
  const state = { parts: [], collectedAt: "", loaded: false, loadError: false, cat: "02_GPU", cash: false, build: {},
    saved: parseSavedBuild(store.get(BUILD_KEY)), status: null, lastRec: null, filter: "", sort: "query", modelMin: false };
  let memCode = "";
  const getCode = () => memCode || store.get(ACCESS_KEY) || "";

  // ------------------------------------------------ 마크다운 (DOMPurify 엄격 설정)
  const PURIFY = { FORBID_TAGS: ["img", "form", "input", "button", "textarea", "select", "style", "iframe", "svg", "math"], FORBID_ATTR: ["style"] };
  if (window.DOMPurify) {
    DOMPurify.addHook("afterSanitizeAttributes", (n) => {
      if (n.tagName === "A") {
        const h = safeUrl(n.getAttribute("href"));
        if (h === "#") n.removeAttribute("href"); else n.setAttribute("href", h);
        n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer nofollow");
      }
    });
  }
  const md = (t) => (window.marked && window.DOMPurify
    ? DOMPurify.sanitize(marked.parse(String(t || "")), PURIFY)
    : esc(t).replace(/\n/g, "<br>"));
  const aiBox = (text, model) => `<div class="summary-box">${md(text)}${model ? `<div class="spec">AI 요약 · ${esc(model)}</div>` : ""}</div>`;
  const loading = (msg) => `<div class="loading" role="status">${esc(msg)}</div>`;
  const ext = (u, label, cls = "") => { const s = safeUrl(u); return s === "#" ? esc(label) : `<a class="${cls}" href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`; };
  const errBox = (e, retry) => {
    const locked = e && (e.status === 401 || e.code === "access_required");
    return `<div class="error" role="alert">⚠ ${esc(e?.message || e)}
      ${locked ? `<button type="button" class="small ghost" data-unlock data-retry="${esc(retry || "")}">접근 코드 입력</button>` : retry ? `<button type="button" class="small ghost" data-retry="${esc(retry)}">다시 시도</button>` : ""}</div>`;
  };
  const basisTag = (p) => {
    const b = priceBasis(p, state.cash);
    const cls = b === "normal" ? "good" : b === "cash" ? "cash" : "";
    const tip = b === "normal" ? "일반결제 가능한 최저가(배송비 포함)" : b === "cash" ? "현금·계좌이체 등 결제 조건이 붙은 가격" : "다나와 검색 화면의 표시가 — 실제 결제가와 다를 수 있음";
    return b === "none" ? "" : `<span class="tag ${cls}" title="${tip}">${esc(basisLabel(p, state.cash))}</span>`;
  };
  const buyHtml = (p) => { const b = buyLink(p, state.cash); return b.url === "#" ? "" : `<a class="buy" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${b.fallback ? "다나와에서 보기" : `${esc(short(b.mall, 14))}에서 구매`} ↗</a>`; };

  // ------------------------------------------------ 토스트
  let toastTimer;
  function toast(html, ms = 3500) {
    const t = $("#toast"); t.innerHTML = html; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ------------------------------------------------ API + 접근 코드
  class ApiError extends Error { constructor(m, status, code) { super(m); this.status = status; this.code = code; } }
  const errMessage = (status, data) => {
    const code = data?.code;
    if (code === "access_not_configured") return "서버에 접근 코드가 설정되지 않아 이 기능은 꺼져 있습니다. 가격표와 빌더는 그대로 쓸 수 있습니다.";
    if (status === 401 || code === "access_required") return "이 기능은 접근 코드가 필요합니다.";
    if (status === 429 || code === "rate_limited") return "요청이 너무 많습니다. 몇 분 뒤에 다시 시도하세요.";
    if (status === 504) return "응답이 너무 오래 걸려 중단됐습니다. 잠시 후 다시 시도하세요.";
    if (status === 413) return "요청 내용이 너무 깁니다.";
    if (data?.error) return String(data.error).slice(0, 200);
    if (status === 503) return "서비스를 잠시 쓸 수 없습니다. 잠시 후 다시 시도하세요.";
    if (status >= 500) return "일시적인 서버 오류입니다. 잠시 후 다시 시도하세요.";
    return `요청을 처리하지 못했습니다. (${status})`;
  };
  async function rawApi(path, body, code) {
    const h = {}; if (code) h["X-Access-Code"] = code;
    if (body !== undefined) h["Content-Type"] = "application/json";
    let res;
    try { res = await fetch(path, { method: body !== undefined ? "POST" : "GET", headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch { throw new ApiError("서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.", 0, "network"); }
    const data = await res.json().catch(() => null);
    if (res.ok && data && !data.error) return data;
    throw new ApiError(errMessage(res.status, data), res.status, data?.code || "");
  }
  async function api(path, body) {
    try { return await rawApi(path, body, getCode()); }
    catch (e) {
      if (e.status !== 401) throw e;
      const code = await askCode(getCode() ? "저장된 코드가 맞지 않습니다. 다시 입력하세요." : "");
      if (!code) throw e;
      return rawApi(path, body, code);
    }
  }

  let lockPending = null, lockReturn = null;
  function askCode(msg = "") {
    if (lockPending) return lockPending.promise;
    let resolve; const promise = new Promise((r) => { resolve = r; });
    lockPending = { promise, resolve };
    lockReturn = document.activeElement;
    $("#lock-msg").textContent = msg; $("#lock-code").value = "";
    $("#lock-forget").hidden = !getCode();
    $("#lock-modal").hidden = false; $("#lock-code").focus();
    return promise;
  }
  function closeLock(code) {
    $("#lock-modal").hidden = true;
    const p = lockPending; lockPending = null; p?.resolve(code || null);
    try { lockReturn?.focus(); } catch { /* 무시 */ }
    updateLockUi();
  }
  $("#lock-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("#lock-code").value.trim(), btn = $("#lock-submit");
    if (!code) { $("#lock-msg").textContent = "코드를 입력하세요."; return; }
    btn.disabled = true; $("#lock-msg").textContent = "확인 중…";
    try {
      await rawApi("/api/auth/check", {}, code);
      memCode = code;
      store.set(ACCESS_KEY, $("#lock-remember").checked ? code : null);
      closeLock(code); toast("접근 코드가 확인됐습니다. 🔓");
    } catch (err) {
      $("#lock-msg").textContent = err.status === 401 ? "코드가 맞지 않습니다." : err.message;
    } finally { btn.disabled = false; }
  });
  $("#lock-cancel").addEventListener("click", () => closeLock(null));
  $("#lock-forget").addEventListener("click", () => { memCode = ""; store.set(ACCESS_KEY, null); $("#lock-forget").hidden = true; $("#lock-msg").textContent = "저장된 코드를 지웠습니다."; updateLockUi(); });
  $("#lock-modal").addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLock(null);
    if (e.key === "Tab") {   // 모달 안에서만 포커스 이동
      const f = $$("input, button:not([hidden])", $("#lock-modal")).filter((x) => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  });
  $("#lock-modal").addEventListener("click", (e) => { if (e.target.id === "lock-modal") closeLock(null); });
  $("#lock-btn").addEventListener("click", () => askCode());
  function updateLockUi() {
    const locked = !!state.status?.locked, has = !!getCode();
    document.body.classList.toggle("locked", locked && !has);
    const b = $("#lock-btn");
    b.hidden = !locked;
    b.textContent = has ? "🔓 접근 코드 입력됨" : "🔒 접근 코드 입력";
    b.setAttribute("aria-label", has ? "접근 코드 변경" : "접근 코드 입력");
  }

  // ------------------------------------------------ 상태 표시
  async function loadStatus() {
    try {
      const s = await rawApi("/api/status");
      state.status = s;
      $("#status").innerHTML = [
        `<span class="pill ${s.firecrawl ? "on" : "off"}" title="웹 자료·유튜브 영상 검색">웹 조사 ${s.firecrawl ? "가능" : "꺼짐"}</span>`,
        `<span class="pill ${s.gemini ? "on" : "off"}" title="${esc((s.gemini_models || []).join(" → "))}">AI 요약 ${s.gemini ? "가능" : "꺼짐"}</span>`,
      ].join("");
    } catch {
      state.status = null;
      $("#status").innerHTML = `<span class="pill off" title="가격표와 빌더는 그대로 쓸 수 있습니다">실시간 기능 연결 안 됨</span>`;
    }
    updateLockUi();
    renderFresh();
  }
  function renderFresh() {
    const f = freshness(state.collectedAt);
    const html = f ? `<span class="fresh ${f.stale ? "stale" : ""}" title="다나와 가격 수집 시각 (한국 시간)">가격 기준 ${esc(f.label)} · ${esc(f.ago)}${f.stale ? " — 오래된 가격일 수 있어요" : ""}</span>` : "";
    $$("[data-fresh]").forEach((el) => { el.innerHTML = html; });
  }

  // ------------------------------------------------ 가격표
  async function loadParts() {
    $("#parts-meta").innerHTML = loading("가격 데이터를 불러오는 중…");
    try {
      const res = await fetch("/data/parts.json", { cache: "no-cache" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      state.parts = (Array.isArray(d.items) ? d.items : []).filter((p) => p && p.category in CATS && isPart(p))
        .map((p) => ({ ...p, pcode: String(p.pcode ?? ""), search_price: num(p.search_price), normal_best_total: num(p.normal_best_total), best_total: num(p.best_total), card_price: num(p.card_price) }))
        .filter((p) => priceOf(p, true) != null);
      state.collectedAt = d.collected_at || "";
      state.loaded = true; state.loadError = false;
      $("#parts-meta").innerHTML = state.parts.length
        ? `<span data-fresh></span> 부품 ${state.parts.length}개 · 다나와 공개 가격비교 기준 · 부품명을 누르면 다나와 상세, ‘…에서 구매’를 누르면 그 가격의 쇼핑몰로 이동합니다.`
        : `<div class="empty">아직 수집된 가격 데이터가 없습니다.</div>`;
    } catch {
      state.loaded = false; state.loadError = true;
      $("#parts-meta").innerHTML = `<div class="error" role="alert">⚠ 가격 데이터를 불러오지 못했습니다. <button type="button" class="small ghost" data-retry="parts">다시 시도</button></div>`;
    }
    restoreBuild();
    renderFresh(); renderChips(); renderPartsTable(); renderBuild(); renderMinHint();
    if (state.pendingRec && state.loaded) { state.pendingRec = false; runRecommend(); }
  }

  function renderChips() {
    $("#cat-chips").innerHTML = Object.entries(CATS).map(([k, v]) => {
      const n = state.parts.filter((p) => p.category === k).length;
      return `<button type="button" class="chip ${k === state.cat ? "active" : ""}" data-cat="${k}" aria-pressed="${k === state.cat}">${v} <span class="cnt">${n}</span></button>`;
    }).join("");
  }
  const inBuild = (p) => state.build[p.category]?.pcode === p.pcode;

  function partRows() {
    const f = state.filter.toLowerCase();
    let rows = state.parts.filter((p) => p.category === state.cat && (!f || `${p.title} ${p.query} ${p.spec}`.toLowerCase().includes(f)));
    const pr = (p) => priceOf(p, state.cash) ?? Infinity;
    if (state.modelMin) {
      const m = new Map();
      for (const p of rows) { const k = p.query || p.title; if (!m.has(k) || pr(p) < pr(m.get(k))) m.set(k, p); }
      rows = [...m.values()];
    }
    const cmp = { query: (a, b) => (a.query || "").localeCompare(b.query || "", "ko") || pr(a) - pr(b),
      asc: (a, b) => pr(a) - pr(b), desc: (a, b) => pr(b) - pr(a), name: (a, b) => (a.title || "").localeCompare(b.title || "", "ko") }[state.sort];
    return rows.sort(cmp);
  }

  function renderPartsTable() {
    const tbl = $("#parts-table");
    if (!state.loaded) { tbl.innerHTML = ""; return; }
    const rows = partRows();
    if (!rows.length) {
      tbl.innerHTML = `<tbody><tr><td class="empty">${state.filter ? `‘${esc(state.filter)}’에 맞는 부품이 없습니다.` : "이 분류에는 수집된 부품이 없습니다."}</td></tr></tbody>`;
      return;
    }
    tbl.innerHTML = `<caption class="sr-only">${esc(CATS[state.cat])} 가격표</caption>
      <thead><tr><th scope="col">부품</th><th scope="col" class="num">적용 가격</th><th scope="col" class="num">다나와 표시가</th><th scope="col" class="num">일반결제 최저</th>
      <th scope="col" class="num"><abbr title="현금·계좌이체 등 결제 조건이 붙은 가격">조건부 최저</abbr></th><th scope="col">카드할인</th><th scope="col"><span class="sr-only">담기</span></th></tr></thead>
      <tbody>${rows.map((p) => {
        const cond = p.best_condition && p.best_condition !== "일반" && p.best_total != null;
        const on = inBuild(p);
        return `<tr>
          <td class="title-cell" data-label="부품"><span class="tag">${esc(p.query)}</span>${ext(p.url, p.title, "pname")}
            <div class="spec">${esc((p.spec || "").slice(0, 120))}</div></td>
          <td class="num" data-label="적용 가격"><span class="price-strong">${won(priceOf(p, state.cash))}</span> ${basisTag(p)}<div>${buyHtml(p)}</div></td>
          <td class="num" data-label="다나와 표시가">${won(p.search_price)}</td>
          <td class="num" data-label="일반결제 최저">${won(p.normal_best_total)}<div class="spec">${esc(p.normal_best_mall || "")}</div></td>
          <td class="num" data-label="조건부 최저">${cond ? `${won(p.best_total)}<div><span class="tag cash">${esc(p.best_condition)}</span><span class="spec">${esc(p.best_mall || "")}</span></div>` : "-"}</td>
          <td data-label="카드할인">${p.card_price ? `${won(p.card_price)}<div class="spec">${esc(p.card_name || "")}</div>` : "-"}</td>
          <td class="act"><button type="button" class="small ${on ? "" : "ghost"}" data-add="${esc(p.pcode)}" aria-label="${esc(short(p.title, 40))} ${on ? "담김" : "내 조합에 담기"}">${on ? "담김 ✓" : "담기"}</button></td>
        </tr>`;
      }).join("")}</tbody>`;
  }

  $("#cat-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    state.cat = b.dataset.cat; renderChips(); renderPartsTable();
  });
  $("#parts-filter").addEventListener("input", (e) => { state.filter = e.target.value.trim(); renderPartsTable(); });
  $("#parts-sort").addEventListener("change", (e) => { state.sort = e.target.value; renderPartsTable(); });
  $("#model-min").addEventListener("change", (e) => { state.modelMin = e.target.checked; renderPartsTable(); });
  $$("[data-cash-toggle]").forEach((el) => el.addEventListener("change", (e) => {
    state.cash = e.target.checked;
    $$("[data-cash-toggle]").forEach((x) => { x.checked = state.cash; });
    renderPartsTable(); renderBuild();
    if (state.lastRec) runRecommend(state.lastRec);
  }));
  $("#parts-table").addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    const p = state.parts.find((x) => x.pcode === b.dataset.add && x.category === state.cat);
    if (p) addToBuild(p);
  });

  // ------------------------------------------------ 다나와 실시간 검색 (🔒)
  const live = { gen: 0, items: [], best: {}, busy: false };
  async function runLive() {
    const q = $("#live-q").value.trim(), out = $("#live-out");
    if (q.length < 2) { out.innerHTML = `<div class="error">검색어를 2자 이상 입력하세요.</div>`; return; }
    if (live.busy) return;
    const gen = ++live.gen; live.items = []; live.best = {}; live.busy = true;
    const btn = $("#live-form button[type=submit]"); btn.disabled = true;
    out.innerHTML = loading("다나와에서 검색하는 중… (몇 초 걸려요)");
    try {
      const d = await api(`/api/danawa/search?q=${encodeURIComponent(q.slice(0, 60))}`);
      if (gen !== live.gen) return;
      live.items = (Array.isArray(d.items) ? d.items : []).filter((it) => isObj(it) && validPcode(String(it.pcode ?? "")));
      if (!live.items.length) { out.innerHTML = `<div class="empty">결과가 없습니다. 다나와가 가끔 빈 결과를 주니 잠시 후 다시 시도하거나 검색어를 바꿔보세요.</div>`; return; }
      out.innerHTML = `<div class="table-wrap"><table class="stack"><caption class="sr-only">다나와 검색 결과</caption>
        <thead><tr><th scope="col">부품</th><th scope="col" class="num">표시가</th><th scope="col">분류</th><th scope="col"><span class="sr-only">동작</span></th></tr></thead><tbody>
        ${live.items.map((it, i) => { const g = guessCat(it); return `<tr>
          <td class="title-cell" data-label="부품">${ext(it.url, it.title, "pname")}<div class="spec">${esc((it.spec || "").slice(0, 120))}</div>
            <div class="offers" id="off-${i}" aria-live="polite"></div></td>
          <td class="num" data-label="표시가">${won(it.price)}</td>
          <td data-label="분류"><select data-cat-for="${i}" aria-label="${esc(short(it.title, 30))} 분류">
            <option value="" ${g ? "" : "selected"}>분류 선택</option>
            ${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === g ? "selected" : ""}>${v}</option>`).join("")}</select></td>
          <td class="act"><button type="button" class="small ghost" data-offers="${i}">쇼핑몰별 가격</button> <button type="button" class="small" data-live-add="${i}">담기</button></td>
        </tr>`; }).join("")}</tbody></table></div>`;
    } catch (err) { if (gen === live.gen) out.innerHTML = errBox(err, "live"); }
    finally { live.busy = false; btn.disabled = false; }
  }
  $("#live-form").addEventListener("submit", (e) => { e.preventDefault(); runLive(); });

  $("#live-out").addEventListener("click", async (e) => {
    const addB = e.target.closest("[data-live-add]"), offB = e.target.closest("[data-offers]");
    if (addB) {
      const i = +addB.dataset.liveAdd, it = live.items[i]; if (!it) return;
      const cat = $(`[data-cat-for="${i}"]`, $("#live-out"))?.value;
      if (!cat) { toast("먼저 분류를 고르세요."); $(`[data-cat-for="${i}"]`, $("#live-out"))?.focus(); return; }
      const b = live.best[it.pcode] || {};
      addToBuild({ category: cat, query: "실시간 검색", pcode: String(it.pcode), title: it.title, spec: it.spec, url: it.url,
        search_price: num(it.price), normal_best_total: b.normal?.total ?? null, normal_best_mall: b.normal?.mall ?? null, normal_best_url: b.normal?.url ?? null,
        best_total: b.best?.total ?? null, best_mall: b.best?.mall ?? null, best_url: b.best?.url ?? null, best_condition: b.best?.cond ?? null,
        at: kstToday(), live: true });
      addB.textContent = "담김 ✓";
    }
    if (offB) {
      const i = +offB.dataset.offers, it = live.items[i]; if (!it) return;
      const gen = live.gen, box = $(`#off-${i}`);
      offB.disabled = true; box.innerHTML = loading("쇼핑몰별 가격 조회 중…");
      try {
        const d = await api(`/api/danawa/offers?pcode=${encodeURIComponent(it.pcode)}`);
        if (gen !== live.gen) return;
        const offers = Array.isArray(d.offers) ? d.offers : [];
        const normal = minBy(offers.filter((o) => !o.is_conditional_price && o.total_price != null), (o) => o.total_price);
        const all = minBy(offers.filter((o) => o.total_price != null), (o) => o.total_price);
        live.best[it.pcode] = {
          normal: normal ? { total: normal.total_price, mall: normal.mall, url: safeUrl(normal.url) } : null,
          best: all ? { total: all.total_price, mall: all.mall, url: safeUrl(all.url), cond: all.is_conditional_price ? (all.payment_condition_label || "현금") : "일반" } : null,
        };
        const shown = offers.slice(0, 6); if (normal && !shown.includes(normal)) shown.push(normal);   // 일반결제 최저가는 항상 보이게
        box.innerHTML = offers.length ? `<table class="offer-table"><caption class="sr-only">쇼핑몰별 가격</caption><tbody>${shown.map((o) => `<tr>
          <td>${esc(o.mall)}</td><td class="num">${won(o.total_price)}</td>
          <td>${o.is_conditional_price ? `<span class="tag cash">${esc(o.payment_condition_label || "조건부")}</span>` : `<span class="tag good">일반</span>`}
            ${o.is_free_shipping ? `<span class="tag">무료배송</span>` : ""}${o.card_price ? `<span class="tag">${esc(o.card_name || "카드")} ${won(o.card_price)}</span>` : ""}</td>
          <td>${ext(o.url, "구매 ↗")}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">판매처 정보가 없습니다.</div>`;
      } catch (err) { if (gen === live.gen) box.innerHTML = errBox(err); }
      finally { offB.disabled = false; }
    }
  });

  // ------------------------------------------------ 빌더
  function saveBuild() { store.set(BUILD_KEY, JSON.stringify(serializeBuild(state.build))); }
  function restoreBuild() {
    state.saved = parseSavedBuild(store.get(BUILD_KEY));
    const code = hashCode(location.hash), shared = code && state.loaded ? decodeBuild(code) : null;
    if (shared) {
      const hadOwn = Object.keys(state.saved).length > 0;
      state.undo = hadOwn ? hydrateBuild(state.saved, state.parts) : null;
      state.build = hydrateBuild(shared, state.parts);
      saveBuild();
      try { history.replaceState(null, "", location.pathname + location.search); } catch { /* 무시 */ }
      showTab("builder");
      toast(`공유된 조합을 불러왔습니다.${hadOwn ? ` <button type="button" class="small ghost" data-undo>내 이전 조합으로 되돌리기</button>` : ""}`, 8000);
    } else {
      if (code && state.loaded) toast("공유 링크가 올바르지 않아 불러오지 못했습니다.");
      state.build = hydrateBuild(state.saved, state.parts);
    }
  }

  function addToBuild(p, qty) {
    if (!state.loaded && !state.loadError) { toast("가격 데이터를 불러오는 중입니다. 잠시 후 다시 담아 주세요."); return; }
    const k = p.category, prev = state.build[k];
    const item = { ...p, qty: clampQty(qty ?? defaultQty(p)) };
    delete item.prev; delete item.missing;
    state.build[k] = item;
    saveBuild(); renderBuild(); renderPartsTable();
    toast(prev && prev.pcode !== p.pcode ? `${CATS[k]}: ${esc(short(prev.title))} → <b>${esc(short(p.title))}</b>(으)로 교체했습니다.` : `${CATS[k]}에 담았습니다: ${esc(short(p.title, 36))}`);
  }

  function ramNote(p) {
    const r = ramInfo(p), q = clampQty(p.qty);
    return r.known ? `<div class="spec">제품당 ${r.per}GB → 총 약 ${r.per * q}GB ${r.per * q < RAM_TARGET_GB ? `<span class="warn">(32GB 권장)</span>` : ""}</div>`
      : `<div class="spec warn">용량을 확인하지 못했습니다. 다나와 상세에서 확인 후 수량을 조정하세요.</div>`;
  }

  function buildTotal() {
    let total = 0, unknown = 0;
    for (const k of CAT_KEYS) { const p = state.build[k]; if (!p) continue; const u = priceOf(p, state.cash); if (u == null) unknown++; else total += u * clampQty(p.qty); }
    return { total, unknown, count: CAT_KEYS.filter((k) => state.build[k]).length };
  }

  function renderBuild() {
    const { total, unknown, count } = buildTotal();
    $("#build-table").innerHTML = `<div class="table-wrap"><table class="stack build"><caption class="sr-only">내 조합</caption>
      <thead><tr><th scope="col">분류</th><th scope="col">부품</th><th scope="col" class="num">단가</th><th scope="col">수량</th><th scope="col" class="num">소계</th><th scope="col"><span class="sr-only">빼기</span></th></tr></thead><tbody>
      ${CAT_KEYS.map((k) => {
        const p = state.build[k];
        if (!p) return `<tr class="empty-row"><th scope="row">${CATS[k]}</th><td class="empty" colspan="5">비어 있음 — 자동 추천이나 가격표에서 담으세요</td></tr>`;
        const unit = priceOf(p, state.cash), q = clampQty(p.qty), sub = unit == null ? null : unit * q;
        const diff = p.prev != null && unit != null && !state.cash ? priceOf(p, false) - p.prev : 0;
        return `<tr><th scope="row" data-label="분류">${CATS[k]}</th>
          <td class="title-cell" data-label="부품">${ext(p.url || danawaUrl(p.pcode), p.title, "pname")}
            ${p.missing ? `<div class="spec warn">현재 가격표에 없는 부품입니다 — 가격 정보 없음</div>` : ""}
            ${p.live ? `<div class="spec">실시간 검색으로 담은 부품 (${esc(p.at || "")} 가격)</div>` : ""}
            ${k === "04_RAM" && !p.missing ? ramNote(p) : ""}
            <div>${p.missing ? "" : buyHtml(p)}</div></td>
          <td class="num" data-label="단가">${won(unit)} ${unit != null ? basisTag(p) : ""}
            ${diff ? `<div class="spec ${diff > 0 ? "bad" : "ok"}">${diff > 0 ? "▲" : "▼"} ${won(Math.abs(diff))} (담았을 때보다)</div>` : ""}</td>
          <td data-label="수량"><input class="qty" type="number" inputmode="numeric" min="1" max="8" step="1" value="${q}" data-qty="${k}" aria-label="${CATS[k]} 수량"></td>
          <td class="num" data-label="소계">${won(sub)}</td>
          <td class="act"><button type="button" class="small ghost danger" data-del="${k}" aria-label="${CATS[k]} 빼기">빼기</button></td></tr>`;
      }).join("")}
      <tr class="total-row"><th scope="row" colspan="4">합계${unknown ? ` <span class="spec">(가격 없는 부품 ${unknown}개 제외)</span>` : ""}</th><td class="num" data-label="합계">${won(total)}</td><td></td></tr>
    </tbody></table></div>`;
    $("#compat").innerHTML = `<div class="compat">${compatChecks(state.build).map(([lvl, msg]) => `<div class="${lvl}">${lvl === "ok" ? "✓" : lvl === "warn" ? "!" : "✕"} ${esc(msg)}</div>`).join("")}</div>`;
    $("#sticky-total").textContent = count ? `합계 ${won(total)} · ${count}/8개` : "아직 담은 부품이 없습니다";
    $$("[data-need-build]").forEach((b) => { b.disabled = !count; });
  }

  function compatChecks(b) {
    const out = [];
    const cpu = b["01_CPU"], mb = b["03_메인보드"], gpu = b["02_GPU"], psu = b["06_파워"], cool = b["07_쿨러"], ram = b["04_RAM"];
    if (cpu && mb) {
      const a = socketOf(cpu), m = socketOf(mb);
      if (a && m) out.push(a === m ? ["ok", `소켓 일치: CPU ${a} / 메인보드 ${m}`] : ["bad", `소켓 불일치: CPU ${a} ↔ 메인보드 ${m}`]);
      else out.push(["warn", "소켓 정보를 확인할 수 없습니다. 상세 스펙을 확인하세요."]);
    }
    if (gpu && psu) {
      const need = gpuWatt(gpu), have = psuWatt(psu);
      if (need && have) out.push(have >= need ? ["ok", `파워 용량 충분: ${have}W ≥ 권장 ${need}W`] : ["bad", `파워 부족: ${have}W < 그래픽카드 권장 ${need}W`]);
      else out.push(["warn", `${!have ? "파워 용량" : "그래픽카드 권장 파워"}을(를) 확인할 수 없습니다. 상세 스펙을 확인하세요.`]);
    }
    if (gpu && !isGpuCard(gpu)) out.push(["warn", "그래픽카드 칸에 담긴 제품이 그래픽카드가 아닐 수 있습니다."]);
    if (cpu && cool && isX3D(cpu) && !bigCooler(cool)) out.push(["warn", "X3D CPU에는 듀얼타워 공랭 이상을 권장합니다."]);
    if (cpu && !cool && /F\b|X3D|X\b/.test(cpu.title || "")) out.push(["warn", "이 CPU는 기본 쿨러가 없을 수 있습니다. 쿨러를 추가하세요."]);
    if (mb && /DDR4/i.test(mb.spec || "") && !/DDR5/i.test(mb.spec || "")) out.push(["warn", "DDR4 메인보드입니다. RAM 규격을 확인하세요."]);
    if (ram && !ramInfo(ram).known) out.push(["warn", "RAM 용량을 확인하지 못했습니다. 수량을 직접 확인하세요."]);
    if (Object.values(b).some((p) => p.missing)) out.push(["warn", "현재 가격표에 없는 부품이 있어 합계에서 빠졌습니다. 다시 골라 주세요."]);
    if (!out.length) out.push(["warn", "부품을 담으면 호환성을 검사합니다."]);
    return out;
  }

  $("#build-table").addEventListener("click", (e) => {
    const d = e.target.closest("[data-del]"); if (!d) return;
    delete state.build[d.dataset.del]; saveBuild(); renderBuild(); renderPartsTable();
  });
  $("#build-table").addEventListener("change", (e) => {
    const q = e.target.closest("[data-qty]"); if (!q || !state.build[q.dataset.qty]) return;
    state.build[q.dataset.qty].qty = clampQty(q.value); saveBuild(); renderBuild();
    $(`[data-qty="${q.dataset.qty}"]`)?.focus();
  });
  $("#clear-build").addEventListener("click", () => {
    if (!buildTotal().count) return;
    state.undo = { ...state.build }; state.build = {}; saveBuild(); renderBuild(); renderPartsTable(); $("#advise-out").innerHTML = "";
    toast(`조합을 비웠습니다. <button type="button" class="small ghost" data-undo>되돌리기</button>`, 6000);
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-undo]") && state.undo) {
      state.build = state.undo; state.undo = null; saveBuild(); renderBuild(); renderPartsTable(); $("#toast").hidden = true;
    }
  });

  // 공유·견적 복사
  const shareUrl = (build) => { const h = shareHash(build); return h ? location.origin + location.pathname + h : ""; };
  async function copyText(text, label) {
    try { await navigator.clipboard.writeText(text); toast(`${label}를 복사했습니다.`); return; } catch { /* 아래 대체 */ }
    $("#share-out").innerHTML = `<label class="block" for="copy-area">${esc(label)} — 직접 선택해 복사하세요</label><textarea id="copy-area" rows="${Math.min(14, text.split("\n").length + 1)}" readonly>${esc(text)}</textarea>`;
    $("#copy-area").focus(); $("#copy-area").select();
  }
  $("#share-link").addEventListener("click", () => { const u = shareUrl(state.build); if (u) copyText(u, "공유 링크"); });
  $("#copy-quote").addEventListener("click", () => {
    if (!buildTotal().count) return;
    copyText(quoteText(state.build, { cash: state.cash, collectedAt: state.collectedAt, link: shareUrl(state.build) }), "견적서");
  });

  // AI 조합 평가 (🔒)
  let adviseBusy = false;
  async function runAdvise() {
    const btn = $("#advise-btn");
    const parts = CAT_KEYS.filter((k) => state.build[k] && !state.build[k].missing).slice(0, 12).map((k) => {
      const p = state.build[k]; return { category: CATS[k], title: String(p.title || "").slice(0, 120), qty: clampQty(p.qty), price: Math.round(priceOf(p, state.cash) || 0) };
    });
    if (!parts.length) { $("#advise-out").innerHTML = `<div class="empty">조합이 비어 있습니다.</div>`; return; }
    if (adviseBusy) return;
    adviseBusy = true; btn.disabled = true;
    $("#advise-out").innerHTML = loading("AI가 조합을 평가하는 중… (최대 1~2분)");
    try {
      const pu = PURPOSES[$("#purpose").value] || PURPOSES.qhd;
      const d = await api("/api/build/advise", { parts, budget: Math.max(0, Math.round(+$("#budget").value || 0)), purpose: pu.label.slice(0, 40) });
      $("#advise-out").innerHTML = aiBox(d.advice, d.model);
    } catch (err) { $("#advise-out").innerHTML = errBox(err, "advise"); }
    finally { adviseBusy = false; btn.disabled = false; }
  }
  $("#advise-btn").addEventListener("click", runAdvise);

  // ------------------------------------------------ 자동 추천
  $("#budget-presets").innerHTML = BUDGET_PRESETS.map((b) => `<button type="button" class="chip" data-budget="${b}">${manwon(b)}</button>`).join("");
  $("#budget-presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-budget]"); if (!b) return;
    $("#budget").value = b.dataset.budget; runRecommend();
  });
  $("#purpose").addEventListener("change", (e) => { if (e.target.value === "work" && $("#storage").value === "1TB") $("#storage").value = "2TB"; });
  function renderMinHint() {
    if (!state.loaded) { $("#min-hint").textContent = ""; return; }
    const r = recommend(state.parts, { cash: state.cash, storage: "1TB" });
    $("#min-hint").textContent = r.minTotal ? `지금 가격으로 가능한 최저 조합은 약 ${manwon(r.minTotal)}입니다.` : "";
  }

  function comboCard(c, label, { best = false, budget = null } = {}) {
    const left = budget != null && isFinite(budget) ? budget - c.total : null;
    const code = encodeBuild(Object.fromEntries(Object.entries(c.items).map(([k, [p, q]]) => [k, { pcode: p.pcode, qty: q }])));
    return `<article class="combo ${best ? "best" : ""}">
      <div class="combo-head"><h3>${esc(label)}</h3>
        <span class="combo-total">${won(c.total)}</span></div>
      <div class="combo-meta"><span class="tag" title="RTX 5060 Ti·라이젠 9600X 조합 ≈ 90 기준의 대략적 상대값">성능 지수 ${c.score.toFixed(0)}</span>
        <span class="tag good" title="100만원당 성능 지수">100만원당 ${c.value.toFixed(1)}</span>
        ${left != null ? `<span class="tag ${left >= 0 ? "good" : "cash"}">예산보다 ${won(Math.abs(left))} ${left >= 0 ? "남음" : "초과"}</span>` : ""}</div>
      <ul>${Object.entries(c.items).map(([k, [p, q]]) => `<li><b>${CATS[k]}</b> ${ext(p.url, p.title)}${q > 1 ? ` ×${q}` : ""}
        <span class="li-price">${won(priceOf(p, state.cash) * q)} ${basisTag(p)} ${buyHtml(p)}</span></li>`).join("")}</ul>
      <div class="row wrap"><button type="button" class="small" data-apply="${esc(code)}">이 조합 담기</button>
        <button type="button" class="small ghost" data-share-combo="${esc(code)}">이 조합 링크 복사</button></div>
    </article>`;
  }

  function runRecommend(opts) {
    const out = $("#auto-out");
    const budget = opts?.budget ?? Math.round(+$("#budget").value);
    const storage = opts?.storage ?? $("#storage").value, purpose = opts?.purpose ?? $("#purpose").value;
    if (!state.loaded) {
      if (state.loadError) { out.innerHTML = `<div class="error" role="alert">⚠ 가격 데이터를 불러오지 못해 추천할 수 없습니다. <button type="button" class="small ghost" data-retry="parts">다시 시도</button></div>`; return; }
      state.pendingRec = true; out.innerHTML = loading("가격 데이터를 불러오는 중… 끝나면 바로 추천합니다."); return;
    }
    if (!(budget > 0)) { out.innerHTML = `<div class="error">예산을 원 단위 숫자로 입력하세요. 예: 2500000</div>`; return; }
    state.lastRec = { budget, storage, purpose };
    const r = recommend(state.parts, { budget, storage, purpose, cash: state.cash });
    if (r.missing) { out.innerHTML = `<div class="empty">조합을 만들 가격 데이터가 부족합니다. 데이터가 갱신되면 다시 시도하세요.</div>`; return; }
    const pu = PURPOSES[purpose] || PURPOSES.qhd;
    let html = `<p class="hint">${esc(pu.label)} 기준 · ${state.cash ? "현금/조건부 포함 최저가" : "일반결제 최저가(없으면 다나와 표시가)"} · 조합 ${r.count}가지 계산</p>`;
    if (r.fit.length) {
      html += r.fit.map((c, i) => comboCard(c, i === 0 ? "🐉 예산 안 최고 성능 (드래곤볼)" : `대안 ${i}`, { best: i === 0, budget })).join("");
    } else {
      html += `<div class="notice" role="status">예산 ${won(budget)}으로는 지금 가격에 맞는 조합이 없습니다. 가장 저렴한 조합(<b>${won(r.cheapest.total)}</b>)까지 <b>${won(r.cheapest.total - budget)}</b>이 부족합니다.
        <button type="button" class="small ghost" data-budget="${Math.ceil(r.cheapest.total / 100000) * 100000}">예산을 ${manwon(Math.ceil(r.cheapest.total / 100000) * 100000)}으로 올려 다시 찾기</button></div>`;
      html += comboCard(r.cheapest, "가장 저렴한 조합", { budget });
    }
    if (r.bestValue && !r.fit.includes(r.bestValue) && (r.fit.length || r.bestValue !== r.cheapest)) html += comboCard(r.bestValue, "가성비 1위 조합 (예산 무관)", { budget });
    out.innerHTML = html;
  }
  $("#auto-form").addEventListener("submit", (e) => { e.preventDefault(); runRecommend(); });
  $("#auto-out").addEventListener("click", (e) => {
    const bb = e.target.closest("[data-budget]");
    if (bb) { $("#budget").value = bb.dataset.budget; runRecommend(); return; }
    const sh = e.target.closest("[data-share-combo]");
    if (sh) { copyText(location.origin + location.pathname + "#b=" + sh.dataset.shareCombo, "공유 링크"); return; }
    const b = e.target.closest("[data-apply]"); if (!b) return;
    const saved = decodeBuild(b.dataset.apply); if (!saved) return;
    state.undo = Object.keys(state.build).length ? { ...state.build } : null;
    state.build = hydrateBuild(saved, state.parts);
    saveBuild(); renderBuild(); renderPartsTable();
    toast(`조합을 담았습니다. 아래 ‘내 조합’에서 확인하세요.${state.undo ? ` <button type="button" class="small ghost" data-undo>되돌리기</button>` : ""}`, 6000);
    $("#build-card").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ------------------------------------------------ 첫 방문 안내
  if (store.get("dragonball-intro") === "hidden") $("#intro").hidden = true;
  $("#intro-close").addEventListener("click", () => { $("#intro").hidden = true; store.set("dragonball-intro", "hidden"); $("#budget").focus(); });
  $("#intro-go").addEventListener("click", () => { $("#budget").value = 2500000; runRecommend(); $("#auto-card").scrollIntoView({ behavior: "smooth" }); });

  // ------------------------------------------------ 웹 리서치 (🔒)
  const PRESETS = ["RTX 5070 vs RX 9070 XT 게이밍 성능 비교", "9800X3D vs 7800X3D 게이밍 차이", "RTX 5060 Ti 16GB 가성비",
    "B650M vs B850M 차이 추천", "DDR5 6000 CL30 vs 5600 게이밍 차이", "2026 가성비 조립PC 견적 추천"];
  $("#research-presets").innerHTML = PRESETS.map((p) => `<button type="button" class="chip" data-preset="${esc(p)}">${esc(p)}</button>`).join("");
  const seq = { research: 0, yt: 0 }, busy = { research: false, yt: false, ytUrl: false };
  $("#research-presets").addEventListener("click", (e) => {
    const c = e.target.closest("[data-preset]"); if (!c || busy.research) return;
    $("#research-q").value = c.dataset.preset; runResearch();
  });
  async function runResearch() {
    const out = $("#research-out"), q = $("#research-q").value.trim();
    if (q.length < 2) { out.innerHTML = `<div class="error">검색어를 2자 이상 입력하세요.</div>`; return; }
    if (busy.research) return;
    const tok = ++seq.research, summarize = $("#research-sum").checked;
    busy.research = true; $("#research-form button[type=submit]").disabled = true; $("#research-presets").classList.add("is-busy");
    out.innerHTML = loading(summarize ? "웹 자료를 모으고 AI가 요약하는 중… (20~60초)" : "웹 자료 검색 중…");
    try {
      const d = await api("/api/research", { query: q.slice(0, 100), summarize });
      if (tok !== seq.research) return;
      const results = Array.isArray(d.results) ? d.results : [];
      out.innerHTML = (d.summary ? aiBox(d.summary, d.model) : "") +
        (results.length ? results.map((r, i) => { const u = safeUrl(r.url); return `<div class="result">
          <h3>[${i + 1}] ${ext(u, r.title || r.url)}</h3>
          <div class="url">${esc(r.url)}</div><p>${esc(r.description)}</p>
          ${u !== "#" ? `<button type="button" class="small ghost" data-page="${esc(u)}">이 페이지 요약 <span class="lock-ico" aria-hidden="true">🔒</span></button><div class="md" aria-live="polite"></div>` : ""}</div>`; }).join("")
          : `<div class="empty">결과가 없습니다. 검색어를 바꿔보세요.</div>`);
    } catch (err) { if (tok === seq.research) out.innerHTML = errBox(err, "research"); }
    finally { busy.research = false; $("#research-form button[type=submit]").disabled = false; $("#research-presets").classList.remove("is-busy"); }
  }
  $("#research-form").addEventListener("submit", (e) => { e.preventDefault(); runResearch(); });
  $("#research-out").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-page]"); if (!b || b.disabled) return;
    const box = b.nextElementSibling;
    b.disabled = true; box.innerHTML = loading("페이지를 읽고 요약하는 중…");
    try {
      const d = await api("/api/page/summary", { url: b.dataset.page.slice(0, 500), question: $("#research-q").value.trim().slice(0, 100) });
      box.innerHTML = aiBox(d.summary, d.model);
    } catch (err) { box.innerHTML = errBox(err); }
    finally { b.disabled = false; }
  });

  // ------------------------------------------------ 유튜브 (🔒)
  async function runYt() {
    const out = $("#yt-out"), q = $("#yt-q").value.trim();
    if (q.length < 2) { out.innerHTML = `<div class="error">검색어를 2자 이상 입력하세요.</div>`; return; }
    if (busy.yt) return;
    const tok = ++seq.yt; busy.yt = true; $("#yt-form button[type=submit]").disabled = true;
    out.innerHTML = loading("유튜브 리뷰 영상을 찾는 중…");
    try {
      const d = await api("/api/youtube/search", { query: q.slice(0, 60) });
      if (tok !== seq.yt) return;
      const vids = Array.isArray(d.videos) ? d.videos : [];
      out.innerHTML = vids.length ? `<div class="videos">${vids.map((v) => {
        const url = normalizeYt(v.url) || safeUrl(v.url), id = /^[\w-]{11}$/.test(v.video_id || "") ? v.video_id : "";
        return `<div class="video">
          ${id ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img loading="lazy" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt=""></a>` : ""}
          <div class="body"><h3>${ext(url, v.title || v.url)}</h3>
          <div class="spec">${esc((v.description || "").slice(0, 140))}</div>
          ${normalizeYt(v.url) ? `<button type="button" class="small" data-yt="${esc(normalizeYt(v.url))}">AI 영상 요약 <span class="lock-ico" aria-hidden="true">🔒</span></button><div class="vsum md" aria-live="polite"></div>` : ""}</div></div>`;
      }).join("")}</div>` : `<div class="empty">유튜브 영상을 찾지 못했습니다. 검색어를 바꿔보세요.</div>`;
    } catch (err) { if (tok === seq.yt) out.innerHTML = errBox(err, "yt"); }
    finally { busy.yt = false; $("#yt-form button[type=submit]").disabled = false; }
  }
  $("#yt-form").addEventListener("submit", (e) => { e.preventDefault(); runYt(); });

  async function ytSummary(url, box, btn) {
    if (btn) btn.disabled = true;
    box.innerHTML = loading("AI가 영상을 보는 중… (길이에 따라 30초~2분)");
    try { const d = await api("/api/youtube/summary", { url }); box.innerHTML = aiBox(d.summary, d.model); }
    catch (err) { box.innerHTML = errBox(err); }
    finally { if (btn) btn.disabled = false; }
  }
  $("#yt-out").addEventListener("click", (e) => {
    const b = e.target.closest("[data-yt]"); if (!b || b.disabled) return;
    ytSummary(b.dataset.yt, b.nextElementSibling, b);
  });
  async function runYtUrl() {
    if (busy.ytUrl) return;
    const url = normalizeYt($("#yt-url").value);
    if (!url) { $("#yt-out").innerHTML = `<div class="error">유튜브 영상 주소만 요약할 수 있습니다. 예: https://www.youtube.com/watch?v=…, https://youtu.be/…, 쇼츠 주소</div>`; return; }
    busy.ytUrl = true; ++seq.yt;
    $("#yt-out").innerHTML = `<div class="md" aria-live="polite"></div>`;
    await ytSummary(url, $("#yt-out .md"), $("#yt-url-form button[type=submit]"));
    busy.ytUrl = false;
  }
  $("#yt-url-form").addEventListener("submit", (e) => { e.preventDefault(); runYtUrl(); });

  // ------------------------------------------------ 다시 시도 / 접근 코드 버튼
  const RETRY = { parts: loadParts, live: runLive, research: runResearch, yt: runYt, advise: runAdvise };
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-retry], [data-unlock]"); if (!b) return;
    if (b.hasAttribute("data-unlock")) { const c = await askCode(); if (!c) return; }
    RETRY[b.dataset.retry]?.();
  });

  // ------------------------------------------------ 탭 (ARIA + 방향키)
  const tabs = $$("[role=tab]");
  function showTab(name, focus = false) {
    const t = tabs.find((x) => x.dataset.tab === name) || tabs[0];
    tabs.forEach((x) => { const on = x === t; x.classList.toggle("active", on); x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1; });
    $$("[role=tabpanel]").forEach((p) => { const on = p.id === `tab-${t.dataset.tab}`; p.classList.toggle("active", on); p.hidden = !on; });
    if (focus) t.focus();
    store.set("dragonball-tab", t.dataset.tab);
  }
  $(".tabs").addEventListener("click", (e) => { const t = e.target.closest("[role=tab]"); if (t) showTab(t.dataset.tab); });
  $(".tabs").addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (j == null) return;
    e.preventDefault(); showTab(tabs[(j + tabs.length) % tabs.length].dataset.tab, true);
  });
  showTab(store.get("dragonball-tab") || "builder");
  window.addEventListener("hashchange", () => { if (hashCode(location.hash) && state.loaded) { restoreBuild(); renderBuild(); renderPartsTable(); } });

  $("#build-table").innerHTML = loading("내 조합을 불러오는 중…");
  loadStatus();
  loadParts();
}
