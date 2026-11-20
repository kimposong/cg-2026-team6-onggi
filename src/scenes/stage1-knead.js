// src/scenes/stage1-knead.js — 1단계: 반죽하기
// 인벤토리(흙·물)에서 끌어다 놓은 뒤, 젖은 흙을 '리듬 게임'으로 치댄다.
//   반죽 가운데에 고정된 동그라미(목표 원)가 있고, 다른 동그라미 하나가 커졌다 작아졌다 한다.
//   두 원의 크기가 겹치는 순간에 화면을 톡! 터치하면 점수가 쌓이고, 점수가 가득 차면 바로 2단계로 넘어간다.
// 물레는 자동으로 돌지 않는다: 반죽 밖 빈 곳을 누른 채 좌우로 흔들면 그 방향으로 돈다 (shared/workbench.js)

(() => {
  /* ---------- 게임 설정: 난이도는 여기 숫자만 바꾸면 된다 ---------- */
  const GOAL = 100;            // 목표 점수 (가득 차면 2단계로)
  // 4단계 판정: 두 원 반지름 차이(s 의 비율)가 작을수록 높은 등급. 위에서부터 검사한다
  const TIERS = [
    { max: 0.015, txt: 'Excellent!', pts: 20, col: [0.45, 0.95, 0.45] },   // 초록
    { max: 0.030, txt: 'Great!',     pts: 15, col: [1, 0.92, 0.3] },        // 노랑 
    { max: 0.055, txt: 'Good',       pts: 8,  col: [1, 0.62, 0.2] },        // 주황
    { max: Infinity, txt: 'Bad',     pts: 2,  col: [1, 0.3, 0.28] },        // 빨강
  ];
  const tierOf = (dPx, s) => TIERS.find((t) => dPx <= t.max * s);
  const PERIOD = 2.4;          // 원이 한 번 줄었다 커지는 데 걸리는 시간(초). 길수록 쉽다
  const R_TARGET = 0.12, R_MIN = 0.035, R_MAX = 0.205;   // 목표 원 / 움직이는 원 최소·최대 반지름 (s 의 비율)

  const R = 0.42, H = 0.75, P = 2.3;                // 흙 덩어리 모양 (초타원)
  const st = { sub: 0, score: 0, combo: 0, best: 0, t: 0, appear: 0, wetT: 0, sq: 0, pulse: 0, pops: [], doneAt: 0, left: false };
  // sub 0: 흙 → 물레 / 1: 물 → 흙 / 2: 리듬 반죽

  const cb = {
    // 리듬 반죽 중에는 터치 위치와 상관없이 화면 어디를 눌러도 되도록 onPress 로 처리한다 (아이들이 정확히 누르기 어렵다)
    hitClay: (ctx, x, y) => st.sub >= 1 && Work.hitClay(ctx, x, y, R, H),

    // (2026-11-20) 작업대 규칙: 받은 재료면 true, 아니면 슬롯으로 튕겨 돌아간다 (지금 index.html 은 2안을 불러오므로 이 파일은 쓰이지 않는다)
    onDrop(id, x, y) {
      const ctx = cb.ctx, onClay = cb.hitClay(ctx, x, y);
      if (st.sub === 0) {
        if (id === 'soil') { st.sub = 1; st.appear = 0; st.sq = 1; return true; }   // 흙은 화면 안 어디에 놓아도 물레에 올라간다
        else Work.hint(['물은 흙을 올린 다음에 써요', '먼저 흙을 물레 위에 놓아 주세요']);
      } else if (st.sub === 1) {
        if (id === 'water' && onClay) { st.wetT = 1; st.sub = 2; st.sq = 1; st.t = 0; Work.setInventory(['soil', 'water'], false); return true; }   // 반죽 게임에는 재료가 필요 없어 인벤토리를 접는다
        else if (id === 'water') Work.hint(['물이 흙에 스며들도록', '흙 위에 놓아 주세요']);
        else Work.hint(['흙은 이미 올렸어요', '이제 물을 흙 위에 부어 주세요']);
      }
      return false;
    },

    // 리듬 터치 판정 (scene.down 에서 직접 부른다 — workbench.js 버전과 상관없이 동작)
    onPress(ctx, x, y) {
      if (st.sub !== 2 || st.doneAt) return;
      const s = ctx.s, tr = tierOf(Math.abs(ringR() - R_TARGET) * s, s);
      const txt = tr.txt, col = tr.col, pts = tr.pts;
      if (pts >= 8) { st.combo++; st.best = Math.max(st.best, st.combo); } else st.combo = 0;   // Bad 면 연속 끊김
      st.score = Math.min(GOAL, st.score + pts); st.sq = pts >= 15 ? 1.2 : 0.8; st.pulse = 1;
      const c = center(ctx);
      st.pops.push({ txt, col, x: c.x, y: c.y - R_TARGET * s - s * 0.07, t: 0 });
      if (st.score >= GOAL) st.doneAt = performance.now() + 1800;                    // 완료 문구를 잠깐 보여 준 뒤 2단계로
    },
  };

  /* ---------- 리듬 원 ---------- */
  // 움직이는 원의 지금 반지름 (s 의 비율). 처음엔 가장 큰 크기에서 줄어들기 시작한다: 커졌다 작아졌다 반복
  function ringR() { return (R_MIN + R_MAX) / 2 + ((R_MAX - R_MIN) / 2) * Math.cos((2 * Math.PI * st.t) / PERIOD); }
  // 반죽 가운데의 화면 좌표
  function center(ctx) { return Camera.worldToScreen(Work.cam.viewProj, [0, H / 2, 0], ctx.W, ctx.H); }
  // 원 테두리: 점을 찍지 않고 셰이더로 속이 빈 '선'을 한 번에 그린다 (UI 도구에 없어 이 파일 안에 둔다)
  let RG = null;
  function ringGL(gl) {
    const mk = (t, src) => { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
    const prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, `#version 300 es
    in vec2 aPos; uniform vec2 uRes; uniform vec4 uBox; out vec2 vP;
    void main(){ vec2 p = uBox.xy + aPos * uBox.zw; vP = aPos * uBox.zw - uBox.zw * 0.5;
      gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0); }`));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float; in vec2 vP; uniform float uR; uniform float uW; uniform vec4 uC; out vec4 o;
    void main(){ float d = abs(length(vP) - uR) - uW * 0.5; o = vec4(uC.rgb, uC.a * clamp(0.5 - d, 0.0, 1.0)); }`));
    gl.linkProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n) => gl.getUniformLocation(prog, n);
    return { prog, vao, uRes: u('uRes'), uBox: u('uBox'), uR: u('uR'), uW: u('uW'), uC: u('uC') };
  }
  // 중심 (cx,cy), 반지름 r, 선 굵기 w(픽셀)인 원 선. 반드시 drawUI 의 맨 마지막에 부른다 (UI 셰이더를 바꾸므로)
  function ring(ctx, cx, cy, r, w, col) {
    const gl = ctx.gl; if (!RG) RG = ringGL(gl);
    const half = r + w + 2;
    gl.useProgram(RG.prog); gl.bindVertexArray(RG.vao);
    gl.uniform2f(RG.uRes, ctx.W, ctx.H);
    gl.uniform4f(RG.uBox, cx - half, cy - half, half * 2, half * 2);
    gl.uniform1f(RG.uR, r); gl.uniform1f(RG.uW, w); gl.uniform4fv(RG.uC, col);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  Scenes.register('stage1-knead', {
    enter(ctx) {
      Object.assign(st, { sub: 0, score: 0, combo: 0, best: 0, t: 0, appear: 0, wetT: 0, sq: 0, pulse: 0, pops: [], doneAt: 0, left: false });
      Object.assign(Work.S.clay, { wet: 0, smooth: 0 });
      Work.setInventory(['soil', 'water'], true);       // 1단계 인벤토리: 흙과 물 두 개
      Work.inv.open = 0;                                // 처음에 펼쳐지는 모습
    },

    update(ctx, dt) {
      cb.ctx = ctx;
      Work.update(ctx, dt);
      const c = Work.S.clay, k = Math.min(1, dt * 6);
      if (st.sub >= 1) st.appear = Math.min(1, st.appear + dt * 2.2);
      if (st.sub === 2 && !st.doneAt) st.t += dt;       // 리듬 시계 (완료되면 멈춘다)
      c.wet += (st.wetT - c.wet) * k;
      c.smooth += (st.score / GOAL - c.smooth) * k;      // 점수가 쌓일수록 표면이 매끈해진다
      st.sq *= Math.exp(-dt * 5);
      st.pulse *= Math.exp(-dt * 7);
      st.pops.forEach((p) => { p.t += dt; });
      st.pops = st.pops.filter((p) => p.t < 0.8);
      if (st.sub >= 1) Work.setLump(ctx, R, H, P, 0.2 * (1 - c.smooth) + 0.015);
      if (st.doneAt && !st.left && performance.now() > st.doneAt) { st.left = true; setTimeout(() => ctx.go('stage2-base'), 0); }   // 전환은 프레임 사이에서
    },

    draw(ctx) {
      Work.drawScene(ctx, () => {
        if (st.sub >= 1) Work.drawLump(ctx, Work.S.clay.wet, Work.easeBack(st.appear), st.sq * Math.cos(performance.now() / 70));
      });
    },

    drawUI(ctx) {
      const { W, H: Hh, s, ui } = ctx;
      let lines, goal;
      if (st.doneAt) { lines = ['✓ 부드러운 반죽 완성!', '이제 이 반죽으로 바닥판을 만들어요']; goal = ''; }
      else if (st.sub === 0) { lines = ['인벤토리의 흙을 물레 위로 끌어다 놓아', '반죽할 흙을 준비하세요']; goal = '다음에는 이 흙에 물을 부어 반죽할 준비를 해요'; }
      else if (st.sub === 1) { lines = ['인벤토리의 물을 흙 위로 끌어다 놓아', '흙에 물을 부어 주세요']; goal = '물을 머금으면 흙이 촉촉해져서 리듬 반죽을 할 수 있어요'; }
      else { lines = ['커졌다 작아지는 하얀 원이 가운데 노란 원과', `딱 겹칠 때 (초록!) 화면을 톡! 터치하세요 (${st.score}/${GOAL}점)`]; goal = '박자에 맞춰 치댈수록 반죽이 매끈하고 쫀득해져요'; }
      Work.drawGuide(ctx, '① 반죽하기', lines, goal);
      Work.drawInventory(ctx);

      if (st.sub !== 2) return;
      const c = center(ctx), rt = R_TARGET * s, rm = ringR() * s, tier = tierOf(Math.abs(rm - rt), s);

      // 판정 글자 (위로 떠오르며 사라진다)
      st.pops.forEach((p) => {
        const a = 1 - p.t / 0.8;
        ui.drawText(ui.text(p.txt), p.x, p.y - p.t * s * 0.08, s * 0.06, 'center', W * 0.8, [p.col[0], p.col[1], p.col[2], a]);
      });
      // 연속 성공
      if (st.combo >= 2 && !st.doneAt) ui.drawText(ui.dynText('combo', `🔥 ${st.combo}연속!`), c.x, c.y + rt + s * 0.14, s * 0.05, 'center', W * 0.8, [1, 0.85, 0.5, 1]);

      // 점수 막대
      const bw = W * 0.56, bh = s * 0.035, bx = W / 2 - bw / 2 - W * 0.04, by = Hh * 0.78;
      ui.rect(bx, by, bw, bh, [1, 1, 1, 0.16], bh / 2);
      if (st.score > 0) ui.rect(bx, by, Math.max(bh, bw * (st.score / GOAL)), bh, [0.95, 0.7, 0.3, 1], bh / 2);
      // 게이지 아래 안내: 몇 점을 채워야 하는지
      ui.drawText(ui.dynText('gauge', `${st.score} / ${GOAL}점 — ${GOAL}점을 채우면 다음 단계로!`), bx + bw / 2, by + bh + s * 0.04, s * 0.04, 'center', bw);

      if (!st.doneAt) {
        // 목표 원(고정): 박자를 맞출 때 살짝 부풀어 오른다
        const pr = rt * (1 + 0.12 * st.pulse);
        ui.circle(c.x, c.y, pr * 2, [1, 1, 1, 0.1 + 0.15 * st.pulse]);
        ring(ctx, c.x, c.y, pr, s * 0.012, [1, 0.82, 0.35, 0.95]);
        // 움직이는 원: 목표와 비슷해지면 색이 바뀌어 "지금!"을 알려 준다 (흰색 → 연두 → 노랑)
        const near = [...tier.col, 1];                 // 빨강 → 주황 → 노랑 → 초록
        ring(ctx, c.x, c.y, rm, s * 0.010, near);
      }
    },

    down(ctx, x, y, type) {
      cb.ctx = ctx; Work.down(ctx, x, y, type, cb);
      // 반죽이나 원을 누르면 점수: 반죽 영역 또는 큰 원 안쪽
      if (st.sub === 2 && !st.doneAt) {
        const c = center(ctx);
        if (cb.hitClay(ctx, x, y) || Math.hypot(x - c.x, y - c.y) <= R_MAX * ctx.s * 1.25) cb.onPress(ctx, x, y);
      }
    },
    move(ctx, x, y) { Work.move(ctx, x, y); },
    up(ctx, x, y) { cb.ctx = ctx; Work.up(ctx, x, y, cb); },
  });
})();
