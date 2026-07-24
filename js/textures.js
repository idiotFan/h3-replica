// ================= 程序化纹理（Canvas 生成） =================
import * as THREE from 'three';

// 地面细节噪点纹理（乘在顶点色上，消除纯色塑料感）
export function makeDetailTexture(repeat = 48) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1100; i++) {
    const g = 228 + Math.floor(Math.random() * 27);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}

// 水面波纹纹理（可滚动）
export function makeWaterTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2e6f9e';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(200,230,255,0.28)';
  ctx.lineWidth = 2;
  for (let row = 0; row < 8; row++) {
    ctx.beginPath();
    const y0 = row * 32 + 10;
    for (let x = 0; x <= 256; x += 8) {
      const y = y0 + Math.sin((x + row * 40) * 0.06) * 5;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  return tex;
}

// 渐变天空穹顶材质（地图/战场共用）
export function makeSkyMaterial(top = 0x4a8fd8, horizon = 0x9fc8e8) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(top) },
      horizonColor: { value: new THREE.Color(horizon) },
    },
    vertexShader: `varying vec3 vPos;
      void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; varying vec3 vPos;
      void main(){
        float h = clamp(normalize(vPos).y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, 0.55)), 1.0);
      }`,
  });
}

// 发光球精灵（太阳/光点/尘土）
export function makeGlowSprite(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,200,80,0)', size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false,
  }));
}

// 月亮精灵
export function makeMoonSprite() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  grad.addColorStop(0, 'rgba(230,236,255,0.9)');
  grad.addColorStop(0.45, 'rgba(200,214,255,0.35)');
  grad.addColorStop(1, 'rgba(200,214,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  // 月盘
  ctx.fillStyle = '#e8ecfa';
  ctx.beginPath(); ctx.arc(64, 64, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c8cfe4';
  ctx.beginPath(); ctx.arc(58, 60, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(70, 70, 3.5, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false,
  }));
}

// 云朵精灵（柔和团块）
export function makeCloudSprite() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const ctx = cv.getContext('2d');
  const blobs = [[40, 40, 22], [64, 34, 26], [90, 42, 20], [58, 44, 24], [78, 44, 18]];
  for (const [x, y, r] of blobs) {
    const grad = ctx.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 0.9, depthWrite: false, fog: false,
  }));
  return sp;
}
