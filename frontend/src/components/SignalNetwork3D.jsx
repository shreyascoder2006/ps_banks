import { Canvas, useThree } from '@react-three/fiber';
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SEVERITY_HEX } from '../lib/networkLayout';

/** Small canvas-drawn textures so labels and alert rings need no extra libraries. */
function useTextTexture(text) {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.font = '600 40px Inter, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(10,20,40,0.78)';
    const w = Math.min(500, g.measureText(text).width + 36);
    g.fillRect(256 - w / 2, 18, w, 60);
    g.fillStyle = '#f0d878';
    g.fillText(text, 256, 49);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text]);
}

function useRingTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = '#ffffff'; g.lineWidth = 9;
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    return new THREE.CanvasTexture(c);
  }, []);
}

function Controls() {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.target.set(0, 1.6, 0);
    c.minDistance = 9; c.maxDistance = 46;
    c.maxPolarAngle = Math.PI * 0.49;
    c.addEventListener('change', invalidate);
    c.update();
    return () => { c.removeEventListener('change', invalidate); c.dispose(); };
  }, [camera, gl, invalidate]);
  return null;
}

function Hub({ hub, onHover }) {
  const tex = useTextTexture(hub.name);
  const crit = hub.stats?.critical || 0;
  const s = 0.45 + Math.min(crit, 400) / 400 * 0.55;
  return (
    <group position={[hub.x, 0, hub.z]}>
      <mesh position={[0, 0.5, 0]} scale={s}
        onPointerMove={(e) => { e.stopPropagation(); onHover({ kind: 'hub', hub, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }}
        onPointerOut={() => onHover(null)}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#d4af37" emissive="#7a5f10" emissiveIntensity={0.5} roughness={0.35} metalness={0.5} />
      </mesh>
      <sprite position={[0, 1.9 + s, 0]} scale={[4.2, 0.79, 1]}>
        <spriteMaterial map={tex} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

function Nodes({ nodes, selectedId, onHover, onSelect }) {
  const ref = useRef();
  const down = useRef(null);
  const { invalidate } = useThree();

  useLayoutEffect(() => {
    const mesh = ref.current;
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const col = new THREE.Color();
    nodes.forEach((n, i) => {
      const s = n.size * (n.c.customerId === selectedId ? 2 : 1);
      m.compose(new THREE.Vector3(n.x, n.y, n.z), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(SEVERITY_HEX[n.c.churnRiskLevel] || '#8b93a7'));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [nodes, selectedId, invalidate]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, nodes.length]}
      onPointerMove={(e) => { e.stopPropagation(); if (e.instanceId != null) onHover({ kind: 'customer', node: nodes[e.instanceId], x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }}
      onPointerOut={() => onHover(null)}
      onPointerDown={(e) => { down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, id: e.instanceId }; }}
      onPointerUp={(e) => {
        // select on release, but only if the pointer barely moved (a drag orbits the camera instead)
        const d = down.current; down.current = null;
        if (d && e.instanceId === d.id && Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) < 6) onSelect(nodes[e.instanceId].c);
      }}>
      <sphereGeometry args={[1, 14, 14]} />
      <meshStandardMaterial roughness={0.45} metalness={0.1} />
    </instancedMesh>
  );
}

function Links({ nodes }) {
  const positions = useMemo(() => {
    const a = new Float32Array(nodes.length * 6);
    nodes.forEach((n, i) => {
      a.set([n.hub.x, 0.5, n.hub.z, n.x, n.y, n.z], i * 6);
    });
    return a;
  }, [nodes]);
  return (
    <lineSegments key={nodes.length}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <lineBasicMaterial color="#8b93a7" transparent opacity={0.1} />
    </lineSegments>
  );
}

function AlertRings({ nodes }) {
  const tex = useRingTexture();
  return nodes.filter((n) => n.alert).map((n) => (
    <sprite key={n.c.customerId} position={[n.x, n.y, n.z]} scale={n.size * 4.2}>
      <spriteMaterial map={tex} transparent depthWrite={false} color="#ffffff" />
    </sprite>
  ));
}

/** Orbit-able scene, rendered on demand (no continuous animation loop). Loaded lazily by SignalNetwork. */
export default function SignalNetwork3D({ net, selectedId, onHover, onSelect }) {
  return (
    <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0, 15, 27], fov: 45, near: 0.1, far: 200 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }} onPointerMissed={() => onHover(null)}>
      <ambientLight intensity={0.85} />
      <directionalLight position={[10, 18, 8]} intensity={1.1} />
      <gridHelper args={[36, 36, '#243660', '#14234a']} position={[0, -0.02, 0]} />
      <Controls />
      <Links nodes={net.nodes} />
      {net.hubs.map((h) => <Hub key={h.name} hub={h} onHover={onHover} />)}
      <Nodes nodes={net.nodes} selectedId={selectedId} onHover={onHover} onSelect={onSelect} />
      <AlertRings nodes={net.nodes} />
    </Canvas>
  );
}
