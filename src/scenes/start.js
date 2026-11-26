// src/scenes/start.js — 시작 화면 (팀 피그마 「옹기종기 공방」 시작 흐름, 팀이 만든 그림 에셋 사용)
//   home    : 제목 로고 + 박물관 옹기 카드 5장 좌우로 넘겨 보기 (카드를 누르면 크게) + 「나도 만들어 볼래!」
//   detail  : 카드를 누르면 커지면서 크게 보인다 (닫기 / 바깥을 누르면 돌아간다 / 좌우로 밀면 옆 카드)
//   steps   : 「시작하기 전에 옹기는 이렇게 만들어요」 7단계 설명 → 「알겠어요, 시작!」
//   loading : 「흙을 준비하고 있어요…」 + 「알고 있나요?」 한마디 → 1단계(stage1-knead)
// 화면 하나(start) 안의 상태 전환이다 (페이지 이동 X — 팀 기술 제약). 그림은 assets/cards · assets/screens · assets/ui (팀 정리본 경로)
// 글자(그림에 없는 것: 순서 안내 · 출처 · 닫기 · 처음으로)는 배달의민족 주아 (assets/fonts/bmjua.ttf) — 불러오는 동안은 글자만 비어 있다
//
// ★ 카드를 바꾸려면 CARDS 의 img 경로만 고치면 된다 (카드 글자는 그림 안에 있다)

(() => {
  /* ---------------- 내용 ---------------- */
  const AS = './assets/';
  const CARDS = ['soraegi', 'siru', 'gumtaengi', 'gyeopdanji', 'jukjeoldanji'].map((n) => AS + 'cards/card-museum-' + n + '.png');
  const IMG = {
    title: AS + 'screens/start/start-title-logo.png', pill: AS + 'screens/start/start-badge-museum.png',
    make: AS + 'ui/buttons/btn-make-mine.png', go: AS + 'ui/buttons/btn-got-it-start.png',
    stepsBanner: AS + 'ui/banners/banner-intro.png', stepsList: AS + 'screens/intro/intro-steps.png',
    clay: AS + 'screens/loading/loading-clay-shadow.png', loadText: AS + 'screens/loading/loading-text.png', loadTip: AS + 'screens/loading/loading-caption.png',
  };
  const FONT_URL = './assets/fonts/bmjua.ttf', FONT_NAME = 'BMJUA';

  const NEXT_SCENE = 'stage1-knead';                    // 로딩이 끝나면 가는 화면
  const LOADING_TIME = 2.6;                             // 로딩 화면을 보여 주는 최소 시간(초)

  /* ---------------- 위치·크기 (u = 프레임 폭, 세로는 H 비율 — 피그마 프레임에서 옮김) ---------------- */
  const CARD = { w: 0.38, gap: 0.268, cy: 0.509 };      // 가운데 카드 폭, 옆 카드 간격(뒤로 겹친다), 중심 높이
  const CARD_ASPECT = 1461 / 2192;                      // 카드 그림 가로/세로
  const TAP_PX = 0.02;                                  // 이 거리(u)보다 덜 움직이면 「눌렀다」
  const TEXT_COL = [1, 0.95, 0.84, 1], TEXT_DARK = [0.3, 0.16, 0.09, 1];

  const st = {
    mode: 'home', t: 0, loadT: 0,
    pos: 0, vel: 0, target: 0,                     // 카드 위치(소수 = 카드 번호), 속도, 멈출 카드
    drag: false, dx0: 0, dy0: 0, pos0: 0, moved: 0, lastX: 0, lastT: 0, hit: null,
    open: 0, openTarget: 0, sel: 0,                // detail: 펼침 0~1, 지금 보는 카드
    press: null,                                   // 누르고 있는 버튼 id
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const frameU = (ctx) => Math.min(ctx.W, ctx.H * 9 / 16);
  const inRect = (b, x, y) => Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2;

  /* ---------------- 글꼴 · 글자 ---------------- */
  // 글꼴은 비동기로 불러온다. 다 불러온 뒤에 글자 그림을 만들어야 모양이 맞으므로, 그 전에는 글자를 건너뛴다
  // (불러오지 못하면 기본 글꼴로 대신한다)
  let fontState = 0;                                    // 0 시작 전, 1 불러오는 중, 2 완료, 3 실패
  function loadFont() {
    if (fontState) return;
    fontState = 1;
    try {
      new FontFace(FONT_NAME, `url(${FONT_URL})`).load().then((f) => { document.fonts.add(f); fontState = 2; }).catch(() => { fontState = 3; });
    } catch (e) { fontState = 3; }
  }
  const textCache = new Map();
  function tex(ctx, str) {
    if (fontState < 2) return null;
    if (!textCache.has(str)) textCache.set(str, TextTex.makeTextTexture(ctx.gl, str, { fontSize: 72, weight: 400, family: fontState === 2 ? FONT_NAME : undefined }));
    return textCache.get(str);
  }
  // 글자(주아 글꼴): outline 이면 둘레를 짙은 갈색으로 한 번 더 깔아 배경 위에서도 읽히게 한다
  function label(ctx, str, x, y, h, color, opt = {}) {
    const t = tex(ctx, str), al = opt.align || 'center', mw = opt.maxW || Infinity;
    if (!t) return;
    if (opt.outline) { const o = h * 0.05; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.ui.drawText(t, x + Math.cos(a) * o, y + Math.sin(a) * o, h, al, mw, [0.3, 0.16, 0.09, color[3]]); } }
    ctx.ui.drawText(t, x, y, h, al, mw, color);
  }

  // 그림을 가운데 (cx, cy), 폭 w 로 그린다 (눌림 표시: 살짝 작게 + 어둡게). 그림 크기를 돌려준다 (판정용)
  function pic(ctx, url, cx, cy, w, a = 1, shade = 1) {
    const t = ImageTex.get(ctx.gl, url), h = w / t.aspect;
    if (t.ready) ctx.ui.drawImage(t, cx - w / 2, cy - h / 2, w, h, [shade, shade, shade, a]);
    return { w, h };
  }
  // 눌렀을 때 살짝 작아지는 그림 버튼
  function picButton(ctx, b) {
    const down = st.press === b.id;
    pic(ctx, b.url, b.x, b.y + (down ? b.h * 0.03 : 0), b.w * (down ? 0.97 : 1), 1, down ? 0.88 : 1);
  }
  // 그림이 없는 작은 글자 버튼 (닫기 · 처음으로)
  function textButton(ctx, b, str) {
    const { ui } = ctx, down = st.press === b.id, h = b.h * (down ? 0.96 : 1), w = b.w * (down ? 0.96 : 1);
    ui.rect(b.x - w / 2, b.y - h / 2 + h * 0.1, w, h, [0.2, 0.1, 0.05, 0.45], h * 0.45);
    ui.rect(b.x - w / 2, b.y - h / 2, w, h, [0.3, 0.16, 0.09, 1], h * 0.45);
    ui.rect(b.x - w / 2 + h * 0.07, b.y - h / 2 + h * 0.07, w - h * 0.14, h - h * 0.14, down ? [0.95, 0.88, 0.72, 1] : [0.99, 0.94, 0.83, 1], h * 0.4);
    label(ctx, str, b.x, b.y, h * 0.5, TEXT_DARK, { maxW: w * 0.85 });
  }

  /* ---------------- 위치 계산 ---------------- */
  function cardRect(ctx, d, scaleW = 1) {                            // d = 카드 번호 − 지금 위치 (0 = 가운데)
    const u = frameU(ctx), ad = Math.abs(d), near = Math.min(ad, 1), far = Math.max(ad - 1, 0);
    const sc = Math.max(0.64, 1 - 0.2 * near - 0.08 * far), a = ad <= 1 ? 1 - 0.25 * ad : Math.max(0, 0.75 - 0.75 * (ad - 1));
    const w = CARD.w * u * sc * scaleW, h = w / CARD_ASPECT, cx = ctx.W / 2 + Math.sign(d) * (near * CARD.gap + far * 0.12) * u, cy = ctx.H * CARD.cy;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, a };
  }
  const homeBtn = (ctx) => { const u = frameU(ctx); return { id: 'make', url: IMG.make, x: ctx.W / 2, y: ctx.H * 0.821, w: 0.62 * u, h: 0.62 * u * 490 / 1360 }; };
  const stepsLink = (ctx) => { const u = frameU(ctx); return { id: 'link', x: ctx.W / 2, y: ctx.H * 0.91, w: 0.6 * u, h: 0.09 * u }; };
  const startBtn = (ctx) => { const u = frameU(ctx); return { id: 'go', url: IMG.go, x: ctx.W / 2, y: ctx.H * 0.836, w: 0.62 * u, h: 0.62 * u * 490 / 1360 }; };
  const backBtn = (ctx) => { const u = frameU(ctx); return { id: 'back', x: ctx.W / 2 - 0.33 * u, y: ctx.H * 0.04, w: 0.26 * u, h: 0.085 * u }; };
  const detailCard = (ctx) => { const u = frameU(ctx), w = 0.8 * u, h = w / CARD_ASPECT; return { x: ctx.W / 2 - w / 2, y: ctx.H * 0.47 - h / 2, w, h }; };
  const closeBtn = (ctx) => { const p = detailCard(ctx), u = frameU(ctx); return { id: 'close', x: ctx.W / 2, y: p.y + p.h + u * 0.1, w: 0.4 * u, h: 0.1 * u }; };

  /* ---------------- 장면 ---------------- */
  Scenes.register('start', {
    enter(ctx, data) {
      Object.assign(st, { mode: 'home', t: 0, vel: 0, drag: false, open: 0, openTarget: 0, press: null, hit: null, loadT: 0 });
      st.pos = st.target = clamp(Math.round(st.pos), 0, CARDS.length - 1);
      st.sndCard = st.pos;                                           // (2026-11-26) 카드 넘기기 소리용: 지금 가운데 카드 번호
      loadFont();
      for (const u of CARDS) ImageTex.get(ctx.gl, u);                // 미리 불러 둔다 (눌렀을 때 비어 보이지 않게)
      for (const k in IMG) ImageTex.get(ctx.gl, IMG[k]);
    },

    update(ctx, dt) {
      st.t += dt;
      if (!st.drag) {                                                // 손을 떼면 가장 가까운 카드에 부드럽게 멈춘다
        st.pos += (st.target - st.pos) * (1 - Math.exp(-dt * 11));
        if (Math.abs(st.target - st.pos) < 0.001) st.pos = st.target;
      }
      // (2026-11-26) 가운데 카드가 바뀔 때마다 넘기는 소리 — 손으로 끄는 중에도, 놓은 뒤 미끄러질 때도 카드 한 장 지날 때마다 한 번
      const mid = clamp(Math.round(st.pos), 0, CARDS.length - 1);
      if (mid !== st.sndCard) { st.sndCard = mid; Sound.play('swipe'); }
      st.open += (st.openTarget - st.open) * (1 - Math.exp(-dt * 12));
      if (Math.abs(st.openTarget - st.open) < 0.002) st.open = st.openTarget;
      if (st.mode === 'loading') { st.loadT += dt; if (st.loadT >= LOADING_TIME) ctx.go(NEXT_SCENE); }
    },

    draw(ctx) {},      // 배경은 main.js 가 그린다 — 이 화면은 3D가 없다

    drawUI(ctx) {
      drawFallbackBg(ctx);
      if (imagesFailed(ctx)) return drawLoadError(ctx);
      if (st.mode === 'steps') return drawSteps(ctx);
      if (st.mode === 'loading') return drawLoading(ctx);
      drawHome(ctx);
    },

    down(ctx, x, y) {
      if (st.mode === 'home') {
        if (inRect(homeBtn(ctx), x, y)) { st.press = 'make'; return; }
        if (inRect(stepsLink(ctx), x, y)) { st.press = 'link'; return; }
        st.drag = true; st.dx0 = x; st.dy0 = y; st.pos0 = st.pos; st.moved = 0; st.lastX = x; st.lastT = performance.now(); st.vel = 0; st.hit = null;
        let best = 1e9;                                              // 겹친 카드는 가운데에 가까운 쪽이 위에 있다
        CARDS.forEach((_, i) => { const r = cardRect(ctx, i - st.pos); if (r.a > 0.1 && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h && Math.abs(i - st.pos) < best) { best = Math.abs(i - st.pos); st.hit = i; } });
      } else if (st.mode === 'detail') {
        if (inRect(closeBtn(ctx), x, y)) st.press = 'close';
        st.dx0 = x; st.dy0 = y;
      } else if (st.mode === 'steps') {
        if (inRect(startBtn(ctx), x, y)) st.press = 'go'; else if (inRect(backBtn(ctx), x, y)) st.press = 'back';
      }
    },

    move(ctx, x, y) {
      const u = frameU(ctx);
      if (st.mode === 'home' && st.drag) {
        st.moved = Math.max(st.moved, Math.hypot(x - st.dx0, y - st.dy0));
        st.pos = clamp(st.pos0 - (x - st.dx0) / (CARD.gap * u * 1.4), -0.25, CARDS.length - 0.75);   // 왼쪽으로 밀면 다음 카드
        const now = performance.now(), dtm = Math.max(1, now - st.lastT);
        st.vel = lerp(st.vel, -(x - st.lastX) / (CARD.gap * u * 1.4) / (dtm / 1000), 0.4);        // 카드/초
        st.lastX = x; st.lastT = now;
      }
    },

    up(ctx, x, y) {
      const u = frameU(ctx), pressed = st.press; st.press = null;
      if (st.mode === 'home') {
        // (2026-11-26) 버튼 소리 Sound.play('click') — 누른 버튼 위에서 뗐을 때만
        if (pressed === 'make') { if (inRect(homeBtn(ctx), x, y)) { Sound.play('click'); st.mode = 'loading'; st.loadT = 0; } return; }
        if (pressed === 'link') { if (inRect(stepsLink(ctx), x, y)) { Sound.play('click'); st.mode = 'steps'; } return; }
        if (!st.drag) return;
        st.drag = false;
        if (st.moved < TAP_PX * u && st.hit !== null) {              // 눌렀다: 가운데 카드면 크게, 옆 카드면 그 카드를 가운데로
          if (st.hit === Math.round(st.target)) { st.sel = st.hit; st.mode = 'detail'; st.openTarget = 1; } else st.target = st.hit;
          return;
        }
        st.target = clamp(Math.round(st.pos + clamp(st.vel * 0.18, -1, 1)), 0, CARDS.length - 1);   // 밀었다: 휙 넘긴 속도 반영
      } else if (st.mode === 'detail') {
        const p = detailCard(ctx), tap = Math.hypot(x - st.dx0, y - st.dy0) < TAP_PX * u;
        const outside = !(x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
        if ((pressed === 'close' && inRect(closeBtn(ctx), x, y)) || (tap && outside && !inRect(closeBtn(ctx), x, y))) {
          if (pressed === 'close') Sound.play('click');   // (2026-11-26) 「닫기」 버튼만 (바깥 터치로 닫을 때는 소리 없음)
          st.mode = 'home'; st.openTarget = 0;
        }
        else if (!tap && Math.abs(x - st.dx0) > 0.12 * u && Math.abs(x - st.dx0) > Math.abs(y - st.dy0)) {   // 펼친 채로 좌우로 밀면 옆 카드
          const n = clamp(st.sel + (x < st.dx0 ? 1 : -1), 0, CARDS.length - 1);
          if (n !== st.sel) { st.sel = n; st.target = n; st.pos = n; }
        }
      } else if (st.mode === 'steps') {
        if (pressed === 'go' && inRect(startBtn(ctx), x, y)) { Sound.play('click'); st.mode = 'loading'; st.loadT = 0; }
        else if (pressed === 'back' && inRect(backBtn(ctx), x, y)) { Sound.play('click'); st.mode = 'home'; }
      }
    },

    cancel(ctx) { st.drag = false; st.press = null; if (st.mode === 'home') st.target = clamp(Math.round(st.pos), 0, CARDS.length - 1); },

    exit(ctx) { return ctx.pot_main.toData(); },
  });

  /* ---------------- 배경 · 오류 상태 ---------------- */
  const BG_URL = './assets/backgrounds/background.png';
  // 배경은 main.js 가 모든 화면 뒤에 깔아 준다. 그게 안 깔렸을 때(옛 main.js · 불러오는 중)만 이 화면이 같은 그림을 직접 깐다
  function drawFallbackBg(ctx) {
    if (ctx.background && ctx.background.ready) return;
    const bg = ImageTex.get(ctx.gl, BG_URL);
    if (bg.ready) ctx.ui.drawFitHeight(bg, ctx.W, ctx.H);
  }
  // 오류 상태: 그림을 하나라도 못 불러왔으면 빈 화면 대신 이유를 알려 준다 (file:// 로 열면 브라우저가 그림을 막는다)
  function imagesFailed(ctx) {
    const urls = [BG_URL, ...CARDS, ...Object.values(IMG)];
    return urls.some((u) => ImageTex.get(ctx.gl, u).failed);
  }
  function drawLoadError(ctx) {
    const { W, H } = ctx, u = frameU(ctx);
    ctx.ui.rect(0, 0, W, H, [0.1, 0.06, 0.03, 0.85]);
    const bad = [BG_URL, ...CARDS, ...Object.values(IMG)].filter((u) => ImageTex.get(ctx.gl, u).failed).map((u) => u.replace('./assets/', ''));
    const lines = ['그림을 불러오지 못했어요', `못 찾은 그림: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ` 외 ${bad.length - 3}개` : ''}`,
      '① assets 폴더(cards · screens · ui)가 프로젝트 안에 있는지', '② Live Server(http://)로 열었는지 확인해 주세요'];
    lines.forEach((l, i) => {
      const t = tex(ctx, l) || ctx.ui.text(l, { weight: 400 });
      ctx.ui.drawText(t, W / 2, H * 0.45 + i * u * 0.085, u * (i ? 0.045 : 0.065), 'center', u * 0.9, i ? [1, 0.93, 0.8, 0.9] : [1, 0.75, 0.55, 1]);
    });
  }

  /* ---------------- 화면별 그리기 ---------------- */
  function drawHome(ctx) {
    const { W, H, ui } = ctx, u = frameU(ctx), cx = W / 2;

    // 위쪽: 알약(왼쪽) + 제목 로고(옹기종기 공방 · 부제 · 인장이 한 장)
    pic(ctx, IMG.pill, cx - 0.5 * u + 0.056 * u + 0.18 * u, H * 0.054, 0.36 * u);
    pic(ctx, IMG.title, cx, H * 0.19, 0.76 * u);

    // 카드 (멀리 있는 것부터 그려 가운데가 맨 위). 펼쳐진 카드는 자세히 보기에서 따로 그린다
    const order = CARDS.map((_, i) => i).sort((a, b) => Math.abs(b - st.pos) - Math.abs(a - st.pos));
    for (const i of order) {
      if (st.mode === 'detail' && i === st.sel && st.open > 0.01) continue;
      const r = cardRect(ctx, i - st.pos);
      if (r.a > 0.02) {
        ui.rect(r.x + 2, r.y + r.h * 0.025, r.w, r.h, [0.1, 0.05, 0.02, 0.28 * r.a], r.w * 0.07);       // 아래 그림자
        pic(ctx, CARDS[i], r.cx, r.cy, r.w, r.a);
      }
    }

    // 쪽 점 · 버튼 · 안내 · 출처
    CARDS.forEach((_, i) => { const on = clamp(1 - Math.abs(i - st.pos), 0, 1); ui.circle(cx + (i - (CARDS.length - 1) / 2) * 0.035 * u, H * 0.70, u * (0.016 + 0.006 * on), on > 0.5 ? [0.3, 0.16, 0.09, 1] : [1, 0.95, 0.85, 0.95]); });
    if (st.mode !== 'detail') {                                       // 자세히 보기 중에는 아래 버튼·안내를 숨긴다
      picButton(ctx, homeBtn(ctx));
      const lk = stepsLink(ctx);
      label(ctx, '만드는 순서 먼저 볼래요', lk.x, lk.y, u * 0.05, st.press === 'link' ? [1, 0.88, 0.65, 1] : TEXT_COL, { outline: true, maxW: u * 0.7 });
      label(ctx, '부천시립박물관 × 가톨릭대학교 미디어기술콘텐츠학과', cx, H * 0.977, u * 0.034, [1, 0.93, 0.8, 0.9], { maxW: u * 0.9 });
    }
    if (st.open > 0.003) drawDetail(ctx);
  }

  function drawDetail(ctx) {
    const { W, H, ui } = ctx, o = easeOut(st.open), from = cardRect(ctx, st.sel - st.pos), to = detailCard(ctx);
    ui.rect(0, 0, W, H, [0.06, 0.04, 0.02, 0.65 * o]);                // 뒤를 어둡게
    const w = lerp(from.w, to.w, o), cx = lerp(from.cx, to.x + to.w / 2, o), cy = lerp(from.cy, to.y + to.h / 2, o);
    pic(ctx, CARDS[st.sel], cx, cy, w, 1);                            // 카드가 제자리에서 커진다
    if (o > 0.7) {
      const u = frameU(ctx);
      CARDS.forEach((_, i) => ui.circle(W / 2 + (i - (CARDS.length - 1) / 2) * 0.035 * u, to.y - u * 0.04, u * (i === st.sel ? 0.018 : 0.012), [1, 0.95, 0.85, i === st.sel ? 1 : 0.45]));
      textButton(ctx, closeBtn(ctx), '닫기');
    }
  }

  function drawSteps(ctx) {
    const { W, H } = ctx, u = frameU(ctx), cx = W / 2;
    pic(ctx, IMG.stepsBanner, cx, H * 0.122, 0.8 * u);               // 시작하기 전에 · 옹기는 이렇게 만들어요
    pic(ctx, IMG.stepsList, cx, H * 0.488, 0.817 * u);               // 7단계 목록
    textButton(ctx, backBtn(ctx), '‹ 처음으로');
    picButton(ctx, startBtn(ctx));
  }

  function drawLoading(ctx) {
    const { W, H } = ctx, u = frameU(ctx), cx = W / 2, bob = Math.sin(st.loadT * 3.2);
    pic(ctx, IMG.clay, cx, H * 0.4 + bob * 0.018 * u, 0.34 * u);       // 흙 덩이가 둥실둥실 (그림자는 그림 안에 있다)
    pic(ctx, IMG.loadText, cx, H * 0.507, 0.62 * u);
    pic(ctx, IMG.loadTip, cx, H * 0.722, 0.79 * u);
  }
})();
