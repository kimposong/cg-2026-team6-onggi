// src/shared/workbench.js — 1~3단계 공통 작업대
// ① 물레는 저절로 돌지 않는다: 마우스 왼쪽 버튼(또는 한 손가락)으로 누른 채 좌우로 흔들 때만 그 방향으로 돈다
// ② 오른쪽 세로 인벤토리(재료 슬롯) ③ 안내 문구(조작 + 결과) ④ 1~2단계가 함께 쓰는 흙 덩어리 메시
//    (2026-11-20 피그마 적용) ② → 화면 아래 가로 슬롯 바 4칸(흙·물·잿물·장작 그림) + 그 아래 그림 버튼 줄(buttonRow).
//    재료는 자유롭게 끌고, 화면이 받지 않은 재료(잘못된 재료)는 안내 문구와 함께 슬롯으로 튕겨 돌아간다
// ⑤ 3단계(흙 쌓고 빚기)가 쓰는 "쌓이는 옹기 벽" 메시 — 올린 단의 반지름이 바뀌면 바로 다시 계산한다

const Work = (() => {
  const { mat4 } = glMatrix;
  const FOVY = (40 * Math.PI) / 180;
  const cam = Camera.createOrbit();
  // 4단계(stage4-shape.js)와 같은 카메라 값: 각도 12°, 바라보는 높이 0.65(기본 옹기 높이 1.3의 절반), 같은 거리 → 물레·옹기 크기가 단계가 바뀌어도 똑같다
  const FOCUS_DEFAULT = 0.65;
  // (2026-11-20) shiftY: 아래 슬롯 바·버튼이 생겨 물레·옹기가 너무 낮아 보여서, 각도는 그대로 두고 장면 전체를 화면 높이의 8% 위로 (core/camera.js 렌즈 이동)
  const SHIFT_Y = 0.08;
  // (2026-11-20) 물레·옹기 화면 크기 배율 — 배경 그림 속 소품에 비해 너무 커서 30% 작게 (0.7). 카메라 거리를 1/0.7 배로 늘려 줄인다
  // (2026-11-20 사용자 조정) 0.7 → 0.8 (원래의 80%)
  const SCENE_SCALE = 0.8;
  const camCfg = { yaw: 0, pitch: (12 * Math.PI) / 180, target: [0, FOCUS_DEFAULT, 0], dist: 4, fovy: FOVY, shiftY: SHIFT_Y };
  /* 줌아웃 배율 (사용자 결정, 2026-11-16): 화면 중심(바라보는 높이)과 기준 거리는 1~3단계 모두 처음 값 그대로.
   * 3단계에서 옹기가 기본 높이보다 높아지면 그 비율만큼 거리를 늘린다(zoom > 1). 1·2단계는 항상 1.
   * 화면 중심이 고정일 때 거리를 (꼭대기 높이 − 중심) 비율로 늘리면 꼭대기의 화면 위치가 정확히 그대로 유지된다 (투영식에서 dist ∝ h) */
  let zoom = 1;
  function setZoom(z) { zoom = Math.max(1, z); }
  /* (2026-11-24 사용자 요청) 3·4단계는 물레·옹기를 아래로 내린다: 옹기 중심(바라보는 높이)과 화면 맨 아래 사이 거리를 40% 줄인다.
   * 바라보는 점은 화면 위에서 (0.5 − shiftY)·H 에 찍히므로 맨 아래까지 거리는 (0.5 + shiftY)·H.
   * 이것을 0.6 배로 → shiftY' = shiftY − 0.4·(0.5 + shiftY) = 0.08 − 0.232 = −0.152 (렌즈 이동이라 각도·크기·줌 규칙은 그대로)
   * → (2026-11-24 사용자 조정) 40% 는 너무 낮아서 20% 로: 0.08 − 0.2·0.58 = −0.036
   * → (2026-11-24 사용자 조정) 비율 대신 "3단계에서 물레 바닥이 아래 버튼(슬롯 바)보다 조금 위" — 고정값으로 계산해 둔다 (매 프레임 계산 안 함)
   *   휴대폰 9:16 기준, 기본 옹기(줌 1): 카메라 거리 7.05, 물레 아랫면 앞쪽 가장자리 (0, −0.1, 1)은 렌즈 이동 0 일 때 화면 위에서 0.708H.
   *   슬롯 바 윗변 0.776H 보다 조금(s×0.015 ≈ 0.008H) 위 = 0.768H 에 오려면 shiftY = 0.708 − 0.768 = −0.06. 4단계도 같은 값을 쓴다 */
  // const LOWER_RATIO = 0.2;
  // const SHIFT_Y_LOW = SHIFT_Y - LOWER_RATIO * (0.5 + SHIFT_Y);
  const SHIFT_Y_LOW = -0.06;
  let shiftGoal = SHIFT_Y;          // 화면이 정하는 목표 — update 에서 camCfg.shiftY 가 부드럽게 따라간다 (단계가 바뀔 때 툭 튀지 않게)
  function setShift(v) { shiftGoal = v; }
  let distReady = false;            // 처음 한 번은 보간 없이 바로 그 거리에서 시작
  let autoDist = 4;                 // 기준 거리 × 자동 줌아웃을 부드럽게 따라가는 값 (여기에 사용자 줌을 곱해 실제 거리가 된다)

  /* 사용자 줌·상하 이동 (2026-11-16, 3단계만 켠다 — 1·2단계는 기본값 그대로)
   * userZoom   : 휠·핀치로 바꾸는 배율 (ZOOM_MIN ~ ZOOM_MAX, 1 = 기준 거리). 자동 줌아웃(zoom)과 곱해진다
   * panY       : 바라보는 높이의 오프셋(월드 단위). 옹기 밖을 잡고 위아래로 끌면 바뀐다 (확대했을 때 위아래를 보기 위해)
   * panEnabled : 끌어서 상하 이동을 받을지. targetMin~targetMax = 바라보는 높이가 움직일 수 있는 범위 (화면이 정한다) */
  const ZOOM_MIN = 0.4, ZOOM_MAX = 1.6;
  const view = { userZoom: 1, panY: 0, panEnabled: false, targetMin: FOCUS_DEFAULT, targetMax: FOCUS_DEFAULT };
  function zoomBy(f) { view.userZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.userZoom * f)); }
  /** 화면 픽셀 dy 만큼 끌었을 때 바라보는 높이를 옮긴다 (아래로 끌면 장면이 따라 내려오므로 바라보는 높이는 올라간다) */
  function panBy(ctx, dy) {
    const a = Camera.worldToScreen(cam.viewProj, [0, 0, 0], ctx.W, ctx.H), b = Camera.worldToScreen(cam.viewProj, [0, 1, 0], ctx.W, ctx.H);
    view.panY += dy / Math.max(1, Math.abs(a.y - b.y));          // 세로 1 단위 = 몇 픽셀
  }
  function resetView() { view.userZoom = 1; view.panY = 0; view.panEnabled = false; view.targetMin = view.targetMax = FOCUS_DEFAULT; }
  const m = mat4.create();

  // (2026-11-20) slot = 슬롯 칸 그림, item = 끌고 다니는 재료 그림. emoji·name 은 그림을 불러오기 전에 대신 보인다
  // 타래(coil)는 피그마에 없어 뺐다 — 3단계는 흙을 끌어다 쌓는다
  const ITEMS = {
    soil:  { emoji: '🟤', name: '흙',   slot: './assets/ui/slots/slot-clay.png',     item: './assets/items/item-clay.png' },
    water: { emoji: '💧', name: '물',   slot: './assets/ui/slots/slot-water.png',    item: './assets/items/item-water.png' },
    glaze: { emoji: '🥣', name: '잿물', slot: './assets/ui/slots/slot-glaze.png',    item: './assets/items/item-glaze-bowl.png' },
    wood:  { emoji: '🪵', name: '장작', slot: './assets/ui/slots/slot-firewood.png', item: './assets/items/item-firewood.png' },
  };
  const ALL_ITEMS = ['soil', 'water', 'glaze', 'wood'];   // 피그마: 1~5단계 모두 같은 4칸
  const BACK_TIME = 0.35;                                  // 잘못된 재료가 슬롯으로 튕겨 돌아가는 시간(초)

  /* 1~3단계가 함께 쓰는 상태 */
  const S = {
    angle: 0,                         // 물레 각도 — 드래그할 때만 바뀐다
    clay: { wet: 0, smooth: 0 },      // 1단계에서 만든 반죽 상태 (2단계가 이어받는다)
  };
  const inv = { items: [], open: 0, target: 1 };   // open: 0(접힘) ~ 1(펼침) — (2026-11-20) 접히면 슬롯 바가 화면 아래로 내려간다
  const g = { mode: null, x0: 0, y0: 0, lastX: 0, lastY: 0, onClay: false, item: null, ix: 0, iy: 0, off: 0 };
  let back = null;                                  // (2026-11-20) 튕겨 돌아가는 재료 { id, x, y, t } — t: 0 → 1
  let hintLines = [], hintUntil = 0;

  const lerp = (a, b, t) => a + (b - a) * t;
  const easeBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

  /* ---------- 인벤토리 ---------- */
  function setInventory(ids, open) { inv.items = ids; inv.target = open ? 1 : 0; }
  /* (2026-11-24 사용자 요청) 이 단계에서 쓰는 재료 — 목록에 없는 칸은 반투명하게 그린다 (끌기는 그대로 되고, 화면이 안내 + 튕겨 돌려보낸다).
   * null = 모두 진하게. 각 화면이 enter 에서 정한다 */
  let activeItems = null;
  const UNUSED_ALPHA = 0.35;        // 안 쓰는 재료 칸의 투명도
  function setActiveItems(ids) { activeItems = ids; }
  const isActive = (id) => !activeItems || activeItems.includes(id);
  function hint(lines) { hintLines = Array.isArray(lines) ? lines : [lines]; hintUntil = performance.now() + 1700; }

  /* (2026-11-20 피그마) 화면 아래부터 쌓는다: 맨 아래 버튼 줄(yBtn) → 그 위 슬롯 바(가로 가운데 정렬).
   * 크기는 짧은 변 s 비율 — 세로 휴대폰에서 피그마와 비슷한 위치(슬롯 ≈ 0.86H, 버튼 ≈ 0.95H)가 된다.
   * 접히면(open → 0) 슬롯 바가 화면 아래로 내려간다. restTop = 펼쳤을 때 슬롯 바 윗변 (화면이 그 위에 슬라이더 등을 둘 때 쓴다) */
  /* (2026-11-20 비율 조정) 피그마 9:16 프레임에서 잰 값. 크기·가로 = 프레임 폭 u 의 비율, 세로 위치 = 화면 높이 H 의 비율.
   * u = min(W, H × 9/16) — 배경 그림(높이 기준)이 화면에서 차지하는 폭. 세로 휴대폰은 화면 폭, PC 가로 창은 가운데 배경 폭이 된다.
   * 그림 파일에는 투명 여백이 있어서, "보이는 부분" 크기를 맞추도록 그림 크기를 나눠 둔다 (slot 그림은 보이는 부분이 88%) */
  const FIG = {
    slotVis: 0.177, slotImg: 0.201, slotPitch: 0.204, slotY: 0.826,   // 슬롯: 보이는 폭 0.177u, 칸 사이 0.027u, 중심 높이 0.826H
    btnW: 0.333, btnGap: 0.052, btnY: 0.93,                            // 버튼: 폭 0.333u (높이는 그림 비율), 두 개면 사이 0.052u, 중심 0.93H
  };
  const frameUnit = (ctx) => Math.min(ctx.W, ctx.H * 9 / 16);
  const BTN_H = 0.1;                                       // 버튼 높이 = s × 0.1 (터치 대상은 짧은 변의 8% 이상) — (2026-11-20) 그림 전 대체 높이로만 쓴다
  function layout(ctx) {
    const { W, H } = ctx, u = frameUnit(ctx);
    const bh = (u * FIG.btnW) / 3, yBtn = H * FIG.btnY;   // 버튼 그림 비율 3:1 → 높이 0.111u (터치 대상 8% 이상)
    const sz = u * FIG.slotImg, pitch = u * FIG.slotPitch, vis = u * FIG.slotVis;
    const yRest = H * FIG.slotY;
    const y = yRest + (1 - inv.open) * (H - yRest + sz);
    const n = inv.items.length, span = Math.max(0, n - 1) * pitch;   // 첫 칸 중심 ~ 마지막 칸 중심
    const slots = inv.items.map((id, i) => ({ id, x: W / 2 - span / 2 + i * pitch, y }));
    return { u, sz, gap: pitch - vis, slots, x0: W / 2 - span / 2 - vis / 2, x1: W / 2 + span / 2 + vis / 2,
      top: y - vis / 2, bottom: y + vis / 2, restTop: yRest - vis / 2, yBtn, bh };
  }

  /** (x, y)가 인벤토리 패널 위인지 — 화면이 자기 조작(고리 잡기 등)보다 인벤토리를 먼저 양보할 때 쓴다 */
  function inInventory(ctx, x, y) {
    if (!inv.items.length || inv.open < 0.5) return false;
    const L = layout(ctx), pad = ctx.s * 0.02;
    return x >= L.x0 - pad && x <= L.x1 + pad && y >= L.top - pad && y <= L.bottom + pad;
  }

  /** 재료 그림 하나: 중심 (x, y), 긴 변 d. 그림이 아직 없으면 이모지 */
  function drawItem(ctx, id, x, y, d, alpha = 1) {
    const t = ImageTex.get(ctx.gl, ITEMS[id].item);
    if (t.ready) {
      const w = t.aspect >= 1 ? d : d * t.aspect, h = w / t.aspect;
      ctx.ui.drawImage(t, x - w / 2, y - h / 2, w, h, [1, 1, 1, alpha]);
    } else ctx.ui.drawText(ctx.ui.text(ITEMS[id].emoji), x, y, d, 'center', Infinity, [1, 1, 1, alpha]);
  }

  function drawInventory(ctx) {
    const { ui, s } = ctx;
    const L = layout(ctx);
    if (inv.open > 0.01) {
      L.slots.forEach((sl) => {
        // 지금 끌고 있거나 돌아오는 중인 재료의 칸은 살짝 흐리게 (재료가 칸에서 빠져나간 느낌)
        const away = g.item === sl.id || (back && back.id === sl.id);
        // (2026-11-24) 이 단계에서 안 쓰는 재료는 반투명 (UNUSED_ALPHA). 끌고 있는 칸의 흐림(0.6)과 곱한다
        const a = (away ? 0.6 : 1) * (isActive(sl.id) ? 1 : UNUSED_ALPHA);
        const t = ImageTex.get(ctx.gl, ITEMS[sl.id].slot);
        // if (t.ready) ui.drawImage(t, sl.x - L.sz / 2, sl.y - L.sz / 2, L.sz, L.sz, away ? [1, 1, 1, 0.6] : [1, 1, 1, 1]);
        if (t.ready) ui.drawImage(t, sl.x - L.sz / 2, sl.y - L.sz / 2, L.sz, L.sz, [1, 1, 1, a]);
        else {
          ui.rect(sl.x - L.sz / 2, sl.y - L.sz / 2, L.sz, L.sz, [1, 1, 1, 0.14 * a], s * 0.02);
          ui.drawText(ui.text(ITEMS[sl.id].emoji), sl.x, sl.y - L.sz * 0.12, L.sz * 0.5, 'center', Infinity, [1, 1, 1, a]);
          ui.drawText(ui.text(ITEMS[sl.id].name), sl.x, sl.y + L.sz * 0.33, L.sz * 0.2, 'center', L.sz * 0.9, [1, 1, 1, a]);
        }
      });
    }
    // 슬롯으로 튕겨 돌아가는 재료: 놓은 곳 → 제 칸 (끝에서 살짝 감속)
    if (back) {
      const sl = L.slots.find((q) => q.id === back.id);
      const k = 1 - Math.pow(1 - back.t, 3);
      const tx = sl ? sl.x : back.x, ty = sl ? sl.y : L.bottom + L.sz;
      drawItem(ctx, back.id, lerp(back.x, tx, k), lerp(back.y, ty, k), lerp(L.u * 0.14, L.sz * 0.6, k));   // (2026-11-20) 크기도 프레임 폭 u 기준
    }
    // 끌고 있는 재료
    if (g.mode === 'item') drawItem(ctx, g.item, g.ix, g.iy - g.off, L.u * 0.14);
  }

  /** (2026-11-20) 재료를 (x, y)에서 제 슬롯으로 튕겨 보낸다 — 잘못된 재료이거나 슬롯 바 위에서 놓았을 때 */
  function sendBack(id, x, y) { back = { id, x, y, t: 0 }; }

  /**
   * (2026-11-20) 화면 맨 아래 그림 버튼 줄 — 가운데 정렬. defs = [{ id, img(경로), label(그림 전 대체 글자), dim? }]
   * 버튼 폭은 그림 비율대로 (그림 전에는 3:1). 반환값은 ui.imageButton / ui.hit 에 그대로 쓴다
   */
  function buttonRow(ctx, defs) {
    const { W } = ctx, L = layout(ctx), gap = L.u * FIG.btnGap;
    // (2026-11-20 비율 조정) 폭을 피그마 값(0.333u)으로 고정하고 높이는 그림 비율대로
    const list = defs.map((d) => {
      const tex = ImageTex.get(ctx.gl, d.img), w = L.u * FIG.btnW;
      return { ...d, tex, w, h: w / (tex.ready ? tex.aspect : 3), y: L.yBtn };
    });
    const total = list.reduce((a, b) => a + b.w, 0) + gap * Math.max(0, list.length - 1);
    let x = W / 2 - total / 2;
    for (const b of list) { b.x = x + b.w / 2; x += b.w + gap; }
    return list;
  }

  /* ---------- 안내 문구: 제목 / 조작 설명(여러 줄) / 결과 ---------- */
  function drawGuide(ctx, title, lines, goal) {
    const { W, H, s, ui } = ctx;
    ui.drawText(ui.text(title), W / 2, H * 0.055, s * 0.065, 'center', W * 0.9);
    let y = H * 0.055 + s * 0.075;
    const hinting = performance.now() < hintUntil;
    (hinting ? hintLines : lines).forEach((l) => {
      ui.drawText(ui.text(l, { weight: 400 }), W / 2, y, s * 0.036, 'center', W * 0.92, hinting ? [1, 0.62, 0.42, 1] : [1, 0.92, 0.85, 0.92]);
      y += s * 0.046;
    });
    if (!hinting && goal) ui.drawText(ui.text(goal, { weight: 400 }), W / 2, y + s * 0.01, s * 0.03, 'center', W * 0.94, [1, 0.92, 0.85, 0.55]);
  }

  /* ---------- (2026-11-20 피그마) 위쪽 단계 배너: 제목·안내 글자 대신 배너 그림 + 그 아래 작은 한 줄 ----------
   * n = 피그마 단계 번호 (banner-stage{n}.png). 피그마에서 잰 값: 보이는 폭 0.745u, 세로 0.10H ~ 0.21H.
   * 배너 그림은 보이는 부분이 폭의 98.1%, 세로 중심이 그림 높이의 49.1% 지점.
   * sub = 배너만으로 알 수 없는 정보(물 붓기 단계, 지금 값 등) 한 줄. hint(잘못된 재료 안내)가 있으면 그것을 먼저 보여 준다 */
  const BANNER = { visW: 0.745, visTop: 0.10, visBot: 0.21, visFrac: 0.981, visMid: 0.491 };
  // const SUB_TEXT_H = 0.055;      // (2026-11-24) 배너 아래 설명문 글자 높이 = 프레임 폭 u × 이 값 (이전 0.045, 접근성 기준 화면 높이 3% 이상)
  const SUB_TEXT_H = 0.064;         // (2026-11-24 사용자 조정) 폭 390px 휴대폰에서 약 25px (25 ÷ 390), 화면 높이의 약 3.6%
  const SUB_MAX_W = 0.86;           // 설명문 한 줄 최대 폭 = 프레임 폭 u × 이 값 — 넘으면 줄바꿈 (2026-11-24)
  /* (2026-11-24) 줄바꿈 결과 캐시: 최대 폭과 글자 높이가 둘 다 u 비율이라 "한 줄 최대 가로세로비"(0.86 ÷ 0.064)는 화면 크기와 상관없이 같다
   * → 같은 문장·폰트면 결과도 같으므로 한 번만 잰다. 값이 바뀌는 문장(폭 % 등)이 계속 쌓이지 않게 200개가 넘으면 비운다 (메모리 증가 방지) */
  const wrapCache = new Map();
  function wrapLine(str, fontSize, fo) {
    const key = `${fontSize}|${fo.family || ''}|${str}`;
    if (!wrapCache.has(key)) {
      if (wrapCache.size > 200) wrapCache.clear();
      wrapCache.set(key, TextTex.wrap(str, SUB_MAX_W / SUB_TEXT_H, { fontSize, ...fo }));
    }
    return wrapCache.get(key);
  }
  function drawBanner(ctx, n, sub) {
    const { W, H, ui } = ctx, u = frameUnit(ctx);
    const t = ImageTex.get(ctx.gl, `./assets/ui/banners/banner-stage${n}.png`);
    const cy = H * (BANNER.visTop + BANNER.visBot) / 2;
    if (t.ready) {
      const w = (u * BANNER.visW) / BANNER.visFrac, h = w / t.aspect;
      ui.drawImage(t, W / 2 - w / 2, cy - h * BANNER.visMid, w, h);
    } else {
      ui.drawText(ui.text(`${n}단계`), W / 2, cy, u * 0.08, 'center', u * 0.9, [0.3, 0.18, 0.1, 1]);   // 그림 전 대체 글자
    }
    // 배너 아래 한 줄(또는 안내 두 줄): 밝은 바탕 알약 위에 진한 글자 (배경 벽 위에서도 잘 읽히게)
    const hinting = performance.now() < hintUntil;
    const lines = hinting ? hintLines : (sub ? [sub] : []);
    // let y = H * BANNER.visBot + u * 0.055;
    // (2026-11-24 사용자 요청) 글자 키움: 높이 0.045u → SUB_TEXT_H(0.055u). 0.045u 는 화면 높이의 약 2.5% 로 접근성 기준(3% 이상)에 못 미쳤다.
    // 0.055u ≈ 화면 높이의 3.1% (9:16 기준). 배너와의 틈·줄 간격도 글자 높이에 맞춰 늘린다 (이전과 같은 비율)
    const th = u * SUB_TEXT_H;
    let y = H * BANNER.visBot + th * 0.75 + u * 0.02;    // 알약 윗변이 배너 아래 0.02u
    // (2026-11-24) 설명문은 주아체 (ctx.fontSub). 다 받기 전에는 기본 폰트 — 받으면 opt 가 바뀌어 새 텍스처로 다시 만든다.
    // 주아체는 굵기가 하나뿐이라 weight 400 (700 을 주면 브라우저가 억지로 더 굵게 그린다)
    const fo = ctx.fontSub && ctx.fontSub.ready ? { family: ctx.fontSub.family, weight: 400 } : {};
    // (2026-11-24 사용자 요청) 길면 글자를 줄이지 않고 줄을 바꾼다 — 글자 크기 고정. 최대 폭 0.86u ÷ 글자 높이 = 한 줄 최대 가로세로비
    // (2026-11-24 사용자 요청) 줄마다 알약이 따로 생겨 화면을 많이 가렸다 → 모든 줄을 알약(박스) 하나에 담는다.
    //   안내(hint)는 원래 한 문장을 두 줄로 나눠 적은 것이라 한 문장으로 이어 붙인 뒤 폭에 맞춰 다시 나눈다 (줄 수가 줄어든다)
    if (!lines.length) return;
    const wrapped = wrapLine(lines.join(' '), hinting ? 72 : 56, fo);
    let i = 0;
    const texs = wrapped.map((l) => {
      // sub 는 값이 계속 바뀌는 글자(폭 %, 진행 %) → dynText(바뀔 때만 다시 만들고 이전 것은 지움). 안내(hint)는 정해진 문장이라 캐시
      // const tx = hinting ? ui.text(l) : ui.dynText('bannerSub', l), th = u * 0.045, tw = Math.min(tx.aspect * th, u * 0.86);
      // (2026-11-24) 줄바꿈으로 sub 도 여러 줄이 될 수 있어 줄마다 dynText 칸을 따로 둔다 (bannerSub0, bannerSub1 …)
      return hinting ? ui.text(l, fo) : ui.dynText(`bannerSub${i++}`, l, fo);
    });
    // 박스 하나: 폭 = 가장 긴 줄, 높이 = 한 줄 알약(1.5·th) + 줄이 늘 때마다 LINE_STEP·th
    const LINE_STEP = 0.95;                               // 박스 안 줄 간격 (글자 텍스처 높이 th 에는 위아래 여백이 있어 1 보다 작아도 겹치지 않는다)
    const tw = Math.max(...texs.map((tx) => Math.min(tx.aspect * th, u * SUB_MAX_W)));
    const bh = th * 1.5 + (texs.length - 1) * th * LINE_STEP;
    const top = y - th * 0.75;
    ui.rect(W / 2 - tw / 2 - u * 0.03, top, tw + u * 0.06, bh, [1, 0.96, 0.88, 0.88], Math.min(th * 0.75, bh / 2));
    texs.forEach((tx) => {
      ui.drawText(tx, W / 2, y, th, 'center', u * SUB_MAX_W, hinting ? [0.8, 0.35, 0.1, 1] : [0.3, 0.18, 0.1, 1]);
      // y += u * 0.075;
      // y += th * 1.7;                                   // (2026-11-24) 줄 간격도 글자 높이 비율로 (알약 높이 1.5·th + 틈)
      y += th * LINE_STEP;
    });
  }

  /* ---------- 입력: 재료 끌기 / 물레 돌리기 / 눌러서 터치 ----------
   * cb = { hitClay(ctx,x,y) → bool, onDrop(id,x,y), onTap(x,y) }
   * 누른 채 조금 움직이면 '물레 돌리기'가 되고, 움직이지 않고 떼면 '터치'가 된다
   * (2026-11-20) onDrop 은 재료를 받았으면 true 를 돌려준다. true 가 아니면(잘못된 재료·잘못된 곳) 재료가 슬롯으로 튕겨 돌아간다
   *              — 안내 문구(hint)는 화면이 onDrop 안에서 띄운다 */
  function down(ctx, x, y, type, cb) {
    const L = layout(ctx);
    g.off = type === 'mouse' ? 0 : ctx.s * 0.08;
    if (inv.open > 0.9) {
      for (const sl of L.slots) {
        if (Math.abs(x - sl.x) <= L.sz / 2 && Math.abs(y - sl.y) <= L.sz / 2) {
          if (back && back.id === sl.id) back = null;   // 돌아오는 중인 재료를 다시 잡으면 바로 잡힌다
          g.mode = 'item'; g.item = sl.id; g.ix = x; g.iy = y; return;
        }
      }
    }
    g.mode = 'press'; g.x0 = g.lastX = x; g.y0 = g.lastY = y; g.onClay = cb.hitClay(ctx, x, y);
  }
  function move(ctx, x, y) {
    if (g.mode === 'item') { g.ix = x; g.iy = y; return; }
    if (g.mode === 'press' && Math.hypot(x - g.x0, y - g.y0) > ctx.s * 0.02) g.mode = 'rotate';
    if (g.mode === 'rotate') {
      S.angle += ((x - g.lastX) / ctx.W) * Math.PI * 1.5;   // 오른쪽으로 밀면 앞면이 오른쪽으로 간다
      if (view.panEnabled && !g.onClay) panBy(ctx, y - g.lastY);   // 옹기 밖을 잡았으면 위아래로 끌어 화면을 옮긴다 (확대했을 때 위아래 보기)
    }
    g.lastX = x; g.lastY = y;
  }
  function up(ctx, x, y, cb) {
    const mode = g.mode; g.mode = null;
    if (mode === 'item') {
      const id = g.item, iy = y - g.off;
      g.item = null;
      // 인벤토리(슬롯 바) 위에서 놓으면 취소 → 제자리로. 화면이 받지 않은 재료도 제자리로 튕겨 돌아간다
      const ok = !inInventory(ctx, x, iy) && cb.onDrop(id, x, iy) === true;
      if (!ok) sendBack(id, x, iy);
    } else if (mode === 'press' && g.onClay && cb.onTap) cb.onTap(x, y);
  }
  const holding = () => g.mode === 'press' && g.onClay;     // 2단계: 흙을 누르고 있는 동안
  /** 두 번째 손가락이 닿아(핀치) 한 손가락 조작이 끊겼을 때: 끌던 재료는 놓지 않고 취소한다 (2026-11-20: 제자리로 튕겨 돌아간다) */
  function cancel() { if (g.mode === 'item' && g.item) sendBack(g.item, g.ix, g.iy - g.off); g.mode = null; g.item = null; }

  /* ---------- 화면 위치 판정 ---------- */
  // 반지름 R, 높이 h인 물체가 화면에서 차지하는 사각형(여유 포함) 안에 (x,y)가 있는지
  function hitClay(ctx, x, y, R, h) {
    const { W, H, s } = ctx, vp = cam.viewProj, pad = s * 0.04;
    const c = Camera.worldToScreen(vp, [0, h / 2, 0], W, H);
    const side = Camera.worldToScreen(vp, [R, h / 2, 0], W, H);
    const front = Camera.worldToScreen(vp, [0, h / 2, R], W, H);
    const top = Camera.worldToScreen(vp, [0, h, 0], W, H), bot = Camera.worldToScreen(vp, [0, 0, 0], W, H);
    const a = Math.abs(side.x - c.x) + pad, ez = Math.abs(front.y - c.y) + pad;
    return Math.abs(x - c.x) <= a && y >= Math.min(top.y, bot.y) - ez && y <= Math.max(top.y, bot.y) + ez;
  }

  function update(ctx, dt) {
    inv.open += (inv.target - inv.open) * Math.min(1, dt * 8);
    if (back && (back.t += dt / BACK_TIME) >= 1) back = null;   // 튕겨 돌아가기 끝
    // 기준 거리: 가장 큰 옹기 지름(1.8 + 고리)이 가로로 들어오는 거리 — 4단계와 같은 값. 여기에 줌아웃 배율(3단계만 1보다 큼)을 곱한다
    // const dist = Camera.fitDistance(ctx.W / ctx.H, FOVY, 2.2, 2.6) * 1.05 * zoom / SCENE_SCALE;   // (2026-11-20) ÷ SCENE_SCALE = 화면에서 SCENE_SCALE 배 크기
    // (2026-11-24) 캔버스 비율(W/H) 대신 피그마 프레임 비율(u/H)로 거리를 정한다 — 배경·버튼(2D)과 같은 기준.
    // 캔버스 비율을 쓰면 PC 가로 창에서는 높이 기준으로 맞춰져 물레가 프레임보다 넓어졌다(휴대폰의 약 1.5배).
    // 프레임 비율이면 어느 화면에서도 물레 폭 ≈ 프레임 폭 u 의 69% (세로 휴대폰은 u = W 라 이전과 똑같다)
    const dist = Camera.fitDistance(frameUnit(ctx) / ctx.H, FOVY, 2.2, 2.6) * 1.05 * zoom / SCENE_SCALE;   // ÷ SCENE_SCALE = 화면에서 SCENE_SCALE 배 크기
    // 거리가 바뀌면 부드럽게 따라간다 (갑자기 튀면 조절 중에 놓치기 쉽다)
    if (!distReady) { autoDist = dist; distReady = true; }
    else autoDist += (dist - autoDist) * Math.min(1, dt * 6);
    // 사용자 줌(휠·핀치)은 바로 반영. 상하 이동은 화면이 정한 범위 안에서만
    camCfg.dist = autoDist * view.userZoom;
    view.panY = Math.min(view.targetMax, Math.max(view.targetMin, FOCUS_DEFAULT + view.panY)) - FOCUS_DEFAULT;
    camCfg.target[1] = FOCUS_DEFAULT + view.panY;
    camCfg.shiftY += (shiftGoal - camCfg.shiftY) * Math.min(1, dt * 6);   // (2026-11-24) 3·4단계 장면 내리기 (setShift) — 부드럽게 따라간다
    cam.update(ctx.W / ctx.H, camCfg);
  }

  function drawScene(ctx, drawProps) {
    ctx.potShader.begin(cam, [0.3, 0.85, 0.45]);
    ctx.wheel.draw(S.angle);        // 물레는 angle 일 때만 돈다 (자동 회전 없음)
    drawProps();
  }

  /* ---------- 흙 덩어리 (1·2단계) / 바닥판 (3단계): 회전체 + 표면 울퉁불퉁 ---------- */
  let lump = null, lumpMesh = null;
  const LM = 48, LS = 64;
  /** 초타원 단면 r(t) = R·(1-|2t-1|^p)^(1/p): p=2 둥근 덩어리, p가 클수록 납작한 원판. amp = 표면 울퉁불퉁한 정도 */
  function setLump(ctx, R, H, p, amp) {
    const prof = [];
    for (let i = 0; i < LM; i++) {
      const t = i / (LM - 1);
      prof.push({ r: R * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * t - 1), p)), 1 / p), y: t * H });
    }
    lumpMesh = Mesh.createRevolution(prof, LS, lumpMesh || undefined);
    const P = lumpMesh.positions;
    for (let i = 0; i < LM; i++) for (let j = 0; j <= LS; j++) {
      const k = (i * (LS + 1) + j) * 3, th = (j / LS) * Math.PI * 2;
      const f = 1 + amp * (Math.sin(3 * th + i * 0.3) * 0.5 + Math.sin(5 * th - i * 0.45 + 1) * 0.5) * Math.sin(Math.PI * i / (LM - 1));
      P[k] *= f; P[k + 2] *= f;
    }
    if (!lump) lump = Mesh.uploadMesh(ctx.gl, lumpMesh, ctx.potShader.locs, true);
    else Mesh.updateMesh(ctx.gl, lump, lumpMesh);
  }
  /** wet: 0 마른 흙 → 1 젖은 흙(진한 색). k: 전체 크기(나타날 때), sq: 눌림 효과 */
  function drawLump(ctx, wet, k, sq) {
    const col = [lerp(0.7, 0.4, wet), lerp(0.54, 0.26, wet), lerp(0.42, 0.18, wet)];
    mat4.fromTranslation(m, [0, 0.003, 0]);
    mat4.rotateY(m, m, S.angle);                                   // 물레와 함께 돈다
    mat4.scale(m, m, [k * (1 + 0.06 * sq), k * (1 - 0.12 * sq), k * (1 + 0.06 * sq)]);
    ctx.potShader.draw(lump, m, col, { ridge: 0.6 });
  }

  /* ---------- 쌓이는 옹기 벽 (3단계): 올린 단의 단면(Pot.wallProfile)을 높이 top 까지만 보여 준다 ----------
   * base    = 바닥 반지름 (단면의 맨 아래 점)
   * radii   = 지금까지 올린 단의 반지름만 (길이 = 올린 단 수). 아직 안 올린 단은 곡선에 넣지 않는다 → 맨 윗단 가장자리가 엉뚱한 쪽으로 휘지 않는다
   * heights = 올린 단의 높이 (radii 와 같은 길이 — 단마다 다를 수 있다)
   * top     = 지금 보여 줄 높이 (새 단이 올라올 때 이전 윗면 → 새 윗면으로 부드럽게 자란다)
   * 매번 단면을 다시 계산한다 (121점이라 가볍다). 고리·축을 밀어 반지름·높이가 바뀌면 그 자리에서 벽이 따라 바뀐다 */
  let wall = null, wallMesh = null;
  let lining = null, liningMesh = null, wallTop = 0;   // 안쪽 면(윗테·안쪽 벽·안바닥) — 벽 두께 (2026-11-16 생김새 피드백)
  const CLAY_IN = PotShader.CLAY.map((c) => c * Pot.LINING_SHADE);   // 안쪽 면 색 (한 번만 만든다)
  const WM = 60;
  function setWall(ctx, base, radii, heights, top) {
    wallTop = top;
    const total = heights.reduce((a, b) => a + b, 0);
    const full = Pot.wallProfile(base, radii, heights, 121);
    const pts = [];
    for (let i = 0; i < WM; i++) {
      const y = (top * i) / (WM - 1), f = Math.min(1, y / total) * 120, k = Math.min(119, Math.floor(f)), t = f - k;
      pts.push({ r: lerp(full[k].r, full[k + 1].r, t), y });
    }
    wallMesh = Mesh.createRevolution(pts, 64, wallMesh || undefined);
    if (!wall) wall = Mesh.uploadMesh(ctx.gl, wallMesh, ctx.potShader.locs, true);
    else Mesh.updateMesh(ctx.gl, wall, wallMesh);
    // 안쪽 면: 같은 바깥 단면을 Pot.WALL_T 만큼 안으로 넣은 것 (점 수가 일정해서 같은 버퍼를 갱신한다)
    liningMesh = Mesh.createRevolution(Pot.liningProfile(pts), 64, liningMesh || undefined);
    if (!lining) lining = Mesh.uploadMesh(ctx.gl, liningMesh, ctx.potShader.locs, true);
    else Mesh.updateMesh(ctx.gl, lining, liningMesh);
  }
  /** sq: 눌림 효과. hl = { activeV, bandHalf } — 선택한 단을 따뜻한 띠로 강조 (벽 메시의 v = y / top 기준). 없으면 강조 안 함 */
  function drawWall(ctx, sq, hl) {
    mat4.fromTranslation(m, [0, 0.003, 0]);
    mat4.rotateY(m, m, S.angle);                                   // 바닥판과 같이 물레를 따라 돈다
    mat4.scale(m, m, [1 + 0.04 * sq, 1 - 0.06 * sq, 1 + 0.04 * sq]);
    ctx.potShader.draw(wall, m, PotShader.CLAY, { ridge: 1, activeV: hl ? hl.activeV : -1, bandHalf: hl ? hl.bandHalf : 0.1 });
    // 벽이 바닥 두께보다 높아진 뒤에만 안쪽 면을 그린다 (그 전에는 윗테가 바닥판과 겹친다)
    if (wallTop > Pot.FLOOR_T + 0.02) ctx.potShader.draw(lining, m, CLAY_IN, { ridge: 1 });
  }

  return {
    S, cam, FOCUS_DEFAULT, setZoom, view, zoomBy, panBy, resetView, easeBack, setInventory, hint, drawInventory, drawGuide,
    SHIFT_Y, SHIFT_Y_LOW, setShift,                  // (2026-11-24) 장면 세로 위치 — 3·4단계는 SHIFT_Y_LOW (물레 바닥이 슬롯 바 바로 위)
    setActiveItems,                                  // (2026-11-24) 이 단계에서 쓰는 재료 (나머지 칸은 반투명)
    down, move, up, cancel, holding, hitClay, inInventory, update, drawScene, setLump, drawLump, setWall, drawWall,
    ALL_ITEMS, buttonRow, bottomLayout: layout,      // (2026-11-20) 아래 슬롯 바 4칸 · 그림 버튼 줄 · 아래쪽 배치 정보
    drawBanner,                                      // (2026-11-20) 위쪽 단계 배너
    get inv() { return inv; },
  };
})();
