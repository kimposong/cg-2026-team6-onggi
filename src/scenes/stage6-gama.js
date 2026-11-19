// src/scenes/stage6-gama.js — 6단계: 가마에 굽기 (2026-11-19 피그마 플로우로 새로 추가)
// 빈 틀: Scenes 약속(enter / update / draw / drawUI / down·move·up / exit)만 갖춰 두었다. 필요한 함수만 채우면 된다
// 피그마 플로우: 빈 가마 → 슬롯의 장작을 가마로 드래그 → 리듬 게임 시작
//   위쪽 슬라이더에서 장작이 좌우로 움직이다 동그라미에 오면 「장작 넣기」. 총 4번, 하단 굽기 진행도(점 4개)
//   불길이 점점 커지고(불 조절), 옹기가 작아지며 가마로 들어가는 느낌

(() => {
  Scenes.register('stage6-gama', {
    enter(ctx, data) {
      // data: 이전 화면이 넘긴 옹기 데이터 { base, radii, heights, height }
    },
    update(ctx, dt) {},
    draw(ctx) {},
    drawUI(ctx) {
      const { W, H, s, ui } = ctx;
      ui.drawText(ui.text('⑥ 가마에 굽기'), W / 2, H * 0.45, s * 0.07, 'center', W * 0.9);
      ui.drawText(ui.text('준비 중', { weight: 400 }), W / 2, H * 0.45 + s * 0.08, s * 0.04, 'center', W * 0.9, [1, 1, 1, 0.5]);
    },
    down(ctx, x, y, type) {},
    move(ctx, x, y, type) {},
    up(ctx, x, y, type) {},
    exit(ctx) { return ctx.pot_main.toData(); },
  });
})();
