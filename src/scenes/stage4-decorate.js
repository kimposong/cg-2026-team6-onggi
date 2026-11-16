// src/scenes/stage4-decorate.js — 4단계: 꾸미기 (옹기를 돌리며 조각칼로 무늬 새기기)
// 옹기는 3단계에서 넘어온 모양 그대로, 카메라·물레 돌리기·줌·상하 이동도 3단계와 같은 작업대(shared/workbench.js)를 쓴다
// 조작: 옹기 위를 끌면 조각칼로 새긴다 (옹기 위에서 시작한 획은 손을 뗄 때까지 "새기기"로 유지 — 중간에 옹기 밖으로 나가도 물레가 돌지 않는다)
//       빈 곳을 좌우로 끌면 물레가 돈다 (3단계 메커니즘). 「물레」 버튼을 켜면 천천히 계속 돌아 띠 무늬를 새기기 쉽다
//       오른쪽 버튼: 조각칼(새기기) / 손가락(지우기) / 물레(켜기·끄기). 아래 슬라이더: 굵기. 마우스 커서는 조각칼 모양이고 칼끝 = 포인터
// 원리: 터치 → 광선(7주차) → 옹기 표면 교차(회전체: 축까지 거리 − 그 높이의 반지름 = 0) → UV(u = 둘레, v = 높이 비율)
//       → 2D 캔버스에 선 긋기 → 텍스처로 올리기(6주차) → potShader 가 흰 곳을 홈처럼 어둡게 그린다 (uDecal)

(() => {
  const { mat4, vec4 } = glMatrix;
  const TEX_W = 1024, TEX_H = 512;        // 무늬 텍스처 크기 (가로 = 둘레 u, 세로 = 높이 v)
  const SIZE_MIN = 3, SIZE_MAX = 40;      // 붓 굵기 범위 (텍스처 픽셀)
  const SPIN_SPEED = 0.45;                // 「물레」 켰을 때 자동 회전 속도 (라디안/초, 한 바퀴 약 14초)
  const Y_MARGIN = 0.16;                  // 줌 계산용 꼭대기 여유 — 3단계 손잡이 높이와 같게 해서 화면이 이어진다

  const st = {
    tool: 'knife',                        // 'knife' 새기기 | 'finger' 지우기
    size: 0.3,                            // 굵기 슬라이더 값 0~1
    spin: false,                          // 물레 자동 회전
    stroke: null,                         // 새기는 중 { lastU, lastV } — lastU 가 null 이면 끊겼다가 다시 닿기를 기다리는 상태
    ptr: { x: 0, y: 0, type: 'mouse' },   // 칼끝 위치 (손가락이면 손가락보다 위로 올린 위치)
    cursorVisible: false,
    sliderDrag: false,
    tools: [], buttons: [], slider: null,
    toastUntil: 0,
    dirty: false,                         // 캔버스가 바뀌어 텍스처를 다시 올려야 하는가
    outer: null,                          // 옹기 바깥 단면 (광선 교차용, 들어올 때 한 번 계산)
    height: 1.3,
  };

  let decal = null;                       // { canvas, c2d, tex } — 처음 한 번 만들고 재사용
  const invVP = mat4.create(), tmp4 = vec4.create();
  const cb = { hitClay: () => false, onDrop() {} };   // 작업대 콜백: 재료 없음. 옹기 판정은 광선으로 따로 한다 (빈 곳 → 회전·상하 이동)

  /* ---------- 무늬 캔버스·텍스처 ---------- */
  function initDecal(gl) {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W; canvas.height = TEX_H;
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = '#000'; c2d.fillRect(0, 0, TEX_W, TEX_H);          // 검정 = 안 새김, 흰색 = 홈
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);                                       // 1번 유닛 (0번은 UI 글자)
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);       // 둘레는 이어진다
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    decal = { canvas, c2d, tex };
    uploadDecal(gl);
  }
  function uploadDecal(gl) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, decal.tex);
    // 캔버스 윗줄 = v 0 = 옹기 바닥. 글자 텍스처(text.js)는 FLIP_Y 를 켜므로 여기서는 꺼 준다 (pixelStorei 는 전역 상태)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, decal.canvas);
    st.dirty = false;
  }
  function clearDecal() { decal.c2d.fillStyle = '#000'; decal.c2d.fillRect(0, 0, TEX_W, TEX_H); st.dirty = true; }

  /* ---------- 광선 → 옹기 표면 (7주차 광선 판정을 회전체에 맞게) ---------- */
  function screenRay(ctx, x, y) {
    mat4.invert(invVP, Work.cam.viewProj);
    vec4.set(tmp4, (x / ctx.W) * 2 - 1, 1 - (y / ctx.H) * 2, 1, 1);     // 화면 → NDC (먼 평면)
    vec4.transformMat4(tmp4, tmp4, invVP);
    const fx = tmp4[0] / tmp4[3], fy = tmp4[1] / tmp4[3], fz = tmp4[2] / tmp4[3];
    const e = Work.cam.eye;
    let dx = fx - e[0], dy = fy - e[1], dz = fz - e[2];
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    return { ox: e[0], oy: e[1], oz: e[2], dx, dy, dz };
  }
  /**
   * 광선 위의 점이 "축까지 거리 − 그 높이의 옹기 반지름" 이 +(밖)에서 −(안)로 바뀌는 첫 지점이 바깥 표면.
   * 높이 0~H 안에 있는 구간만 160칸으로 훑고, 바뀐 칸을 이분법으로 좁힌다. 물레가 돌아간 각도만큼 u 를 되돌린다
   */
  function hitPot(ctx, x, y) {
    const r = screenRay(ctx, x, y), H = st.height;
    let t0 = 0, t1 = 40;
    if (Math.abs(r.dy) > 1e-6) {
      const a = -r.oy / r.dy, b = (H - r.oy) / r.dy;
      t0 = Math.max(0, Math.min(a, b)); t1 = Math.max(a, b);
    } else if (r.oy < 0 || r.oy > H) return null;
    if (t1 <= t0) return null;
    const f = (t) => Math.hypot(r.ox + r.dx * t, r.oz + r.dz * t) - Pot.radiusAt(st.outer, r.oy + r.dy * t);
    const N = 160, step = (t1 - t0) / N;
    let ta = t0, fa = f(ta);
    for (let i = 1; i <= N; i++) {
      let tb = t0 + step * i, fb = f(tb);
      if (fa > 0 && fb <= 0) {
        for (let k = 0; k < 10; k++) { const tm = (ta + tb) / 2; if (f(tm) > 0) ta = tm; else tb = tm; }
        const t = (ta + tb) / 2;
        const px = r.ox + r.dx * t, py = r.oy + r.dy * t, pz = r.oz + r.dz * t;
        // 메시의 u 는 회전 전 각도 / 2π. 모델이 물레 각도만큼 돌아 있으므로 그만큼 더해 되돌린다 (rotateY: 월드 각도 = 원래 각도 − angle)
        let u = (Math.atan2(pz, px) + Work.S.angle) / (Math.PI * 2);
        u -= Math.floor(u);
        return { u, v: py / H, r: Math.hypot(px, pz) };
      }
      ta = tb; fa = fb;
    }
    return null;
  }

  /* ---------- 캔버스에 새기기 / 지우기 ---------- */
  const brushPx = () => SIZE_MIN + (SIZE_MAX - SIZE_MIN) * st.size;
  function paintTo(u, v) {
    const c = decal.c2d, s = st.stroke, size = brushPx();
    const x1 = u * TEX_W, y1 = v * TEX_H;
    c.fillStyle = c.strokeStyle = st.tool === 'knife' ? '#fff' : '#000';   // 조각칼은 홈(흰색), 손가락은 메움(검정)
    c.lineWidth = size; c.lineCap = 'round'; c.lineJoin = 'round';
    if (s.lastU === null) {
      // 획의 첫 점: 점 하나
      for (const off of [-TEX_W, 0, TEX_W]) { c.beginPath(); c.arc(x1 + off, y1, size / 2, 0, Math.PI * 2); c.fill(); }
    } else {
      // 이음매(u = 0/1)를 넘어가면 짧은 쪽으로 잇는다. 캔버스 밖으로 나가는 부분은 ±TEX_W 로 옮겨 한 번 더 그린다 (둘레가 이어지도록)
      let du = u - s.lastU;
      if (du > 0.5) du -= 1; else if (du < -0.5) du += 1;
      const x0 = s.lastU * TEX_W, y0 = s.lastV * TEX_H, xe = (s.lastU + du) * TEX_W;
      for (const off of [-TEX_W, 0, TEX_W]) { c.beginPath(); c.moveTo(x0 + off, y0); c.lineTo(xe + off, y1); c.stroke(); }
    }
    s.lastU = u; s.lastV = v; st.dirty = true;
  }

  // 손가락에 칼끝이 가려지지 않도록, 터치일 때는 손가락보다 위를 칼끝으로 삼는다 (3단계와 같은 규칙)
  function setPtr(ctx, x, y, type) {
    st.ptr.x = x; st.ptr.y = type === 'mouse' ? y : y - ctx.s * 0.08; st.ptr.type = type;
  }

  /* ---------- UI 배치: 오른쪽 도구 버튼 3개, 아래 굵기 슬라이더, 맨 아래 버튼 2개 ---------- */
  function layoutUI(ctx) {
    const { W, H, s } = ctx;
    const sz = s * 0.14, gap = s * 0.02, x = W - sz / 2 - gap * 2, y0 = H * 0.2 + sz / 2;
    st.tools = [
      { id: 'knife', icon: '🔪', name: '새기기', x, y: y0, w: sz, h: sz },
      { id: 'finger', icon: '👆', name: '지우기', x, y: y0 + (sz + gap), w: sz, h: sz },
      { id: 'spin', icon: '🔄', name: '물레', x, y: y0 + 2 * (sz + gap), w: sz, h: sz },
    ];
    st.buttons = ctx.ui.layoutBottomPair(W, H, { id: 'clear', label: '다 지우기' }, { id: 'done', label: '완료', primary: true });
    const top = st.buttons[0].y - st.buttons[0].h / 2;                  // 버튼 윗변
    st.slider = { x0: W * 0.2, x1: W * 0.8, y: top - s * 0.07, h: s * 0.014 };
  }
  const sliderHit = (ctx, x, y) => st.slider && Math.abs(y - st.slider.y) < ctx.s * 0.05 && x > st.slider.x0 - ctx.s * 0.04 && x < st.slider.x1 + ctx.s * 0.04;
  function sliderSet(x) { st.size = Math.min(1, Math.max(0, (x - st.slider.x0) / (st.slider.x1 - st.slider.x0))); }

  function onButton(ctx, id) {
    if (id === 'knife' || id === 'finger') st.tool = id;
    if (id === 'spin') st.spin = !st.spin;
    if (id === 'clear') clearDecal();
    if (id === 'done') {
      // 프로토타입: 다음 단계(완성하기)로 넘길 데이터를 콘솔에 남긴다. 무늬는 pot_main.decal 텍스처에 남아 있다
      console.log('[옹기 형태]', JSON.stringify(ctx.pot_main.toData()));
      st.toastUntil = performance.now() + 1800;
      // 완성하기 화면이 생기면: ctx.go('stage5-glaze', ctx.pot_main.toData());
    }
  }

  /* ---------- 커서: 조각칼(칼끝 = 포인터) / 손가락(손톱 끝 = 포인터) + 굵기 미리보기 ---------- */
  function drawCursor(ctx) {
    const { ui, s } = ctx, { x, y } = st.ptr;
    // 굵기 미리보기: 텍스처 픽셀 → 월드 길이(둘레 기준) → 화면 픽셀. 대략값이면 충분하다
    const R = st.outer ? Pot.radiusAt(st.outer, st.height * 0.5) : 0.55;
    const ppu = Math.abs(Camera.worldToScreen(Work.cam.viewProj, [0, 1, 0], ctx.W, ctx.H).y - Camera.worldToScreen(Work.cam.viewProj, [0, 0, 0], ctx.W, ctx.H).y);
    const d = Math.max(s * 0.02, (brushPx() / TEX_W) * Math.PI * 2 * R * ppu);
    ui.circle(x, y, d, [1, 1, 1, 0.2]);
    if (st.tool === 'knife') {
      // 조각칼: 날(밝은 회색)은 칼끝에서 위로, 손잡이(나무색)는 그 위. 끝점에 작은 주황 점
      ui.rect(x - s * 0.006, y - s * 0.075, s * 0.012, s * 0.075, [0.86, 0.88, 0.92, 0.95], s * 0.004);
      ui.rect(x - s * 0.014, y - s * 0.2, s * 0.028, s * 0.13, [0.47, 0.31, 0.18, 0.95], s * 0.009);
      ui.circle(x, y, s * 0.012, [1, 0.75, 0.42, 1]);
    } else {
      // 손가락 이모지는 손톱이 글자 위쪽이므로, 글자 중심을 포인터보다 아래에 두어 손톱 끝이 포인터에 오게 한다
      ui.drawText(ui.text('👆'), x, y + s * 0.05, s * 0.1);
    }
  }

  Scenes.register('stage4-decorate', {
    enter(ctx, data) {
      const pot = ctx.pot_main;
      if (data) pot.load(data);                        // 3단계에서 넘어온 모양
      pot.update();
      st.outer = pot.outerProfile();
      st.height = pot.shape.height;
      if (!decal) initDecal(ctx.gl);
      pot.decal = decal.tex;                           // 이후 단계·전시실도 이 텍스처를 그대로 쓴다
      Object.assign(st, { tool: 'knife', spin: false, stroke: null, sliderDrag: false, toastUntil: 0, cursorVisible: false });
      Work.setInventory([], false);                    // 재료 없음 (인벤토리는 그리지 않는다)
      Work.resetView();
      Work.view.panEnabled = true;                     // 옹기 밖을 위아래로 끌면 화면 이동 (3단계와 같음)
      ctx.gl.canvas.style.cursor = 'none';             // 시스템 커서 대신 조각칼을 그린다 (캔버스 안 UI 규칙 유지)
    },

    update(ctx, dt) {
      Work.update(ctx, dt);
      const pot = ctx.pot_main, H = st.height;
      // 카메라: 3단계와 같은 규칙 (중심 고정, 기본 높이보다 높으면 줌아웃), 상하 이동 범위도 같음
      const yTop = H + Y_MARGIN, yTopDefault = 1.3 + Y_MARGIN;
      Work.setZoom((yTop - Work.FOCUS_DEFAULT) / (yTopDefault - Work.FOCUS_DEFAULT));
      Work.view.targetMin = 0.05;
      Work.view.targetMax = Math.max(Work.FOCUS_DEFAULT, yTop);

      if (st.spin) Work.S.angle += dt * SPIN_SPEED;    // 「물레」 켜짐: 천천히 계속 돈다 (손으로 돌리는 것과 더해진다)
      // 옹기는 물레를 따라 돈다 (모델 행렬 = 살짝 띄우기 + Y축 회전)
      mat4.fromTranslation(pot.model, [0, 0.003, 0]);
      mat4.rotateY(pot.model, pot.model, Work.S.angle);

      // 새기는 중이면 매 프레임 칼끝 아래 표면을 찾아 잇는다 (손이 멈춰 있어도 물레가 돌면 띠가 그려진다)
      if (st.stroke) {
        const h = hitPot(ctx, st.ptr.x, st.ptr.y);
        if (h) paintTo(h.u, h.v);
        else st.stroke.lastU = null;                   // 옹기 밖으로 나가면 선을 끊고, 다시 닿으면 새 점부터
      }
      if (st.dirty) uploadDecal(ctx.gl);
      layoutUI(ctx);
    },

    draw(ctx) {
      Work.drawScene(ctx, () => ctx.pot_main.draw(ctx.potShader));
    },

    drawUI(ctx) {
      const { W, H, s, ui } = ctx;
      Work.drawGuide(ctx, '④ 꾸미기',
        ['옹기 위를 끌어 조각칼로 무늬를 새겨요', '빈 곳을 좌우로 끌면 물레가 돌아요'],
        '물레 버튼을 켜면 천천히 돌아서 띠 무늬를 새기기 쉬워요');

      // 오른쪽 도구 버튼
      for (const b of st.tools) {
        const on = b.id === 'spin' ? st.spin : st.tool === b.id;
        ui.rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, on ? [0.72, 0.42, 0.24, 0.95] : [1, 1, 1, 0.14], b.h * 0.2);
        ui.drawText(ui.text(b.icon), b.x, b.y - b.h * 0.12, b.h * 0.42);
        ui.drawText(ui.text(b.name), b.x, b.y + b.h * 0.32, b.h * 0.2, 'center', b.w * 0.9);
      }

      // 굵기 슬라이더 (그림판 붓 크기처럼): 트랙 + 채워진 부분 + 손잡이, 왼쪽에 「굵기」
      const sl = st.slider, kx = sl.x0 + (sl.x1 - sl.x0) * st.size;
      ui.drawText(ui.text('굵기'), sl.x0 - s * 0.03, sl.y, s * 0.035, 'right', Infinity, [1, 0.92, 0.85, 0.85]);
      ui.rect(sl.x0, sl.y - sl.h / 2, sl.x1 - sl.x0, sl.h, [1, 1, 1, 0.25], sl.h / 2);
      ui.rect(sl.x0, sl.y - sl.h / 2, kx - sl.x0, sl.h, [1, 0.75, 0.42, 0.9], sl.h / 2);
      ui.circle(kx, sl.y, s * 0.06, [1, 1, 1, 0.95]);
      ui.circle(kx, sl.y, Math.max(s * 0.008, s * 0.05 * st.size), [0.3, 0.2, 0.12, 1]);   // 손잡이 안에 굵기 미리보기 점

      for (const b of st.buttons) ui.button(b);

      if (performance.now() < st.toastUntil) {
        const t = ui.text('무늬를 저장했어요 (콘솔 확인)', { weight: 400 });
        const th = s * 0.045, tw = Math.min(t.aspect * th, W * 0.9);
        const ty = sl.y - s * 0.08;
        ui.rect(W / 2 - tw / 2 - s * 0.03, ty - th * 0.9, tw + s * 0.06, th * 1.8, [0, 0, 0, 0.6], th * 0.5);
        ui.drawText(t, W / 2, ty, th, 'center', W * 0.9);
      }

      if (st.cursorVisible) drawCursor(ctx);
    },

    // 판정 순서: 아래 버튼 → 도구 버튼 → 슬라이더 → 옹기 표면(새기기 시작) → 작업대(빈 곳: 물레 돌리기 / 상하 이동)
    down(ctx, x, y, type) {
      for (const b of st.buttons) if (ctx.ui.hit(b, x, y)) { onButton(ctx, b.id); return; }
      for (const b of st.tools) if (ctx.ui.hit(b, x, y)) { onButton(ctx, b.id); return; }
      if (sliderHit(ctx, x, y)) { st.sliderDrag = true; sliderSet(x); return; }
      setPtr(ctx, x, y, type);
      st.cursorVisible = true;
      if (hitPot(ctx, st.ptr.x, st.ptr.y)) { st.stroke = { lastU: null, lastV: 0 }; return; }   // 획 시작 — 실제 점은 update 에서 찍는다
      Work.down(ctx, x, y, type, cb);
    },

    move(ctx, x, y, type) {
      if (st.sliderDrag) { sliderSet(x); return; }
      setPtr(ctx, x, y, type);
      st.cursorVisible = true;
      if (st.stroke) return;                           // 새기는 중: 위치만 기억하고 update 가 잇는다
      Work.move(ctx, x, y);
    },

    up(ctx, x, y, type) {
      if (st.sliderDrag) { st.sliderDrag = false; return; }
      if (st.stroke) { st.stroke = null; if (type !== 'mouse') st.cursorVisible = false; return; }
      if (type !== 'mouse') st.cursorVisible = false;
      Work.up(ctx, x, y, cb);
    },

    hover(ctx, x, y) {
      setPtr(ctx, x, y, 'mouse');
      st.cursorVisible = true;
    },

    wheel(ctx, x, y, dy) { Work.zoomBy(Math.exp(dy * 0.0012)); },
    pinch(ctx, factor) { Work.zoomBy(1 / factor); },
    cancel(ctx) { st.stroke = null; st.sliderDrag = false; st.cursorVisible = false; Work.cancel(); },

    exit(ctx) {
      ctx.gl.canvas.style.cursor = '';
      Work.setZoom(1);
      Work.resetView();
      mat4.fromTranslation(ctx.pot_main.model, [0, 0.003, 0]);   // 회전은 이 화면 안에서만
      return ctx.pot_main.toData();
    },
  });
})();
