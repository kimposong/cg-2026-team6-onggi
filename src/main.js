// src/main.js — 시작: 공용 도구를 만들고, 렌더 루프를 돌리고, 입력을 지금 화면으로 전달한다
// 화면별 내용은 scenes/ 에 있다. 이 파일은 어느 화면인지 모른 채 Scenes.call 로 넘기기만 한다

(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2', { antialias: true });

  if (!gl) {
    // 오류 상태: WebGL2를 못 쓰는 기기에서도 흰 화면 대신 안내를 보여 준다
    showFatal('이 기기에서는 3D 화면을 열 수 없어요.\n다른 브라우저(크롬·사파리 최신 버전)로 열어 주세요.');
    return;
  }

  /* ---------- 공용 도구 묶음 (모든 화면이 ctx 로 받는다) ---------- */
  const potShader = PotShader.create(gl);
  const ctx = {
    gl,
    W: 1, H: 1, s: 1,
    ui: UI.create(gl),
    potShader,
    wheel: Wheel.create(gl, potShader),
    // pot_main: 관람객이 직접 만드는 메인 옹기. 전시실의 박물관 옹기·다른 관람객 옹기와 구분하기 위한 이름
    // Pot.create 는 옹기를 만드는 공통 틀이라 전시실에서도 같은 틀로 여러 개를 만든다
    pot_main: Pot.create(gl, potShader.locs),
    go: (name, data) => Scenes.go(ctx, name, data),
    // (2026-11-20) 전체 배경 그림 — 피그마의 한옥 작업장. 불러오는 동안·실패하면 아래 clearColor 단색이 대신 보인다
    background: ImageTex.load(gl, './assets/backgrounds/background.png'),
    // (2026-11-24) 배너 아래 설명문 폰트 — 배달의민족 주아체. 다 받기 전·실패하면 기본 폰트 (Work.drawBanner 가 ready 를 본다)
    fontSub: TextTex.loadFont('BMJUA', './assets/fonts/bmjua.ttf'),
  };

  const perf = { acc: 0, count: 0, shown: '' };

  /* ---------- 화면 크기 ---------- */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // 3배 화면은 2배로 제한 → 픽셀 계산량 절약
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.W = w; ctx.H = h; ctx.s = Math.min(w, h);
    gl.viewport(0, 0, w, h);
  }

  /* ---------- 입력 → 지금 화면 ---------- */
  // (2026-11-25) 위에 덮는 층(Overlay: 완료 팝업·일시정지)이 먼저 받는다. 이 층이 먹으면(true) 화면으로 안 보낸다
  Input.setup(canvas, {
    down: (x, y, type) => { if (!Overlay.down(ctx, x, y)) Scenes.call('down', ctx, x, y, type); },
    move: (x, y, type) => { if (!Overlay.move(ctx, x, y)) Scenes.call('move', ctx, x, y, type); },
    up: (x, y, type) => { if (!Overlay.up(ctx, x, y)) Scenes.call('up', ctx, x, y, type); },
    hover: (x, y) => { if (!Overlay.blocking()) Scenes.call('hover', ctx, x, y); },
    wheel: (x, y, dy) => { if (!Overlay.blocking()) Scenes.call('wheel', ctx, x, y, dy); },       // 마우스 휠 (화면이 줌으로 쓴다)
    pinch: (f, cx, cy) => { if (!Overlay.blocking()) Scenes.call('pinch', ctx, f, cx, cy); },     // 두 손가락 벌리기·오므리기 (줌)
    cancel: () => Scenes.call('cancel', ctx),                        // 두 번째 손가락이 닿아 한 손가락 조작이 끊길 때
  });
  // (2026-11-25) ESC = 일시정지 켜기·끄기 (PC). 휴대폰은 오른쪽 위 일시정지 버튼
  window.addEventListener('keydown', (e) => Overlay.key(ctx, e.key));

  /* ---------- 렌더 루프 ---------- */
  let last = performance.now();
  let fontSet = false;
  function frame(now) {
    const ms = now - last;
    const dt = Math.min(ms / 1000, 0.05); // 탭을 다시 열었을 때 한 번에 크게 튀지 않게
    trackFrameTime(ms);
    last = now;

    resize();
    // (2026-11-25) 주아체를 다 받으면 화면의 모든 글자 기본 폰트로 (받기 전·실패하면 기본 폰트 그대로).
    // 주아체는 굵기가 하나뿐이라 weight 400 (700 을 주면 브라우저가 억지로 두껍게 그린다)
    if (ctx.fontSub.ready && !fontSet) { ctx.ui.setFont({ family: ctx.fontSub.family, weight: 400 }); fontSet = true; }
    gl.clearColor(0.165, 0.13, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // (2026-11-20) 배경 그림을 3D보다 먼저 화면 가득 그린다. ui.begin 이 깊이 테스트를 끄므로 깊이 버퍼에 남지 않고,
    // 이어지는 3D(potShader.begin)가 깊이 테스트를 다시 켠다
    if (ctx.background.ready) {
      ctx.ui.begin(ctx.W, ctx.H);
      // 모바일 세로 화면에서 그림이 꽉 차는 것이 기준 → 그림의 위아래를 화면 위아래에 맞춘다 (PC 가로 창은 양옆이 단색)
      ctx.ui.drawFitHeight(ctx.background, ctx.W, ctx.H);
    }

    // (2026-11-25) 팝업·일시정지가 떠 있으면 화면의 update 를 건너뛴다 = 게임 전체 정지 (타이머·리듬·물레 모두 dt 로 움직인다)
    Overlay.update(ctx, dt);
    if (!Overlay.blocking()) Scenes.call('update', ctx, dt);
    // 완료 팝업일 때는 3D·화면 UI 를 숨기고 배경 그림만 (일시정지는 멈춘 화면을 그대로 보여 준다)
    if (!Overlay.hidesScene()) Scenes.call('draw', ctx);

    ctx.ui.begin(ctx.W, ctx.H);
    if (!Overlay.hidesScene()) Scenes.call('drawUI', ctx);
    Overlay.drawUI(ctx);
    // 프레임 시간 (성능 측정, 12주차 기준 16.7ms 이하) — 모든 화면 공통
    // (2026-11-25) 오른쪽 위는 일시정지 버튼 자리라 왼쪽 위로 옮김
    // → (2026-11-25) 왼쪽 위는 시작 화면 「처음으로」 버튼·표찰 자리라 위쪽 가운데로
    ctx.ui.drawText(ctx.ui.dynText('ms', perf.shown), ctx.W / 2, ctx.s * 0.03, ctx.s * 0.03, 'center', Infinity, [1, 1, 1, 0.5]);

    requestAnimationFrame(frame);
  }

  // 0.5초마다 평균 프레임 시간을 갱신해 표시한다
  function trackFrameTime(ms) {
    perf.acc += ms; perf.count++;
    if (perf.acc > 500) {
      perf.shown = `${(perf.acc / perf.count).toFixed(1)} ms/frame`;
      perf.acc = 0; perf.count = 0;
    }
  }

  function showFatal(msg) {
    const c2 = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    c2.fillStyle = '#2a211c';
    c2.fillRect(0, 0, canvas.width, canvas.height);
    c2.fillStyle = '#fff';
    c2.textAlign = 'center';
    c2.font = `${18 * dpr}px sans-serif`;
    msg.split('\n').forEach((line, i) => c2.fillText(line, canvas.width / 2, canvas.height / 2 + i * 28 * dpr));
  }

  resize();
  // 지금은 4단계만 만들어져 있으므로 바로 4단계로 시작한다. 시작 화면이 완성되면 'start' 로 바꾼다
  // → (2026-11-25) 시작 화면 완성 (팀원 JAEWON LEE, sub 병합) — 'start' 로 시작한다
  Scenes.go(ctx, 'start');
  requestAnimationFrame(frame);
})();
