// src/scenes/stage5-glaze.js — 5단계: 완성하기 (유약 색 선택 후 바르기)
// (2026-11-19) 피그마 플로우: 이 화면은 유약(잿물) 색 선택 과정만 맡는다 — 황갈색 #A07835 / 밤갈색 #75432D / 흑갈색 #3E2823. 굽기는 6단계 stage6-gama
//   → (2026-11-20 수정) 색 코드는 #AD783E / #75432D / #3E2B23 (아래 GLAZES)
// 빈 틀: Scenes 약속(enter / update / draw / drawUI / down·move·up / exit)만 갖춰 두었다. 필요한 함수만 채우면 된다
// (2026-11-20) 기본 화면 깔기 — 피그마 Frame 13 「다섯번째, 잿물 입히기」 배치:
//   위 배너 5 · 가운데 4단계에서 만든 옹기(무늬 포함)가 물레 위에 · 잿물 색 원 3개(0.695H) · 아래 슬롯 바 4칸 · 「가마로 가기」 버튼
//   작업대(shared/workbench.js)의 카메라·물레 돌리기·줌·상하 이동은 3·4단계와 같다.
//   아직 안 만든 것: 색 고르기, 잿물 그릇을 옹기로 끌어 바르기, 옹기 색 바꾸기 (다음 작업)
// (2026-11-20 A안 「담그기」, 사용자 결정) 색 원을 누르면 FILL_TIME 동안 유약이 아래에서 위로 차오르며 옹기 전체가 그 색이 된다.
//   차오르는 동안 물레가 천천히 돈다(→ 2026-11-20 사용자 피드백으로 뺌). 다른 색을 누르면 이전 유약 위로 새 색이 다시 차오른다.
//   다 발라야 「가마로 가기」가 진해진다. 그리는 쪽은 Pot.glaze → PotShader (uGlazeColor·uGlazeTop·uGlazeUnder)
// (2026-11-24 사용자 요청) 색 원을 누르면 "색만 고른다" (옹기는 그대로). 아래 슬롯의 잿물 그릇을 끌어 옹기에 가져다 대야
//   고른 색으로 차오른다. 색을 안 고르고 그릇을 대면 안내 + 튕겨 돌아감. 다른 재료(흙·물·장작)도 안내 + 튕겨 돌아감

(() => {
  const { mat4 } = glMatrix;
  const Y_MARGIN = 0.16;                  // 줌 계산용 꼭대기 여유 — 4단계와 같게 해서 화면이 이어진다

  // 잿물 색 3종 (피그마 색표). img = 색 원 그림. hex 는 나중에 옹기 색을 바꿀 때 쓴다
  const GLAZES = [
    // (2026-11-20 수정) 피그마 색표를 처음에 #A07835 / #3E2823 로 잘못 읽었다 — 색 원 그림의 픽셀 색과 맞춰 고침
    { id: 'yellowbrown', name: '황갈색', hex: '#AD783E', img: './assets/stages/stage5/stage5-glaze-yellowbrown.png' },
    { id: 'chestnut',    name: '밤갈색', hex: '#75432D', img: './assets/stages/stage5/stage5-glaze-chestnut.png' },
    { id: 'darkbrown',   name: '흑갈색', hex: '#3E2B23', img: './assets/stages/stage5/stage5-glaze-darkbrown.png' },
  ];
  // 피그마 Frame 13 에서 잰 값: 색 원 중심 가로 0.302u / 0.5u / 0.694u, 보이는 지름 0.135u, 세로 0.695H.
  // 색 원 그림은 보이는 부분이 폭의 91.6% → 그림 지름 0.147u
  const FIG = { circleX: [0.302, 0.5, 0.694], circleImg: 0.147, circleY: 0.695 };

  const FILL_TIME = 1.6;                  // (2026-11-20) 유약이 바닥에서 꼭대기까지 차오르는 시간(초)
  const FILL_SPIN = 0.9;                  // 차오르는 동안 물레가 도는 속도 (라디안/초) — (2026-11-20) 사용자 피드백으로 쓰지 않음 (자동 회전은 4단계만)
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  GLAZES.forEach((g) => { g.rgb = hexToRgb(g.hex); });

  const st = { height: 1.3, circles: [], buttons: [], sel: -1, pop: 0 };   // sel: 고른 색 번호(-1 없음), pop: 누른 원이 통 튀는 효과

  // 작업대 콜백: 지금은 어떤 재료도 받지 않는다 (잿물 그릇 끌어 바르기는 다음 작업) → 안내 + 슬롯으로 튕겨 돌아감
  // (2026-11-20 A안) 잿물은 색 원을 눌러 바르므로 재료는 받지 않는다
  const cb = {
    hitClay: () => false,
    // onDrop() { Work.hint(['잿물은 위의 색 동그라미를 눌러 발라요', '마음에 드는 색을 골라 보세요']); return false; },
    // (2026-11-24) 잿물 그릇(glaze)을 옹기 위에 놓으면 고른 색으로 바른다. 받으면 true (그릇은 사라지고 슬롯에는 그대로 남는다)
    onDrop(id, x, y) {
      const ctx = cb.ctx;
      if (id !== 'glaze') { Work.hint(['아래의 잿물 그릇을', '옹기에 가져다 대요']); return false; }
      if (st.sel < 0) { Work.hint(['먼저 위의 동그라미에서', '잿물 색을 골라요']); return false; }
      if (!overPot(ctx, x, y)) { Work.hint(['잿물 그릇을', '옹기 위에 가져다 대요']); return false; }
      startGlaze(ctx, st.sel);
      return true;
    },
  };
  /** (2026-11-24) 화면 점 (x, y)가 옹기 위인가 — 가장 넓은 단 반지름 × 옹기 높이 사각형 (작업대 hitClay, 여유 포함) */
  function overPot(ctx, x, y) {
    const sh = ctx.pot_main.shape;
    return Work.hitClay(ctx, x, y, Math.max(sh.base, ...sh.radii), st.height);
  }

  /** (2026-11-20) i번 색으로 바르기 시작 — 이미 바른 색이 있으면 그 위로 다시 차오른다 */
  function startGlaze(ctx, i) {
    const gz = ctx.pot_main.glaze, g = GLAZES[i];
    // if (st.sel === i && gz.hex === g.hex) return;         // 같은 색을 또 누르면 그대로
    if (gz.hex === g.hex) { Work.hint(['이미 이 색이 발렸어요']); return; }   // (2026-11-24) 같은 색을 또 바르면 그대로 (sel 은 이제 고르기에서 바뀐다)
    gz.under = gz.hex && gz.level > 0.3 ? gz.color.slice() : null;   // 이전 유약이 어느 정도 발려 있었으면 아래에 깔아 둔다
    gz.hex = g.hex;
    for (let k = 0; k < 3; k++) gz.color[k] = g.rgb[k];      // 같은 배열을 고쳐 쓴다 (Pot 이 이 배열을 셰이더에 넘김)
    gz.level = 0;
    st.sel = i; st.pop = 1;
  }
  /** (2026-11-24) 색 원을 누르면 색만 고른다 — 옹기에 바르는 것은 잿물 그릇을 가져다 댈 때 (cb.onDrop) */
  function selectGlaze(i) {
    if (st.sel !== i) { st.sel = i; st.pop = 1; }
    Work.hint(['이제 아래의 잿물 그릇을', '옹기에 가져다 대요']);
  }

  function layoutUI(ctx) {
    const { W, H } = ctx, u = Work.bottomLayout(ctx).u, fx = W / 2 - u / 2;
    st.circles = GLAZES.map((g, i) => ({ ...g, x: fx + u * FIG.circleX[i], y: H * FIG.circleY, d: u * FIG.circleImg }));
    // (2026-11-20) 유약을 다 바르기 전에는 흐리게
    st.buttons = Work.buttonRow(ctx, [{ id: 'kiln', img: './assets/ui/buttons/btn-to-kiln.png', label: '가마로 가기', dim: !glazed(ctx) }]);
  }
  const glazed = (ctx) => ctx.pot_main.glaze.hex && ctx.pot_main.glaze.level >= 1;

  function onButton(ctx, id) {
    if (id === 'kiln') {
      // (2026-11-20) 유약을 다 바른 뒤에만 가마로
      // if (!glazed(ctx)) { Work.hint(st.sel < 0 ? ['먼저 잿물 색을 골라 주세요', '위의 동그라미를 눌러요'] : ['잿물이 다 발릴 때까지', '조금만 기다려 주세요']); return; }
      // (2026-11-24) 색만 고르고 아직 안 바른 경우 안내 추가
      if (!glazed(ctx)) {
        const gz = ctx.pot_main.glaze;
        Work.hint(st.sel < 0 ? ['먼저 잿물 색을 골라 주세요', '위의 동그라미를 눌러요']
          : !gz.hex ? ['아래의 잿물 그릇을', '옹기에 가져다 대요']
          : ['잿물이 다 발릴 때까지', '조금만 기다려 주세요']);
        return;
      }
      ctx.go('stage6-gama');        // exit 가 toData() 를 넘긴다
    }
  }

  Scenes.register('stage5-glaze', {
    enter(ctx, data) {
      // data: 이전 화면이 넘긴 옹기 데이터 { height, radii } → (2026-11-16 형식) { base, radii, heights, height }
      const pot = ctx.pot_main;
      if (data) pot.load(data);                        // 4단계에서 넘어온 모양 (무늬는 pot_main.decal 텍스처에 남아 있다)
      pot.update();
      st.height = pot.shape.height;
      // (2026-11-20) 이미 바른 색이 있으면(다시 들어온 경우) 그 색을 고른 상태로
      st.sel = GLAZES.findIndex((g) => g.hex === pot.glaze.hex); st.pop = 0;
      Work.setInventory(Work.ALL_ITEMS, true);
      Work.setActiveItems(['glaze']);                  // (2026-11-24) 5단계는 잿물 그릇만 쓴다 → 흙·물·장작 칸은 반투명
      Work.resetView();
      Work.view.panEnabled = true;                     // 옹기 밖을 위아래로 끌면 화면 이동 (3·4단계와 같음)
    },

    update(ctx, dt) {
      Work.update(ctx, dt);
      const pot = ctx.pot_main, H = st.height;
      // 카메라: 4단계와 같은 규칙 (중심 고정, 기본 높이보다 높으면 줌아웃), 상하 이동 범위도 같음
      const yTop = H + Y_MARGIN, yTopDefault = 1.3 + Y_MARGIN;
      Work.setZoom((yTop - Work.FOCUS_DEFAULT) / (yTopDefault - Work.FOCUS_DEFAULT));
      Work.view.targetMin = 0.05;
      Work.view.targetMax = Math.max(Work.FOCUS_DEFAULT, yTop);
      // (2026-11-20) 유약 차오르기: level 0 → 1. 차오르는 동안 물레가 천천히 돌아 둘레 전체가 발리는 모습이 보인다
      const gz = pot.glaze;
      // → (2026-11-20 사용자 피드백) 옹기가 저절로 도는 움직임은 4단계에서만. 5단계는 차오르는 동안 돌리지 않는다 (FILL_SPIN 안 씀)
      //   손으로 빈 곳을 끌어 물레를 돌리는 것은 1~3단계처럼 그대로 된다
      if (gz.hex && gz.level < 1) {
        gz.level = Math.min(1, gz.level + dt / FILL_TIME);
        if (gz.level >= 1) gz.under = null;                                     // 다 덮었으면 이전 색은 필요 없다
      }
      st.pop *= Math.exp(-dt * 6);
      // 옹기는 물레를 따라 돈다 (4단계와 같은 모델 행렬)
      mat4.fromTranslation(pot.model, [0, 0.003, 0]);
      mat4.rotateY(pot.model, pot.model, Work.S.angle);
      layoutUI(ctx);
    },

    draw(ctx) {
      Work.drawScene(ctx, () => ctx.pot_main.draw(ctx.potShader));
    },

    drawUI(ctx) {
      const { ui } = ctx;
      Work.drawBanner(ctx, 5, '');
      // 잿물 색 원 3개 (지금은 보여 주기만 — 고르기는 다음 작업)
      // (2026-11-20) 누르면 그 색으로 바른다. 고른 원은 뒤에 밝은 테두리 + 누를 때 통 튀는 효과
      // (2026-11-24) 누르면 고르기만 (테두리 = 고른 색, 옹기에는 잿물 그릇을 대야 발린다)
      st.circles.forEach((c, i) => {
        const t = ImageTex.get(ctx.gl, c.img), on = i === st.sel;
        const d = c.d * (on ? 1 + 0.12 * st.pop : 1);
        if (on) ui.circle(c.x, c.y, d * 1.16, [1, 0.95, 0.8, 0.95]);
        if (t.ready) ui.drawImage(t, c.x - d / 2, c.y - d / 2, d, d);
        else ui.circle(c.x, c.y, d * 0.9, [...c.rgb, 1]);   // 그림 전에는 색 동그라미
      });
      for (const b of st.buttons) ui.imageButton(b);
      Work.drawInventory(ctx);
    },

    // 판정 순서: 아래 버튼 → 작업대(슬롯 재료 끌기 / 빈 곳: 물레 돌리기·상하 이동)
    // (2026-11-20) 버튼 다음에 잿물 색 원 (원 안을 누르면 그 색으로 바르기)
    // (2026-11-24) 원 안을 누르면 색 고르기만 → 슬롯의 잿물 그릇을 옹기로 끌어 놓으면 바르기 (cb.onDrop)
    down(ctx, x, y, type) {
      for (const b of st.buttons) if (ctx.ui.hit(b, x, y)) { onButton(ctx, b.id); return; }
      for (let i = 0; i < st.circles.length; i++) {
        const c = st.circles[i];
        // if (Math.hypot(x - c.x, y - c.y) <= c.d * 0.5) { startGlaze(ctx, i); return; }
        if (Math.hypot(x - c.x, y - c.y) <= c.d * 0.5) { selectGlaze(i); return; }
      }
      cb.ctx = ctx;
      Work.down(ctx, x, y, type, cb);
    },
    move(ctx, x, y, type) { Work.move(ctx, x, y); },
    up(ctx, x, y, type) { cb.ctx = ctx; Work.up(ctx, x, y, cb); },
    wheel(ctx, x, y, dy) { Work.zoomBy(Math.exp(dy * 0.0012)); },
    pinch(ctx, factor) { Work.zoomBy(1 / factor); },
    cancel(ctx) { Work.cancel(); },

    exit(ctx) {
      Work.setZoom(1);
      Work.resetView();
      mat4.fromTranslation(ctx.pot_main.model, [0, 0.003, 0]);   // 회전은 이 화면 안에서만
      return ctx.pot_main.toData();
    },
  });
})();
