// components/dice/Dice3D.tsx
// @ts-nocheck
"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

export type Dice3DProps = {
  value: number | null; // 1–6 when result known
  rolling: boolean;
};

/* ────────────────────────────────────────────────────────── */
/* Orientation helpers                                        */
/* ────────────────────────────────────────────────────────── */
/**
 * ORIENTATIONS maps the "winning number" to the Euler rotation
 * that should put that number on top.
 *
 * These are for a *standard* dice orientation (1 opposite 6,
 * 2 opposite 5, 3 opposite 4, with 1–2–3 meeting at a vertex).
 *
 * If the pips don't visually line up, you only need to tweak
 * these 6 rotations.
 */
const ORIENTATIONS: Record<number, THREE.Euler> = {
  // 1 on top
  1: new THREE.Euler(0, 0, 0),

  // 2 on top (assume "2" is on +X)
  2: new THREE.Euler(0, 0, -Math.PI / 2),

  // 3 on top (assume "3" is on +Z)
  3: new THREE.Euler(-Math.PI / 2, 0, 0),

  // 4 on top (opposite 3)
  4: new THREE.Euler(Math.PI / 2, 0, 0),

  // 5 on top (opposite 2)
  5: new THREE.Euler(0, 0, Math.PI / 2),

  // 6 on top (opposite 1)
  6: new THREE.Euler(Math.PI, 0, 0),
};

function dampEuler(
  current: THREE.Euler,
  target: THREE.Euler,
  lambda: number,
  dt: number,
) {
  current.x += (target.x - current.x) * (1 - Math.exp(-lambda * dt));
  current.y += (target.y - current.y) * (1 - Math.exp(-lambda * dt));
  current.z += (target.z - current.z) * (1 - Math.exp(-lambda * dt));
}

/* ────────────────────────────────────────────────────────── */
/* Internal dice mesh                                         */
/* ────────────────────────────────────────────────────────── */

function DiceMesh({
  targetValue,
  rolling,
}: {
  targetValue: number | null;
  rolling: boolean;
}) {
  const groupRef = useRef<THREE.Group | null>(null);
  const rotationRef = useRef(new THREE.Euler(0.5, 0.8, 0.2));

  // Load your GLB from /public/models/dice.glb
  const { scene } = useGLTF("/models/dice.glb");

  // Clone, center & scale once so it fits nicely in view
  const diceObj = useMemo(() => {
    const clone = scene.clone(true);

    // Compute bounding box & size
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);

    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    const desiredSize = 1.4; // how big in world units you want the die
    const scale = desiredSize / maxAxis;

    clone.scale.setScalar(scale);

    // Recompute box after scaling, then center to origin
    box.setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);
    clone.position.sub(center);

    // Optional: reset base rotation so our ORIENTATIONS
    // map applies from a known neutral pose.
    clone.rotation.set(0, 0, 0);

    return clone;
  }, [scene]);

  // Allow meshes to cast/receive shadows, keep original mats/colors
  useEffect(() => {
    diceObj.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [diceObj]);

  useFrame((_, dt) => {
    if (!groupRef.current) return;

    const rot = rotationRef.current.clone();

    if (rolling || !targetValue) {
      // Fast chaotic spin while rolling
      rot.x += dt * 7;
      rot.y += dt * 9;
      rot.z += dt * 5;
    } else {
      // Smoothly damp towards the Euler for the winning number
      const target =
        ORIENTATIONS[targetValue] ?? ORIENTATIONS[1];
      dampEuler(rot, target, 7, dt);
    }

    rotationRef.current.copy(rot);
    groupRef.current.rotation.copy(rot);
  });

  return (
    <group ref={groupRef} dispose={null}>
      <primitive object={diceObj} />
    </group>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Public Dice3D component                                    */
/* ────────────────────────────────────────────────────────── */

export function Dice3D({ value, rolling }: Dice3DProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <div className="w-full max-w-xs h-56 mx-auto rounded-2xl bg-white border border-slate-200 shadow-sm">
      <Canvas
        camera={{ position: [2.4, 2.4, 2.4], fov: 45 }}
        shadows
      >
        <ambientLight intensity={0.9} />
        <directionalLight
          position={[4, 6, 3]}
          intensity={1.1}
          castShadow
        />
        <directionalLight
          position={[-4, -3, -5]}
          intensity={0.4}
        />
        <Suspense fallback={null}>
          <DiceMesh targetValue={value} rolling={rolling} />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom={false}
        />
      </Canvas>
    </div>
  );
}

useGLTF.preload("/models/dice.glb");
