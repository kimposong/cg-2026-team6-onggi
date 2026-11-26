// src/core/sound.js — 소리 도구 (2026-11-26): 불러오기 · 한 번 재생 · 반복 재생 · 음소거
// core 규칙대로 "어떻게 소리를 내는지"만 안다. 어떤 소리를 언제 낼지는 각 화면이 정한다 (Sound.play('click') 처럼 이름으로 부른다)
// Web Audio(AudioContext)를 쓴다 — <audio> 태그보다 ① 반복 재생 이음매 틈이 적고 ② 같은 효과음을 겹쳐 낼 수 있고 ③ 지연이 짧다 (리듬 반죽)
// Unity 로 치면 AudioClip(buffers) + AudioSource(play/loop) + AudioMixer 의 마스터 볼륨(master)

const Sound = (() => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ac = Ctx ? new Ctx() : null;            // 소리를 못 쓰는 브라우저면 null → 모든 함수가 조용히 아무것도 안 한다
  const master = ac ? ac.createGain() : null;   // 모든 소리가 지나가는 마스터 볼륨 (음소거 = 여기를 0 으로)
  if (master) master.connect(ac.destination);
  // (2026-11-26) 일시정지 때 꺼지는 반복 소리(불꽃 등)만 모이는 통로 — 배경음(keepOnPause)과 한 번 소리(버튼 클릭)는 여기를 안 지나서 계속 난다
  const loopBus = ac ? ac.createGain() : null;
  if (loopBus) loopBus.connect(master);

  const buffers = {};      // 이름 → 디코딩된 소리 (AudioBuffer)
  let muted = false;

  /* ---------- 자동 재생 제한 풀기 ----------
     브라우저는 사용자가 화면을 한 번 누르기 전에는 소리를 막는다 (AudioContext 가 'suspended' 로 시작).
     첫 터치·클릭·키 입력 때 resume() 을 부르면 그때부터 소리가 난다. 그 전에 시작한 반복 소리(배경음)도 이때 들리기 시작한다.
     아이폰은 touchend 안에서 불러야 풀리는 경우가 있어 둘 다 건다 */
  function unlock() {
    if (ac && ac.state === 'suspended' && !document.hidden) ac.resume().catch(() => {});
  }
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
  // 휴대폰 화면을 끄거나 다른 앱으로 가면 소리를 멈추고, 돌아오면 다시 낸다
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend().catch(() => {});
    else ac.resume().catch(() => {});
  });

  /** 소리 파일 불러오기 — { 이름: 주소 }. 비동기로 받아 두고, 다 받기 전에 play 하면 그 소리만 건너뛴다 */
  function load(list) {
    if (!ac) return;
    Object.entries(list).forEach(([name, url]) => {
      fetch(url)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        // 옛 사파리는 decodeAudioData 가 Promise 를 안 돌려줘서 콜백 방식으로 쓴다
        .then((data) => new Promise((ok, fail) => ac.decodeAudioData(data, ok, fail)))
        .then((buf) => { buffers[name] = buf; })
        .catch(() => console.warn(`[Sound] ${url} 을 불러오지 못했어요 (경로 확인).`));   // 소리가 없어도 체험은 계속된다
    });
  }

  /** 한 번 재생 (효과음). opt = { volume 0~1, rate 재생 속도(1 = 원래 높이) } */
  function play(name, opt = {}) {
    const buf = buffers[name];
    if (!buf || ac.state !== 'running') return;  // 아직 못 받았거나 첫 터치 전이면 건너뛴다 (나중에 몰아서 나지 않게)
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = buf;
    src.playbackRate.value = opt.rate || 1;
    g.gain.value = opt.volume ?? 1;
    src.connect(g);                               // (connect 를 이어 쓰는 a.connect(b).connect(c) 는 옛 사파리에서 안 돼서 나눠 쓴다)
    g.connect(master);
    src.start();
  }

  /** 반복 재생 (배경음·불꽃). 돌려받은 핸들로 볼륨을 바꾸거나 멈춘다.
      파일을 아직 받는 중이면 받는 대로 시작한다 (배경음은 프로그램 시작 때 부르므로)
      opt = { volume, fadeIn, keepOnPause } — keepOnPause: true 면 일시정지 중에도 계속 들린다 (배경음) */
  function loop(name, opt = {}) {
    const h = { src: null, gain: ac ? ac.createGain() : null, stopped: false, wait: 0 };
    if (!ac) return { setVolume() {}, stop() {} };
    const vol = opt.volume ?? 1, fadeIn = opt.fadeIn || 0;
    h.gain.connect(opt.keepOnPause ? master : loopBus);
    const start = () => {
      if (h.stopped) return;
      const buf = buffers[name];
      if (!buf) { h.wait = setTimeout(start, 200); return; }   // 받을 때까지 0.2초마다 다시 본다
      h.src = ac.createBufferSource();
      h.src.buffer = buf;
      h.src.loop = true;                                        // 끝나면 처음으로 — 파일 자체를 이음매 없게 잘라 두었다 (HANDOFF 8-1-2)
      h.src.connect(h.gain);
      if (fadeIn > 0) {
        h.gain.gain.setValueAtTime(0, ac.currentTime);
        h.gain.gain.linearRampToValueAtTime(vol, ac.currentTime + fadeIn);
      } else h.gain.gain.value = vol;
      h.src.start();
    };
    start();
    return {
      /** 볼륨 바꾸기. time = 이 시간(초) 동안 부드럽게 (뚝 바뀌면 딸깍 소리가 난다) */
      setVolume(v, time = 0.1) {
        const p = h.gain.gain, now = ac.currentTime;
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.linearRampToValueAtTime(v, now + time);
      },
      /** 멈추기. fade = 이 시간(초) 동안 줄이다가 멈춘다 */
      stop(fade = 0.1) {
        if (h.stopped) return;
        h.stopped = true;
        clearTimeout(h.wait);
        const now = ac.currentTime, p = h.gain.gain;
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.linearRampToValueAtTime(0, now + fade);
        if (h.src) h.src.stop(now + fade + 0.02);
        setTimeout(() => h.gain.disconnect(), (fade + 0.1) * 1000);
      },
    };
  }

  /** 음소거 켜기·끄기 — 마스터 볼륨을 0.15초 동안 0 으로 (반복 소리도 멈추지 않고 소리만 꺼진다 → 다시 켜면 이어서 들림) */
  function setMuted(m) {
    muted = m;
    if (!ac) return;
    const p = master.gain, now = ac.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(m ? 0 : 1, now + 0.15);
  }

  /** (2026-11-26) 일시정지: 반복 소리(keepOnPause 가 아닌 것)를 0.2초 동안 줄여 멈춘 것처럼 — 풀면 같은 자리에서 다시 들린다.
      배경음과 버튼 클릭은 그대로 (사용자 결정: 일시정지 중에는 배경음만) */
  function setPaused(p) {
    if (!ac) return;
    const g = loopBus.gain, now = ac.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(p ? 0 : 1, now + 0.2);
  }

  return { load, play, loop, setMuted, setPaused, get muted() { return muted; } };
})();
