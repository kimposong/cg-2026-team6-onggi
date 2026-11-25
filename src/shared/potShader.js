// src/shared/potShader.js — 옹기·물레를 그리는 Phong 조명 셰이더 (5주차)
// 4~7단계와 전시실이 모두 쓰므로 한 곳에 둔다. 조명 버그는 여기만 고치면 모든 화면에 반영된다
// 2026-11-16: 새긴 무늬 텍스처(uDecal, 4단계 꾸미기) 추가 — 흰 곳을 홈처럼 어둡게 + 가장자리 음영 (6주차 텍스처)
// 2026-11-20: 유약(잿물, 5단계) 추가 — 높이 uGlazeTop 아래는 유약 색 + 반들반들한 광택(Phong 지수↑), 경계는 흘러내린 듯 물결.
//             홈에는 유약이 고여 더 진하다. 다른 색으로 다시 바르는 동안은 이전 유약(uGlazeUnder)이 아래에 깔린다

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
  uniform vec3 uGlazeColor; // (2026-11-20) 유약 색
  uniform float uGlazeTop;  // 유약이 올라온 높이 (월드 y). 0 이하면 유약 없음
  uniform vec3 uGlazeUnder; // 새 색이 차오르는 동안 그 위쪽에 남아 있는 이전 유약 색
  uniform float uUseUnder;  // 1이면 이전 유약이 옹기 전체에 깔려 있다
  // (2026-11-25) 구운 결과 — 6단계 굽기 셰이더(stage6-gama.js BAKE_FS)와 같은 식. 7단계·마무리 화면이 구운 겉모습을 그대로 보여 준다
  uniform float uBurn;      // 너무 뜨거워 숯처럼 새까맣게 탐 (0~1)
  uniform float uDull;      // 덜 구워져 광택 없이 푸석함 (0~1)
  uniform float uShine;     // 알맞게 구워져 윤기가 더해짐 (0~1)
  out vec4 outColor;

  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;          // 컬링을 끄고 양면을 그린다. 안쪽 면은 법선을 뒤집는다

    vec3 L = normalize(uLightDir);
    vec3 V = normalize(uCamPos - vWorldPos);
    vec3 Hh = normalize(L + V);
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, Hh), 0.0), 24.0) * 0.16; // 젖은 흙의 약한 광택

    // (2026-11-20) 유약: 이 점이 유약 아래인지 (g = 0 흙 ~ 1 유약). 경계 높이를 둘레(u)에 따라 흔들어 흘러내린 느낌을 낸다.
    // 높이는 월드 y 로 본다 — 바깥 벽·안쪽 면·바닥이 같은 기준으로 차오른다 (안쪽 면은 v 가 높이 비율이 아니라서)
    float wob = 0.022 * sin(vUV.x * 6.2831 * 7.0) + 0.012 * sin(vUV.x * 6.2831 * 13.0 + 1.3);
    float g = uGlazeTop > 0.0 ? 1.0 - smoothstep(-0.006, 0.006, vWorldPos.y - (uGlazeTop + wob)) : 0.0;
    float under = uUseUnder > 0.5 ? 1.0 : 0.0;           // 이전 유약이 깔린 곳 (새 유약이 아직 안 올라온 위쪽)
    vec3 glazeCol = mix(uGlazeUnder, uGlazeColor, g);
    float gz = max(g, under);                            // 유약이 있는 정도 (새 것이든 이전 것이든)
    if (uRidge < -0.5) gz = 0.0;                         // 물레에는 바르지 않는다

    // (2026-11-20 사용자 피드백) 새긴 홈(cv)에는 유약 색이 입혀지지 않고, 유약과 상관없이 늘 같은 밝은 흙색(GROOVE)이 드러난다
    // → 어떤 잿물 색을 골라도 4단계에서 그린 그림이 또렷하게 보인다 (유약 위에 손으로 그려 흙빛이 드러나는 옹기 그림과 비슷)
    float cv = (uUseDecal > 0.5 && gl_FrontFacing) ? texture(uDecal, vUV).r : 0.0;
    // (2026-11-20 고증) 옹기는 잿물을 바른 뒤 마르기 전에 손가락으로 그린다("환을 친다") → 그린 자리는 유약이 없어 구운 맨흙이 드러난다
    //   (국가유산청 옹기장 자료). 그래서 홈 색 = 유약과 상관없는 구운 맨흙 색 #B07A50 (붉은 기 도는 황토 갈색), 광택 없음.
    //   이전 값 (0.82, 0.64, 0.46) 은 구운 흙치고 너무 밝은 모래색이라 바꿈
    const vec3 GROOVE = vec3(0.69, 0.48, 0.31);
    // 가장자리: 손가락에 밀린 잿물이 홈 가장자리에 조금 남는다 → 가장자리만 유약 색으로 물든다 (그래서 색마다 미묘하게 달라 보임).
    // 주변 4점(3px 거리)의 최솟값 = 안쪽 정도. 홈 안쪽 깊숙한 곳은 1, 가장자리는 0 에 가깝다
    float cvIn = cv;
    if (cv > 0.0) {
      vec2 du = vec2(3.0 / 1024.0, 0.0), dv = vec2(0.0, 3.0 / 512.0);
      cvIn = min(min(texture(uDecal, vUV + du).r, texture(uDecal, vUV - du).r),
                 min(texture(uDecal, vUV + dv).r, texture(uDecal, vUV - dv).r));
    }
    float edge = cv * (1.0 - cvIn);
    float gzSurf = gz * (1.0 - cv);                      // 홈을 뺀 나머지만 유약 표면

    vec3 base = uBaseColor;
    float ridge = max(uRidge, 0.0) * (1.0 - 0.6 * gzSurf); // (2026-11-20) 유약이 덮으면 물레 자국·얼룩이 옅어진다
    base *= 1.0 - ridge * 0.06 * (0.5 + 0.5 * sin(vUV.y * 180.0));                       // 물레 자국(가로 줄)
    base *= 1.0 - ridge * 0.04 * (0.5 + 0.5 * sin(vUV.x * 6.2831 * 5.0 + vUV.y * 9.0));  // 흙 얼룩
    // 물레(uRidge = -1): 둘레를 12칸으로 나눈 나무판 무늬. 옹기는 둥글어서 돌려도 똑같아 보이므로,
    // 이 무늬가 있어야 좌우로 돌렸다는 것이 눈에 보인다
    if (uRidge < -0.5) base *= 0.82 + 0.18 * step(0.5, fract(vUV.x * 12.0));
    base = mix(base, glazeCol, gzSurf);
    // 유약을 바른 곳의 홈 = 구운 맨흙 색, 가장자리만 유약 색으로 물듦 (안 바른 곳의 홈은 원래대로)
    base = mix(base, mix(GROOVE, glazeCol, 0.55 * edge), cv * gz);
    // 유약 광택: 하이라이트를 좁고 밝게 (Phong 지수 24 → 70) — 흙은 거칠어 넓고 흐리게, 유약은 매끈해 작고 또렷하게 (6주차 재질)
    spec = mix(spec, pow(max(dot(N, Hh), 0.0), 70.0) * 0.55, gzSurf);
    spec *= 1.0 - 0.85 * cv * gz;                        // (2026-11-20) 유약 없는 홈은 무광 — 같은 밝기라도 반들거림 차이로 그림이 구분된다
    spec = spec * (1.0 - uDull) * (1.0 - uBurn) * (1.0 + uShine * 1.6);   // (2026-11-25) 구운 결과: 식으면·타면 광택이 사라지고, 잘 구우면 더 반짝
    // 막 차오르는 경계선은 유약이 두껍게 맺혀 살짝 진하게
    float rim = uGlazeTop > 0.0 ? 1.0 - smoothstep(0.0, 0.03, abs(vWorldPos.y - (uGlazeTop + wob))) : 0.0;
    base *= 1.0 - 0.18 * rim * g;

    vec3 col = base * (0.3 + 0.7 * diff) + vec3(spec);

    // 새긴 무늬: 홈(흰 곳)은 어둡게. 홈의 아래 가장자리는 위에서 오는 빛을 받아 밝고, 위 가장자리는 그늘이 진다 (얕은 홈의 음영을 흉내)
    if (uUseDecal > 0.5 && gl_FrontFacing) {
      // cv 는 위에서 읽었다 (2026-11-20: 유약 계산에도 쓰므로 앞으로 옮김)
      float below = texture(uDecal, vUV - vec2(0.0, 2.0 / 512.0)).r;
      float above = texture(uDecal, vUV + vec2(0.0, 2.0 / 512.0)).r;
      // (2026-11-20) 유약은 홈에 고여 더 진해진다 → 무늬가 도드라짐 (0.45 + 0.2·gz)
      // → (2026-11-20 사용자 피드백) 홈에는 밝은 흙색이 드러나므로, 유약 바른 곳의 홈은 덜 어둡게 해서 밝은 색이 살게 (0.45 → 0.15)
      col *= 1.0 - mix(0.45, 0.15, gz) * cv;
      col += vec3(0.22) * max(cv - below, 0.0) * (0.4 + 0.6 * diff);
      col *= 1.0 - 0.35 * max(cv - above, 0.0);
    }

    if (!gl_FrontFacing) col *= 0.55;     // 안쪽은 어둡게

    // 선택한 구간을 따뜻한 띠로 강조
    if (uActiveV >= 0.0) {
      float d = abs(vUV.y - uActiveV) / uBandHalf;
      col = mix(col, vec3(1.0, 0.78, 0.45), (1.0 - smoothstep(0.7, 1.0, d)) * 0.28);
    }
    // (2026-11-25) 구운 결과 (기본값 0 이면 그대로) — 6단계 BAKE_FS 의 끝부분과 같은 식 (달아오름 uHeat 은 가마 안 연출이라 뺌)
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, mix(col, vec3(lum), 0.5) * vec3(1.15, 1.0, 0.85) + vec3(0.09, 0.075, 0.06), uDull);   // 식은 옹기: 윤기 없이 푸석한 흙빛
    col = mix(col, vec3(0.05, 0.04, 0.04) + vec3(lum) * 0.22, uBurn);                                    // 탄 옹기: 숯처럼 새까맣지만 모양의 음영은 남는다
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
     *   (2026-11-20) glaze: { color:[r,g,b], top: 월드 높이(0 이하 = 없음), under:[r,g,b] 또는 null } — 없으면 유약 없음
     *   (2026-11-25) fired: { burn, dull, shine } (각 0~1) — 구운 결과 겉모습. 없으면 굽기 전
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
      // (2026-11-20) 유약 — uniform 은 다음 draw 까지 남으므로 없을 때도 매번 꺼 준다 (물레 등에 묻지 않게)
      const gz = opt.glaze;
      gl.uniform1f(locs.uGlazeTop, gz ? gz.top : 0);
      gl.uniform3fv(locs.uGlazeColor, gz ? gz.color : color);
      gl.uniform1f(locs.uUseUnder, gz && gz.under ? 1 : 0);
      gl.uniform3fv(locs.uGlazeUnder, gz && gz.under ? gz.under : color);
      // (2026-11-25) 구운 결과 { burn, dull, shine } — 없으면 0 (유약처럼 매번 꺼 준다: 물레에 묻지 않게)
      const fx = opt.fired;
      gl.uniform1f(locs.uBurn, fx ? fx.burn : 0);
      gl.uniform1f(locs.uDull, fx ? fx.dull : 0);
      gl.uniform1f(locs.uShine, fx ? fx.shine : 0);
      gl.bindVertexArray(gpu.vao);
      gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_SHORT, 0);
    }

    return { locs, begin, draw };
  }

  const CLAY = [0.66, 0.45, 0.32];
  const WOOD = [0.36, 0.26, 0.2];

  return { create, CLAY, WOOD };
})();
