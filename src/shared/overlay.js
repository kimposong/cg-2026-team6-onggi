// src/shared/overlay.js — 모든 단계 위에 덮는 층: 단계 완료 팝업 + 일시정지 (2026-11-25, 피그마 최종안 6-0-1)
// 화면(씬)들 위에 한 겹 더 있는 층이다. main.js 가 매 프레임 이 층에 먼저 물어보고,
//   · 팝업·일시정지가 떠 있으면 화면의 update 와 입력을 멈춘다 (= 게임 전체 정지)
//   · 완료 팝업일 때는 3D·화면 UI 를 숨기고 배경 그림만 어둡게 깐다 ("로딩 화면 느낌", 사용자 결정 1-2 A)
// 각 단계는 끝날 때 ctx.go 대신 Overlay.stageDone(ctx, n, next) 를 부르면 된다 (n = 피그마 단계 번호 1~6)
// Unity 로 치면 모든 씬 위에 떠 있는 DontDestroyOnLoad UI 캔버스 + Time.timeScale = 0 같은 역할

const Overlay = (() => {
  /* ---------- 설정: 숫자만 바꾸면 된다 ---------- */
  const NEXT_DELAY = 1.5;           // 완료 팝업의 「다음으로」가 눌리기까지 기다리는 시간(초) — 사용자 결정 1-1 B (글을 읽을 틈)
  const APPEAR = 0.25;              // 팝업이 튀어나오는 연출 시간(초)
  // const RESTART_SCENE = 'stage1-knead';   // 「처음부터 다시」 목적지 — 시작 화면이 완성되면 'start' 로 바꾼다 (2-2 추천안)
  const RESTART_SCENE = 'start';           // (2026-11-25) 시작 화면 완성(sub 병합) → 처음 화면으로 (사용자 결정 2-2 A)

  const IMG = {
    done: (n) => `./assets/ui/popups/popup-stage${n}-complete.png`,
    pause: './assets/ui/popups/popup-pause.png',
    next: './assets/ui/buttons/btn-next.png',          // 사용자 결정 1-5: 완료 팝업도 기존 「다음으로」 그림을 쓴다 (팀 합의)
    pauseBtn: './assets/ui/buttons/btn-pause.png',
    cont: './assets/ui/buttons/btn-continue.png',
    restart: './assets/ui/buttons/btn-restart.png',
  };

  // 배치 (피그마 9:16 프레임 기준 — workbench.js 의 FIG 와 같은 규칙: 크기·가로 = 프레임 폭 u 비율, 세로 = 화면 높이 H 비율)
  // 팝업 그림은 둘레에 그림자 여백이 있어 그림 폭을 카드보다 조금 넓게 잡는다 (카드 = 그림 폭의 약 93%)
  const FIG = {
    popW: 0.88,                     // 팝업 그림 폭 (보이는 카드 ≈ 0.82u)
    popY: 0.46,                     // 팝업 중심 높이
    doneBtnY: 0.80,                 // 완료 팝업 안 「다음으로」 중심 = 팝업 그림 높이의 이 비율 (그림 아래쪽 빈 칸)
    btnW: 0.36,                     // 「다음으로」 폭
    pauseBtnW: 0.10,                // 오른쪽 위 일시정지 버튼 (터치 판정은 1.3배로 넓힘)
    pauseBtnY: 0.05,
    contY: 0.43, contW: 0.50,       // 일시정지 팝업 안 「계속하기」 (그림 높이 비율, 폭 u 비율)
    restartY: 0.66, restartW: 0.42, // 「처음부터 다시」
    soundY: 0.83,                   // (2026-11-25) 소리 켜기·끄기 줄 (피그마 일시정지 팝업 맨 아래)
  };

  // (2026-11-25 사용자 결정 2-3) 소리 켜기·끄기 — 지금은 스위치 상호작용만. 소리를 넣을 때 Overlay.sound 를 읽으면 된다
  // 다음에 열어도 기억하도록 브라우저 저장소(localStorage)에 남긴다
  const SOUND_KEY = 'onggi-sound';
  let sound = true;
  try { sound = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { /* 저장소를 못 쓰는 브라우저 */ }
  function setSound(on) {
    sound = on;
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (e) { /* 무시 */ }
  }

  const st = {
    mode: null,      // null | 'done' (단계 완료 팝업) | 'pause' (일시정지)
    n: 0,            // 완료 팝업 단계 번호
    next: null,      // 「다음으로」를 누르면 부를 함수
    t: 0,            // 팝업이 뜬 뒤 흐른 시간(초)
    wait: 0,         // stageDone(…, delay) — 이 시간 뒤에 팝업을 띄운다 (그동안 화면은 그대로 돈다)
    pending: null,   // 기다리는 중인 완료 팝업 { n, next }
    press: null,     // 누르고 있는 버튼 id (뗄 때 같은 버튼 위면 실행)
    cursor: '',      // 팝업 동안 시스템 커서를 보이게 했다가 되돌릴 값 (4단계는 커서를 숨긴다)
  };

  const frameUnit = (ctx) => Math.min(ctx.W, ctx.H * 9 / 16);
  const easeBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  // 일시정지 버튼은 1~7단계 플레이 화면에서만 (2-4 추천안: 시작·설명·로딩·마지막 화면에는 없음)
  const inStage = () => Scenes.current.startsWith('stage');

  /* ---------- 외부에서 부르는 것 ---------- */

  /** 단계 완료 팝업. n = 피그마 단계 번호(1~6), next = 「다음으로」를 누르면 할 일, delay = 몇 초 뒤에 띄울지 */
  function stageDone(ctx, n, next, delay = 0) {
    if (st.mode === 'done' || st.pending) return;              // 두 번 불려도 한 번만
    ImageTex.get(ctx.gl, IMG.done(n));                         // 그림을 미리 불러 둔다
    if (delay > 0) { st.pending = { n, next }; st.wait = delay; return; }
    open(ctx, 'done', n, next);
  }

  function open(ctx, mode, n = 0, next = null) {
    Object.assign(st, { mode, n, next, t: 0, press: null });
    // 하던 한 손가락 조작(재료 끌기·물레 돌리기)을 끊는다 — 정지 중에는 손을 떼는 신호가 화면에 안 간다
    Scenes.call('cancel', ctx);
    Work.cancel();
    st.cursor = ctx.gl.canvas.style.cursor;
    ctx.gl.canvas.style.cursor = '';
  }

  function close(ctx) {
    const scene = Scenes.current;
    st.mode = null; st.press = null;
    return scene;
  }

  function pause(ctx) {
    if (st.mode || !inStage()) return;
    open(ctx, 'pause');
  }

  function resume(ctx) {
    if (st.mode !== 'pause') return;
    close(ctx);
    ctx.gl.canvas.style.cursor = st.cursor;      // 4단계라면 다시 숨긴다 (화면이 커서를 직접 그림)
  }

  /** 지금 화면의 update·입력을 멈춰야 하나 (팝업·일시정지) */
  const blocking = () => st.mode !== null;
  /** 3D·화면 UI 를 숨기고 배경만 보여야 하나 (완료 팝업) */
  const hidesScene = () => st.mode === 'done';

  function update(ctx, dt) {
    if (st.pending && !st.mode) {
      st.wait -= dt;
      if (st.wait <= 0) { const p = st.pending; st.pending = null; open(ctx, 'done', p.n, p.next); }
    }
    if (st.mode) st.t += dt;
  }

  /* ---------- 배치 ---------- */
  function popupBox(ctx, src) {
    const u = frameUnit(ctx), t = ImageTex.get(ctx.gl, src);
    const w = u * FIG.popW, h = w / (t.ready ? t.aspect : 1.17);
    return { t, x: ctx.W / 2 - w / 2, y: ctx.H * FIG.popY - h / 2, w, h };
  }

  // 그림 버튼 하나 (폭 = u 비율, 높이 = 그림 비율). 반환값은 ui.imageButton / ui.hit 에 그대로 쓴다
  function imgBtn(ctx, id, src, label, cx, cy, wu) {
    const u = frameUnit(ctx), tex = ImageTex.get(ctx.gl, src), w = u * wu;
    return { id, img: src, label, tex, x: cx, y: cy, w, h: w / (tex.ready ? tex.aspect : 3) };
  }

  function pauseButton(ctx) {
    const u = frameUnit(ctx), x1 = (ctx.W + u) / 2, d = u * FIG.pauseBtnW;
    const b = imgBtn(ctx, 'pause', IMG.pauseBtn, 'Ⅱ', x1 - d * 0.75, ctx.H * FIG.pauseBtnY + d * 0.1, FIG.pauseBtnW);
    b.h = d;                                     // 정사각형
    return b;
  }

  function buttons(ctx) {
    if (st.mode === 'done') {
      const p = popupBox(ctx, IMG.done(st.n));
      const b = imgBtn(ctx, 'next', IMG.next, '다음으로', ctx.W / 2, p.y + p.h * FIG.doneBtnY, FIG.btnW);
      b.dim = st.t < NEXT_DELAY;
      return [b];
    }
    if (st.mode === 'pause') {
      const p = popupBox(ctx, IMG.pause);
      return [
        imgBtn(ctx, 'continue', IMG.cont, '계속하기', ctx.W / 2, p.y + p.h * FIG.contY, FIG.contW),
        imgBtn(ctx, 'restart', IMG.restart, '처음부터 다시', ctx.W / 2, p.y + p.h * FIG.restartY, FIG.restartW),
        soundRow(ctx, p),
      ];
    }
    return inStage() ? [pauseButton(ctx)] : [];
  }

  // (2026-11-25) 소리 줄: 「소리」 글자 + 스위치. 그림이 없어 코드로 그린다 (피그마 색: 크림 바탕·진갈색). 줄 전체가 터치 대상
  function soundRow(ctx, p) {
    const u = frameUnit(ctx);
    return { id: 'sound', x: ctx.W / 2, y: p.y + p.h * FIG.soundY, w: u * 0.5, h: u * 0.1, custom: true };
  }
  function drawSoundRow(ctx, b) {
    const { ui } = ctx, u = frameUnit(ctx);
    const brown = [0.32, 0.16, 0.08, 1];
    const font = ctx.fontSub && ctx.fontSub.ready ? { family: 'BMJUA', weight: 400 } : {};
    ui.drawText(ui.text('소리', font), b.x - u * 0.05, b.y, u * 0.05, 'right', Infinity, brown);
    // 스위치: 켜짐 = 주황 바탕 + 손잡이 오른쪽, 꺼짐 = 연한 갈색 + 왼쪽
    const sw = u * 0.13, sh = u * 0.065, sx = b.x, sy = b.y - sh / 2;
    ui.rect(sx, sy, sw, sh, sound ? [0.85, 0.5, 0.22, 1] : [0.75, 0.66, 0.58, 1], sh / 2);
    const kd = sh * 0.8;
    ui.circle(sound ? sx + sw - sh / 2 : sx + sh / 2, b.y, kd, [1, 0.97, 0.9, 1]);
    ui.drawText(ui.text(sound ? '켜짐' : '꺼짐', font), sx + sw + u * 0.03, b.y, u * 0.042, 'left', Infinity, [0.45, 0.3, 0.2, 1]);
  }

  // 터치 판정: 일시정지 버튼은 작아서 판정만 1.3배로 넓힌다 (터치 대상 짧은 변 8% 이상)
  function hitBtn(b, x, y) {
    const k = b.id === 'pause' ? 1.3 : 1;
    return Math.abs(x - b.x) <= (b.w * k) / 2 && Math.abs(y - b.y) <= (b.h * k) / 2;
  }

  /* ---------- 입력: true 를 돌려주면 이 층이 먹은 것 (화면으로 안 보낸다) ---------- */
  function down(ctx, x, y) {
    const b = buttons(ctx).find((bb) => hitBtn(bb, x, y));
    if (b) { st.press = b.id; return true; }
    return blocking();                           // 팝업이 떠 있으면 빈 곳 터치도 막는다 (팝업 밖을 눌러도 닫히지 않음 — 2-5 추천안)
  }

  function up(ctx, x, y) {
    const id = st.press;
    st.press = null;
    if (!id) return blocking();
    const b = buttons(ctx).find((bb) => bb.id === id);
    if (!b || !hitBtn(b, x, y)) return true;     // 누른 버튼 밖에서 떼면 취소
    if (id === 'pause') pause(ctx);
    else if (id === 'continue') resume(ctx);
    else if (id === 'restart') { close(ctx); ctx.go(RESTART_SCENE); }
    else if (id === 'sound') setSound(!sound);   // (2026-11-25) 지금은 스위치만 바뀐다 (소리 기능은 나중에)
    else if (id === 'next' && !b.dim) {
      const next = st.next;
      close(ctx);
      ctx.gl.canvas.style.cursor = st.cursor;
      if (next) next();                          // 다음 화면으로 (화면의 exit 가 커서 등을 정리한다)
    }
    return true;
  }

  const move = () => blocking() || st.press !== null;

  /** 키보드: ESC = 일시정지 켜기·끄기 (2-5 추천안: 「계속하기」 또는 ESC 로 풀기) */
  function key(ctx, k) {
    if (k !== 'Escape') return;
    if (st.mode === 'pause') resume(ctx);
    else pause(ctx);
  }

  /* ---------- 그리기 (화면 UI 위에, main.js 가 마지막에 부른다) ---------- */
  function drawUI(ctx) {
    const { W, H, ui } = ctx;
    const list = buttons(ctx);

    if (!st.mode) {                              // 플레이 중: 오른쪽 위 일시정지 버튼만
      list.forEach((b) => drawButton(ctx, b));
      return;
    }

    const k = Math.min(1, st.t / APPEAR), a = k;
    // 완료 팝업은 화면(3D·UI)을 안 그린 상태라 배경 그림 위에 옅게, 일시정지는 멈춘 화면 위에 조금 더 진하게
    ui.rect(0, 0, W, H, [0.08, 0.05, 0.03, (st.mode === 'done' ? 0.35 : 0.5) * a]);

    const p = popupBox(ctx, st.mode === 'done' ? IMG.done(st.n) : IMG.pause);
    const sc = 0.9 + 0.1 * easeBack(k);          // 살짝 작게 시작해 통 튀어나온다
    if (p.t.ready) {
      const w = p.w * sc, h = p.h * sc;
      ui.drawImage(p.t, W / 2 - w / 2, p.y + p.h / 2 - h / 2, w, h, [1, 1, 1, a]);
    } else {
      // 그림을 불러오기 전: 크림색 상자 + 제목 글자
      ui.rect(p.x + p.w * 0.04, p.y + p.h * 0.03, p.w * 0.92, p.h * 0.9, [1, 0.95, 0.86, a], p.w * 0.05);
      const title = st.mode === 'done' ? `${st.n}단계 완료!` : '잠깐 쉬어 갈까요?';
      ui.drawText(ui.text(title), W / 2, p.y + p.h * 0.18, p.h * 0.1, 'center', p.w * 0.8, [0.32, 0.16, 0.08, a]);
    }
    if (k < 1) return;                           // 튀어나오는 동안에는 버튼을 안 그린다

    list.forEach((b) => drawButton(ctx, b));

    // 「다음으로」 기다리는 동안: 버튼 아래 가는 막대가 차오른다 → 다 차면 버튼이 진해지고 막대는 사라진다
    if (st.mode === 'done') {
      const b = list[0], f = Math.min(1, st.t / NEXT_DELAY);
      if (f < 1) {
        const bw = b.w * 0.7, bh = Math.max(3, b.h * 0.08), bx = b.x - bw / 2, by = b.y + b.h * 0.62;
        ui.rect(bx, by, bw, bh, [0.32, 0.16, 0.08, 0.2], bh / 2);
        ui.rect(bx, by, bw * f, bh, [0.55, 0.3, 0.15, 0.9], bh / 2);
      }
    }
  }

  function drawButton(ctx, b) {
    if (b.custom) { drawSoundRow(ctx, b); return; }
    const pressed = st.press === b.id;
    if (pressed) b = { ...b, w: b.w * 0.95, h: b.h * 0.95 };   // 누르는 동안 살짝 작게
    ctx.ui.imageButton(b);
  }

  return { stageDone, pause, resume, blocking, hidesScene, update, drawUI, down, move, up, key, NEXT_DELAY,
    get sound() { return sound; } };     // (2026-11-25) 소리 켜짐 여부 — 소리를 넣을 때 읽는다
})();
