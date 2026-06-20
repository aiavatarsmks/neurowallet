'use client';

import { useRef, Suspense, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type AvatarState = 'idle' | 'talking' | 'thinking';

// ─── 3D Scene ───────────────────────────────────────────────────────────────

function WireframeHead({ state }: { state: AvatarState }) {
  const headRef    = useRef<THREE.Mesh>(null);
  const groupRef   = useRef<THREE.Group>(null);
  const ring1Ref   = useRef<THREE.Mesh>(null);
  const ring2Ref   = useRef<THREE.Mesh>(null);
  const ring3Ref   = useRef<THREE.Mesh>(null);
  const eyeLRef    = useRef<THREE.Mesh>(null);
  const eyeRRef    = useRef<THREE.Mesh>(null);
  const glowRef    = useRef<THREE.Mesh>(null);

  const GREEN       = useMemo(() => new THREE.Color('#00FF7F'), []);
  const GREEN_DIM   = useMemo(() => new THREE.Color('#00CC60'), []);
  const GREEN_FAINT = useMemo(() => new THREE.Color('#004D26'), []);
  const BG_DARK     = useMemo(() => new THREE.Color('#050E07'), []);

  useFrame((_, delta) => {
    const t = Date.now() * 0.001;

    // Floating idle motion
    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(t * 0.7) * 0.07;
    }

    // Head slow rotation
    if (headRef.current) {
      const speed = state === 'talking' ? 0.5 : state === 'thinking' ? 0.8 : 0.25;
      headRef.current.rotation.y += delta * speed;
    }

    // Rings
    if (ring1Ref.current) ring1Ref.current.rotation.z += delta * 0.45;
    if (ring2Ref.current) ring2Ref.current.rotation.z -= delta * 0.28;
    if (ring3Ref.current) {
      ring3Ref.current.rotation.x += delta * 0.15;
      ring3Ref.current.rotation.z += delta * 0.2;
    }

    // Eye pulse when talking
    if (eyeLRef.current && eyeRRef.current) {
      const intensity = state === 'talking'
        ? 0.08 + Math.abs(Math.sin(t * 6)) * 0.05
        : 0.07 + Math.sin(t * 1.5) * 0.01;
      eyeLRef.current.scale.setScalar(intensity * 14);
      eyeRRef.current.scale.setScalar(intensity * 14);
    }

    // Inner glow pulse
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = state === 'talking'
        ? 0.08 + Math.abs(Math.sin(t * 4)) * 0.06
        : 0.04 + Math.sin(t * 1.2) * 0.02;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Inner glow fill */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.96, 32, 32]} />
        <meshBasicMaterial color={GREEN} transparent opacity={0.05} />
      </mesh>

      {/* Dark core fill (to hide back wireframe) */}
      <mesh>
        <sphereGeometry args={[0.93, 32, 32]} />
        <meshBasicMaterial color={BG_DARK} />
      </mesh>

      {/* Main wireframe sphere */}
      <mesh ref={headRef}>
        <sphereGeometry args={[1, 22, 22]} />
        <meshBasicMaterial color={GREEN} wireframe transparent opacity={0.82} />
      </mesh>

      {/* Eyes */}
      <mesh ref={eyeLRef} position={[-0.28, 0.12, 0.88]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color={GREEN} />
      </mesh>
      <mesh ref={eyeRRef} position={[0.28, 0.12, 0.88]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color={GREEN} />
      </mesh>

      {/* Halo ring 1 — tilted */}
      <mesh ref={ring1Ref} rotation={[Math.PI * 0.35, 0.2, 0]}>
        <torusGeometry args={[1.38, 0.014, 6, 100]} />
        <meshBasicMaterial color={GREEN} transparent opacity={0.9} />
      </mesh>

      {/* Halo ring 2 — opposite tilt */}
      <mesh ref={ring2Ref} rotation={[-Math.PI * 0.2, 0.5, 0]}>
        <torusGeometry args={[1.48, 0.008, 6, 100]} />
        <meshBasicMaterial color={GREEN_DIM} transparent opacity={0.55} />
      </mesh>

      {/* Halo ring 3 — horizontal */}
      <mesh ref={ring3Ref} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.3, 0.006, 6, 80]} />
        <meshBasicMaterial color={GREEN_FAINT} transparent opacity={0.6} />
      </mesh>

      {/* Point light for subtle fill */}
      <pointLight position={[0, 0, 2.5]} intensity={0.6} color="#00FF7F" />
      <pointLight position={[0, 2, 0]} intensity={0.3} color="#00FF7F" />
    </group>
  );
}

// ─── Public Component ────────────────────────────────────────────────────────

interface NeuraAvatarProps {
  state?: AvatarState;
  className?: string;
}

export function NeuraAvatar({ state = 'idle', className = '' }: NeuraAvatarProps) {
  return (
    <div className={`relative w-full ${className}`} style={{ height: '100%' }}>
      {/* Radial green glow behind avatar */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 50% 50%, rgba(0,255,127,0.13) 0%, rgba(0,255,127,0.04) 50%, transparent 75%)',
        }}
      />

      <Canvas
        camera={{ position: [0, 0, 3.4], fov: 44 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={null}>
          <WireframeHead state={state} />
        </Suspense>
      </Canvas>

      {/* Bottom fade so avatar blends into content below */}
      <div
        className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, transparent, #080C09)',
        }}
      />
    </div>
  );
}

export default NeuraAvatar;
