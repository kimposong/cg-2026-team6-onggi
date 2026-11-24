// src/core/text.js — 문자열 하나를 텍스처로 (11주차 강의 코드 기반)

const TextTex = (() => {

  // (2026-11-24) 폰트 문자열 — 텍스처 만들기와 줄바꿈 폭 재기(wrap)가 똑같은 폰트를 쓰도록 한 곳에서 만든다
  function fontOf(opt) {
    // const font = `${opt.weight || 700} ${fontSize}px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    // (2026-11-24) opt.family 를 주면 그 폰트를 맨 앞에 (loadFont 로 불러온 폰트. 없는 글자는 뒤의 기본 폰트로)
    const fam = opt.family ? `"${opt.family}", ` : '';
    return `${opt.weight || 700} ${opt.fontSize || 64}px ${fam}"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  }

  function makeTextTexture(gl, text, opt = {}) {
    const fontSize = opt.fontSize || 64;
    const pad = opt.pad || 16;
    const color = opt.color || '#ffffff';
    const font = fontOf(opt);

    // ① 크기를 재기 위해 임시 2D 컨텍스트를 만든다
    const m = document.createElement('canvas').getContext('2d');
    m.font = font;
    const w = Math.ceil(m.measureText(text).width) + pad * 2;
    const h = Math.ceil(fontSize * 1.25) + pad * 2; // 한글·이모지 위아래가 잘리지 않게 여유

    // ② 실제로 글자를 그린다
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, pad, h / 2);

    // ③ 그 캔버스를 그대로 텍스처로 올린다
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return { tex, w, h, aspect: w / h };
  }

  /**
   * (2026-11-24) 폰트 파일 불러오기 — 브라우저의 FontFace 기능 (HTML·CSS 를 쓰지 않아 "캔버스 하나" 규칙 유지).
   * { family, ready, failed } 를 바로 돌려주고, 다 받으면 ready = true (ImageTex.load 와 같은 방식).
   * 글자는 텍스처로 한 번 만들어 캐시하므로, 화면은 ready 일 때만 family 를 넘겨야 한다 (받기 전에 만든 글자는 기본 폰트로 굳는다).
   * 실패(file:// 로 열기 등)하면 failed = true 로 두고 기본 폰트로 계속 돈다
   */
  function loadFont(family, url) {
    const f = { family, ready: false, failed: false };
    if (typeof FontFace === 'undefined') { f.failed = true; return f; }
    new FontFace(family, `url(${url})`).load()
      .then((face) => { document.fonts.add(face); f.ready = true; })
      .catch((e) => { f.failed = true; console.warn('[폰트] 불러오기 실패:', url, e); });
    return f;
  }

  /**
   * (2026-11-24) 줄바꿈: 한 줄의 텍스처 가로세로비(makeTextTexture 의 w/h 와 같은 계산)가 maxAspect 를 넘지 않도록 띄어쓰기 단위로 나눈다.
   * 화면에서 글자 높이 h 로 그리면 줄 폭 = aspect × h 이므로, "최대 폭 ÷ 글자 높이" 를 maxAspect 로 넘기면 글자 크기를 그대로 둔 채 줄이 나뉜다.
   * 띄어쓰기 없이 한 단어가 너무 길면 그 단어는 한 줄로 둔다 (drawText 의 maxW 가 그 줄만 줄여서 맞춘다)
   */
  const measureCtx = document.createElement('canvas').getContext('2d');
  function wrap(text, maxAspect, opt = {}) {
    const fontSize = opt.fontSize || 64, pad = opt.pad || 16;
    measureCtx.font = fontOf(opt);
    const h = Math.ceil(fontSize * 1.25) + pad * 2;
    const fits = (s) => (Math.ceil(measureCtx.measureText(s).width) + pad * 2) / h <= maxAspect;
    const out = [];
    let cur = '';
    for (const word of text.split(' ')) {
      const cand = cur ? `${cur} ${word}` : word;
      if (!cur || fits(cand)) cur = cand;
      else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
    return out;
  }

  return { makeTextTexture, loadFont, wrap };
})();
