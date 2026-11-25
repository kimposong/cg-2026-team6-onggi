// src/scenes/ending.js — 마무리 화면 「옹기장이가 되었어요!」 (2026-11-25, 피그마 최종안 6-0-1)
// 7단계에서 만든 내 옹기 카드를 비스듬히 놓아 보여 주고, 「이제 진짜 옹기를 보러 가요!」 안내로 전시실 관람을 유도한다.
// 버튼: 「다시 만들기」 → 1단계 / 「처음으로」 → 시작 화면(start) (사용자 결정 3-6)
// 3D 는 그리지 않는다 (배경 그림은 main.js 가 그린다). 일시정지 버튼은 단계 화면에서만이라 여기엔 없다.

(() => {
  const IMG = {
    title: './assets/screens/ending/ending-title.png',
    caption: './assets/screens/ending/ending-caption.png',
    again: './assets/ui/buttons/btn-make-again.png',
    home: './assets/ui/buttons/btn-home.png',
  };
  // 배치 (피그마 9:16 프레임 기준: 크기·가로 = 프레임 폭 u 비율, 세로 = 화면 높이 H 비율)
  const FIG = {
    titleW: 1.0, titleY: 0.12,          // 제목 그림 (양옆 여백 포함)
    cardH: 0.44, cardY: 0.43,           // 카드 (기울인 그림의 높이·중심)
    tilt: -0.08,                        // 카드 기울기 (라디안, 약 −4.6°)
    captionW: 0.84, captionY: 0.745,    // 「이제 진짜 옹기를 보러 가요!」 안내
  };
  const AGAIN_SCENE = 'stage1-knead';   // 「다시 만들기」
  const HOME_SCENE = 'start';           // 「처음으로」 (시작 화면은 곧 만들 예정 — 지금은 빈 틀)

  const st = { tex: null, t: 0, buttons: [], press: null };

  /** 카드를 기울여 그림자와 함께 새 캔버스에 그린다 (UI 셰이더에는 회전이 없으므로 그림 자체를 돌려 둔다) */
  function tiltCard(card) {
    const a = FIG.tilt, w = card.width, h = card.height, pad = Math.round(w * 0.06);
    const cw = Math.ceil(Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) + pad * 2;
    const chh = Math.ceil(Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) + pad * 2;
    const c = document.createElement('canvas');
    c.width = cw; c.height = chh;
    const g = c.getContext('2d');
    g.translate(cw / 2, chh / 2);
    g.rotate(a);
    g.shadowColor = 'rgba(40, 20, 10, 0.45)'; g.shadowBlur = pad * 0.6; g.shadowOffsetY = pad * 0.25;
    g.drawImage(card, -w / 2, -h / 2);
    return c;
  }

  const frameUnit = (ctx) => Math.min(ctx.W, ctx.H * 9 / 16);

  Scenes.register('ending', {
    enter(ctx, data) {
      // data: 7단계가 넘긴 { ...옹기 데이터, fired, card(2D 캔버스) }
      st.t = 0; st.press = null;
      if (data && data.card) st.tex = ImageTex.fromCanvas(ctx.gl, tiltCard(data.card), st.tex);
      else st.tex = null;                              // 카드 없이 들어오면(촬영 전 등) 카드 자리는 비운다
    },

    update(ctx, dt) {
      st.t += dt;
      st.buttons = Work.buttonRow(ctx, [
        { id: 'again', img: IMG.again, label: '다시 만들기' },
        { id: 'home', img: IMG.home, label: '처음으로' },
      ]);
    },

    drawUI(ctx) {
      const { W, H, ui } = ctx, u = frameUnit(ctx);
      const fade = (t0) => Math.min(1, Math.max(0, (st.t - t0) / 0.35));   // 차례로 나타난다

      const tTitle = ImageTex.get(ctx.gl, IMG.title);
      if (tTitle.ready) {
        const w = u * FIG.titleW, h = w / tTitle.aspect, s = 0.8 + 0.2 * Work.easeBack(fade(0));
        ui.drawImage(tTitle, W / 2 - (w * s) / 2, H * FIG.titleY - (h * s) / 2, w * s, h * s, [1, 1, 1, fade(0)]);
      } else ui.drawText(ui.text('옹기장이가 되었어요!'), W / 2, H * FIG.titleY, u * 0.09, 'center', u * 0.9, [0.32, 0.16, 0.08, 1]);

      if (st.tex) {
        const k = fade(0.2), h = H * FIG.cardH, w = h * st.tex.aspect, drop = (1 - Work.easeBack(k)) * H * 0.05;
        ui.drawImage(st.tex, W / 2 - w / 2, H * FIG.cardY - h / 2 - drop, w, h, [1, 1, 1, k]);
      }

      const tCap = ImageTex.get(ctx.gl, IMG.caption);
      if (tCap.ready) {
        const w = u * FIG.captionW, h = w / tCap.aspect;
        ui.drawImage(tCap, W / 2 - w / 2, H * FIG.captionY - h / 2, w, h, [1, 1, 1, fade(0.45)]);
      }

      for (const b of st.buttons) {
        const pressed = st.press === b.id;
        ui.imageButton(pressed ? { ...b, w: b.w * 0.95, h: b.h * 0.95 } : b);
      }
    },

    down(ctx, x, y) {
      const b = st.buttons.find((bb) => ctx.ui.hit(bb, x, y));
      st.press = b ? b.id : null;
    },
    up(ctx, x, y) {
      const id = st.press;
      st.press = null;
      const b = st.buttons.find((bb) => bb.id === id);
      if (!b || !ctx.ui.hit(b, x, y)) return;
      if (id === 'again') ctx.go(AGAIN_SCENE);
      else if (id === 'home') ctx.go(HOME_SCENE);
    },

    exit(ctx) { return ctx.pot_main.toData(); },
  });
})();
