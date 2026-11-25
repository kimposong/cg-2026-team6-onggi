// src/core/input.js — 터치·마우스 입력을 캔버스 픽셀 좌표로 바꿔 전달
// 2026-11-16: 마우스 휠(wheel)과 두 손가락 벌리기·오므리기(pinch)를 추가 — 줌인·줌아웃용. 무엇을 확대할지는 화면이 정한다

const Input = (() => {

  /**
   * pointer 이벤트는 터치와 마우스를 같은 코드로 받는다 → 개발은 마우스로, 시연은 휴대폰으로
   * handlers: { down(x, y, type), move(x, y, type), up(x, y, type), hover(x, y),
   *             wheel(x, y, deltaY)?      — 마우스 휠. deltaY > 0 이면 아래로 굴림
   *             pinch(factor, cx, cy)?    — 두 손가락 사이 거리가 직전보다 factor 배 (1보다 크면 벌림). cx, cy = 두 손가락 가운데
   *             cancel()?                 — 두 번째 손가락이 닿아 한 손가락 조작(down 중)이 끊겼을 때 }
   */
  function setup(canvas, handlers) {
    // CSS 좌표 → 캔버스 픽셀 좌표. devicePixelRatio 때문에 둘이 다르다
    // 이 변환을 빼먹으면 고해상도 휴대폰에서 버튼이 엉뚱한 곳에서 눌린다 (11주차, 가장 흔한 버그)
    const toPx = (e) => {
      const r = canvas.getBoundingClientRect();
      const dpr = canvas.width / r.width;
      return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
    };

    let activeId = null; // 한 손가락만 받는다 (두 번째 손가락부터는 핀치로만 쓴다)
    const touches = new Map();   // 지금 닿아 있는 손가락들 { id → {x, y} } — 핀치 계산용
    let pinchDist = 0;           // 직전 프레임의 두 손가락 사이 거리 (0 = 핀치 중 아님)

    canvas.addEventListener('pointerdown', (e) => {
      // (2026-11-25 휴대폰 테스트) 터치는 pointerup 뒤에 호환용 mousedown 이 따라오는데, 그 기본 동작이 "탭한 곳(캔버스)으로 포커스 옮기기"라
      // 7단계에서 pointerup 때 잡아 둔 이름 입력칸의 포커스를 빼앗아 휴대폰 키보드가 뜨지 않았다.
      // pointerdown 에서 막으면 호환용 마우스 이벤트가 오지 않는다 (스크롤·확대는 원래 CSS touch-action: none 으로 막혀 있다).
      // 마우스는 막지 않는다 — 막으면 PC 에서 캔버스를 눌러도 창에 포커스가 안 와 ESC 키가 안 먹을 수 있다
      if (e.pointerType !== 'mouse') e.preventDefault();
      const p = toPx(e);
      if (e.pointerType !== 'mouse') touches.set(e.pointerId, p);

      // 두 번째 손가락: 한 손가락 조작을 끊고 핀치를 시작한다
      if (touches.size === 2) {
        if (activeId !== null) { activeId = null; if (handlers.cancel) handlers.cancel(); }
        const [a, b] = [...touches.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (activeId !== null || touches.size > 2) return;
      activeId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      handlers.down(p.x, p.y, e.pointerType);
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = toPx(e);
      if (touches.has(e.pointerId)) touches.set(e.pointerId, p);

      // 핀치 중: 두 손가락 사이 거리의 변화 비율을 넘긴다
      if (pinchDist > 0 && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 1 && handlers.pinch) handlers.pinch(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        if (d > 1) pinchDist = d;
        return;
      }
      if (activeId === null) {
        if (e.pointerType === 'mouse') handlers.hover(p.x, p.y);
      } else if (e.pointerId === activeId) {
        handlers.move(p.x, p.y, e.pointerType);
      }
    });

    const end = (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinchDist = 0;   // 손가락이 하나 남으면 핀치 끝. 남은 손가락은 새로 떼었다 대야 조작이 된다 (튀지 않게)
      if (e.pointerId !== activeId) return;
      activeId = null;
      const p = toPx(e);
      handlers.up(p.x, p.y, e.pointerType);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // 마우스 휠: 페이지 스크롤 대신 화면에 넘긴다 (passive: false 여야 preventDefault 가 먹는다)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!handlers.wheel) return;
      const p = toPx(e);
      handlers.wheel(p.x, p.y, e.deltaY);
    }, { passive: false });

    // 길게 누를 때 뜨는 브라우저 메뉴 막기
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return { setup };
})();
