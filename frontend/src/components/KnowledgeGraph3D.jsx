import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Minimal, punchy node definitions (2-3 words, zero clutter)
const CUSTOMER_STEPS = [
  { step: '01', title: 'Unexplained Fee', tag: 'Trigger', pos: [0, -3.2, 0], color: '#c2410c' },
  { step: '02', title: 'Trust Erosion', tag: 'Friction', pos: [16, -3.8, 1.2], color: '#ea580c' },
  { step: '03', title: 'Support Delay', tag: 'Escalation', pos: [32, -4.4, 0.5], color: '#b45309' },
  { step: '04', title: 'Capital Lost', tag: 'Churn', pos: [48, -5.0, -1], color: '#991b1b' },
];

const BANK_STEPS = [
  { step: '01', title: 'Silent Outflow', tag: 'Blindspot', pos: [0, 3.2, 0], color: '#15803d' },
  { step: '02', title: 'Delayed Alert', tag: 'Gap', pos: [16, 3.8, -1.2], color: '#166534' },
  { step: '03', title: 'SLA Breach', tag: 'Compliance', pos: [32, 4.4, -0.5], color: '#047857' },
  { step: '04', title: 'Deposit Flight', tag: 'Attrition', pos: [48, 5.0, 1], color: '#991b1b' },
];

// Ultra-minimal, crisp billboard badge generator (Sleek pill, zero fluff)
function createMinimalSprite(item, isBank = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 130;
  const ctx = canvas.getContext('2d');

  const accent = item.color;

  // Glass pill background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(8, 8, 384, 114, 57);
  ctx.fill();
  ctx.stroke();

  // Accent Step dot
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(42, 65, 14, 0, Math.PI * 2);
  ctx.fill();

  // Step Number inside dot
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.step, 42, 65);

  // Main Title
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(item.title, 72, 54);

  // Subtitle / Tag
  ctx.fillStyle = accent;
  ctx.font = '600 15px monospace';
  ctx.fillText(item.tag.toUpperCase(), 72, 84);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });

  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(6.4, 2.1, 1);
  return sprite;
}

export default function KnowledgeGraph3D({ scrollProgress = 0 }) {
  const containerRef = useRef(null);
  const solutionOverlayRef = useRef(null);
  const progressRef = useRef(scrollProgress);
  const currentProgressRef = useRef(scrollProgress);

  useEffect(() => {
    progressRef.current = scrollProgress;
  }, [scrollProgress]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    scene.fog = new THREE.FogExp2(0xffffff, 0.014);

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 1000);
    camera.position.set(-6, 0, 18);

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 3. Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 15);
    scene.add(dirLight);

    // 4. Subtle Clean Floor Grid
    const grid = new THREE.GridHelper(180, 45, 0xe4e4e7, 0xf4f4f5);
    grid.position.y = -12;
    scene.add(grid);

    // 5. Sleek Geometric Chain Links
    const linkGeo = new THREE.TorusGeometry(1.3, 0.3, 12, 28);

    const customerMeshes = [];
    const bankMeshes = [];

    // Customer Chain
    CUSTOMER_STEPS.forEach((item, index) => {
      const group = new THREE.Group();
      group.position.set(...item.pos);

      const mat = new THREE.MeshLambertMaterial({ color: item.color });
      const link = new THREE.Mesh(linkGeo, mat);
      link.rotation.x = index % 2 === 0 ? Math.PI / 2 : 0;
      link.rotation.y = index % 2 === 1 ? Math.PI / 4 : 0;
      group.add(link);

      const sprite = createMinimalSprite(item, false);
      sprite.position.set(item.pos[0], item.pos[1] - 3.2, item.pos[2]);
      scene.add(sprite);

      scene.add(group);
      customerMeshes.push({ group, link });
    });

    // Bank Chain
    BANK_STEPS.forEach((item, index) => {
      const group = new THREE.Group();
      group.position.set(...item.pos);

      const mat = new THREE.MeshLambertMaterial({ color: item.color });
      const link = new THREE.Mesh(linkGeo, mat);
      link.rotation.x = index % 2 === 0 ? Math.PI / 2 : 0;
      link.rotation.y = index % 2 === 1 ? Math.PI / 4 : 0;
      group.add(link);

      const sprite = createMinimalSprite(item, true);
      sprite.position.set(item.pos[0], item.pos[1] + 3.2, item.pos[2]);
      scene.add(sprite);

      scene.add(group);
      bankMeshes.push({ group, link });
    });

    // 6. Minimal Glowing Conduits
    const cableGroup = new THREE.Group();
    const breakableCables = [];

    // Customer Line
    for (let i = 0; i < CUSTOMER_STEPS.length - 1; i++) {
      const p1 = new THREE.Vector3(...CUSTOMER_STEPS[i].pos);
      const p2 = new THREE.Vector3(...CUSTOMER_STEPS[i + 1].pos);
      const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
      mid.y -= 0.6;

      const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xc2410c, transparent: true, opacity: 0.65 });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.12, 6, false), mat);
      cableGroup.add(tube);

      if (i === 1) breakableCables.push({ tube, mat });
    }

    // Bank Line
    for (let i = 0; i < BANK_STEPS.length - 1; i++) {
      const p1 = new THREE.Vector3(...BANK_STEPS[i].pos);
      const p2 = new THREE.Vector3(...BANK_STEPS[i + 1].pos);
      const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
      mid.y += 0.6;

      const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      const mat = new THREE.MeshBasicMaterial({ color: 0x15803d, transparent: true, opacity: 0.65 });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.12, 6, false), mat);
      cableGroup.add(tube);

      if (i === 1) breakableCables.push({ tube, mat });
    }
    scene.add(cableGroup);

    // 7. Sleek Interceptor Ring at X = 24
    const interceptorGroup = new THREE.Group();
    interceptorGroup.position.set(24, 0, 0);

    const breakerRing = new THREE.Mesh(
      new THREE.TorusGeometry(6.2, 0.16, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0xd97706, transparent: true, opacity: 0.85 })
    );
    breakerRing.rotation.y = Math.PI / 2;
    interceptorGroup.add(breakerRing);

    const centerPrism = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 12, 6),
      new THREE.MeshLambertMaterial({ color: 0xd4af37, wireframe: true })
    );
    interceptorGroup.add(centerPrism);

    // Solution Diverter Lines
    const solMat = new THREE.MeshBasicMaterial({ color: 0xd97706, transparent: true, opacity: 0 });
    const solCurve1 = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(16, -3.8, 1.2),
      new THREE.Vector3(22, -1, 2),
      new THREE.Vector3(24, 0, 0)
    );
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(solCurve1, 16, 0.18, 6, false), solMat));

    const solCurve2 = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(16, 3.8, -1.2),
      new THREE.Vector3(22, 1, 2),
      new THREE.Vector3(24, 0, 0)
    );
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(solCurve2, 16, 0.18, 6, false), solMat));

    scene.add(interceptorGroup);

    // 8. Minimalist Solution Nexus at X = 65
    const solutionGroup = new THREE.Group();
    solutionGroup.position.set(65, 0, 0);

    const solNexus = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.6, 1),
      new THREE.MeshLambertMaterial({ color: 0xd4af37, wireframe: true })
    );
    solutionGroup.add(solNexus);

    const halo1 = new THREE.Mesh(
      new THREE.TorusGeometry(5.4, 0.08, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0x15803d })
    );
    const halo2 = new THREE.Mesh(
      new THREE.TorusGeometry(6.6, 0.08, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0xc2410c })
    );
    solutionGroup.add(halo1);
    solutionGroup.add(halo2);
    scene.add(solutionGroup);

    // 9. Kinetic Ambient Stream Particles
    const pCount = 140;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    const pCol = new Float32Array(pCount * 3);
    const pSpd = new Float32Array(pCount);

    const cOrange = new THREE.Color('#c2410c');
    const cGreen = new THREE.Color('#15803d');

    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = Math.random() * 75 - 5;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 14;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 8;

      const c = Math.random() > 0.5 ? cOrange : cGreen;
      pCol[i * 3] = c.r;
      pCol[i * 3 + 1] = c.g;
      pCol[i * 3 + 2] = c.b;

      pSpd[i] = 0.18 + Math.random() * 0.25;
    }

    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));

    const particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0.7 })
    );
    scene.add(particles);

    // 10. Smooth Render Loop
    let animationFrameId;
    let time = 0;

    const renderLoop = () => {
      animationFrameId = requestAnimationFrame(renderLoop);
      time += 0.015;

      const targetP = progressRef.current;
      currentProgressRef.current += (targetP - currentProgressRef.current) * 0.08;
      const p = currentProgressRef.current;

      camera.position.x = -6 + p * 71;
      camera.position.y = Math.sin(p * Math.PI) * 2.0;
      camera.position.z = 18 - p * 6;

      const lookX = camera.position.x + 8;
      camera.lookAt(lookX, 0, 0);

      // Rotate links
      customerMeshes.forEach(({ link }) => (link.rotation.z += 0.008));
      bankMeshes.forEach(({ link }) => (link.rotation.z -= 0.008));

      // Cut cable logic
      const breakProgress = Math.max(0, Math.min(1, (p - 0.35) / 0.3));
      breakerRing.rotation.x = time * 0.6;
      centerPrism.rotation.y += 0.015;

      breakableCables.forEach(({ mat }) => {
        mat.opacity = Math.max(0.06, 0.65 * (1 - breakProgress * 1.3));
      });
      solMat.opacity = breakProgress * 0.9;

      // Stream particles
      const positions = particles.geometry.attributes.position.array;
      for (let i = 0; i < pCount; i++) {
        positions[i * 3] -= pSpd[i];
        if (positions[i * 3] < camera.position.x - 10) {
          positions[i * 3] = camera.position.x + 40;
        }
      }
      particles.geometry.attributes.position.needsUpdate = true;

      // Solution core
      solNexus.rotation.x += 0.01;
      solNexus.rotation.y += 0.012;
      halo1.rotation.x = time * 0.5;
      halo2.rotation.y = -time * 0.4;

      // Solution Card Emergence
      if (solutionOverlayRef.current) {
        const clarity = Math.max(0, Math.min(1, (p - 0.72) / 0.24));
        solutionOverlayRef.current.style.opacity = clarity;
        solutionOverlayRef.current.style.pointerEvents = clarity > 0.4 ? 'auto' : 'none';
        solutionOverlayRef.current.style.transform = `scale(${0.9 + clarity * 0.1}) translateY(${(1 - clarity) * 20}px)`;
      }

      renderer.render(scene, camera);
    };

    renderLoop();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden select-none bg-white">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Clean, minimal Solution Card at the end */}
      <div
        ref={solutionOverlayRef}
        className="absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-75"
        style={{ opacity: 0 }}
      >
        <div className="text-center max-w-md mx-auto px-6 py-7 rounded-2xl bg-white/95 border border-slate-200 shadow-2xl">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-900 flex items-center justify-center shadow-sm">
            <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v4M12 14v4M16 14v4" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">ps_banks</h2>
          <p className="text-xs text-slate-500 mt-1">Autonomous Customer Retention & Compliance</p>

          <div className="grid grid-cols-2 gap-2 mt-5 text-left">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <div className="text-[10px] font-mono font-bold text-emerald-700">PREDICTIVE ML</div>
              <div className="text-xs font-semibold text-slate-900 mt-0.5">Early Churn Signals</div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <div className="text-[10px] font-mono font-bold text-amber-700">COMPLIANCE</div>
              <div className="text-xs font-semibold text-slate-900 mt-0.5">RBI SLA Guard</div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <div className="text-[10px] font-mono font-bold text-blue-700">RETENTION</div>
              <div className="text-xs font-semibold text-slate-900 mt-0.5">1-Click Resolution</div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <div className="text-[10px] font-mono font-bold text-purple-700">AUDIT</div>
              <div className="text-xs font-semibold text-slate-900 mt-0.5">On-Chain Proof</div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-center gap-2.5">
            <a
              href="/login"
              className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-sm transition-transform active:scale-95"
            >
              Open Console →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
