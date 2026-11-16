// src/scenes/stage3-stack.js — 3단계: 흙 쌓고 빚기 (이전 3단계 「흙 쌓기」 + 4단계 「옹기 빚기」 통합, 2026-11-16 피드백 반영)
// 흐름: 바닥판 크기 조절 → 타래를 올려 1단 → 그 단의 폭(고리 좌우)·높이(축 위아래) 조절 → 다음 타래 … 6단까지 → 「완료」
// 가이드(고리·높이 축)는 "지금 다듬는 단"에만 있다. 다음 타래를 올리면 꺼졌다가, 새 단이 다 올라오면 다시 켜진다 (사용자 요청 3)
// 올린 단은 다음 타래를 올리면 굳는다(다시 조절 불가). 되돌리려면 「뒤로가기」로 마지막 단을 내려놓는다 (한 단도 없으면 2단계로)
// 물레는 자동으로 돌지 않는다: 빈 곳을 누른 채 좌우로 흔들면 그 방향으로 돈다 (shared/workbench.js)

(() => {
  const { mat4 } = glMatrix;
  const LAYERS = Pot.BANDS;                          // 6단 (= 옹기 6구간)
  const BASE_H = 0.06;                               // 바닥판 두께 (2단계가 만든 바닥판과 같다)

  /* ---------- 3단계 전용: 반투명 가이드 셰이더 (고리 원판·높이 축) — 삭제된 이전 4단계 stage4-shape.js 에서 가져옴 ---------- */
  const GUIDE_VS = `#version 300 es
  in vec3 aPos;
  in vec2 aUV;
  uniform mat4 uModel, uView, uProj;
  out vec2 vUV;
  void main() {
    vUV = aUV;
    gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
  }`;

  const GUIDE_FS = `#version 300 es
  precision mediump float;
  in vec2 vUV;
  uniform vec4 uColor;
  uniform float uEdge;   // 1이면 원판: 가장자리(v→1)를 밝게 그려 고리처럼 보이게
  out vec4 outColor;
  void main() {
    vec3 c = uColor.rgb;
    float a = uColor.a;
    if (uEdge > 0.5) {
      float e = smoothstep(0.82, 1.0, vUV.y);   // 원판 단면에서 v는 중심(0) → 가장자리(1)
      c = mix(c, vec3(1.0), e * 0.5);
      a = mix(a, min(1.0, a * 3.5), e);
    }
    outColor = vec4(c, a);
  }`;

  const RING_GAP = 0.05;            // 원판은 옹기 표면보다 살짝 크게 → 가장자리 고리가 옹기 밖으로 보인다
  const AXIS_WIDTH = 0.07;          // 높이 축 판의 폭
  const KNOB_LIFT = 0.1;            // 높이 손잡이는 그 단의 윗면보다 이만큼 위에
  const PICK = [1.0, 0.75, 0.42];   // 잡고 있을 때 색
  const IDLE = [0.85, 0.9, 1.0];    // 기본 가이드 색

  let gres = null;                  // 가이드 셰이더·원판·사각형 메시 (처음 들어올 때 한 번 만든다)
  const m = mat4.create();          // 가이드 모델 행렬 (재사용)
  let defaults = null;              // 기본 옹기 데이터 — 뒤로가기로 단을 내려놓을 때 그 단의 폭·높이를 되돌리는 데 쓴다

  const st = {
    layers: 0,             // 올린 단 수 (0 = 바닥판만)
    top: 0,                // 지금 화면에 보이는 벽 높이 (올린 단의 윗면 높이를 부드럽게 따라간다)
    sq: 0,                 // 타래를 올렸을 때 출렁이는 효과
    guideA: 0,             // 가이드 밝기 0~1 — 새 단이 올라오는 동안 0(꺼짐), 다 올라오면 1(켜짐)로 서서히
    drag: null,            // 잡고 있는 가이드 { kind: 'ring' | 'height', side, lastX, lastY }
    hover: null,           // 'ring' | 'height' | null
    cursor: { x: 0, y: 0, visible: false, grab: false },
    ring: null,            // 지금 단 고리의 화면 정보 { cx, cy, a, b, pxPerUnit } (화면에 그려지는 타원)
    axis: null,            // 지금 단 높이 축의 화면 정보 { x, bottom, top, knobX, knobY, pxPerUnitY } (바닥 단계에서는 null)
    buttons: [],
    toastUntil: 0,
    wallDirty: true,       // 벽 메시를 다시 만들어야 하는가 (단을 올리거나 폭·높이가 바뀌었을 때만)
    baseDirty: true,       // 바닥판 메시를 다시 만들어야 하는가 (바닥 반지름이 바뀌었을 때만)
  };

  const cur = () => st.layers - 1;                   // 지금 다듬는 단 번호 (−1 = 바닥판)
  const pct = (v, lo, hi) => Math.round(((v - lo) / (hi - lo)) * 100);

  function initResources(gl) {
    const prog = Program.create(gl, GUIDE_VS, GUIDE_FS);
    gres = {
      prog,
      disk: Mesh.uploadMesh(gl, Mesh.createRevolution(Mesh.diskProfile(1, 0, 8), 64), prog.locs),
      quad: Mesh.uploadMesh(gl, Mesh.quadMesh(), prog.locs),
    };
  }

  /** 고리의 모델 행렬: 높이 y로 옮기고, 반지름 r만큼 x·z로 늘린다 (단위 원판 하나를 재사용) */
  function diskModel(y, r) {
    mat4.fromTranslation(m, [0, y, 0]);
    mat4.scale(m, m, [r + RING_GAP, 1, r + RING_GAP]);
    return m;
  }

  /** 높이 축 판: 그 단의 아랫면 y0 에서 윗면 + 손잡이까지. 작업대 카메라는 yaw 0 이라 돌리지 않아도 항상 정면이다 */
  function axisModel(y0, y1) {
    mat4.fromTranslation(m, [0, y0, 0]);
    mat4.scale(m, m, [AXIS_WIDTH, y1 - y0 + KNOB_LIFT, 1]);
    return m;
  }

  /* ---------- 지금 단의 가이드가 화면 어디에 있는지 계산 (선택 판정·라벨 배치에 사용) ---------- */
  function computeScreenInfo(ctx) {
    const { W, H, s } = ctx;
    const pot = ctx.pot_main;
    const toS = (p) => Camera.worldToScreen(Work.cam.viewProj, p, W, H);   // 작업대 카메라(yaw 0)를 그대로 쓴다
    const ellipse = (y, R) => {
      const c = toS([0, y, 0]);
      const side = toS([R, y, 0]);      // 카메라 기준 오른쪽
      const front = toS([0, y, R]);     // 카메라 쪽
      const a = Math.hypot(side.x - c.x, side.y - c.y);
      return { cx: c.x, cy: c.y, a, b: Math.abs(front.y - c.y), pxPerUnit: a / R };
    };

    if (st.layers === 0) {
      // 바닥 단계: 바닥판 둘레에 고리만 (두께는 고정이라 높이 축 없음)
      st.ring = ellipse(BASE_H / 2, pot.shape.base + RING_GAP);
      st.axis = null;
      return;
    }
    const i = cur();
    st.ring = ellipse(pot.bandY(i), pot.shape.radii[i] + RING_GAP);
    const y0 = i > 0 ? pot.bandTop(i - 1) : 0, y1 = pot.bandTop(i);
    const bottom = toS([0, y0, 0]), top = toS([0, y1, 0]), knob = toS([0, y1 + KNOB_LIFT, 0]);
    const zero = toS([0, 0, 0]), one = toS([0, 1, 0]);
    // 화면에서 세로 1 단위가 몇 픽셀인지. 너무 작으면 조금만 밀어도 높이가 크게 변하므로 최소값을 둔다
    st.axis = { x: bottom.x, bottom: bottom.y, top: top.y, knobX: knob.x, knobY: knob.y, y0, y1,
      pxPerUnitY: Math.max(Math.abs(zero.y - one.y), s * 0.15) };
  }

  /* ---------- 무엇을 잡았는가: 손잡이 → 축 판 → 고리 → 없음. 가이드가 꺼져 있을 때는 잡히지 않는다 ---------- */
  function pick(ctx, x, y) {
    const s = ctx.s;
    if (st.guideA < 0.5 || !st.ring) return null;
    const ax = st.axis;
    if (ax) {
      if (Math.hypot(x - ax.knobX, y - ax.knobY) < s * 0.08) return 'height';
      if (Math.abs(x - ax.x) < s * 0.035 && y > Math.min(ax.knobY, ax.bottom) && y < Math.max(ax.knobY, ax.bottom)) return 'height';
    }
    const b = st.ring;
    const dx = (x - b.cx) / (b.a * 1.15);
    const dy = (y - b.cy) / Math.max(b.b * 1.3, s * 0.035); // 타원이 납작하므로 세로 여유를 준다
    if (dx * dx + dy * dy <= 1) return 'ring';
    return null;   // 인벤토리·물레 돌리기는 Work 가 처리
  }

  // 손가락에 커서가 가려지지 않도록, 터치일 때는 커서를 손가락보다 위에 그리고 그 위치로 조작한다
  function cursorFrom(ctx, x, y, type) {
    const off = type === 'mouse' ? 0 : ctx.s * 0.08;
    return { x, y: y - off };
  }

  /* ---------- 작업대(Work) 콜백: 타래 놓기 ---------- */
  const cb = {
    hitClay: (ctx, x, y) => Work.hitClay(ctx, x, y, 0.95, Math.max(st.top, 0.25)),
    onDrop(id, x, y) {
      const ctx = cb.ctx;
      if (id !== 'coil') return;
      if (st.layers >= LAYERS) { Work.hint([`타래 ${LAYERS}단을 다 올렸어요`, '마지막 단을 다듬고 완료를 눌러 주세요']); return; }
      if (!cb.hitClay(ctx, x, y)) { Work.hint(['타래가 바닥판 테두리에 닿도록', '옹기 위에 놓아 주세요']); return; }
      st.layers++;                                   // 한 단 올리기 — 올리는 순간 이미 성형된(기본 옹기) 모양이다
      st.guideA = 0;                                 // 이전 단의 가이드를 끈다 → 새 단이 다 올라오면 그 단의 가이드가 켜진다
      st.hover = null; st.sq = 1; st.wallDirty = true;
    },
  };

  function onButton(ctx, id) {
    if (id === 'back') {
      if (st.layers === 0) { ctx.go('stage2-base'); return; }        // 올린 단이 없으면 이전 단계로
      const i = cur();
      ctx.pot_main.setRadius(i, defaults.radii[i]);                  // 내려놓은 단의 폭·높이는 기본값으로 되돌린다
      ctx.pot_main.setLayerHeight(i, defaults.heights[i]);
      st.layers--;
      st.guideA = 0; st.hover = null; st.drag = null; st.wallDirty = true;
    }
    if (id === 'done') {
      if (st.layers < LAYERS) { Work.hint([`타래를 ${LAYERS}단까지 올려야 완성돼요`, `(지금 ${st.layers}/${LAYERS})`]); return; }
      // 4단계(꾸미기)로 — exit 가 toData() 를 넘긴다
      console.log('[옹기 형태]', JSON.stringify(ctx.pot_main.toData()));
      ctx.go('stage4-decorate');
    }
  }

  Scenes.register('stage3-stack', {
    enter(ctx) {
      if (!gres) initResources(ctx.gl);
      ctx.pot_main.reset();                           // 기본 옹기 모양 = 올리는 단마다 처음 갖는 폭·높이
      defaults = ctx.pot_main.toData();
      Object.assign(st, { layers: 0, top: 0, sq: 0, guideA: 0, drag: null, hover: null, ring: null, axis: null,
        toastUntil: 0, wallDirty: true, baseDirty: true });
      st.cursor.visible = false;
      Work.setInventory(['coil'], true);              // 3단계 인벤토리: 타래만
      Work.resetView();                               // 사용자 줌·상하 이동은 기본값에서 시작
      Work.view.panEnabled = true;                    // 옹기 밖을 잡고 위아래로 끌면 화면이 움직인다 (확대했을 때 위아래 보기)
    },

    update(ctx, dt) {
      cb.ctx = ctx;
      Work.update(ctx, dt);
      const pot = ctx.pot_main;

      // 쌓인 높이: 높이 축을 끌고 있을 때는 바로 따라가고, 단을 올리거나 내려놓을 때는 부드럽게 자라거나 줄어든다
      const goal = st.layers > 0 ? pot.bandTop(cur()) : 0, prev = st.top;
      if (st.drag && st.drag.kind === 'height') st.top = goal;
      else {
        st.top += (goal - st.top) * Math.min(1, dt * 5);
        if (Math.abs(st.top - goal) < 0.002) st.top = goal;
      }
      if (st.top !== prev) st.wallDirty = true;
      st.sq *= Math.exp(-dt * 5);
      // 카메라 (사용자가 정한 화면 기준): 화면 중심·기준 거리는 1·2단계와 같고, 옹기가 기본 높이(6단 × 기본 단 높이 = 1.3)보다 높아지면
      // 꼭대기(손잡이 포함)가 화면 중심에서 떨어진 비율만큼 줌아웃한다 → 꼭대기의 화면 위치가 기본 높이일 때와 똑같이 유지된다
      const yTop = st.top + KNOB_LIFT + 0.06, yTopDefault = defaults.height + KNOB_LIFT + 0.06;
      Work.setZoom((yTop - Work.FOCUS_DEFAULT) / (yTopDefault - Work.FOCUS_DEFAULT));   // 1보다 작으면 Work 가 1로 막는다
      // 상하 이동 범위: 물레 윗면 근처 ~ 옹기 꼭대기 (확대하지 않았을 때도 이 범위 안에서만 움직인다)
      Work.view.targetMin = 0.05;
      Work.view.targetMax = Math.max(Work.FOCUS_DEFAULT, yTop);

      // 가이드 켜기/끄기: 벽이 자라는(줄어드는) 동안은 꺼 두고, 자리를 잡으면 서서히 켠다
      const settled = Math.abs(st.top - goal) < 0.01;
      st.guideA += ((settled ? 1 : 0) - st.guideA) * Math.min(1, dt * (settled ? 6 : 14));

      // 바닥판 메시 (바닥 반지름이 바뀐 경우에만)
      if (st.baseDirty) { Work.setLump(ctx, pot.shape.base, BASE_H, 7, 0); st.baseDirty = false; }

      // 벽 메시: 지금 높이(top)를 덮는 단까지의 반지름·높이만으로 단면을 만든다 (바뀐 경우에만 다시 계산)
      // 뒤로가기로 벽이 줄어드는 동안은 내려놓은 단도 잠깐 포함된다
      if (st.wallDirty && st.top > 0.005) {
        let n = 0, acc = 0;
        while (n < LAYERS && acc < st.top - 1e-4) { acc += pot.shape.heights[n]; n++; }
        n = Math.max(1, n);
        Work.setWall(ctx, pot.shape.base, pot.shape.radii.slice(0, n), pot.shape.heights.slice(0, n), st.top);
        st.wallDirty = false;
      }

      computeScreenInfo(ctx);
      st.buttons = ctx.ui.layoutBottomPair(ctx.W, ctx.H,
        { id: 'back', label: '뒤로가기' }, { id: 'done', label: '완료', primary: st.layers >= LAYERS });
    },

    draw(ctx) {
      const pot = ctx.pot_main;
      Work.drawScene(ctx, () => {
        Work.drawLump(ctx, 0.35, 1, 0);                         // 바닥판
        if (st.top > 0.005) {
          // 지금 다듬는 단을 따뜻한 띠로 강조 — 벽 메시의 v 는 0(바닥)~1(지금 높이 top) 이므로 그 비율로 바꿔 준다
          const i = cur();
          const hl = i >= 0 ? { activeV: pot.bandY(i) / st.top, bandHalf: pot.shape.heights[i] / 2 / st.top } : null;
          Work.drawWall(ctx, st.sq * Math.cos(performance.now() / 70), hl);
        }
      });

      /*
       * 반투명 가이드: 옹기 "안쪽"에 있지만 보여야 하므로 깊이 테스트를 끄고 그 위에 겹쳐 그린다.
       * 깊이 테스트를 켜 두면 옹기 벽에 가려 보이지 않는다. 밝기(guideA)가 0이면 그리지 않는다
       */
      if (st.guideA > 0.01 && st.ring) {
        const gl = ctx.gl, L = gres.prog.locs, A = st.guideA;
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(gres.prog.prog);
        gl.uniformMatrix4fv(L.uView, false, Work.cam.view);
        gl.uniformMatrix4fv(L.uProj, false, Work.cam.proj);

        // 고리 (바닥판 또는 지금 단)
        const onR = (st.drag && st.drag.kind === 'ring') || st.hover === 'ring';
        const colR = onR ? PICK : IDLE;
        gl.uniform1f(L.uEdge, 1);
        gl.uniform4f(L.uColor, colR[0], colR[1], colR[2], (onR ? 0.26 : 0.16) * A);
        const i = cur();
        gl.uniformMatrix4fv(L.uModel, false, i >= 0 ? diskModel(pot.bandY(i), pot.shape.radii[i]) : diskModel(BASE_H / 2, pot.shape.base));
        gl.bindVertexArray(gres.disk.vao);
        gl.drawElements(gl.TRIANGLES, gres.disk.count, gl.UNSIGNED_SHORT, 0);

        // 높이 축 (지금 단에만)
        if (st.axis) {
          const onH = (st.drag && st.drag.kind === 'height') || st.hover === 'height';
          const colH = onH ? PICK : IDLE;
          gl.uniform1f(L.uEdge, 0);
          gl.uniform4f(L.uColor, colH[0], colH[1], colH[2], (onH ? 0.45 : 0.2) * A);
          gl.uniformMatrix4fv(L.uModel, false, axisModel(st.axis.y0, st.axis.y1));
          gl.bindVertexArray(gres.quad.vao);
          gl.drawElements(gl.TRIANGLES, gres.quad.count, gl.UNSIGNED_SHORT, 0);
        }
      }
    },

    drawUI(ctx) {
      const { W, H, s, ui } = ctx;
      const pot = ctx.pot_main, A = st.guideA;

      // 제목과 안내 (단계 진행에 따라 바뀐다)
      let lines, goal;
      if (st.layers === 0) {
        lines = ['바닥판의 고리를 좌우로 밀어 바닥 크기를 정하고', `타래를 끌어다 올려 첫 단을 쌓으세요 (0/${LAYERS})`];
        goal = '올린 단마다 고리로 폭을, 가운데 축으로 높이를 정해요';
      } else if (st.layers < LAYERS) {
        lines = [`${st.layers}단의 폭(고리 좌우)과 높이(축 위아래)를 조절하고`, `다 됐으면 다음 타래를 올리세요 (${st.layers}/${LAYERS})`];
        goal = '다음 타래를 올리면 이 단은 굳어요. 되돌리려면 뒤로가기';
      } else {
        lines = [`✨ ${LAYERS}단을 다 올렸어요`, '마지막 단을 다듬고 완료를 누르세요'];
        goal = '빈 곳을 누른 채 좌우로 흔들면 물레가 돌아 옆면을 볼 수 있어요';
      }
      Work.drawGuide(ctx, '③ 흙 쌓고 빚기', lines, goal);

      if (st.ring && A > 0.01) {
        // 높이 손잡이 (축 맨 위의 동그라미)
        if (st.axis) {
          const onH = (st.drag && st.drag.kind === 'height') || st.hover === 'height';
          ui.circle(st.axis.knobX, st.axis.knobY, s * 0.06, onH ? [1, 0.75, 0.42, 0.95 * A] : [1, 1, 1, 0.55 * A]);
          ui.drawText(ui.text('↕'), st.axis.knobX, st.axis.knobY, s * 0.045, 'center', Infinity, [0.2, 0.15, 0.12, A]);
        }
        // 단 이름 — 고리 왼쪽 끝
        const b = st.ring;
        ui.drawText(ui.text(st.layers === 0 ? '바닥' : String(st.layers)), b.cx - b.a - s * 0.035, b.cy, s * 0.04, 'right', Infinity, [1, 0.8, 0.5, A]);
      }

      // 지금 다듬는 대상의 현재 값
      const label = st.layers === 0
        ? `바닥 폭 ${pct(pot.shape.base, Pot.R_MIN, Pot.R_MAX)}%`
        : `${st.layers}단 폭 ${pct(pot.shape.radii[cur()], Pot.R_MIN, Pot.R_MAX)}% · 높이 ${pct(pot.shape.heights[cur()], Pot.LH_MIN, Pot.LH_MAX)}%`;
      ui.drawText(ui.dynText('value', label), W / 2, H * 0.055 + s * 0.225, s * 0.045, 'center', W * 0.9, [1, 0.8, 0.5, 1]);

      // 버튼
      for (const b of st.buttons) ui.button(b);

      // 완료 안내
      if (performance.now() < st.toastUntil) {
        const t = ui.text('모양을 저장했어요 (콘솔 확인)', { weight: 400 });
        const th = s * 0.045, tw = Math.min(t.aspect * th, W * 0.9);
        const ty = st.buttons[0].y - st.buttons[0].h - s * 0.04;
        ui.rect(W / 2 - tw / 2 - s * 0.03, ty - th * 0.9, tw + s * 0.06, th * 1.8, [0, 0, 0, 0.6], th * 0.5);
        ui.drawText(t, W / 2, ty, th, 'center', W * 0.9);
      }

      // 손 커서: 가이드 위에 있을 때 펼친 손 / 잡았을 때 쥔 손
      if (st.cursor.visible) ui.drawText(ui.text(st.cursor.grab ? '✊' : '✋'), st.cursor.x, st.cursor.y, s * 0.1);

      Work.drawInventory(ctx);   // 끌고 있는 타래가 맨 위에 보이도록 마지막에
    },

    // 판정 순서: 버튼 → (인벤토리 위가 아니면) 손잡이·축·고리 → 작업대(재료 끌기 / 물레 돌리기)
    down(ctx, x, y, type) {
      for (const b of st.buttons) {
        if (ctx.ui.hit(b, x, y)) { onButton(ctx, b.id); return; }
      }
      cb.ctx = ctx;
      const c = cursorFrom(ctx, x, y, type);
      const target = Work.inInventory(ctx, x, y) ? null : pick(ctx, c.x, c.y);
      if (target === 'height') {
        st.drag = { kind: 'height', lastY: c.y };
      } else if (target === 'ring') {
        // 오른쪽을 잡으면 오른쪽으로 당길 때, 왼쪽을 잡으면 왼쪽으로 당길 때 넓어진다
        st.drag = { kind: 'ring', side: c.x >= st.ring.cx ? 1 : -1, lastX: c.x };
      } else {
        Work.down(ctx, x, y, type, cb);
        return;
      }
      Object.assign(st.cursor, c, { visible: true, grab: true });
    },

    move(ctx, x, y, type) {
      const d = st.drag;
      if (!d) { Work.move(ctx, x, y); return; }
      const c = cursorFrom(ctx, x, y, type);
      Object.assign(st.cursor, c, { visible: true });
      const pot = ctx.pot_main;

      if (d.kind === 'ring') {
        // 화면에서 움직인 픽셀 → 월드 단위 반지름 변화 (그 높이에서 1 단위가 몇 픽셀인지로 나눈다)
        const dr = (d.side * (c.x - d.lastX)) / st.ring.pxPerUnit;
        if (st.layers === 0) {
          const before = pot.shape.base;
          pot.setBase(before + dr);
          if (pot.shape.base !== before) st.baseDirty = true;
        } else {
          const i = cur(), before = pot.shape.radii[i];
          pot.setRadius(i, before + dr);
          if (pot.shape.radii[i] !== before) st.wallDirty = true;
        }
        d.lastX = c.x;
      } else if (d.kind === 'height') {
        // 화면 y는 아래로 갈수록 커지므로, 위로 밀면(dy < 0) 높아진다
        const i = cur(), before = pot.shape.heights[i];
        pot.setLayerHeight(i, before - (c.y - d.lastY) / st.axis.pxPerUnitY);
        if (pot.shape.heights[i] !== before) st.wallDirty = true;
        d.lastY = c.y;
      }
    },

    up(ctx, x, y, type) {
      if (st.drag) {
        st.drag = null; st.cursor.grab = false;
        if (type !== 'mouse') st.cursor.visible = false;
        return;
      }
      cb.ctx = ctx;
      Work.up(ctx, x, y, cb);
    },

    hover(ctx, x, y) {
      st.hover = Work.inInventory(ctx, x, y) ? null : pick(ctx, x, y);
      Object.assign(st.cursor, { x, y, visible: st.hover !== null, grab: false });
    },

    /* ---------- 줌인·줌아웃: 마우스 휠(컴퓨터) / 두 손가락 벌리기·오므리기(휴대폰) ---------- */
    wheel(ctx, x, y, dy) {
      Work.zoomBy(Math.exp(dy * 0.0012));              // 아래로 굴리면(dy > 0) 멀어진다. 한 칸(약 100)에 ×1.13
    },
    pinch(ctx, factor) {
      Work.zoomBy(1 / factor);                          // 손가락을 벌리면(factor > 1) 가까워진다
    },
    cancel(ctx) {
      // 두 번째 손가락이 닿았다: 끌던 고리·축은 놓고, 작업대 조작(재료 끌기·물레 돌리기)도 취소
      st.drag = null; st.cursor.visible = false; st.cursor.grab = false;
      Work.cancel();
    },

    exit(ctx) {
      Work.setZoom(1);                                  // 줌아웃은 3단계에서만. 2단계로 돌아가거나 다음 단계로 갈 때 기준 거리로
      Work.resetView();                                 // 사용자 줌·상하 이동도 기본값으로 (1·2단계는 그대로 보이게)
      return ctx.pot_main.toData();
    },
  });
})();
