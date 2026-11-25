// src/core/image.js — 그림 파일(png 등) → 텍스처 (6주차 텍스처 로드)
// 어떤 그림을 어디에 그릴지는 쓰는 쪽이 정한다. 여기에는 불러와서 텍스처로 올리는 법만 있다
// 주의: Live Server(http://)로 열어야 한다. file:// 로 열면 브라우저가 그림을 텍스처로 쓰지 못하게 막는다 → failed = true

const ImageTex = (() => {

  /**
   * 그림을 불러와 텍스처로 올린다. 불러오기는 비동기라 빈 객체를 바로 돌려주고, 다 되면 ready = true 가 된다
   * 반환 객체는 TextTex 와 같은 모양 { tex, w, h, aspect } → ui.drawImage 로 그린다
   * maxSize: 긴 변을 이 크기 이하로 줄여서 올린다 (원본이 커도 휴대폰 GPU 메모리·업로드 시간을 아낀다)
   */
  function load(gl, url, maxSize = 2048) {
    const out = { tex: null, w: 1, h: 1, aspect: 1, ready: false, failed: false };
    const img = new Image();
    img.onload = () => {
      try {
        // ① 큰 그림은 2D 캔버스에 줄여 그린다 (작으면 그대로)
        const k = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * k), h = Math.round(img.height * k);
        let src = img;
        if (k < 1) {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const c2 = c.getContext('2d');
          c2.imageSmoothingQuality = 'high';
          c2.drawImage(img, 0, 0, w, h);
          src = c;
        }
        // ② 텍스처로 올린다. UI 셰이더가 글자 텍스처와 같은 규칙(FLIP_Y)으로 읽으므로 똑같이 켠다
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        // 화면에 원본보다 작게 그려질 때 자글거리지 않게 밉맵을 만든다 (WebGL2 는 2의 거듭제곱이 아니어도 된다)
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        Object.assign(out, { tex, w, h, aspect: w / h, ready: true });
      } catch (e) {
        // file:// 로 열었을 때 여기로 온다 (SecurityError). 그림 없이 단색 배경으로 계속 돈다
        out.failed = true;
        console.warn(`[ImageTex] ${url} 을 텍스처로 쓰지 못했어요. Live Server(http://)로 열어 주세요.`, e);
      }
    };
    img.onerror = () => { out.failed = true; console.warn(`[ImageTex] ${url} 을 불러오지 못했어요 (경로 확인).`); };
    img.src = url;
    return out;
  }

  /** (2026-11-20) 같은 경로는 한 번만 불러온다 — 매 프레임 get 해도 된다 (처음 부를 때 불러오기 시작, 다 되면 ready) */
  const cache = new Map();
  function get(gl, url) {
    if (!cache.has(url)) cache.set(url, load(gl, url));
    return cache.get(url);
  }

  /**
   * (2026-11-25) 2D 캔버스 → 텍스처 (코드로 그린 그림: 7단계 옹기 카드 등). load 와 같은 모양 { tex, w, h, aspect, ready } 을 돌려준다
   * out 을 넘기면 그 텍스처를 다시 쓴다 (내용이 바뀔 때마다 새로 만들지 않게)
   */
  function fromCanvas(gl, canvas, out) {
    out = out || { tex: gl.createTexture(), w: 1, h: 1, aspect: 1, ready: false, failed: false };
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);      // UI 셰이더 규칙 (load 와 같음)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    Object.assign(out, { w: canvas.width, h: canvas.height, aspect: canvas.width / canvas.height, ready: true });
    return out;
  }

  return { load, get, fromCanvas };
})();
