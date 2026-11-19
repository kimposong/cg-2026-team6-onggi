// src/scenes/stage7-result.js — 7단계: 결과물 확인 및 카드 저장 (2026-11-19 stage6-result.js 에서 번호 변경 — 6단계에 가마 굽기가 들어감)
// 빈 틀: Scenes 약속(enter / update / draw / drawUI / down·move·up / exit)만 갖춰 두었다. 필요한 함수만 채우면 된다
// 피그마 플로우: 완성된 옹기를 3D로 돌려 「촬영하기」 → 그 각도로 옹기 카드를 만들어 「이미지 저장」

(() => {
  Scenes.register('stage7-result', {
    enter(ctx, data) {
      // data: 이전 화면이 넘긴 옹기 데이터 { base, radii, heights, height }
    },
    update(ctx, dt) {},
    draw(ctx) {},
    drawUI(ctx) {
      const { W, H, s, ui } = ctx;
      ui.drawText(ui.text('⑦ 결과 확인'), W / 2, H * 0.45, s * 0.07, 'center', W * 0.9);
      ui.drawText(ui.text('준비 중', { weight: 400 }), W / 2, H * 0.45 + s * 0.08, s * 0.04, 'center', W * 0.9, [1, 1, 1, 0.5]);
    },
    down(ctx, x, y, type) {},
    move(ctx, x, y, type) {},
    up(ctx, x, y, type) {},
    exit(ctx) { return ctx.pot_main.toData(); },
  });
})();
