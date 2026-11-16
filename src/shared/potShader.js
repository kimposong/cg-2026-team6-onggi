// src/shared/potShader.js — 옹기·물레를 그리는 Phong 조명 셰이더 (5주차)
// 4~7단계와 전시실이 모두 쓰므로 한 곳에 둔다. 조명 버그는 여기만 고치면 모든 화면에 반영된다
// 2026-11-16: 새긴 무늬 텍스처(uDecal, 4단계 꾸미기) 추가 — 흰 곳을 홈처럼 어둡게 + 가장자리 음영 (6주차 텍스처)

const PotShader = (() => {
  const { mat3 } = glMatrix;

  const VS = `#version 300 es
  in vec3 aPos;
  in vec3 aNormal;
  in vec2 aUV;
  uniform mat4 uModel, uView, uProj;
  uniform mat3 uNormalMat;   // 법선 행렬(모델 행렬의 역전치)
  out vec3 vWorldPos;
  out vec3 vNormal;
  out vec2 vUV;
  void main() {
    vec4 w = uModel * vec4(aPos, 1.0);
    vWorldPos = w.xyz;
    vNormal = uNormalMat * aNormal;
    vUV = aUV;
    gl_Position = uProj * uView * w;
  }`;

  const FS = `#version 300 es
  precision highp float;
  in vec3 vWorldPos;
  in vec3 vNormal;
  in vec2 vUV;
  uniform vec3 uLightDir;   // 빛이 오는 방향(정규화)
  uniform vec3 uCamPos;
  uniform vec3 uBaseColor;
  uniform float uRidge;     // 1이면 물레 자국 무늬 (옹기 옆면용), -1이면 물레 나무판 무늬
  uniform float uActiveV;   // 강조할 구간 중심의 높이 비율, 없으면 -1
  uniform float uBandHalf;  // 강조 띠의 절반 두께 (높이 비율)
  uniform sampler2D uDecal; // 새긴 무늬 (u = 둘레, v = 높이 비율). 흰 곳이 홈
  uniform float uUseDecal;  // 1이면 무늬를 입힌다
  out vec4 outColor;

  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;          // 컬링을 끄고 양면을 그린다. 안쪽 면은 법선을 뒤집는다

    vec3 L = normalize(uLightDir);
    vec3 V = normalize(uCamPos - vWorldPos);
    vec3 Hh = normalize(L + V);
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, Hh), 0.0), 24.0) * 0.16; // 젖은 흙의 약한 광택

    vec3 base = uBaseColor;
    float ridge = max(uRidge, 0.0);
    base *= 1.0 - ridge * 0.06 * (0.5 + 0.5 * sin(vUV.y * 180.0));                       // 물레 자국(가로 줄)
    base *= 1.0 - ridge * 0.04 * (0.5 + 0.5 * sin(vUV.x * 6.2831 * 5.0 + vUV.y * 9.0));  // 흙 얼룩
    // 물레(uRidge = -1): 둘레를 12칸으로 나눈 나무판 무늬. 옹기는 둥글어서 돌려도 똑같아 보이므로,
    // 이 무늬가 있어야 좌우로 돌렸다는 것이 눈에 보인다
    if (uRidge < -0.5) base *= 0.82 + 0.18 * step(0.5, fract(vUV.x * 12.0));

    vec3 col = base * (0.3 + 0.7 * diff) + vec3(spec);

    // 새긴 무늬: 홈(흰 곳)은 어둡게. 홈의 아래 가장자리는 위에서 오는 빛을 받아 밝고, 위 가장자리는 그늘이 진다 (얕은 홈의 음영을 흉내)
    if (uUseDecal > 0.5 && gl_FrontFacing) {
      float cv = texture(uDecal, vUV).r;
      float below = texture(uDecal, vUV - vec2(0.0, 2.0 / 512.0)).r;
      float above = texture(uDecal, vUV + vec2(0.0, 2.0 / 512.0)).r;
      col *= 1.0 - 0.45 * cv;
      col += vec3(0.22) * max(cv - below, 0.0) * (0.4 + 0.6 * diff);
      col *= 1.0 - 0.35 * max(cv - above, 0.0);
    }

    if (!gl_FrontFacing) col *= 0.55;     // 안쪽은 어둡게

    // 선택한 구간을 따뜻한 띠로 강조
    if (uActiveV >= 0.0) {
      float d = abs(vUV.y - uActiveV) / uBandHalf;
      col = mix(col, vec3(1.0, 0.78, 0.45), (1.0 - smoothstep(0.7, 1.0, d)) * 0.28);
    }
    outColor = vec4(col, 1.0);
  }`;

  function create(gl) {
    const { prog, locs } = Program.create(gl, VS, FS);
    const normalMat = mat3.create(); // 루프 안에서 새로 만들지 않도록 재사용

    // 무늬 텍스처는 1번 유닛에 둔다 (0번은 UI 글자 텍스처). 무늬가 없을 때 바인딩할 1×1 검정 텍스처도 하나 만들어 둔다
    const blank = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(prog);
    gl.uniform1i(locs.uDecal, 1);

    /** 한 프레임에 한 번: 카메라·조명 설정 */
    function begin(cam, lightDir) {
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE); // 입구 안쪽(뒷면)도 보여야 한다
      gl.useProgram(prog);
      gl.uniformMatrix4fv(locs.uView, false, cam.view);
      gl.uniformMatrix4fv(locs.uProj, false, cam.proj);
      gl.uniform3fv(locs.uLightDir, lightDir);
      gl.uniform3fv(locs.uCamPos, cam.eye);
    }

    /**
     * 메시 하나 그리기
     * @param opt { ridge: 무늬 종류, activeV: 강조 구간 높이 비율(-1 없음), bandHalf: 강조 띠 절반 두께, decal: 새긴 무늬 텍스처(없으면 null) }
     */
    function draw(gpu, model, color, opt = {}) {
      mat3.normalFromMat4(normalMat, model); // 법선에는 모델 행렬 대신 역전치 행렬 (5주차)
      gl.uniformMatrix4fv(locs.uModel, false, model);
      gl.uniformMatrix3fv(locs.uNormalMat, false, normalMat);
      gl.uniform3fv(locs.uBaseColor, color);
      gl.uniform1f(locs.uRidge, opt.ridge || 0);
      gl.uniform1f(locs.uActiveV, opt.activeV === undefined ? -1 : opt.activeV);
      gl.uniform1f(locs.uBandHalf, opt.bandHalf || 0.1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, opt.decal || blank);
      gl.uniform1f(locs.uUseDecal, opt.decal ? 1 : 0);
      gl.bindVertexArray(gpu.vao);
      gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_SHORT, 0);
    }

    return { locs, begin, draw };
  }

  const CLAY = [0.66, 0.45, 0.32];
  const WOOD = [0.36, 0.26, 0.2];

  return { create, CLAY, WOOD };
})();
