// Three.js layer driven by the master clock (no animation loop of its own).
//   const t3 = threeLayer(s, { parent: stageEl, zIndex: 0 });
//   t3.scene.add(mesh);  s.onFrame((f) => { mesh.rotation.y = f * 0.02; });
import * as THREE from 'three';

export function threeLayer(s, { parent, width = s.width, height = s.height, zIndex = 0, fov = 35 } = {}) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  Object.assign(renderer.domElement.style, { position: 'absolute', left: 0, top: 0, zIndex, pointerEvents: 'none' });
  renderer.domElement.dataset.name = 'Three layer';
  (parent || document.getElementById('stage')).appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 5000);
  camera.position.set(0, 0, 1000);
  s.onFrame(() => renderer.render(scene, camera), 100);
  return { THREE, renderer, scene, camera };
}
