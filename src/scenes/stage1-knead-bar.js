// src/scenes/stage1-knead-bar.js — 1단계 (2안): 반죽하기 · 게이지 바 리듬 게임
// 반죽 위에 가로 게이지 바가 있고, 가운데에 초록 구간이 있다. 포인터가 좌우로 왔다갔다 하다가
// 초록 구간에 올 때 반죽을 톡! 터치하면 높은 점수. 점수가 100점이 되면 바로 2단계로 넘어간다.
// 1안(stage1-knead.js, 원 맞추기)과 같은 장면 이름('stage1-knead')을 쓰므로, index.html 에서 둘 중 하나만 불러온다.
// 물레는 자동으로 돌지 않는다: 반죽 밖 빈 곳을 누른 채 좌우로 흔들면 그 방향으로 돈다 (shared/workbench.js)

(() => {
  /* ---------- 게임 설정: 난이도는 여기 숫자만 바꾸면 된다 ---------- */
  const GOAL = 100;            // 목표 점수 (가득 차면 2단계로)
  // 4단계 판정: 포인터가 바 중심에서 떨어진 정도(0~1, 1 = 바 끝)가 작을수록 높은 등급. 위에서부터 검사한다
  // max 가 클수록 그 색 구간이 넓어져 쉬워진다 (색 띠 너비도 이 값을 따른다)
  const TIERS = [
    { max: 0.12, txt: 'Excellent!', pts: 20, col: [0.45, 0.95, 0.45] },   // 초록 (가운데)
    { max: 0.22, txt: 'Great!',     pts: 15, col: [1, 0.92, 0.3] },        // 노랑
    { max: 0.35, txt: 'Good',       pts: 8,  col: [1, 0.62, 0.2] },        // 주황
    { max: Infinity, txt: 'Bad',    pts: 2,  col: [1, 0.3, 0.28] },        // 빨강 (바깥)
  ];
  const tierOf = (f) => TIERS.find((t) => f <= t.max);
  const PERIOD = 3.0;          // 포인터가 왼쪽→오른쪽→왼쪽 한 바퀴 도는 시간(초). 길수록 쉽다

  const R = 0.42, H = 0.75, P = 2.3;                // 흙 덩어리 모양 (초타원)
  const st = { sub: 0, score: 0, combo: 0, best: 0, t: 0, appear: 0, wetT: 0, sq: 0, pulse: 0, pops: [], doneAt: 0, left: false };
  // sub 0: 흙 → 물레 / 1: 물 → 흙 / 2: 리듬 반죽

  const cb = {
    // 리듬 반죽 중에는 터치 위치와 상관없이 화면 어디를 눌러도 되도록 onPress 로 처리한다 (아이들이 정확히 누르기 어렵다)
    hitClay: (ctx, x, y) => st.sub >= 1 && Work.hitClay(ctx, x, y, R, H),

    onDrop(id, x, y) {
      const ctx = cb.ctx, onClay = cb.hitClay(ctx, x, y);
      if (st.sub === 0) {
        if (id === 'soil') { st.sub = 1; st.appear = 0; st.sq = 1; }                 // 흙은 화면 안 어디에 놓아도 물레에 올라간다
        else Work.hint(['물은 흙을 올린 다음에 써요', '먼저 흙을 물레 위에 놓아 주세요']);
      } else if (st.sub === 1) {
        if (id === 'water' && onClay) { st.wetT = 1; st.sub = 2; st.sq = 1; st.t = 0; Work.setInventory(['soil', 'water'], false); }   // 반죽 게임에는 재료가 필요 없어 인벤토리를 접는다
        else if (id === 'water') Work.hint(['물이 흙에 스며들도록', '흙 위에 놓아 주세요']);
        else Work.hint(['흙은 이미 올렸어요', '이제 물을 흙 위에 부어 주세요']);
      }
    },

    // 리듬 터치 판정 (scene.down 에서 직접 부른다 — workbench.js 버전과 상관없이 동작)
    onPress(ctx, x, y) {
      if (st.sub !== 2 || st.doneAt) return;
      const s = ctx.s, tr = tierOf(Math.abs(pointer()));
      const txt = tr.txt, col = tr.col, pts = tr.pts;
      if (pts >= 8) { st.combo++; st.best = Math.max(st.best, st.combo); } else st.combo = 0;   // Bad 면 연속 끊김
      st.score = Math.min(GOAL, st.score + pts); st.sq = pts >= 15 ? 1.2 : 0.8; st.pulse = 1;
      const b = barBox(ctx);
      st.pops.push({ txt, col, x: b.cx, y: b.cy - s * 0.09, t: 0 });
      if (st.score >= GOAL) st.doneAt = performance.now() + 1800;                    // 완료 문구를 잠깐 보여 준 뒤 2단계로
    },
  };

  /* ---------- 리듬 원 ---------- */
  // 포인터 위치: -1(왼쪽 끝) ~ 1(오른쪽 끝). 부드럽게 왔다갔다 한다
  function pointer() { return Math.cos((2 * Math.PI * st.t) / PERIOD); }
  // 반죽 가운데의 화면 좌표
  function center(ctx) { return Camera.worldToScreen(Work.cam.viewProj, [0, H / 2, 0], ctx.W, ctx.H); }
  // 게이지 바: 반죽 바로 위 (화면 좌표)
  function barBox(ctx) {
    const top = Camera.worldToScreen(Work.cam.viewProj, [0, H, 0], ctx.W, ctx.H), s = ctx.s;
    const w = Math.min(ctx.W * 0.7, s * 0.8), h = s * 0.06;
    return { cx: top.x, cy: top.y - s * 0.1, w, h };
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
      else { lines = ['좌우로 움직이는 바늘이 가운데 초록 구간에 올 때', `반죽을 톡! 터치하세요 (${st.score}/${GOAL}점)`]; goal = '박자에 맞춰 치댈수록 반죽이 매끈하고 쫀득해져요'; }
      Work.drawGuide(ctx, '① 반죽하기', lines, goal);
      Work.drawInventory(ctx);

      if (st.sub !== 2) return;
      const c = center(ctx), bx0 = barBox(ctx);

      // 판정 글자 (위로 떠오르며 사라진다)
      st.pops.forEach((p) => {
        const a = 1 - p.t / 0.8;
        ui.drawText(ui.text(p.txt), p.x, p.y - p.t * s * 0.08, s * 0.06, 'center', W * 0.8, [p.col[0], p.col[1], p.col[2], a]);
      });
      // 연속 성공
      if (st.combo >= 2 && !st.doneAt) ui.drawText(ui.dynText('combo', `🔥 ${st.combo}연속!`), c.x, c.y + s * 0.2, s * 0.05, 'center', W * 0.8, [1, 0.85, 0.5, 1]);

      // 점수 막대
      const bw = W * 0.56, bh = s * 0.035, bx = W / 2 - bw / 2 - W * 0.04, by = Hh * 0.78;
      ui.rect(bx, by, bw, bh, [1, 1, 1, 0.16], bh / 2);
      if (st.score > 0) ui.rect(bx, by, Math.max(bh, bw * (st.score / GOAL)), bh, [0.95, 0.7, 0.3, 1], bh / 2);
      // 게이지 아래 안내: 몇 점을 채워야 하는지
      ui.drawText(ui.dynText('gauge', `${st.score} / ${GOAL}점 — ${GOAL}점을 채우면 다음 단계로!`), bx + bw / 2, by + bh + s * 0.04, s * 0.04, 'center', bw);

      if (!st.doneAt) {
        // 게이지 바: 바깥 빨강 → 주황 → 노랑 → 가운데 초록 (띠 너비는 TIERS.max 를 따른다)
        const { cx, cy, w, h } = bx0, x0 = cx - w / 2, y0 = cy - h / 2;
        ui.rect(x0 - 3, y0 - 3, w + 6, h + 6, [0, 0, 0, 0.45], h * 0.5);
        const bands = [[1, TIERS[3]], [TIERS[2].max, TIERS[2]], [TIERS[1].max, TIERS[1]], [TIERS[0].max, TIERS[0]]];
        bands.forEach(([f, t], i) => ui.rect(cx - (w / 2) * f, y0, w * f, h, [...t.col, 1], i === 0 ? h * 0.5 : 0));
        // 포인터: 바 위를 좌우로 왕복 (맞는 구간의 색으로 윤곽이 빛난다)
        const px = cx + pointer() * (w / 2), pw = Math.max(5, s * 0.014);
        ui.rect(px - pw * 0.5 - 2, y0 - h * 0.35 - 2, pw + 4, h * 1.7 + 4, [0, 0, 0, 0.55], pw);
        ui.rect(px - pw * 0.5, y0 - h * 0.35, pw, h * 1.7, [1, 1, 1, 1], pw / 2);
        ui.circle(px, y0 - h * 0.35, pw * 2.2, [1, 1, 1, 1]);
        if (st.pulse > 0.05) ui.rect(x0, y0, w, h, [1, 1, 1, 0.35 * st.pulse], h * 0.5);   // 터치 순간 반짝
      }
    },

    down(ctx, x, y, type) {
      cb.ctx = ctx; Work.down(ctx, x, y, type, cb);
      // 반죽을 누르면 점수 (빈 곳 드래그는 물레 돌리기)
      if (st.sub === 2 && !st.doneAt) {
        if (cb.hitClay(ctx, x, y)) cb.onPress(ctx, x, y);
      }
    },
    move(ctx, x, y) { Work.move(ctx, x, y); },
    up(ctx, x, y) { cb.ctx = ctx; Work.up(ctx, x, y, cb); },
  });
})();