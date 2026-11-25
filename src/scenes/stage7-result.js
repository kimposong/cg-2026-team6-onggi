// src/scenes/stage7-result.js — 7단계: 결과물 확인 및 카드 저장 (2026-11-19 stage6-result.js 에서 번호 변경 — 6단계에 가마 굽기가 들어감)
// 빈 틀: Scenes 약속(enter / update / draw / drawUI / down·move·up / exit)만 갖춰 두었다. 필요한 함수만 채우면 된다
// 피그마 플로우: 완성된 옹기를 3D로 돌려 「촬영하기」 → 그 각도로 옹기 카드를 만들어 「이미지 저장」
//
// (2026-11-25 구현, 피그마 최종안 6-0-1 · 사용자 결정 3-1 ~ 3-7)
//   ① 촬영(phase 'shoot'): 구운 옹기가 물레 위에 있다. 4단계처럼 빈 곳 좌우 드래그 = 물레 돌리기, 휠·핀치 = 줌, 세로 드래그 = 상하 이동 (3-7).
//      겉모습은 6단계 구운 결과 그대로 (Pot.fired → PotShader uBurn·uDull·uShine, 3-3). 「촬영하기」를 누르면
//      지금 물레 각도 그대로 **옹기만 투명 배경으로** 프레임버퍼(FBO)에 따로 그려 사진을 얻는다 (3-1 C) — 화면 캡처가 아니다.
//   ② 카드(phase 'card'): 카드 틀 그림 위에 사진 + 이름 + 잿물 색·구운 결과 + 날짜를 2D 캔버스로 합성 → 텍스처로 화면에 보여 준다.
//      이름은 키보드로 입력 (3-2 — 휴대폰 키보드를 띄우려면 HTML <input> 이 꼭 필요해서, 화면에 안 보이는 입력칸 하나를 코드로 만든다.
//      글자는 캔버스 카드 위에 그린다). 날짜·잿물 색·구운 결과는 자동.
//      「이미지 저장」= PC 는 파일 다운로드, 휴대폰은 공유 창(→ 「이미지 저장」으로 갤러리) — 안 되는 기기는 다운로드 (3-4).
//      「다음으로」= 저장하지 않아도 바로 마무리 화면(ending)으로 (3-5).

(() => {
  const { mat4 } = glMatrix;
  const Y_MARGIN = 0.16;                  // 줌 계산용 꼭대기 여유 — 4·5단계와 같게 해서 화면이 이어진다

  const IMG = {
    frame: './assets/stages/stage7/stage7-card-frame.png',
    capture: './assets/ui/buttons/btn-capture.png',
    save: './assets/ui/buttons/btn-save-image.png',
    next: './assets/ui/buttons/btn-next.png',
  };

  // 카드 배치 = 카드 틀 그림(1462×2194) 픽셀 좌표. 그림이 바뀌면 여기만 고친다
  //   photo: 위 칸에서 옹기 사진을 넣을 자리 (오른쪽 아래 「부천시립박물관에서 빚음」 도장 위까지)
  //   name: 아래 칸 이름 줄 (box = 화면에서 눌러 이름을 적는 칸), info: 잿물 색·구운 결과 줄, date: 날짜 줄
  const CARD = {
    w: 1462, h: 2194,
    photo: { x: 120, y: 330, w: 1222, h: 920 },
    name: { x: 731, y: 1725, size: 118, box: { x: 190, y: 1640, w: 1082, h: 170 } },
    info: { y: 1890, size: 60 },
    date: { y: 1980, size: 54 },
  };
  const COL = { name: '#4A2A1A', info: '#6B4632', date: '#8A6A55', placeholder: '#B5A08E', box: '#C9A27E', boxOn: '#E0892F' };
  const DEFAULT_NAME = '나만의 옹기';     // 이름을 안 적고 저장하면 이 이름으로
  const NAME_MAX = 10;                    // 이름 최대 글자 수 (카드 한 줄에 들어가게)
  const DISPLAY_SCALE = 0.5;              // 화면에 보여 줄 카드 해상도 (원본의 50% — 휴대폰 화면에는 충분)
  const SAVE_SCALE = 0.75;                // 저장 이미지 해상도 (1097×1646 — 원본 그대로면 저장이 느리다)
  const PHOTO_SS = 2;                     // 사진을 2배로 그린 뒤 줄인다 (FBO 는 안티에일리어싱이 없어 가장자리가 계단처럼 보이므로)
  const SHOT = { pitch: (12 * Math.PI) / 180, fovy: (30 * Math.PI) / 180, margin: 1.3 };    // 촬영 카메라 (margin 1.12 는 원근 때문에 입구 쪽이 사진 칸 위로 잘려서 1.3): 작업대와 같은 12° 내려다보기, 옹기가 사진 칸을 꽉 채우게
  const FLASH_TIME = 0.45;                // 찰칵! 흰 번쩍임 시간(초)

  const GLAZE_NAMES = { '#AD783E': '황갈색', '#75432D': '밤갈색', '#3E2B23': '흑갈색' };   // 5단계 GLAZES 와 같은 색 코드
  const FIRED_TEXT = { good: '알맞게 잘 구워졌어요', cold: '덜 구워져 푸석해요', burnt: '너무 뜨거워 새까맣게 탔어요' };

  // 카드 틀은 2D 캔버스에 그려야 해서 텍스처(ImageTex)가 아니라 그림 객체로 따로 불러 둔다
  const frameImg = new Image();
  frameImg.onload = () => { st.cardDirty = true; };
  frameImg.src = IMG.frame;

  const st = {
    phase: 'shoot',        // 'shoot' 촬영 / 'card' 카드
    height: 1.3,
    buttons: [], press: null,
    flash: 0,              // 1 → 0 (찰칵 번쩍임)
    cardIn: 1,             // 0 → 1 (카드가 튀어나오는 연출)
    photo: null,           // 찍은 옹기 사진 (2D 캔버스, 투명 배경)
    name: '', editing: false, blink: 0,
    cardDirty: true, cardTex: null, cardCanvas: null, fontReady: false,
    caret: { x: 0, y: 0, h: 0 },   // 이름 끝 커서 위치 (카드 픽셀 좌표)
    date: '',
  };

  const cb = { hitClay: () => false, onDrop: () => false };   // 재료는 쓰지 않는다 (슬롯 바는 접어 둔다)
  const frameUnit = (ctx) => Math.min(ctx.W, ctx.H * 9 / 16);

  /* ---------- ① 촬영: 옹기만 FBO 에 따로 그려 읽어 온다 ---------- */
  let fbo = null;
  const shotCam = Camera.createOrbit();
  function getFbo(gl, w, h) {
    if (fbo && fbo.w === w && fbo.h === h) return fbo;
    if (fbo) { gl.deleteFramebuffer(fbo.fb); gl.deleteTexture(fbo.tex); gl.deleteRenderbuffer(fbo.depth); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fbo = { fb, tex, depth, w, h };
    return fbo;
  }

  /** 지금 물레 각도 그대로 옹기만 그려 사진(2D 캔버스, 투명 배경)을 돌려준다 */
  function takePhoto(ctx) {
    const gl = ctx.gl, pot = ctx.pot_main, sh = pot.shape;
    const maxRb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const ss = Math.min(PHOTO_SS, maxRb / CARD.photo.w);
    const rw = Math.round(CARD.photo.w * ss), rh = Math.round(CARD.photo.h * ss);
    const f = getFbo(gl, rw, rh);

    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    gl.viewport(0, 0, rw, rh);
    gl.clearColor(0, 0, 0, 0);                         // 투명 배경 — 물레·배경 없이 옹기만
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // 카메라: 옹기 가운데를 보고, 기울여 본 옹기(옆면 높이 + 윗면 타원)가 사진 칸에 꽉 차는 거리 (4주차 fitDistance)
    const H = sh.height, R = Math.max(sh.base, ...sh.radii);
    const objH = H * Math.cos(SHOT.pitch) + 2 * R * Math.sin(SHOT.pitch), objW = 2 * R;
    const dist = Camera.fitDistance(rw / rh, SHOT.fovy, objW * SHOT.margin, objH * SHOT.margin);
    shotCam.update(rw / rh, { yaw: 0, pitch: SHOT.pitch, target: [0, H / 2, 0], dist, fovy: SHOT.fovy });
    ctx.potShader.begin(shotCam, [0.3, 0.85, 0.45]);   // 작업대와 같은 빛
    pot.draw(ctx.potShader);                           // 모델 행렬에 물레 각도가 들어 있다 (update) → 고른 각도 그대로
    const px = new Uint8Array(rw * rh * 4);
    gl.readPixels(0, 0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.W, ctx.H);
    gl.clearColor(0.165, 0.13, 0.11, 1);               // main.js 의 바탕색으로 되돌림

    // GL 은 아래 줄부터 읽힌다 → 위아래를 뒤집어 2D 캔버스에 넣고, 사진 칸 크기로 줄인다 (줄이면서 가장자리가 부드러워짐)
    const big = document.createElement('canvas');
    big.width = rw; big.height = rh;
    const img = new ImageData(rw, rh), row = rw * 4;
    for (let y = 0; y < rh; y++) img.data.set(px.subarray((rh - 1 - y) * row, (rh - y) * row), y * row);
    big.getContext('2d').putImageData(img, 0, 0);
    const photo = document.createElement('canvas');
    photo.width = CARD.photo.w; photo.height = CARD.photo.h;
    const p2 = photo.getContext('2d');
    p2.imageSmoothingQuality = 'high';
    p2.drawImage(big, 0, 0, photo.width, photo.height);
    return photo;
  }

  /* ---------- ② 카드 합성 (2D 캔버스) ---------- */
  const fontOf = (px) => `${px}px BMJUA, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;

  /** scale = 원본 대비 해상도, forSave = 저장용(이름 칸 테두리·안내 글자 없이) */
  function renderCard(ctx, scale, forSave, canvas) {
    const c = canvas || document.createElement('canvas');
    c.width = Math.round(CARD.w * scale); c.height = Math.round(CARD.h * scale);
    const g = c.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, CARD.w, CARD.h);
    if (frameImg.complete && frameImg.naturalWidth) g.drawImage(frameImg, 0, 0, CARD.w, CARD.h);
    else { g.fillStyle = '#FDF3DD'; g.fillRect(0, 0, CARD.w, CARD.h); }   // 틀 그림 전에는 크림색 바탕
    if (st.photo) g.drawImage(st.photo, CARD.photo.x, CARD.photo.y);

    g.textAlign = 'center'; g.textBaseline = 'middle';
    const N = CARD.name, name = st.name.trim();
    if (!forSave) {
      // 이름 칸: 점선 상자 (적는 중이면 주황)
      const b = N.box;
      g.setLineDash([18, 12]); g.lineWidth = 5; g.strokeStyle = st.editing ? COL.boxOn : COL.box;
      g.beginPath();
      if (g.roundRect) g.roundRect(b.x, b.y, b.w, b.h, 28); else g.rect(b.x, b.y, b.w, b.h);
      g.stroke(); g.setLineDash([]);
    }
    if (name || forSave) {
      g.fillStyle = COL.name; g.font = fontOf(N.size);
      g.fillText(name || DEFAULT_NAME, N.x, N.y, N.box.w - 40);
      const w = Math.min(g.measureText(name).width, N.box.w - 40);
      st.caret = { x: N.x + w / 2 + 10, y: N.y, h: N.size * 0.9 };
    } else {
      g.fillStyle = COL.placeholder; g.font = fontOf(64);
      g.fillText(st.editing ? '' : '여기를 눌러 이름을 적어요', N.x, N.y);
      st.caret = { x: N.x, y: N.y, h: N.size * 0.9 };
    }
    const pot = ctx.pot_main, hex = pot.glaze.hex;
    const glazeTxt = hex ? `${GLAZE_NAMES[hex] || hex} 잿물` : '잿물 없이';
    const firedTxt = FIRED_TEXT[pot.fired] || '아직 굽지 않았어요';
    g.fillStyle = COL.info; g.font = fontOf(CARD.info.size);
    // g.fillText(`${glazeTxt} · ${firedTxt}`, …) — 주아체에 가운뎃점(·)이 없어 빈칸으로 나와서 쉼표로
    g.fillText(`${glazeTxt}, ${firedTxt}`, CARD.w / 2, CARD.info.y, CARD.w - 260);
    g.fillStyle = COL.date; g.font = fontOf(CARD.date.size);
    g.fillText(st.date, CARD.w / 2, CARD.date.y);
    return c;
  }

  /** 화면에 그릴 카드 자리 (배너 아래 ~ 버튼 위, 카드 비율 유지) */
  function cardRect(ctx) {
    const { W, H } = ctx, u = frameUnit(ctx);
    const top = H * 0.275, bottom = H * 0.865;
    let h = bottom - top, w = (h * CARD.w) / CARD.h;
    if (w > u * 0.86) { w = u * 0.86; h = (w * CARD.h) / CARD.w; }
    return { x: W / 2 - w / 2, y: top, w, h, k: w / CARD.w };
  }
  /** 카드 픽셀 좌표 → 화면 좌표 */
  function toScreen(r, x, y) { return { x: r.x + x * r.k, y: r.y + y * r.k }; }
  function inNameBox(ctx, x, y) {
    const r = cardRect(ctx), b = CARD.name.box, p = toScreen(r, b.x, b.y);
    return x >= p.x && x <= p.x + b.w * r.k && y >= p.y && y <= p.y + b.h * r.k;
  }

  /* ---------- 이름 입력: 화면에 안 보이는 <input> 하나 (휴대폰 키보드를 띄우는 유일한 방법) ---------- */
  let input = null;
  function getInput() {
    if (input) return input;
    input = document.createElement('input');
    input.type = 'text';
    input.maxLength = NAME_MAX;
    input.autocomplete = 'off';
    input.setAttribute('enterkeyhint', 'done');
    // 보이지 않게 (opacity 0). 글자 크기 16px 미만이면 아이폰이 화면을 확대해 버려서 16px
    // Object.assign(input.style, { position: 'fixed', left: '0px', top: '0px', width: '10px', height: '10px',
    //   opacity: '0', fontSize: '16px', border: '0', padding: '0', margin: '0', zIndex: '-1' });
    // (2026-11-25 아이폰 테스트) 코드로 focus() 를 거는 방식은 iOS(아이폰은 크롬도 사파리 엔진)에서 키보드가 뜨지 않았다
    //   — iOS 는 touchend·click 같은 이벤트 안에서만 코드 focus 에 키보드를 띄운다.
    //   → 투명한 입력칸을 **캔버스 위, 카드의 이름 칸 자리에 겹쳐** 두고 사용자가 직접 탭하게 한다 (모든 기기에서 브라우저가 키보드를 띄운다).
    //   자리는 매 프레임 placeInput 이 맞춘다. 글자·커서는 보이지 않게(투명) 하고, 화면에는 캔버스 카드가 그린다
    Object.assign(input.style, { position: 'fixed', left: '0px', top: '0px', width: '10px', height: '10px', display: 'none',
      opacity: '0.01', color: 'transparent', caretColor: 'transparent', background: 'transparent', outline: 'none',
      fontSize: '16px', border: '0', padding: '0', margin: '0', zIndex: '10', touchAction: 'manipulation' });
    input.addEventListener('input', () => { st.name = input.value.slice(0, NAME_MAX); st.cardDirty = true; st.blink = 0; });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();                             // 적는 동안 ESC 가 일시정지로 가지 않게 (main.js 의 window keydown)
      if (e.key === 'Enter' || e.key === 'Escape') input.blur();
    });
    // (2026-11-25) 사용자가 입력칸을 직접 탭해 포커스가 오면 "적는 중"
    input.addEventListener('focus', () => { st.editing = true; st.cardDirty = true; st.blink = 0; });
    input.addEventListener('blur', () => {
      st.editing = false; st.cardDirty = true;
      window.scrollTo(0, 0);                           // (2026-11-25) 아이폰은 키보드가 올라올 때 화면을 밀어 올리고 안 돌려놓을 때가 있다
    });
    document.body.appendChild(input);
    hookDebug(input);                                  // (2026-11-25) ?debug 일 때만
    return input;
  }
  /* (2026-11-25) 진단 모드: 주소 뒤에 ?debug 를 붙이면 이름 입력칸이 받은 이벤트를 화면 위쪽에 보여 준다 (아이폰은 개발자 도구를 보기 어려워서) */
  const DEBUG = /debug/.test(location.search);
  const dbg = [];
  function log(s) { if (!DEBUG) return; dbg.push(`${(performance.now() / 1000).toFixed(2)} ${s}`); if (dbg.length > 9) dbg.shift(); }
  function hookDebug(el) {
    if (!DEBUG) return;
    ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'focus', 'blur'].forEach((ev) => el.addEventListener(ev, () => log(`input ${ev} active=${document.activeElement.tagName}`)));
  }

  /* (2026-11-25) 두 번째 경로: 투명 입력칸이 탭을 못 받고 캔버스가 받은 경우, 캔버스의 touchend 안에서 포커스를 건다
     (iOS 는 touchend·click 안에서 건 focus 에는 키보드를 띄운다). 캔버스에 한 번만 붙인다 */
  let touchHooked = false;
  function hookCanvasTouch(ctx) {
    if (touchHooked) return;
    touchHooked = true;
    const canvas = ctx.gl.canvas;
    canvas.addEventListener('touchend', (e) => {
      if (Scenes.current !== 'stage7-result' || st.phase !== 'card' || Overlay.blocking()) return;
      const t = e.changedTouches[0], r = canvas.getBoundingClientRect(), k = canvas.width / r.width;
      const x = (t.clientX - r.left) * k, y = (t.clientY - r.top) * k;
      log(`canvas touchend name=${inNameBox(ctx, x, y)}`);
      if (!inNameBox(ctx, x, y)) return;
      // (2026-11-25 아이폰: 키보드가 뜨려다 0.1초 만에 사라짐) iOS 는 손을 뗀 뒤 흉내 mousedown·click 을 보내는데,
      // 그 mousedown 이 포커스를 캔버스로 옮겨 입력칸이 바로 blur 됐다. touchend 에서 preventDefault 하면 흉내 마우스 이벤트가 취소된다
      e.preventDefault();
      const el = getInput();
      if (el.style.display === 'none') el.style.display = 'block';
      el.focus();
      log(`focus() → active=${document.activeElement.tagName}`);
    });
    // (2026-11-25) 이름을 적는 중에는 캔버스의 mousedown 기본 동작(포커스 옮기기)을 막는다 — 어떤 경로의 흉내 mousedown 도 입력칸 포커스를 못 빼앗게.
    // 적는 중에 빈 곳을 누르면 우리 코드(up 의 'empty' → stopEdit)가 직접 내린다
    canvas.addEventListener('mousedown', (e) => {
      log(`canvas mousedown editing=${st.editing}`);
      if (Scenes.current === 'stage7-result' && input && document.activeElement === input) e.preventDefault();
    });
  }

  /** (2026-11-25) 투명 입력칸을 카드의 이름 칸 위에 맞춘다 (카드 화면에서 팝업이 없을 때만 보임). 캔버스 픽셀 → CSS 픽셀 */
  function placeInput(ctx, show) {
    const el = getInput();
    if (!show) { if (el.style.display !== 'none') { if (document.activeElement === el) el.blur(); el.style.display = 'none'; } return; }
    const canvas = ctx.gl.canvas, k = canvas.clientWidth / canvas.width, r = cardRect(ctx), b = CARD.name.box, p = toScreen(r, b.x, b.y);
    Object.assign(el.style, { display: 'block', left: `${p.x * k}px`, top: `${p.y * k}px`, width: `${b.w * r.k * k}px`, height: `${b.h * r.k * k}px` });
    if (document.activeElement !== el && el.value !== st.name) el.value = st.name;
  }
  function startEdit(ctx) {
    const el = getInput(), canvas = ctx.gl.canvas;
    // 입력칸을 카드의 이름 칸 자리에 둔다 (키보드가 올라올 때 브라우저가 엉뚱한 곳으로 스크롤하지 않게). 캔버스 픽셀 → CSS 픽셀
    const k = canvas.clientWidth / canvas.width, r = cardRect(ctx), p = toScreen(r, CARD.name.box.x, CARD.name.box.y);
    Object.assign(el.style, { left: `${p.x * k}px`, top: `${p.y * k}px` });
    el.value = st.name;
    el.focus();                                        // 사용자가 누른 순간(pointerup) 안에서 불러야 휴대폰 키보드가 뜬다
    el.setSelectionRange(el.value.length, el.value.length);
    st.editing = true; st.cardDirty = true; st.blink = 0;
  }
  function stopEdit() { if (input && document.activeElement === input) input.blur(); st.editing = false; }

  /* ---------- 이미지 저장 ---------- */
  function fileName() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `onggi-card-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
  }
  /** 저장: 누른 순간 안에서 끝까지 동기로 처리한다 (휴대폰 공유 창은 사용자가 누른 직후에만 열린다 — toBlob 처럼 기다리면 막힘) */
  function saveCard(ctx) {
    const c = renderCard(ctx, SAVE_SCALE, true);
    const bin = atob(c.toDataURL('image/png').split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' }), name = fileName();
    const mobile = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    // 휴대폰: 공유 창 → 「이미지 저장」을 고르면 갤러리(사진 앱)에 들어간다 (웹페이지는 갤러리에 바로 넣을 수 없다)
    if (mobile && navigator.canShare) {
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: '나만의 옹기카드' }).catch(() => {});   // 사용자가 닫아도 오류 아님
        Work.hint(['「이미지 저장」을 고르면', '갤러리에 들어가요']);
        return;
      }
    }
    // PC(또는 공유 창이 안 되는 휴대폰): 파일로 내려받기
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    Work.hint(mobile ? ['다운로드 폴더에 저장했어요'] : ['카드 이미지를 저장했어요']);
  }

  /* ---------- 버튼 ---------- */
  function layoutUI(ctx) {
    st.buttons = st.phase === 'shoot'
      ? Work.buttonRow(ctx, [{ id: 'capture', img: IMG.capture, label: '촬영하기' }])
      : Work.buttonRow(ctx, [{ id: 'save', img: IMG.save, label: '이미지 저장' }, { id: 'next', img: IMG.next, label: '다음으로' }]);
  }
  function onButton(ctx, id) {
    if (id === 'capture') {
      st.photo = takePhoto(ctx);
      st.phase = 'card'; st.flash = 1; st.cardIn = 0; st.cardDirty = true;
    } else if (id === 'save') {
      stopEdit();
      saveCard(ctx);
    } else if (id === 'next') {
      stopEdit();
      ctx.go('ending');                                // exit 가 카드 그림을 넘긴다 (저장은 「이미지 저장」을 눌렀을 때만 — 3-5)
    }
  }

  Scenes.register('stage7-result', {
    enter(ctx, data) {
      // data: 이전 화면이 넘긴 옹기 데이터 { base, radii, heights } (2026-11-25: 6단계가 fired 도 넘긴다)
      const pot = ctx.pot_main;
      if (data) pot.load(data);
      if (data && data.fired) pot.fired = data.fired;  // 6단계가 pot_main.fired 에도 넣지만, 데이터로 와도 받는다
      pot.update();
      st.height = pot.shape.height;
      const d = new Date();
      Object.assign(st, { phase: 'shoot', flash: 0, cardIn: 1, photo: null, name: '', editing: false, cardDirty: true, press: null,
        date: `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일` });
      Work.setInventory(Work.ALL_ITEMS, false);        // 재료를 쓰지 않는다 → 슬롯 바를 접는다 (4단계와 같음)
      Work.setActiveItems([]);
      Work.resetView();
      Work.view.panEnabled = true;                     // 4단계와 같은 조작: 돌리기·줌·상하 이동 (3-7)
      Work.setShift(Work.SHIFT_Y_LOW);                 // 아래가 버튼 한 줄뿐이라 4단계처럼 장면을 내린다
      hookCanvasTouch(ctx);                            // (2026-11-25) 이름 칸 포커스 두 번째 경로 (touchend)
      getInput();
    },

    update(ctx, dt) {
      Work.update(ctx, dt);
      const pot = ctx.pot_main, H = st.height;
      // 카메라: 4·5단계와 같은 규칙 (중심 고정, 기본 높이보다 높으면 줌아웃), 상하 이동 범위도 같음
      const yTop = H + Y_MARGIN, yTopDefault = 1.3 + Y_MARGIN;
      Work.setZoom((yTop - Work.FOCUS_DEFAULT) / (yTopDefault - Work.FOCUS_DEFAULT));
      Work.view.targetMin = 0.05;
      Work.view.targetMax = Math.max(Work.FOCUS_DEFAULT, yTop);
      // 옹기는 물레를 따라 돈다 (4단계와 같은 모델 행렬) — 촬영도 이 행렬로 그린다
      mat4.fromTranslation(pot.model, [0, 0.003, 0]);
      mat4.rotateY(pot.model, pot.model, Work.S.angle);

      st.flash = Math.max(0, st.flash - dt / FLASH_TIME);
      st.cardIn = Math.min(1, st.cardIn + dt * 3);
      st.blink += dt;
      // 주아체를 늦게 받으면 카드 글자를 다시 그린다
      if (ctx.fontSub && ctx.fontSub.ready && !st.fontReady) { st.fontReady = true; st.cardDirty = true; }
      // (2026-11-25) 투명 입력칸: 카드가 다 나온 뒤, 팝업(일시정지)이 없을 때만 이름 칸 위에 둔다
      placeInput(ctx, st.phase === 'card' && st.cardIn >= 1);
      if (st.phase === 'card' && st.cardDirty) {
        st.cardCanvas = renderCard(ctx, DISPLAY_SCALE, false, st.cardCanvas);
        st.cardTex = ImageTex.fromCanvas(ctx.gl, st.cardCanvas, st.cardTex);
        st.cardDirty = false;
      }
      layoutUI(ctx);
    },

    draw(ctx) {
      if (st.phase === 'shoot') Work.drawScene(ctx, () => ctx.pot_main.draw(ctx.potShader));
      // 카드 단계에서는 3D 를 그리지 않는다 (피그마: 배경 위에 카드만)
    },

    drawUI(ctx) {
      const { W, H, ui } = ctx;
      const sub = st.phase === 'shoot' ? '옹기를 돌려 보고 마음에 들 때 찍어 봐'
        : st.editing ? '이름을 다 적었으면 빈 곳을 눌러 줘' : '이름 칸을 눌러 옹기 이름을 적어 봐';
      Work.drawBanner(ctx, 7, sub);

      if (st.phase === 'card' && st.cardTex) {
        const r = cardRect(ctx), e = Work.easeBack(st.cardIn), sc = 0.85 + 0.15 * e;
        const w = r.w * sc, h = r.h * sc;
        ui.drawImage(st.cardTex, W / 2 - w / 2, r.y + r.h / 2 - h / 2, w, h, [1, 1, 1, Math.min(1, st.cardIn * 2)]);
        // 이름 적는 중: 글자 끝에서 깜빡이는 커서 (0.5초 켜짐 / 0.5초 꺼짐 — 느린 깜빡임이라 접근성 기준의 번쩍임과 다르다)
        if (st.editing && st.cardIn >= 1 && st.blink % 1 < 0.5) {
          const p = toScreen(r, st.caret.x, st.caret.y), ch = st.caret.h * r.k;
          ui.rect(p.x, p.y - ch / 2, Math.max(2, r.k * 8), ch, [0.29, 0.16, 0.1, 1]);
        }
      }
      for (const b of st.buttons) {
        const pressed = st.press === b.id;
        ui.imageButton(pressed ? { ...b, w: b.w * 0.95, h: b.h * 0.95 } : b);
      }
      if (st.flash > 0) ui.rect(0, 0, W, H, [1, 1, 1, st.flash * 0.9]);   // 찰칵!
      // (2026-11-25) 진단 모드: 입력칸 위치·상태 + 최근 이벤트
      if (DEBUG) {
        const el = getInput(), u = frameUnit(ctx);
        const lines = [`v39 input ${el.style.display} ${el.style.left},${el.style.top} ${el.style.width}x${el.style.height}`,
          `active=${document.activeElement.tagName} editing=${st.editing}`, ...dbg];
        ui.rect(0, 0, W, u * 0.05 * (lines.length + 0.5), [0, 0, 0, 0.7]);
        lines.forEach((l, i) => ui.drawText(ui.dynText(`dbg${i}`, l, { weight: 400 }), u * 0.02, u * 0.05 * (i + 0.8), u * 0.04, 'left', W * 0.96, [1, 1, 0.6, 1]));
      }
    },

    // 버튼·이름 칸은 손을 뗄 때(up) 실행한다 — 휴대폰은 pointerup 에서만 "사용자가 누름"으로 쳐서 키보드·공유 창이 열린다
    down(ctx, x, y, type) {
      const b = st.buttons.find((bb) => ctx.ui.hit(bb, x, y));
      if (b) { st.press = b.id; return; }
      if (st.phase === 'card') { st.press = inNameBox(ctx, x, y) ? 'name' : 'empty'; log(`canvas down ${st.press}`); return; }
      Work.down(ctx, x, y, type, cb);                 // 촬영: 빈 곳 드래그 = 물레 돌리기 / 상하 이동
    },
    move(ctx, x, y) { if (!st.press) Work.move(ctx, x, y); },
    up(ctx, x, y) {
      const id = st.press;
      st.press = null;
      if (!id) { Work.up(ctx, x, y, cb); return; }
      if (id === 'name') { if (inNameBox(ctx, x, y)) startEdit(ctx); return; }
      if (id === 'empty') { stopEdit(); return; }      // 카드 밖을 누르면 다 적은 것으로
      const b = st.buttons.find((bb) => bb.id === id);
      if (b && ctx.ui.hit(b, x, y)) onButton(ctx, id);
    },
    wheel(ctx, x, y, dy) { if (st.phase === 'shoot') Work.zoomBy(Math.exp(dy * 0.0012)); },
    pinch(ctx, factor) { if (st.phase === 'shoot') Work.zoomBy(1 / factor); },
    cancel(ctx) { Work.cancel(); st.press = null; stopEdit(); placeInput(ctx, false); },   // 일시정지가 열릴 때도 불린다 → 키보드를 내리고 입력칸을 숨긴다 (팝업 위 탭을 가로채지 않게, 풀리면 update 가 다시 둔다)

    exit(ctx) {
      stopEdit();
      placeInput(ctx, false);                          // (2026-11-25) 다른 화면에서는 입력칸을 숨긴다
      Work.setZoom(1);
      Work.resetView();
      Work.setShift(Work.SHIFT_Y);
      mat4.fromTranslation(ctx.pot_main.model, [0, 0.003, 0]);   // 회전은 이 화면 안에서만
      // 마무리 화면에 카드 그림(저장용 해상도)을 넘긴다
      const card = st.photo ? renderCard(ctx, SAVE_SCALE, true) : null;
      return { ...ctx.pot_main.toData(), fired: ctx.pot_main.fired, card };
    },
  });
})();
