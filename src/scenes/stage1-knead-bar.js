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
  // (2026-11-20 피그마 그림 적용) max 를 게이지 그림(stage2-gauge.png)의 색 띠 경계에 맞춤 — 그림과 판정이 같아야 한다.
  //   원래 값: 초록 0.12 / 노랑 0.22 / 주황 0.35. 그림 값: 초록 0.14 / 노랑 0.44 / 주황 0.69 (바깥 크림색 = Bad)
  //   → 노랑·주황이 넓어져 전보다 쉽다. 어렵게 하려면 PERIOD 를 줄이거나 그림의 띠를 다시 그려야 한다 (여기 숫자만 바꾸면 그림과 어긋남)
  const TIERS = [
    { max: 0.14, txt: 'Excellent!', pts: 20, col: [0.45, 0.95, 0.45] },   // 초록 (가운데)
    { max: 0.44, txt: 'Great!',     pts: 15, col: [1, 0.92, 0.3] },        // 노랑
    { max: 0.69, txt: 'Good',       pts: 8,  col: [1, 0.62, 0.2] },        // 주황
    { max: Infinity, txt: 'Bad',    pts: 2,  col: [1, 0.3, 0.28] },        // 빨강 (바깥) — 그림에서는 크림색
  ];
  // (2026-11-20) 게이지 그림: 안쪽 칸(포인터가 움직이는 범위)은 그림 폭의 2.6% ~ 97.2%. 피그마 위치: 폭 0.462u, 중심 0.275H
  const GAUGE = { img: './assets/stages/stage2/stage2-gauge.png', cursor: './assets/stages/stage2/stage2-gauge-cursor.png',
    in0: 0.026, in1: 0.972, w: 0.462, y: 0.275, cursorW: 0.06 };   // cursorW: ▼ 표시 폭 (피그마는 0.03u 로 너무 작아 두 배로)
  const tierOf = (f) => TIERS.find((t) => f <= t.max);
  const PERIOD = 3.0;          // 포인터가 왼쪽→오른쪽→왼쪽 한 바퀴 도는 시간(초). 길수록 쉽다

  const R = 0.42, H = 0.75, P = 2.3;                // 흙 덩어리 모양 (초타원)
  const st = { sub: 0, score: 0, combo: 0, best: 0, t: 0, appear: 0, wetT: 0, sq: 0, pulse: 0, pops: [], doneAt: 0, left: false };
  // sub 0: 흙 → 물레 / 1: 물 → 흙 / 2: 리듬 반죽
  // (2026-11-25) 1.5: 물을 부어 젖는 중 — 「1단계 완료」 팝업의 「다음으로」를 누르면 2 (그 전에는 배너 1, 게이지 없음)

  const cb = {
    // 리듬 반죽 중에는 터치 위치와 상관없이 화면 어디를 눌러도 되도록 onPress 로 처리한다 (아이들이 정확히 누르기 어렵다)
    hitClay: (ctx, x, y) => st.sub >= 1 && Work.hitClay(ctx, x, y, R, H),

    // (2026-11-20) 받은 재료면 true — 아니면 작업대가 재료를 슬롯으로 튕겨 돌려보낸다 (안내 문구는 여기서)
    onDrop(id, x, y) {
      const ctx = cb.ctx, onClay = cb.hitClay(ctx, x, y);
      if (st.sub === 0) {
        if (id === 'soil') { st.sub = 1; st.appear = 0; st.sq = 1; return true; }   // 흙은 화면 안 어디에 놓아도 물레에 올라간다
        if (id === 'water') Work.hint(['물은 흙을 올린 다음에 써요', '먼저 흙을 물레 위에 놓아 주세요']);
        else Work.hint(['지금은 흙이 필요해요', '흙을 물레 위로 끌어다 놓아 주세요']);
      } else if (st.sub === 1) {
        // (2026-11-20) 피그마: 반죽 게임 중에도 슬롯 바 4칸을 그대로 보여 준다 → 인벤토리를 접지 않는다
        if (id === 'water' && onClay) {
          // st.wetT = 1; st.sub = 2; st.sq = 1; st.t = 0;
          // (2026-11-25 피그마 최종안) 흙 준비 끝 → 「1단계 완료」 팝업. 흙이 젖는 모습을 0.9초 보여 준 뒤 띄우고,
          // 「다음으로」를 누르면 팝업만 닫고 이 화면에서 리듬 반죽(피그마 2단계)이 이어진다
          // (2026-11-25 사용자 테스트) 바로 sub = 2 로 바꾸면 팝업이 뜨기 전 0.9초 동안 리듬 게임(배너 2·게이지)이 먼저 보였다
          //   → 젖는 중(sub 1.5)으로 두고 배너 1·게이지 숨김, 「다음으로」를 누를 때 리듬 반죽을 시작한다 (사용자 결정 C안)
          st.wetT = 1; st.sub = 1.5; st.sq = 1;
          Overlay.stageDone(ctx, 1, () => { st.sub = 2; st.t = 0; }, 0.9);
          return true;
        }
        else if (id === 'water') Work.hint(['물이 흙에 스며들도록', '흙 위에 놓아 주세요']);
        else if (id === 'soil') Work.hint(['흙은 이미 올렸어요', '이제 물을 흙 위에 부어 주세요']);
        else Work.hint(['지금은 물이 필요해요', '물을 흙 위로 끌어다 부어 주세요']);
      } else if (st.sub === 1.5) {
        Work.hint(['흙이 물을 머금는 중이에요']);   // (2026-11-25) 젖는 중 (팝업이 뜨기 전 0.9초)
      } else {
        Work.hint(['반죽할 때는 재료가 필요 없어요', '초록 칸에 맞춰 반죽을 톡! 터치해요']);
      }
      return false;
    },

    // 리듬 터치 판정 (scene.down 에서 직접 부른다 — workbench.js 버전과 상관없이 동작)
    onPress(ctx, x, y) {
      if (st.sub !== 2 || st.doneAt) return;
      const s = ctx.s, tr = tierOf(Math.abs(pointer()));
      const txt = tr.txt, col = tr.col, pts = tr.pts;
      if (pts >= 8) { st.combo++; st.best = Math.max(st.best, st.combo); } else st.combo = 0;   // Bad 면 연속 끊김
      st.score = Math.min(GOAL, st.score + pts); st.sq = pts >= 15 ? 1.2 : 0.8; st.pulse = 1;
      const b = barBox(ctx);
      st.pops.push({ txt, col, x: b.cx, y: b.cy + b.u * 0.17, t: 0 });   // (2026-11-20) 바 위는 배너라서 바 아래에 띄운다
      if (st.score >= GOAL) st.doneAt = performance.now() + 1800;                    // 완료 문구를 잠깐 보여 준 뒤 2단계로
    },
  };

  /* ---------- 리듬 원 ---------- */
  // 포인터 위치: -1(왼쪽 끝) ~ 1(오른쪽 끝). 부드럽게 왔다갔다 한다
  function pointer() { return Math.cos((2 * Math.PI * st.t) / PERIOD); }
  // 반죽 가운데의 화면 좌표
  function center(ctx) { return Camera.worldToScreen(Work.cam.viewProj, [0, H / 2, 0], ctx.W, ctx.H); }
  // 게이지 바: 반죽 바로 위 (화면 좌표)
  // (2026-11-20 피그마) 반죽 위가 아니라 배너 바로 아래 고정 위치 (0.275H). 반환 w 는 포인터가 움직이는 안쪽 칸 폭,
  // img = 그림 전체 사각형 (안쪽 칸 양옆에 테두리가 있어 그림이 조금 더 넓다)
  function barBox(ctx) {
    const u = Work.bottomLayout(ctx).u, t = ImageTex.get(ctx.gl, GAUGE.img);
    const iw = u * GAUGE.w, ih = iw / (t.ready ? t.aspect : 1052 / 159);
    const cx = ctx.W / 2, cy = ctx.H * GAUGE.y;
    const ix = cx - iw / 2;
    return { cx: ix + iw * (GAUGE.in0 + GAUGE.in1) / 2, cy, w: iw * (GAUGE.in1 - GAUGE.in0), h: ih, img: { x: ix, y: cy - ih / 2, w: iw, h: ih }, u };
  }

  Scenes.register('stage1-knead', {
    enter(ctx) {
      Object.assign(st, { sub: 0, score: 0, combo: 0, best: 0, t: 0, appear: 0, wetT: 0, sq: 0, pulse: 0, pops: [], doneAt: 0, left: false });
      Object.assign(Work.S.clay, { wet: 0, smooth: 0 });
      Work.setInventory(Work.ALL_ITEMS, true);          // 1단계 인벤토리: 흙과 물 두 개 → (2026-11-20 피그마) 아래 슬롯 바 4칸 (흙·물·잿물·장작)
      Work.setActiveItems(['soil', 'water']);           // (2026-11-24) 1단계는 흙·물만 쓴다 → 잿물·장작 칸은 반투명
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
      // (2026-11-25) 바로 넘어가지 않고 「2단계 완료」 팝업 → 「다음으로」에서 2단계(바닥 만들기 = 피그마 3단계 시작)로
      // 원래: setTimeout(() => ctx.go('stage2-base'), 0)   // 전환은 프레임 사이에서
      if (st.doneAt && !st.left && performance.now() > st.doneAt) { st.left = true; Overlay.stageDone(ctx, 2, () => ctx.go('stage2-base')); }
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
      // (2026-11-20 피그마) 제목·안내 글자 → 배너 그림. 흙·물 올리기 = 배너 1 「흙 준비하기」, 리듬 반죽 = 배너 2 「흙 반죽하기」
      // 위 lines·goal 은 원래 안내 문구 기록으로 남겨 둔다 (배너에 없는 물 붓기 단계·완성 문구만 배너 아래 한 줄로)
      const sub = st.doneAt ? lines[0] : st.sub === 1 ? '이제 물을 흙 위로 끌어다 부어 줘' : '';
      Work.drawBanner(ctx, st.sub < 2 ? 1 : 2, sub);
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

      // 점수 막대 → (2026-11-20 피그마) 막대 대신 슬롯 바 아래(버튼 줄 자리)에 「반죽 진행도 N/100」 글자.
      // 원래 막대(Hh * 0.78)는 아래 슬롯 바와 겹쳐서 뺐다
      const L = Work.bottomLayout(ctx);
      ui.drawText(ui.dynText('gauge', `반죽 진행도 ${st.score}/${GOAL}`), W / 2, Hh * 0.925, L.u * 0.06, 'center', L.u * 0.9, [0.3, 0.18, 0.1, 1]);   // 피그마: 0.925H

      // (2026-11-20 피그마) 게이지 그림 + ▼ 커서 그림. 그림을 불러오기 전에는 아래 원래 막대로 그린다
      const tG = ImageTex.get(ctx.gl, GAUGE.img), tC = ImageTex.get(ctx.gl, GAUGE.cursor);
      if (!st.doneAt && tG.ready && tC.ready) {
        const { cx, cy, w, h, img, u } = bx0;
        ui.drawImage(tG, img.x, img.y, img.w, img.h);
        if (st.pulse > 0.05) ui.rect(cx - w / 2, cy - h * 0.3, w, h * 0.6, [1, 1, 1, 0.45 * st.pulse], h * 0.3);   // 터치 순간 반짝
        // ▼ 커서: 끝이 바 윗변에 살짝 걸치도록, 포인터 위치를 따라 좌우로
        const px = cx + pointer() * (w / 2), cw = u * GAUGE.cursorW, ch = cw / tC.aspect;
        ui.drawImage(tC, px - cw / 2, img.y - ch * 0.8, cw, ch);
      } else if (!st.doneAt) {
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
        if (cb.hitClay(ctx, x, y) && !Work.inInventory(ctx, x, y)) cb.onPress(ctx, x, y);   // 슬롯을 잡은 건 반죽 터치가 아니다
      }
    },
    move(ctx, x, y) { Work.move(ctx, x, y); },
    up(ctx, x, y) { cb.ctx = ctx; Work.up(ctx, x, y, cb); },
  });
})();
