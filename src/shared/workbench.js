// src/shared/workbench.js — 1~3단계 공통 작업대
// ① 물레는 저절로 돌지 않는다: 마우스 왼쪽 버튼(또는 한 손가락)으로 누른 채 좌우로 흔들 때만 그 방향으로 돈다
// ② 오른쪽 세로 인벤토리(재료 슬롯) ③ 안내 문구(조작 + 결과) ④ 1~2단계가 함께 쓰는 흙 덩어리 메시
// ⑤ 3단계(흙 쌓고 빚기)가 쓰는 "쌓이는 옹기 벽" 메시 — 올린 단의 반지름이 바뀌면 바로 다시 계산한다

const Work = (() => {
  const { mat4 } = glMatrix;
  const FOVY = (40 * Math.PI) / 180;
  const cam = Camera.createOrbit();
  // 4단계(stage4-shape.js)와 같은 카메라 값: 각도 12°, 바라보는 높이 0.65(기본 옹기 높이 1.3의 절반), 같은 거리 → 물레·옹기 크기가 단계가 바뀌어도 똑같다
  const FOCUS_DEFAULT = 0.65;
  const camCfg = { yaw: 0, pitch: (12 * Math.PI) / 180, target: [0, FOCUS_DEFAULT, 0], dist: 4, fovy: FOVY };
  /* 줌아웃 배율 (사용자 결정, 2026-11-16): 화면 중심(바라보는 높이)과 기준 거리는 1~3단계 모두 처음 값 그대로.
   * 3단계에서 옹기가 기본 높이보다 높아지면 그 비율만큼 거리를 늘린다(zoom > 1). 1·2단계는 항상 1.
   * 화면 중심이 고정일 때 거리를 (꼭대기 높이 − 중심) 비율로 늘리면 꼭대기의 화면 위치가 정확히 그대로 유지된다 (투영식에서 dist ∝ h) */
  let zoom = 1;
  function setZoom(z) { zoom = Math.max(1, z); }
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

  const ITEMS = {
    soil:  { emoji: '🟤', name: '흙' },
    water: { emoji: '💧', name: '물' },
    coil:  { emoji: '🟫', name: '타래' },
  };

  /* 1~3단계가 함께 쓰는 상태 */
  const S = {
    angle: 0,                         // 물레 각도 — 드래그할 때만 바뀐다
    clay: { wet: 0, smooth: 0 },      // 1단계에서 만든 반죽 상태 (2단계가 이어받는다)
  };
  const inv = { items: [], open: 0, target: 1 };   // open: 0(접힘) ~ 1(펼침)
  const g = { mode: null, x0: 0, y0: 0, lastX: 0, lastY: 0, onClay: false, item: null, ix: 0, iy: 0, off: 0 };
  let hintLines = [], hintUntil = 0;

  const lerp = (a, b, t) => a + (b - a) * t;
  const easeBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

  /* ---------- 인벤토리 ---------- */
  function setInventory(ids, open) { inv.items = ids; inv.target = open ? 1 : 0; }
  function hint(lines) { hintLines = Array.isArray(lines) ? lines : [lines]; hintUntil = performance.now() + 1700; }

  // 오른쪽 가장자리에 세로로 쌓는다. 접히면(open→0) 슬롯이 위쪽 머리글로 줄어든다
  function layout(ctx) {
    const { W, H, s } = ctx;
    const sz = s * 0.15, gap = s * 0.02, hdr = s * 0.07;
    const x = W - sz * 0.5 - gap * 2, y0 = H * 0.2;
    const slots = inv.items.map((id, i) => ({
      id, x, y: y0 + hdr + gap + (i + 0.5) * (sz + gap) * inv.open, h: sz * inv.open,
    }));
    return { x, y0, sz, gap, hdr, slots, pw: sz + gap * 2, body: inv.items.length * (sz + gap) * inv.open };
  }

  /** (x, y)가 인벤토리 패널 위인지 — 화면이 자기 조작(고리 잡기 등)보다 인벤토리를 먼저 양보할 때 쓴다 */
  function inInventory(ctx, x, y) {
    const L = layout(ctx);
    const ph = L.hdr + (inv.items.length ? L.gap + L.body : 0);
    return Math.abs(x - L.x) <= L.pw / 2 && y >= L.y0 && y <= L.y0 + ph;
  }

  function drawInventory(ctx) {
    const { ui, s } = ctx;
    const L = layout(ctx);
    const ph = L.hdr + (inv.items.length ? L.gap + L.body : 0);
    ui.rect(L.x - L.pw / 2, L.y0, L.pw, ph, [0, 0, 0, 0.38], s * 0.025);
    ui.drawText(ui.text(inv.target > 0.5 ? '재료 ▲' : '재료 ▼'), L.x, L.y0 + L.hdr / 2, s * 0.032, 'center', L.pw * 0.9, [1, 1, 1, 0.9]);
    if (inv.open > 0.05) {
      L.slots.forEach((sl) => {
        ui.rect(sl.x - L.sz / 2, sl.y - sl.h / 2, L.sz, sl.h, [1, 1, 1, 0.14 * inv.open], s * 0.02);
        ui.drawText(ui.text(ITEMS[sl.id].emoji), sl.x, sl.y - sl.h * 0.12, sl.h * 0.5, 'center', Infinity, [1, 1, 1, inv.open]);
        ui.drawText(ui.text(ITEMS[sl.id].name), sl.x, sl.y + sl.h * 0.33, sl.h * 0.2, 'center', L.sz * 0.9, [1, 1, 1, inv.open]);
      });
    }
    // 끌고 있는 재료
    if (g.mode === 'item') ui.drawText(ui.text(ITEMS[g.item].emoji), g.ix, g.iy - g.off, s * 0.12);
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

  /* ---------- 입력: 재료 끌기 / 물레 돌리기 / 눌러서 터치 ----------
   * cb = { hitClay(ctx,x,y) → bool, onDrop(id,x,y), onTap(x,y) }
   * 누른 채 조금 움직이면 '물레 돌리기'가 되고, 움직이지 않고 떼면 '터치'가 된다 */
  function down(ctx, x, y, type, cb) {
    const L = layout(ctx);
    g.off = type === 'mouse' ? 0 : ctx.s * 0.08;
    if (inv.open > 0.9) {
      for (const sl of L.slots) {
        if (Math.abs(x - sl.x) <= L.sz / 2 && Math.abs(y - sl.y) <= L.sz / 2) { g.mode = 'item'; g.item = sl.id; g.ix = x; g.iy = y; return; }
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
      const L = layout(ctx);
      if (x < L.x - L.pw / 2) cb.onDrop(g.item, x, y - g.off);   // 인벤토리 위에서 놓으면 취소
      g.item = null;
    } else if (mode === 'press' && g.onClay && cb.onTap) cb.onTap(x, y);
  }
  const holding = () => g.mode === 'press' && g.onClay;     // 2단계: 흙을 누르고 있는 동안
  /** 두 번째 손가락이 닿아(핀치) 한 손가락 조작이 끊겼을 때: 끌던 재료는 놓지 않고 취소한다 */
  function cancel() { g.mode = null; g.item = null; }

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
    // 기준 거리: 가장 큰 옹기 지름(1.8 + 고리)이 가로로 들어오는 거리 — 4단계와 같은 값. 여기에 줌아웃 배율(3단계만 1보다 큼)을 곱한다
    const dist = Camera.fitDistance(ctx.W / ctx.H, FOVY, 2.2, 2.6) * 1.05 * zoom;
    // 거리가 바뀌면 부드럽게 따라간다 (갑자기 튀면 조절 중에 놓치기 쉽다)
    if (!distReady) { autoDist = dist; distReady = true; }
    else autoDist += (dist - autoDist) * Math.min(1, dt * 6);
    // 사용자 줌(휠·핀치)은 바로 반영. 상하 이동은 화면이 정한 범위 안에서만
    camCfg.dist = autoDist * view.userZoom;
    view.panY = Math.min(view.targetMax, Math.max(view.targetMin, FOCUS_DEFAULT + view.panY)) - FOCUS_DEFAULT;
    camCfg.target[1] = FOCUS_DEFAULT + view.panY;
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
  const WM = 60;
  function setWall(ctx, base, radii, heights, top) {
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
  }
  /** sq: 눌림 효과. hl = { activeV, bandHalf } — 선택한 단을 따뜻한 띠로 강조 (벽 메시의 v = y / top 기준). 없으면 강조 안 함 */
  function drawWall(ctx, sq, hl) {
    mat4.fromTranslation(m, [0, 0.003, 0]);
    mat4.rotateY(m, m, S.angle);                                   // 바닥판과 같이 물레를 따라 돈다
    mat4.scale(m, m, [1 + 0.04 * sq, 1 - 0.06 * sq, 1 + 0.04 * sq]);
    ctx.potShader.draw(wall, m, PotShader.CLAY, { ridge: 1, activeV: hl ? hl.activeV : -1, bandHalf: hl ? hl.bandHalf : 0.1 });
  }

  return {
    S, cam, FOCUS_DEFAULT, setZoom, view, zoomBy, panBy, resetView, easeBack, setInventory, hint, drawInventory, drawGuide,
    down, move, up, cancel, holding, hitClay, inInventory, update, drawScene, setLump, drawLump, setWall, drawWall,
    get inv() { return inv; },
  };
})();
