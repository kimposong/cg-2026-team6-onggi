// src/pot/pot.js — 옹기를 만드는 공통 틀: 형태 상태(바닥 반지름 + 6단 반지름 + 6단 높이), 옆면 곡선 규칙, 메시 갱신
// 관람객의 옹기(pot_main)도, 전시실의 박물관 옹기도 모두 이 틀로 만든다 (Unity의 프리팹 같은 역할)
// 2026-11-16: 단마다 높이를 따로 갖고(heights), 바닥 반지름(base)도 조절할 수 있게 바꿈 (3단계 통합 피드백)
// 2026-11-16: 벽에 두께를 줌 — 바깥 벽 메시 + 안쪽 면 메시(윗테·안쪽 벽·안바닥), liningProfile (생김새 피드백 "벽이 너무 얇다")
// 2026-11-16: 새긴 무늬 텍스처(decal) — 4단계가 만들고, 바깥 벽을 그릴 때 셰이더에 넘긴다

const Pot = (() => {
  const { mat4 } = glMatrix;

  const BANDS = 6;                     // 높이를 6단(구간)으로
  const R_MIN = 0.2, R_MAX = 0.9;      // 바닥·구간 반지름 범위 (세로 화면에서 잘리지 않게)
  const H_MIN = 0.7, H_MAX = 2.0;      // 전체 높이 범위 (setHeight — 단 높이를 같은 비율로 늘릴 때)
  const LH_MIN = H_MIN / BANDS, LH_MAX = H_MAX / BANDS;   // 한 단 높이 범위 ≈ 0.117 ~ 0.333
  const DEFAULT_BASE = 0.5;            // 바닥판 반지름 (2단계 바닥판과 같은 값)
  const DEFAULT_RADII = [0.5, 0.56, 0.6, 0.6, 0.56, 0.5]; // 위만 뚫린 적당히 둥근 기본형
  const DEFAULT_HEIGHT = 1.3;
  const DEFAULT_HEIGHTS = new Array(BANDS).fill(DEFAULT_HEIGHT / BANDS);   // 단마다 같은 높이에서 시작
  const RINGS = 60;                    // 높이 방향 분할 수
  const SEGMENTS = 64;                 // 둘레 분할 수
  // 벽 두께 (월드 단위). 기본 옹기 높이 1.3 을 실제 장독 약 65cm 로 보면 1 단위 ≈ 50cm → 0.06 ≈ 3cm.
  // 실측 자료는 찾지 못했고(HANDOFF 4장 고증 메모), 큰 장독이 2~3cm 안팎이라는 통념 + 화면에서 두께가 보이도록 정한 값. 바꾸려면 여기만
  const WALL_T = 0.06;
  // 바닥 두께. 3단계 바닥판 덩어리(두께 0.06)보다 두꺼워야 안바닥이 바닥판 위에 드러난다
  const FLOOR_T = 0.08;
  const LINING_SHADE = 0.85;           // 안쪽 면은 빛이 덜 들어오므로 살짝 어둡게

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  /**
   * 옹기 옆면(바깥) 단면: 맨 아래(y=0)는 바닥 반지름(base), 그 위로 각 단의 "중심 높이"에 그 단의 반지름을 조절점으로 두고 부드럽게 잇는다.
   * 맨 위(y=H)는 마지막 단의 반지름을 그대로 쓴다.
   * 단면을 높이 기준으로 균일하게 나누므로 v = 높이 비율이 된다 (구간 강조 표시·새긴 무늬 좌표에 사용).
   * @param base    바닥 반지름
   * @param radii   단별 반지름 (길이 = 단 수. 3단계에서는 올린 단까지만 넘긴다)
   * @param heights 단별 높이 (radii 와 같은 길이)
   */
  function wallProfile(base, radii, heights, rings) {
    const n = radii.length;
    const ys = [0];
    const rs = [base];
    let acc = 0;
    for (let i = 0; i < n; i++) { ys.push(acc + heights[i] / 2); rs.push(radii[i]); acc += heights[i]; }
    const height = acc;
    ys.push(height); rs.push(radii[n - 1]);

    const pts = [];
    for (let i = 0; i < rings; i++) {
      const y = (i / (rings - 1)) * height;
      let k = 0;
      while (k < ys.length - 2 && y > ys[k + 1]) k++;
      const t = (y - ys[k]) / (ys[k + 1] - ys[k]);
      const r = Mesh.catmullRom(rs[Math.max(k - 1, 0)], rs[k], rs[k + 1], rs[Math.min(k + 2, rs.length - 1)], t);
      pts.push({ r: Math.max(r, 0.08), y });
    }
    return pts;
  }

  /** 바깥 단면 outer(아래→위)에서 높이 y 의 반지름 (선형 보간). 4단계 광선 교차에서도 쓴다 */
  function radiusAt(outer, y) {
    if (y <= outer[0].y) return outer[0].r;
    for (let i = 1; i < outer.length; i++) {
      if (y <= outer[i].y) {
        const a = outer[i - 1], b = outer[i], t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
        return a.r + (b.r - a.r) * t;
      }
    }
    return outer[outer.length - 1].r;
  }

  /**
   * 안쪽 면 단면 (벽 두께를 보여 주는 메시): 윗테(바깥 꼭대기 → 안쪽으로 thick) → 안쪽 벽(위→아래, 바깥 단면을 thick 만큼 안으로) → 안바닥(벽 → 중심)
   * 회전체 법선 규칙(접선을 90° 돌림)에 따라 윗테·안바닥은 위를, 안쪽 벽은 옹기 속을 향한다 → 위에서 들여다보면 두께와 안바닥이 보인다.
   * 점 수는 outer.length + 4 로 항상 같다 (bufferSubData 로 갱신하려면 정점 수가 같아야 한다).
   * 바닥 높이(floorY)보다 낮은 바깥 점은 안바닥 가장자리 한 점으로 눌러 둔다 (면적 0 삼각형 → 보이지 않고, 바닥과 겹쳐 깜빡이지도 않는다)
   */
  function liningProfile(outer, thick = WALL_T, floorY = FLOOR_T) {
    const n = outer.length, top = outer[n - 1];
    const inner = (p) => Math.max(0.02, p.r - thick);
    const rFloor = Math.max(0.02, radiusAt(outer, floorY) - thick);     // 안바닥 가장자리 반지름
    const pts = [{ r: top.r, y: top.y }, { r: inner(top), y: top.y }];  // 윗테
    for (let i = n - 1; i >= 0; i--) {
      const p = outer[i];
      if (p.y > floorY) pts.push({ r: inner(p), y: p.y });               // 안쪽 벽
      else pts.push({ r: rFloor, y: floorY });                            // 바닥 아래 점은 모두 같은 자리로
    }
    pts.push({ r: rFloor, y: floorY }, { r: 0, y: floorY });            // 안바닥
    return pts;
  }

  /**
   * @param data  (선택) 이전 단계나 저장된 데이터 { base, radii, heights } — 없으면 기본형.
   *              옛 형식 { height, radii } 도 받는다 (heights 는 균등 분할, base 는 radii[0])
   */
  function create(gl, locs, data) {
    const shape = {
      base: DEFAULT_BASE,
      radii: DEFAULT_RADII.slice(),
      heights: DEFAULT_HEIGHTS.slice(),
      /** 전체 높이 = 단 높이의 합 (읽기 전용 — 바꾸려면 setHeight / setLayerHeight) */
      get height() { return sum(this.heights); },
    };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    function apply(d) {
      shape.radii = d.radii.slice();
      shape.heights = d.heights ? d.heights.slice() : new Array(BANDS).fill((d.height || DEFAULT_HEIGHT) / BANDS);
      shape.base = d.base !== undefined ? d.base : d.radii[0];
    }
    if (data) apply(data);

    // 옆면·안쪽 면·바닥 모두 형태에 따라 바뀌므로 동적 메시 (바닥 원판 반지름 = 바닥 반지름 base)
    let outer = wallProfile(shape.base, shape.radii, shape.heights, RINGS);
    let wallMesh = Mesh.createRevolution(outer, SEGMENTS);
    let liningMesh = Mesh.createRevolution(liningProfile(outer), SEGMENTS);
    let floorMesh = Mesh.createRevolution(Mesh.diskProfile(shape.base, 0), SEGMENTS);
    const wallGpu = Mesh.uploadMesh(gl, wallMesh, locs, true);
    const liningGpu = Mesh.uploadMesh(gl, liningMesh, locs, true);
    const floorGpu = Mesh.uploadMesh(gl, floorMesh, locs, true);
    let dirty = false;
    const liningCol = [0, 0, 0];         // 안쪽 면 색 (매 프레임 새 배열을 만들지 않도록 재사용)

    // 물레 윗판과 겹쳐 깜빡이지 않게 살짝 띄운다. 화면이 회전을 더하고 싶으면 이 행렬을 직접 고친다 (4단계: 물레 각도)
    const model = mat4.fromTranslation(mat4.create(), [0, 0.003, 0]);

    return {
      shape,
      model,
      decal: null,          // 새긴 무늬 텍스처 (WebGLTexture). 4단계가 만들어 넣고, 이후 단계·전시실이 그대로 쓴다

      /** i번 단 중심의 높이 (월드 단위) */
      bandY(i) { return sum(shape.heights.slice(0, i)) + shape.heights[i] / 2; },
      /** i번 단 윗면의 높이 (월드 단위) — 0번 단 아랫면은 0 */
      bandTop(i) { return sum(shape.heights.slice(0, i + 1)); },
      /** 지금 형태의 바깥 단면 (광선 교차 등에 쓴다 — 새 배열을 만들므로 매 프레임 부르지 않는다) */
      outerProfile() { return wallProfile(shape.base, shape.radii, shape.heights, RINGS); },

      setRadius(i, r) {
        const next = clamp(r, R_MIN, R_MAX);
        if (next !== shape.radii[i]) { shape.radii[i] = next; dirty = true; }
      },

      /** 바닥 반지름 (3단계 바닥 단계에서 조절) */
      setBase(r) {
        const next = clamp(r, R_MIN, R_MAX);
        if (next !== shape.base) { shape.base = next; dirty = true; }
      },

      /** i번 단의 높이 (3단계에서 단마다 세로 축으로 조절) */
      setLayerHeight(i, h) {
        const next = clamp(h, LH_MIN, LH_MAX);
        if (next !== shape.heights[i]) { shape.heights[i] = next; dirty = true; }
      },

      /** 전체 높이를 바꾼다 — 모든 단을 같은 비율로 늘리거나 줄인다 (이전 4단계 높이 축과 호환) */
      setHeight(h) {
        const next = clamp(h, H_MIN, H_MAX);
        const now = shape.height;
        if (next !== now) { shape.heights = shape.heights.map((v) => (v * next) / now); dirty = true; }
      },

      reset() {
        shape.base = DEFAULT_BASE;
        shape.radii = DEFAULT_RADII.slice();
        shape.heights = DEFAULT_HEIGHTS.slice();
        dirty = true;
      },

      /** 다른 데이터로 형태를 통째로 바꾼다 (단계 이동, 저장 불러오기) */
      load(d) {
        apply(d);
        dirty = true;
      },

      /** 변경이 있을 때만 메시를 다시 계산한다 (같은 배열을 재사용) */
      update() {
        if (!dirty) return;
        outer = wallProfile(shape.base, shape.radii, shape.heights, RINGS);
        wallMesh = Mesh.createRevolution(outer, SEGMENTS, wallMesh);
        liningMesh = Mesh.createRevolution(liningProfile(outer), SEGMENTS, liningMesh);
        floorMesh = Mesh.createRevolution(Mesh.diskProfile(shape.base, 0), SEGMENTS, floorMesh);
        Mesh.updateMesh(gl, wallGpu, wallMesh);
        Mesh.updateMesh(gl, liningGpu, liningMesh);
        Mesh.updateMesh(gl, floorGpu, floorMesh);
        dirty = false;
      },

      /**
       * 그리기: 바닥 + 바깥 벽(물레 자국 무늬, 선택 구간 강조, 새긴 무늬) + 안쪽 면(윗테·안쪽 벽·안바닥, 살짝 어둡게). opt.activeBand 를 주면 그 구간을 강조한다
       */
      draw(potShader, color = PotShader.CLAY, opt = {}) {
        const band = opt.activeBand;
        const H = shape.height;
        const activeV = band !== undefined && band >= 0 ? this.bandY(band) / H : -1;
        const bandHalf = band !== undefined && band >= 0 ? shape.heights[band] / 2 / H : 0.5 / BANDS;
        for (let i = 0; i < 3; i++) liningCol[i] = color[i] * LINING_SHADE;
        potShader.draw(floorGpu, model, color);
        potShader.draw(wallGpu, model, color, { ridge: 1, activeV, bandHalf, decal: this.decal });
        potShader.draw(liningGpu, model, liningCol, { ridge: 1 });
      },

      /** 다음 단계로 넘길 데이터 — 화면 간 약속 형식. height 는 참고용(단 높이의 합) */
      toData() { return { base: shape.base, radii: shape.radii.slice(), heights: shape.heights.slice(), height: shape.height }; },
    };
  }

  return { create, wallProfile, liningProfile, radiusAt, BANDS, R_MIN, R_MAX, H_MIN, H_MAX, LH_MIN, LH_MAX, WALL_T, FLOOR_T, LINING_SHADE };
})();
