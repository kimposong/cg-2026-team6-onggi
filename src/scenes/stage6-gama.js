// src/scenes/stage6-gama.js — 6단계: 가마에 굽기
// ① 옹기를 끌어 가마 쪽으로: 가마는 배경 뒤쪽에 있다 → 옹기를 위로 끌수록 뒤로 가듯 원근에 맞게 작아진다
//    옹기의 폭·높이가 가마 입구보다 작아지면 서서히 투명해지며 가마 속으로 들어간다
// ② 불 때기 미니게임: 가마 옆 온도계(4단계)가 몇 초마다 한 단계씩 내려간다. 장작을 넣으면 한 단계 올라간다
//    2~3단계가 알맞은 온도. 1단계로 떨어지면 식어서 광택이 없고, 4단계까지 올라가면 옹기가 새까맣게 탄다
//    알맞은 온도로 끝까지 버티면 윤기 나는 옹기가 나온다 → 다음 단계(결과)로
// 구운 결과는 data.fired = 'good' | 'cold' | 'burnt' 로 다음 화면에 넘긴다
// 가마·불·장작 그림은 팀이 만든 assets 를 쓴다. 난이도·크기·위치는 아래 설정값만 고치면 된다

(() => {
  const { mat4, vec3 } = glMatrix;

  /* ---------- 게임 설정: 난이도 ---------- */
  const DROP_TIME = 3.0;       // 온도가 한 단계 내려가는 데 걸리는 시간(초). 짧을수록 어렵다
  const GOAL_TIME = 14;        // 알맞은 온도로 버텨야 하는 시간(초) = 굽기 진행도가 가득 차는 시간. 짧을수록 쉽다
  const MAX_FAILS = 3;         // 이만큼 실패하면 '다음으로'가 열린다 (그 전에는 다시 굽기만)
  const START_LEVEL = 3;       // 시작 온도 단계 (1 차가움 ~ 4 가득). 2~4 가 알맞은 온도
  const SAFE_MIN = 2, SAFE_MAX = 4;

  /* ---------- 그림 위치·크기: 모두 프레임 폭 u (= min(W, H×9/16), 배경 그림의 가로폭) 또는 화면 높이 H 의 비율 ---------- */
  const KILN_IMG = './assets/stages/stage6/stage6-kiln.png';
  const FIRE_IMG = './assets/stages/stage6/stage6-fire.png';
  const WOOD_IMG = './assets/items/item-firewood.png';
  const KILN = { w: 0.60, baseY: 0.555 };   // 가마 그림 폭 0.60u (투명 여백 포함), 가마 바닥이 닿는 높이 0.555H (배경 벽·바닥 경계 0.535H 바로 앞)
  // 가마 그림(1739×1159) 안의 입구: 가운데 x 785, 너비 694, 위 516, 바닥 955 (픽셀). 그림이 바뀌면 여기만 고친다
  const IMG = { w: 1739, h: 1159, openCx: 785, openW: 694, openTop: 516, openFloor: 955, baseY: 1068 };
  const HORIZON = 0.40;        // 옹기가 멀어질수록 모이는 지평선 높이 (H 비율)
  const START_Y = 0.745;        // 옹기가 처음 놓인 바닥 높이 (H 비율)
  const POT_W0 = 0.40;         // 처음 옹기의 가장 넓은 폭 (u 비율)
  const TILT = (14 * Math.PI) / 180;   // 옹기를 내려다보는 각도 (작업대와 비슷하게)
  const INSIDE_ALPHA = 0.25;   // 가마 속에 들어간 옹기가 어렴풋이 보이는 정도. 0 이면 완전히 사라진다
  const GAUGE = { cx: 0.385, top: 0.265, bottom: 0.525, w: 0.21, tube: 0.034, bulb: 0.07 };   // 온도계 패널: 가운데 x(프레임 가운데에서 u 비율), 위·아래(H), 폭(u) / 유리관 굵기·맨 아래 둥근 부분 지름(u)

  const LEVEL_COL = [[0.45, 0.62, 0.88], [1, 0.7, 0.25], [1, 0.45, 0.18], [0.85, 0.15, 0.12]];   // 1 맨 아래 둥근 부분(파랑) · 2 주황 · 3 진한 주황 · 4 천장(빨강)
  const LEVEL_NAME = ['낮음', '적당', '적당', '뜨거움'];
  const FIRE_SCALE = [0.2, 0.46, 0.78, 1.15];   // 단계별 불길 크기 (입구 너비 비율)
  const HEAT = [0, 0.3, 0.65, 1];               // 단계별 옹기가 달아오른 정도

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const st = {
    phase: 'carry',          // carry 옮기는 중 → fire 불 때기 → ending 결과 연출(가마 속) → out 옹기가 나옴 → done
    baseY: 0, cx: 0,         // 옹기 바닥 가운데의 화면 위치
    drag: false, gx: 0, gy: 0, glide: false, moved: false,
    t: 0, hintT: 0, tempShow: START_LEVEL,
    level: START_LEVEL, hold: DROP_TIME, progress: 0, fireShow: 0.5, lit: 0, flare: 0, warn: 0,
    result: null, endT: 0, outT: 0, wood: null, buttons: [], alpha: 1, fails: 0,
  };
  const cam = { view: mat4.create(), proj: mat4.create(), eye: [0, 0, 0] };
  const tmpM = mat4.create(), eyeV = vec3.create();

  /* ---------- 위치 계산 ---------- */
  const frameU = (ctx) => Math.min(ctx.W, ctx.H * 9 / 16);
  // 가마 입구 (화면 픽셀): 가운데 x, 너비, 높이, 바닥 y
  function kilnGeom(ctx) {
    const u = frameU(ctx), W = ctx.W, H = ctx.H, imgW = KILN.w * u, k = imgW / IMG.w;
    const x0 = W / 2 - imgW / 2, y0 = KILN.baseY * H - IMG.baseY * k;
    return { x0, y0, k, imgW, imgH: IMG.h * k,
      ox: x0 + IMG.openCx * k, ow: IMG.openW * k, oh: (IMG.openFloor - IMG.openTop) * k, floor: y0 + IMG.openFloor * k, top: y0 + IMG.openTop * k };
  }
  const startY = (ctx) => START_Y * ctx.H;
  const enterY = (ctx) => kilnGeom(ctx).floor - 0.02 * ctx.H;     // 이 높이까지 가면 완전히 들어간 것
  const rMax = (ctx) => Math.max(ctx.pot_main.shape.base, ...ctx.pot_main.shape.radii);
  // 바닥 위 높이(원근): 지평선에서 멀수록(위일수록) 작다. 처음 크기 = 1
  const scaleAt = (ctx, y) => clamp((y - HORIZON * ctx.H) / (startY(ctx) - HORIZON * ctx.H), 0.05, 1.2);
  function potPx(ctx, y) {
    const u = frameU(ctx), rm = rMax(ctx), k = ((POT_W0 * u) / (2 * rm)) * scaleAt(ctx, y);
    return { k, w: 2 * rm * k, h: ctx.pot_main.shape.height * k };
  }
  // 옹기가 가마 입구보다 작아졌는지 → 투명해지는 정도 f (0 보임 ~ 1 사라짐). 폭·높이 둘 다 입구보다 작아져야 한다
  function fadeAt(ctx, y) {
    const g = kilnGeom(ctx), p = potPx(ctx, y), fit = Math.min(g.ow / p.w, g.oh / p.h);
    const byFit = smooth(1.0, 1.35, fit);
    const byY = smooth(g.floor + 0.02 * ctx.H, enterY(ctx), y);     // 어떤 모양이어도 끝까지 가면 반드시 들어간다
    return Math.max(byFit, byY);
  }
  // 가마에 가까워지면 입구 가운데로 끌려 들어간다
  function magnetX(ctx, x, y) {
    const g = kilnGeom(ctx);
    return lerp(x, g.ox, smooth(g.floor + 0.12 * ctx.H, g.floor + 0.02 * ctx.H, y));
  }
  function placeAt(ctx, y, x) {
    st.baseY = clamp(y, enterY(ctx), startY(ctx));
    st.cx = magnetX(ctx, x, st.baseY);
  }

  /* ---------- 옹기 그리기 (3D 옹기를 2D 일러스트 위에 놓는다) ---------- */
  // 정사영 카메라: 월드 1 단위 = k 픽셀. 옹기 바닥 가운데가 (cx, baseY). 옹기 모델·유약·무늬 계산은 그대로(월드 단위) 쓴다
  function setCamera(ctx, cx, baseY, k) {
    mat4.ortho(cam.proj, 0, ctx.W, ctx.H, 0, -5000, 5000);
    mat4.fromTranslation(cam.view, [cx, baseY, 0]);
    mat4.rotateX(cam.view, cam.view, -TILT);
    mat4.scale(cam.view, cam.view, [k, -k, k]);                  // 화면은 y 가 아래쪽이라 한 번 뒤집는다
    mat4.invert(tmpM, cam.view);
    vec3.transformMat4(eyeV, [ctx.W / 2, ctx.H / 2, 5000], tmpM);  // 보는 쪽 방향 (월드 좌표)
    cam.eye[0] = eyeV[0]; cam.eye[1] = eyeV[1]; cam.eye[2] = eyeV[2];
  }

  /* ---------- 굽기 전용 옹기 셰이더 ----------
     팀 공용 potShader.js 는 건드리지 않는다. 같은 옹기 셰이더에 투명도·달아오름·타기·식음·윤기(fx)만 더한 복사본을 이 파일 안에서 따로 만들어 쓴다.
     정점 셰이더는 같고, attribute 위치를 공용 셰이더와 똑같이 묶어서(bindAttribLocation) 옹기 메시를 그대로 그릴 수 있다 */
  const BAKE_VS = `#version 300 es
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
  const BAKE_FS = `#version 300 es
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
  uniform float uAlpha;     // (2026-11-22) 굽기 효과 — 투명도 (1 = 불투명)
  uniform float uHeat;      // 가마 불빛에 달아올라 주황빛이 돈다 (0~1)
  uniform float uBurn;      // 너무 뜨거워 숯처럼 새까맣게 탄다 (0~1)
  uniform float uDull;      // 온도가 낮아 식어서 광택이 없고 푸석하다 (0~1)
  uniform float uShine;     // 알맞게 구워져 윤기가 더해진다 (0~1)
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
    spec = spec * (1.0 - uDull) * (1.0 - uBurn) * (1.0 + uShine * 1.6);   // (2026-11-22) 구운 결과: 식으면·타면 광택이 사라지고, 잘 구우면 더 반짝
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
    // (2026-11-22) 굽기 효과: 달아오름 → 식어서 푸석 → 새까맣게 탐 (기본값 0 이면 그대로)
    col = mix(col, col * vec3(1.5, 0.95, 0.6) + vec3(0.12, 0.04, 0.0), uHeat);
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, mix(col, vec3(lum), 0.5) * vec3(1.15, 1.0, 0.85) + vec3(0.09, 0.075, 0.06), uDull);   // 식은 옹기: 윤기 없이 푸석한 흙빛
    col = mix(col, vec3(0.05, 0.04, 0.04) + vec3(lum) * 0.22, uBurn);                                    // 탄 옹기: 숯처럼 새까맣지만 모양의 음영은 남는다
    outColor = vec4(col, uAlpha);
  }`;
  let bake = null;
  function getBake(ctx) {
    if (bake && bake.gl === ctx.gl) return bake;
    const gl = ctx.gl, base = ctx.potShader.locs, { mat3 } = glMatrix;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, BAKE_VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, BAKE_FS));
    for (const n of ['aPos', 'aNormal', 'aUV']) if (base[n] !== undefined) gl.bindAttribLocation(prog, base[n], n);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const L = {};
    for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) { const nm = gl.getActiveUniform(prog, i).name; L[nm] = gl.getUniformLocation(prog, nm); }
    const blank = gl.createTexture(), nm3 = mat3.create();
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(prog); gl.uniform1i(L.uDecal, 1);
    const fx = { alpha: 1, heat: 0, burn: 0, dull: 0, shine: 0 };
    // Pot.draw(셰이더) 가 부르는 begin / draw 를 공용 셰이더와 같은 모양으로 맞춘다
    bake = { gl, fx,
      begin(c, lightDir) {
        gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.useProgram(prog);
        gl.uniformMatrix4fv(L.uView, false, c.view); gl.uniformMatrix4fv(L.uProj, false, c.proj);
        gl.uniform3fv(L.uLightDir, lightDir); gl.uniform3fv(L.uCamPos, c.eye);
      },
      draw(gpu, model, color, opt = {}) {
        mat3.normalFromMat4(nm3, model);
        gl.uniformMatrix4fv(L.uModel, false, model); gl.uniformMatrix3fv(L.uNormalMat, false, nm3);
        gl.uniform3fv(L.uBaseColor, color);
        gl.uniform1f(L.uRidge, opt.ridge || 0);
        gl.uniform1f(L.uActiveV, opt.activeV === undefined ? -1 : opt.activeV);
        gl.uniform1f(L.uBandHalf, opt.bandHalf || 0.1);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, opt.decal || blank);
        gl.uniform1f(L.uUseDecal, opt.decal ? 1 : 0);
        const gz = opt.glaze;
        gl.uniform1f(L.uGlazeTop, gz ? gz.top : 0); gl.uniform3fv(L.uGlazeColor, gz ? gz.color : color);
        gl.uniform1f(L.uUseUnder, gz && gz.under ? 1 : 0); gl.uniform3fv(L.uGlazeUnder, gz && gz.under ? gz.under : color);
        gl.uniform1f(L.uAlpha, fx.alpha); gl.uniform1f(L.uHeat, fx.heat); gl.uniform1f(L.uBurn, fx.burn);
        gl.uniform1f(L.uDull, fx.dull); gl.uniform1f(L.uShine, fx.shine);
        gl.bindVertexArray(gpu.vao); gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_SHORT, 0);
      },
    };
    return bake;
  }

  function drawPot(ctx, cx, baseY, alpha, fxv) {
    if (alpha <= 0.004) return;
    const gl = ctx.gl, ps = getBake(ctx), fx = ps.fx, p = potPx(ctx, baseY);
    Object.assign(fx, fxv);
    // 바닥 그림자
    ctx.ui.begin(ctx.W, ctx.H);
    ctx.ui.rect(cx - p.w * 0.6, baseY - p.w * 0.06, p.w * 1.2, p.w * 0.12, [0, 0, 0, 0.26 * alpha], p.w * 0.06);
    setCamera(ctx, cx, baseY, p.k);
    ps.begin(cam, [0.3, 0.85, 0.45]);
    if (alpha < 0.999) {
      // 투명할 때는 깊이를 먼저 기록해 두고(색은 안 씀), 가장 앞면만 반투명하게 칠한다 — 옹기 안쪽 뒷면이 비쳐 보이지 않게
      gl.depthFunc(gl.LEQUAL);
      gl.colorMask(false, false, false, false); fx.alpha = 1;
      ctx.pot_main.draw(ps);
      gl.colorMask(true, true, true, true);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      fx.alpha = alpha;
      ctx.pot_main.draw(ps);
      gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
    } else { fx.alpha = 1; ctx.pot_main.draw(ps); }
    gl.disable(gl.DEPTH_TEST);
    Object.assign(fx, { alpha: 1, heat: 0, burn: 0, dull: 0, shine: 0 });
  }

  /* ---------- 장면 흐름 ---------- */
  function resetGame() {
    Object.assign(st, { tempShow: START_LEVEL, level: START_LEVEL, hold: DROP_TIME, progress: 0, fireShow: FIRE_SCALE[START_LEVEL - 1], lit: 0, flare: 0, warn: 0, resT: 0, result: null, endT: 0, outT: 0, wood: null });
  }
  function enterKiln(ctx) {            // 옹기가 가마 속으로 완전히 들어갔다 → 불 때기 시작
    st.phase = 'fire'; st.drag = false; st.glide = false; resetGame();
    Work.setInventory(Work.ALL_ITEMS, true);
  }
  function feed(ctx, fromX, fromY) {   // 장작 한 개 넣기
    if (st.phase !== 'fire') return;
    const g = kilnGeom(ctx);
    st.wood = { x: fromX, y: fromY, t: 0 };                      // 장작이 입구로 날아가는 연출 (끝나면 불길이 번쩍)
    st.level += 1; st.hold = DROP_TIME; st.flare = 1;
    if (st.level > SAFE_MAX) finish(ctx, 'burnt');
  }
  function finish(ctx, kind) {
    st.result = kind; st.phase = 'ending'; st.endT = 0; st.wood = st.wood;
    if (kind !== 'good') st.fails += 1;
  }
  function retry(ctx) {                // 다시 굽기: 옹기를 처음 자리에서 가마로 자동으로 들여보낸다
    st.phase = 'carry'; st.glide = true; st.drag = false; st.moved = true; st.result = null;
    placeAt(ctx, startY(ctx), ctx.W / 2);
    resetGame();
  }

  const cb = {
    hitClay: () => false,
    // 슬롯의 장작을 가마(입구와 그 둘레)에 놓으면 한 개 넣는다
    onDrop(id, x, y) {
      if (id !== 'wood') { Work.hint(['여기서는 장작만 쓸 수 있어요']); return false; }
      if (st.phase !== 'fire') { if (st.phase === 'carry') Work.hint(['옹기를 가마에 넣으면', '그때부터 장작을 넣을 수 있어요']); return false; }
      const g = kilnGeom(cb.ctx), pad = cb.ctx.s * 0.08;
      if (x >= g.x0 - pad && x <= g.x0 + g.imgW + pad && y >= g.y0 - pad && y <= g.y0 + g.imgH + pad) { feed(cb.ctx, x, y); return true; }
      Work.hint(['장작은 가마 쪽으로 끌어다 놓아요', '가마 입구에 놓으면 불이 타올라요']);
      return false;
    },
  };

  Scenes.register('stage6-gama', {
    enter(ctx, data) {
      // data: 이전 화면이 넘긴 옹기 데이터 { base, radii, heights, height, glaze } — 무늬(decal)·유약은 pot_main 에 남아 있다
      if (data && data.radii) ctx.pot_main.load(data);
      ctx.pot_main.update();
      Object.assign(st, { phase: 'carry', drag: false, glide: false, moved: false, t: 0, hintT: 0, buttons: [], alpha: 1, fails: 0 });
      resetGame();
      Work.setInventory(Work.ALL_ITEMS, true);         // 이전 단계처럼 흙·물·잿물·장작 4칸을 계속 보여 준다 (장작만 쓸 수 있다)
      placeAt(ctx, startY(ctx), ctx.W / 2);
      cb.ctx = ctx;
    },

    update(ctx, dt) {
      cb.ctx = ctx;
      Work.update(ctx, dt);
      st.t += dt; st.hintT += dt;
      st.flare *= Math.exp(-dt * 5);
      st.resT = st.result ? st.resT + dt : 0;
      if (st.wood) { st.wood.t += dt / 0.35; if (st.wood.t >= 1) st.wood = null; }
      const g = kilnGeom(ctx);

      if (st.phase === 'carry') {
        if (!st.moved) placeAt(ctx, startY(ctx), ctx.W / 2);           // 화면 크기가 바뀌어도 처음 자리를 지킨다
        if (st.glide) placeAt(ctx, st.baseY - ctx.H * 0.3 * dt * (0.5 + 1.0 * (1 - scaleAt(ctx, st.baseY))), lerp(st.cx, g.ox, Math.min(1, dt * 2.5)));   // 입구 가까이에서 놓으면 스스로 걸어 들어간다
        st.alpha = lerp(1, INSIDE_ALPHA, fadeAt(ctx, st.baseY));
        if (st.baseY <= enterY(ctx) + 0.5) enterKiln(ctx);
      } else if (st.phase === 'fire') {
        st.progress = Math.min(1, st.progress + dt / GOAL_TIME);
        st.hold -= dt;
        if (st.hold <= 0) {                                          // 몇 초마다 한 단계씩 식는다
          st.level -= 1; st.hold = DROP_TIME;
          if (st.level < SAFE_MIN) finish(ctx, 'cold');
        }
        st.warn = st.hold < 1.3 && st.level <= SAFE_MIN ? 1 : 0;      // 곧 식는다는 경고
        if (st.progress >= 1 && st.phase === 'fire') finish(ctx, 'good');
        st.alpha = INSIDE_ALPHA;
      } else if (st.phase === 'ending') {
        st.endT += dt; st.alpha = INSIDE_ALPHA;
        if (st.endT >= (st.result === 'good' ? 1.0 : 1.3)) { st.phase = 'out'; st.outT = 0; }
      } else if (st.phase === 'out') {
        st.outT += dt;
        const t = clamp(st.outT / 1.5, 0, 1), e = easeOut(t);
        placeAt(ctx, lerp(enterY(ctx), startY(ctx), e), lerp(g.ox, ctx.W / 2, e));
        st.cx = lerp(g.ox, ctx.W / 2, e);                             // 나오는 길에는 가운데로 자연스럽게
        st.alpha = lerp(INSIDE_ALPHA, 1, smooth(0, 0.4, t));
        if (t >= 1) st.phase = 'done';
      } else if (st.phase === 'done') { st.alpha = 1; }

      // 온도계 수은주: 지금 온도 = (단계 - 1) + 남은 시간 비율 → 한 단계 안에서 서서히 내려가고, 다음 단계 칸으로 이어진다 (0~4, 천장 = 4)
      if (st.phase === 'fire' || st.phase === 'ending') {
        const tt = clamp(st.level - 1 + st.hold / DROP_TIME, 0, 4);
        st.tempShow += (tt - st.tempShow) * Math.min(1, dt * 10);
      }

      // 불길 크기: 단계에 따라 부드럽게 커지고 작아진다
      let target = FIRE_SCALE[clamp(st.level, 1, 4) - 1];
      if (st.phase === 'ending' || st.phase === 'out' || st.phase === 'done') target = st.result === 'cold' ? 0.1 : st.result === 'burnt' ? 1.45 : 0.78;
      if (st.phase === 'carry') target = 0.18;
      st.fireShow += (target - st.fireShow) * Math.min(1, dt * 5);
      // 가마 불빛은 옹기가 가마 속에서 구워지는 동안에만 켜진다 (넣기 전·나온 뒤에는 꺼짐)
      const litT = st.phase === 'fire' ? 1 : 0;
      st.lit += (litT - st.lit) * Math.min(1, dt * (litT ? 4 : 3));
      if (!litT && st.lit < 0.01) st.lit = 0;

      // 버튼
      if (st.phase === 'fire') st.buttons = Work.buttonRow(ctx, [{ id: 'wood', img: './assets/ui/buttons/btn-add-firewood.png', label: '장작 넣기' }]);
      else if (st.phase === 'done') {
        st.buttons = st.result === 'good'
          ? Work.buttonRow(ctx, [{ id: 'next', img: './assets/ui/buttons/btn-next.png', label: '다음으로' }])
          : st.fails >= MAX_FAILS
            ? Work.buttonRow(ctx, [{ id: 'retry', img: './assets/ui/buttons/btn-undo.png', label: '다시 굽기' }, { id: 'next', img: './assets/ui/buttons/btn-next.png', label: '다음으로' }])
            : Work.buttonRow(ctx, [{ id: 'retry', img: './assets/ui/buttons/btn-undo.png', label: '다시 굽기' }]);
      } else if (st.phase === 'carry' && !st.glide && !st.drag) {      // 끌기 말고 버튼으로도 가마에 넣을 수 있다
        const l = Work.bottomLayout(ctx), bw = l.u * 0.5;
        st.buttons = [{ id: 'enter', label: '가마에 넣기', primary: true, x: ctx.W / 2, y: l.yBtn, w: bw, h: bw / 3 * 0.95 }];
      } else st.buttons = [];
      // 인벤토리: 옮기고 굽는 동안은 펼쳐 두고, 결과 글이 나오는 동안만 접는다 (글·버튼 자리)
      Work.setInventory(Work.ALL_ITEMS, st.phase === 'carry' || st.phase === 'fire' || st.phase === 'ending');
    },

    draw(ctx) {
      const { ui, gl } = ctx, g = kilnGeom(ctx);
      ui.begin(ctx.W, ctx.H);
      const kt = ImageTex.get(gl, KILN_IMG);
      if (kt.ready) ui.drawImage(kt, g.x0, g.y0, g.imgW, g.imgH);
      else ui.rect(g.x0 + g.imgW * 0.1, g.y0 + g.imgH * 0.1, g.imgW * 0.8, g.imgH * 0.9, [0.85, 0.55, 0.3, 1], g.imgW * 0.2);   // 그림 전 대체
      // 옹기: 옮기는 동안 / 가마 속 / 나온 뒤 모두 같은 규칙으로 그린다. 구운 결과는 효과 값으로 보여 준다
      let fx = { heat: 0, burn: 0, dull: 0, shine: 0 };
      if (st.phase === 'carry') fx.heat = (1 - smooth(0, 0.5, 1 - fadeAt(ctx, st.baseY))) * 0.6;       // 가마 앞에서는 불빛이 비친다
      else if (st.phase === 'fire') fx.heat = HEAT[clamp(st.level, 1, 4) - 1];
      else {
        const e = st.phase === 'ending' ? smooth(0, 1.2, st.endT) : 1, o = st.phase === 'out' ? clamp(st.outT / 1.5, 0, 1) : st.phase === 'done' ? 1 : 0;
        if (st.result === 'burnt') { fx.burn = e; fx.heat = (1 - o) * 0.9; }
        else if (st.result === 'cold') { fx.dull = e; fx.heat = 0; }
        else { fx.heat = (1 - o) * 0.9 + 0.1 * (1 - o); fx.shine = o * 0.6; }
      }
      fx.heat *= st.lit;                                   // 불빛이 꺼져 있으면 옹기도 달아오르지 않는다
      drawPot(ctx, st.cx, st.baseY, st.alpha, fx);
    },

    drawUI(ctx) {
      const { W, H, s, ui, gl } = ctx, g = kilnGeom(ctx), u = frameU(ctx);
      const lv = clamp(st.level, 1, 4);

      /* --- 가마 입구 불빛: 단계가 높을수록 밝다. 입구 모양(윗부분이 둥근 아치)에 맞춰 칠한다 --- */
      const flick = 0.85 + 0.15 * Math.sin(st.t * 11) * Math.sin(st.t * 7.3);
      let glow = st.phase === 'carry' ? 0.12 : [0.05, 0.3, 0.55, 0.85][lv - 1];
      if (st.result === 'cold' && st.phase !== 'fire') glow = 0.03;
      if (st.result === 'burnt' && st.phase !== 'fire') glow = 1;
      if (st.result === 'good' && st.phase !== 'fire') glow = 0.55;
      glow = (glow + 0.25 * st.flare) * flick * st.lit;
      const col = st.result === 'burnt' && st.phase !== 'fire' ? [1, 0.3, 0.1] : [1, 0.55, 0.15];
      const ax = g.ox - g.ow / 2, ar = g.ow / 2;                   // 아치: 위쪽 반원 + 아래쪽 직사각형
      ui.circle(g.ox, g.floor - g.oh * 0.5, g.ow * (2.3 + 0.3 * glow), [...col, 0.05 * glow]);
      ui.circle(g.ox, g.floor - g.oh * 0.5, g.ow * 1.55, [...col, 0.08 * glow]);
      ui.circle(g.ox, g.top + ar, g.ow * 0.98, [...col, 0.34 * glow]);
      ui.rect(ax + g.ow * 0.01, g.top + ar, g.ow * 0.98, g.floor - (g.top + ar), [...col, 0.34 * glow]);

      /* --- 불길 (아래 가운데에서 단계에 따라 커진다) --- */
      const ft = ImageTex.get(gl, FIRE_IMG);
      if (ft.ready && st.lit > 0.02) {
        const fw = g.ow * st.fireShow * (1 + 0.2 * st.flare) * (1 + 0.04 * Math.sin(st.t * 13)), fh = fw / ft.aspect;
        ui.drawImage(ft, g.ox - fw / 2, g.floor - fh * 0.96, fw, fh, st.result === 'cold' && st.phase !== 'fire' ? [0.6, 0.8, 1, 0.7 * st.lit] : [1, 1, 1, st.lit]);
      }
      // 장작이 입구로 날아가는 연출
      if (st.wood) {
        const wt = ImageTex.get(gl, WOOD_IMG), k = easeOut(st.wood.t), d = u * 0.12 * (1 - 0.5 * k);
        const x = lerp(st.wood.x, g.ox, k), y = lerp(st.wood.y, g.floor - g.oh * 0.2, k) - Math.sin(Math.PI * k) * s * 0.06;
        if (wt.ready) ui.drawImage(wt, x - d / 2, y - d / (2 * wt.aspect), d, d / wt.aspect, [1, 1, 1, 1 - 0.4 * k]);
      }

      /* --- 위쪽 배너 + 안내 한 줄 --- */
      let sub;
      if (st.phase === 'carry') sub = '옹기를 끌거나 버튼으로 가마에 넣어요';
      else if (st.phase === 'fire') sub = `장작으로 온도를 ${SAFE_MIN}~${SAFE_MAX}단계로 지켜요`;
      else if (st.result === 'cold') sub = '온도가 낮아 식어버렸어요';
      else if (st.result === 'burnt') sub = '너무 뜨거워 새까맣게 탔어요';
      else sub = '잘 구워졌어요! 윤기가 반짝반짝';
      Work.drawBanner(ctx, 6, sub);

      /* --- 길 안내 (옹기를 처음 잡기 전): 옹기 → 가마 입구 --- */
      if (st.phase === 'carry' && !st.moved && !st.drag) {
        const sy = startY(ctx), N = 7;
        for (let i = 1; i <= N; i++) {
          const t = i / (N + 1), y = lerp(sy, g.floor, t), sc = scaleAt(ctx, y), pulse = 0.5 + 0.5 * Math.sin(st.hintT * 4 - i * 0.7);
          ui.circle(lerp(W / 2, g.ox, t), y - s * 0.16 * sc, s * (0.012 + 0.02 * sc), [1, 0.92, 0.7, 0.2 + 0.5 * pulse]);
        }
      }

      /* --- 온도계 + 굽기 진행도 (불 때기 중·결과 연출 중) --- */
      if (st.phase !== 'carry') drawGauge(ctx, g);
      if (st.phase === 'fire' || st.phase === 'ending') {
        const bw = u * 0.62, bh = u * 0.035, bx = W / 2 - bw / 2, by = H * 0.735;
        pill(ctx, ui.dynText('gamaPct', `굽는 중 ${Math.round(st.progress * 100)}%`), by - bh * 2.2, u * 0.04, bw);
        ui.rect(bx, by, bw, bh, [0, 0, 0, 0.28], bh / 2);
        if (st.progress > 0) ui.rect(bx, by, Math.max(bh, bw * st.progress), bh, [0.95, 0.7, 0.3, 1], bh / 2);
      }
      if (st.phase === 'fire') {
        const tip = st.level <= SAFE_MIN ? '지금 장작을 넣어요!' : st.level < SAFE_MAX ? '장작을 넣어도 괜찮아요' : '가득 찼어요! 더 넣으면 깨져요';
        if (st.level > SAFE_MIN || Math.sin(st.t * 8) > -0.4) pill(ctx, ui.text(tip), H * 0.665, u * 0.045, u * 0.86);   // 넣을 때가 되면 깜빡인다
      }

      /* --- 결과 글 --- */
      if (st.phase === 'done' || st.phase === 'out') {
        const a = st.phase === 'out' ? smooth(0.6, 1, st.outT / 1.5) : 1;
        const M = {
          good:  ['잘 구워졌어요!', '알맞은 온도에서 구워서 윤기가 반짝여요'],
          cold:  ['식어버렸어요…', '온도가 낮으면 유약이 녹지 않아 광택이 없어요'],
          burnt: ['새까맣게 타버렸어요!', '온도가 너무 높으면 옹기가 숯처럼 타 버려요'],
        }[st.result || 'good'];
        if (a > 0.05) { pill(ctx, ui.text(M[0]), H * 0.828, u * 0.052, u * 0.8); pill(ctx, ui.text(M[1], { weight: 400 }), H * 0.866, u * 0.034, u * 0.84); }
        if (st.result === 'good' && st.phase === 'done') {          // 반짝이
          for (let i = 0; i < 7; i++) {
            const ph = st.t * 2.2 + i * 1.7, tw = Math.max(0, Math.sin(ph)), ang = i * 0.9 + 0.5;
            const p = potPx(ctx, st.baseY), x = st.cx + Math.cos(ang) * p.w * (0.35 + 0.05 * i % 3), y = st.baseY - p.h * (0.15 + 0.1 * i);
            ui.circle(x, y, u * 0.022 * tw, [1, 0.97, 0.8, 0.9 * tw]);
          }
        }
      }

      /* --- 슬롯(장작) + 버튼 --- */
      Work.drawInventory(ctx);
      for (const b of st.buttons) ui.imageButton(b);
    },

    down(ctx, x, y, type) {
      cb.ctx = ctx;
      for (const b of st.buttons) if (ctx.ui.hit(b, x, y)) { onButton(ctx, b.id); return; }
      if (st.phase === 'carry' && !st.glide) {
        const p = potPx(ctx, st.baseY), pad = ctx.s * 0.05, w = Math.max(p.w, frameU(ctx) * 0.16);
        if (Math.abs(x - st.cx) <= w * 0.6 + pad && y >= st.baseY - p.h - pad && y <= st.baseY + pad) {
          st.drag = true; st.moved = true; st.gx = x - st.cx; st.gy = y - st.baseY; return;
        }
      }
      Work.down(ctx, x, y, type, cb);
    },
    move(ctx, x, y) {
      if (st.drag) {
        const u = frameU(ctx), minX = ctx.W / 2 - u / 2, maxX = ctx.W / 2 + u / 2;
        placeAt(ctx, y - st.gy, clamp(x - st.gx, minX, maxX));
        return;
      }
      Work.move(ctx, x, y);
    },
    up(ctx, x, y) {
      if (st.drag) {
        st.drag = false;
        // 입구 크기에 가까워졌다면 손을 놓아도 마저 걸어 들어간다
        if (st.phase === 'carry' && fadeAt(ctx, st.baseY) > 0) st.glide = true;
        return;
      }
      Work.up(ctx, x, y, cb);
    },
    cancel() { st.drag = false; Work.cancel(); },

    exit(ctx) {
      const result = st.result || 'good';
      ctx.pot_main.fired = result;                       // 이후 화면이 읽을 수 있게
      return { ...ctx.pot_main.toData(), fired: result };
    },
  });

  function onButton(ctx, id) {
    if (id === 'enter' && st.phase === 'carry') { st.glide = true; st.moved = true; st.drag = false; }
    else if (id === 'wood' && st.phase === 'fire') { const l = Work.bottomLayout(ctx); feed(ctx, ctx.W / 2, l.yBtn); }
    else if (id === 'retry') retry(ctx);
    else if (id === 'next') ctx.go('stage7-result');      // exit 가 옹기 데이터 + 구운 결과를 넘긴다
  }

  // 밝은 알약 위에 진한 글자 (배경 벽·바닥 위에서도 잘 읽히게 — Work.drawBanner 의 안내 줄과 같은 모양)
  function pill(ctx, tx, y, th, maxW) {
    const { W, ui } = ctx, tw = Math.min(tx.aspect * th, maxW);
    ui.rect(W / 2 - tw / 2 - th * 0.7, y - th * 0.75, tw + th * 1.4, th * 1.5, [1, 0.96, 0.88, 0.9], th * 0.75);
    ui.drawText(tx, W / 2, y, th, 'center', maxW, [0.3, 0.18, 0.1, 1]);
  }

  /* ---------- 온도계 ----------
     맨 아래 둥근 부분 = 1단계, 그 위 유리관이 2 → 3 → 4단계, 관의 천장 = 4단계(과열).
     테두리·칸 색은 가만히 있고, 수은주(지금 온도)가 서서히 내려간다.
     지금 온도보다 아래 색은 그대로, 위의 색은 반투명 → 어느 색까지 내려왔는지 한눈에 보인다 */
  function drawGauge(ctx, g) {
    const { W, H, ui } = ctx, u = frameU(ctx), pw = GAUGE.w * u;
    const rt = st.result ? st.resT : 0, burnt = st.result === 'burnt', cold = st.result === 'cold';
    const hf = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
    const sh = burnt ? Math.sin(rt * 70) * u * 0.01 * Math.max(0, 1 - rt / 0.6) : 0;   // 깨질 때 부르르 떨린다
    const cxp = W / 2 + GAUGE.cx * u + sh;
    const top = GAUGE.top * H, bot = GAUGE.bottom * H, px = cxp - pw / 2;
    ui.rect(px, top, pw, bot - top, [0.16, 0.1, 0.07, 0.72], u * 0.025);
    ui.drawText(ui.text('가마 온도'), cxp, top + u * 0.032, u * 0.034, 'center', pw * 0.9);

    const tw = GAUGE.tube * u, bd = GAUGE.bulb * u, bw = u * 0.007;              // 유리관 굵기 · 둥근 부분 지름 · 테두리 두께
    const tx = px + pw * 0.27, cyb = bot - u * 0.022 - bd / 2;                    // 관 가운데 x · 둥근 부분 가운데 y
    const yTop = top + u * 0.07, yBot = cyb - bd * 0.15;                          // 관의 천장 · 관이 둥근 부분과 만나는 곳
    const yOf = (t) => yBot + (yTop + tw / 2 - yBot) * ((clamp(t, 1, 4) - 1) / 3); // 온도 1~4 → 높이 (4 = 관의 둥근 천장 시작점)
    const T = clamp(st.tempShow, 0, 4), lv = clamp(st.level, 1, 4);
    const broken = burnt && rt > 0.12, ice = cold ? smooth(0, 0.9, rt) : 0;
    const yT = broken ? yOf(3.55) : yTop, tr = broken ? tw * 0.08 : tw / 2;       // 깨지면 위쪽이 사라진다
    const blink = st.warn ? 0.5 + 0.5 * Math.sin(st.t * 18) : 1;

    // 얼어붙으면 얼음 테두리가 번진다
    if (ice > 0) {
      const ic = [0.7, 0.9, 1, 0.85 * ice], eb = bw * 2.6 * ice;
      ui.rect(tx - tw / 2 - bw - eb, yTop - bw - eb, tw + (bw + eb) * 2, yBot - yTop + bd * 0.5 + eb, ic, tw / 2 + bw + eb);
      ui.circle(tx, cyb, bd + (bw + eb) * 2, ic);
    }
    // 테두리(고정): 관 + 둥근 부분
    const dark = [0.2, 0.12, 0.08, 1];
    ui.rect(tx - tw / 2 - bw, yT - bw, tw + bw * 2, yBot - yT + bd * 0.5, dark, tr + bw);
    ui.circle(tx, cyb, bd + bw * 2, dark);
    // 유리 안쪽(비어 있는 부분)
    const glass = [0.93, 0.9, 0.86, 1];
    ui.rect(tx - tw / 2, yT, tw, yBot - yT + bd * 0.5, glass, tr);
    ui.circle(tx, cyb, bd, glass);

    // 칸(2~4단계): 전체를 반투명으로 깔고, 지금 온도 아래쪽만 진하게 — 천장은 둥근 끝
    const capC = yTop + tw / 2;
    for (let i = 2; i <= 4; i++) {
      const c = LEVEL_COL[i - 1], ya = yOf(i - 1), yb = i === 4 ? (broken ? yT : capC) : yOf(i);
      ui.rect(tx - tw / 2, yb, tw, ya - yb, [c[0], c[1], c[2], 0.28]);                       // 지금 온도보다 위: 약간 투명
      if (i === 4 && !broken) ui.circle(tx, capC, tw, [c[0], c[1], c[2], 0.28]);
      if (T > i - 1) {                                                                         // 지금 온도보다 아래: 그대로
        const yt = T >= i ? yb : yOf(T);
        ui.rect(tx - tw / 2, yt, tw, ya - yt, [c[0], c[1], c[2], 1]);
        if (i === 4 && T >= 3.995 && !broken) ui.circle(tx, capC, tw, [c[0], c[1], c[2], 1]);
      }
    }
    // 둥근 부분(1단계): 온도가 1 이상이면 항상 가득 — 식어서 1단계가 되면 관이 비고 이것만 남는다
    ui.circle(tx, cyb, bd, [...LEVEL_COL[0], T >= 0.99 ? 1 : 0.3]);
    // 칸 경계선 + 유리 반사광
    for (let i = 2; i <= 3; i++) ui.rect(tx - tw / 2, yOf(i) - 1, tw, 2, [0.2, 0.12, 0.08, 0.55]);
    for (let i = 2; i <= 4; i++) {                                                              // 촘촘한 눈금 (한 칸을 4등분)
      const ya = yOf(i - 1), yb = i === 4 ? capC : yOf(i);
      for (let k = 1; k <= 3; k++) { const yy = ya + (yb - ya) * k / 4; if (yy > yT + 2) ui.rect(tx - tw / 2, yy - 0.75, tw * 0.38, 1.5, [0.2, 0.12, 0.08, 0.4]); }
    }
    ui.rect(tx - tw * 0.3, Math.max(yTop, yT) + tw * 0.4, tw * 0.14, yBot - Math.max(yTop, yT) - tw * 0.6, [1, 1, 1, 0.3], tw * 0.07);
    ui.circle(tx - bd * 0.2, cyb - bd * 0.18, bd * 0.2, [1, 1, 1, 0.35]);
    // 수은주 윗면: 지금 온도 — 곧 식으면 깜빡인다
    if (T > 1.01 && !broken) ui.rect(tx - tw / 2, yOf(T) - 2, tw, 4, [1, 1, 1, 0.9 * blink]);

    // 깨짐: 들쭉날쭉한 단면 + 유리 조각 + 튀는 붉은 액체
    if (broken) {
      const bt = rt - 0.12;
      for (let k = 0; k < 5; k++) ui.circle(tx - tw * 0.36 + tw * 0.18 * k, yT - (hf(k, 1) - 0.2) * tw * 0.35, tw * (0.2 + 0.12 * hf(k, 2)), dark);
      for (let i = 0; i < 16; i++) {
        const vx = (hf(i, 3) - 0.5) * u * 0.55, vy = -u * (0.18 + 0.4 * hf(i, 4)), life = 1.1 + hf(i, 5) * 0.5;
        if (bt > life) continue;
        const x = tx + vx * bt, y = yT + vy * bt + u * 0.9 * bt * bt, a = 1 - smooth(life * 0.6, life, bt), sz = u * (0.008 + 0.012 * hf(i, 6));
        if (i < 9) ui.rect(x - sz, y - sz * 0.5, sz * 2, sz, [0.95, 0.97, 1, 0.9 * a], sz * 0.2);   // 유리 조각
        else ui.circle(x, y, sz * 1.3, [0.9, 0.12, 0.1, 0.95 * a]);                                  // 붉은 액체
      }
      const dr = smooth(0.2, 1.0, bt);                                                              // 단면에서 흘러내리는 액체
      if (dr > 0) ui.rect(tx - tw * 0.22, yT, tw * 0.44, (yOf(3.2) - yT) * dr, [0.85, 0.12, 0.1, 0.9], tw * 0.2);
    }
    if (burnt && rt < 0.18) ui.rect(px, top, pw, bot - top, [1, 1, 1, 0.8 * (1 - rt / 0.18)], u * 0.025);   // 번쩍
    // 얼음: 관과 둥근 부분이 하얗게 얼고 서리·고드름이 생긴다
    if (ice > 0) {
      ui.rect(tx - tw / 2, yTop, tw, yBot - yTop + bd * 0.5, [0.75, 0.92, 1, 0.55 * ice], tw / 2);
      ui.circle(tx, cyb, bd, [0.75, 0.92, 1, 0.5 * ice]);
      for (let i = 0; i < 9; i++) {
        const x = tx + (hf(i, 7) - 0.5) * tw * 0.8, y = lerp(yTop + tw * 0.5, cyb, hf(i, 8)), r = u * (0.006 + 0.006 * hf(i, 9)) * ice, tws = 0.6 + 0.4 * Math.sin(st.t * 4 + i * 2);
        ui.rect(x - r, y - r * 0.18, r * 2, r * 0.36, [1, 1, 1, 0.9 * tws * ice]);
        ui.rect(x - r * 0.18, y - r, r * 0.36, r * 2, [1, 1, 1, 0.9 * tws * ice]);
      }
      for (let i = 0; i < 6; i++) {                                                                 // 패널 위에 매달린 고드름
        const x = px + pw * (0.1 + 0.16 * i + 0.04 * hf(i, 10)), h = u * (0.03 + 0.045 * hf(i, 11)) * ice;
        ui.rect(x - u * 0.007, top - u * 0.004, u * 0.014, h, [0.85, 0.95, 1, 0.95], u * 0.007);
      }
    }
    // 오른쪽: 단계 이름 + 알맞은 구간(2~3단계) 표시선
    const lx = tx + tw / 2 + bw + u * 0.014, lw = px + pw - lx - u * 0.008;
    const mid = (i) => (i === 1 ? cyb : i === 4 ? (capC + yOf(3)) / 2 : (yOf(i - 1) + yOf(i)) / 2);
    for (let i = 1; i <= 4; i++) {
      const on = i <= lv;
      ui.drawText(ui.text(LEVEL_NAME[i - 1], { weight: 400 }), lx + lw * 0.55, mid(i), u * 0.04, 'center', lw * 0.8, on ? [1, 0.95, 0.85, 1] : [1, 0.95, 0.85, 0.5]);
    }
    ui.rect(lx, capC, u * 0.006, yOf(1) - capC, [0.55, 0.95, 0.5, 0.95], u * 0.003);
  }
})();
