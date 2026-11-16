// src/pot/pot.js — 옹기를 만드는 공통 틀: 형태 상태(바닥 반지름 + 6단 반지름 + 6단 높이), 옆면 곡선 규칙, 메시 갱신
// 관람객의 옹기(pot_main)도, 전시실의 박물관 옹기도 모두 이 틀로 만든다 (Unity의 프리팹 같은 역할)
// 2026-11-16: 단마다 높이를 따로 갖고(heights), 바닥 반지름(base)도 조절할 수 있게 바꿈 (3단계 통합 피드백)

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

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  /**
   * 옹기 옆면 단면: 맨 아래(y=0)는 바닥 반지름(base), 그 위로 각 단의 "중심 높이"에 그 단의 반지름을 조절점으로 두고 부드럽게 잇는다.
   * 맨 위(y=H)는 마지막 단의 반지름을 그대로 쓴다.
   * 단면을 높이 기준으로 균일하게 나누므로 v = 높이 비율이 된다 (구간 강조 표시에 사용).
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

    // 옆면과 바닥 모두 형태에 따라 바뀌므로 동적 메시 (바닥 원판 반지름 = 바닥 반지름 base)
    let wallMesh = Mesh.createRevolution(wallProfile(shape.base, shape.radii, shape.heights, RINGS), SEGMENTS);
    let floorMesh = Mesh.createRevolution(Mesh.diskProfile(shape.base, 0), SEGMENTS);
    const wallGpu = Mesh.uploadMesh(gl, wallMesh, locs, true);
    const floorGpu = Mesh.uploadMesh(gl, floorMesh, locs, true);
    let dirty = false;

    // 물레 윗판과 겹쳐 깜빡이지 않게 살짝 띄운다
    const model = mat4.fromTranslation(mat4.create(), [0, 0.003, 0]);

    return {
      shape,
      model,

      /** i번 단 중심의 높이 (월드 단위) */
      bandY(i) { return sum(shape.heights.slice(0, i)) + shape.heights[i] / 2; },
      /** i번 단 윗면의 높이 (월드 단위) — 0번 단 아랫면은 0 */
      bandTop(i) { return sum(shape.heights.slice(0, i + 1)); },

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
        wallMesh = Mesh.createRevolution(wallProfile(shape.base, shape.radii, shape.heights, RINGS), SEGMENTS, wallMesh);
        floorMesh = Mesh.createRevolution(Mesh.diskProfile(shape.base, 0), SEGMENTS, floorMesh);
        Mesh.updateMesh(gl, wallGpu, wallMesh);
        Mesh.updateMesh(gl, floorGpu, floorMesh);
        dirty = false;
      },

      /**
       * 그리기. opt.activeBand 를 주면 그 구간을 강조한다
       */
      draw(potShader, color = PotShader.CLAY, opt = {}) {
        const band = opt.activeBand;
        const H = shape.height;
        const activeV = band !== undefined && band >= 0 ? this.bandY(band) / H : -1;
        const bandHalf = band !== undefined && band >= 0 ? shape.heights[band] / 2 / H : 0.5 / BANDS;
        potShader.draw(floorGpu, model, color);
        potShader.draw(wallGpu, model, color, { ridge: 1, activeV, bandHalf });
      },

      /** 다음 단계로 넘길 데이터 — 화면 간 약속 형식. height 는 참고용(단 높이의 합) */
      toData() { return { base: shape.base, radii: shape.radii.slice(), heights: shape.heights.slice(), height: shape.height }; },
    };
  }

  return { create, wallProfile, BANDS, R_MIN, R_MAX, H_MIN, H_MAX, LH_MIN, LH_MAX };
})();
