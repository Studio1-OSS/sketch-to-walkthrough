import * as THREE from 'three';
import { roomCenter, type PlanSpec } from './plan';

const wallMat = new THREE.MeshStandardMaterial({ color: '#f6f3e9', roughness: 0.87 });
const wallCapMat = new THREE.MeshStandardMaterial({ color: '#e6e4d9', roughness: 0.9 });
const FRAME = '#e6e9dc';
const floorColors: Record<PlanSpec['rooms'][number]['floor'], string> = { wood: '#cbb18a', tile: '#b8c9c3', carpet: '#cec3b0', concrete: '#c0c4c1' };
const toWorld = (p: [number, number], height = 0) => new THREE.Vector3(p[0] / 1000, height / 1000, -p[1] / 1000);

function textureFor(floor: PlanSpec['rooms'][number]['floor']) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = floorColors[floor]; ctx.fillRect(0, 0, 256, 256);
  if (floor === 'wood') {
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = i % 2 ? '#bda37d' : '#dac39d'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 256); ctx.stroke();
      for (let j = 0; j < 3; j++) { const y = ((j * 97 + i * 47) % 256); ctx.strokeRect(i * 32, y, 32, 48); }
    }
  } else if (floor === 'tile') {
    ctx.strokeStyle = '#e0e7e1'; ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
  } else {
    for (let i = 0; i < 1400; i++) { ctx.fillStyle = i % 2 ? '#ffffff18' : '#5c51460b'; ctx.fillRect((i * 89) % 256, (i * 71) % 256, 1.3, 1.3); }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(3, 3); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function labelSprite(text: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 112;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#173e37e8'; ctx.beginPath(); ctx.roundRect(75, 10, 362, 82, 28); ctx.fill();
  ctx.font = '500 29px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f5f7ed'; ctx.fillText(text, 256, 53, 320);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(1.65, 0.36, 1); sprite.renderOrder = 5;
  return sprite;
}

export function buildWorld(plan: PlanSpec, options: { labels?: boolean; ceiling?: boolean } = {}) {
  const group = new THREE.Group(); group.name = 'Sketch to Walkthrough';
  const height = plan.wallHeight;
  const box = (parent: THREE.Object3D, width: number, h: number, depth: number, x: number, y: number, material = wallMat) => {
    if (width <= 0 || h <= 0) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width / 1000, h / 1000, depth / 1000), material);
    mesh.position.set(x / 1000, y / 1000, 0); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  };
  for (const room of plan.rooms) {
    const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#ffffff', map: textureFor(room.floor), roughness: 0.9, side: THREE.DoubleSide }));
    mesh.scale.set(0.001, 1, 0.001); mesh.position.y = 0.012; mesh.receiveShadow = true; mesh.name = `${room.name} floor`; group.add(mesh);
    if (options.ceiling) {
      const ceiling = new THREE.Mesh(geometry.clone(), new THREE.MeshStandardMaterial({ color: '#f4f3e9', roughness: 1, side: THREE.DoubleSide }));
      ceiling.scale.set(0.001, 1, 0.001); ceiling.position.y = height / 1000; ceiling.name = `${room.name} ceiling`; group.add(ceiling);
    }
    if (options.labels) {
      const label = labelSprite(room.name); label.position.copy(toWorld(roomCenter(room.polygon), 1800)); group.add(label);
    }
  }
  const frameMaterial = new THREE.MeshStandardMaterial({ color: FRAME, roughness: 0.58 });
  const doorMaterial = new THREE.MeshStandardMaterial({ color: '#9d7753', roughness: 0.75 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: '#b3dfdd', metalness: 0.1, roughness: 0.12, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
  for (const wall of plan.walls) {
    const parent = new THREE.Group(); parent.name = wall.id;
    const dx = wall.b[0] - wall.a[0], dy = wall.b[1] - wall.a[1], length = Math.hypot(dx, dy);
    parent.position.copy(toWorld([(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2]));
    parent.rotation.y = Math.atan2(dy, dx);
    const openings = plan.openings.filter((o) => o.wallId === wall.id).sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const opening of openings) {
      const center = (cursor + opening.offset) / 2 - length / 2;
      box(parent, opening.offset - cursor, height, wall.thickness, center, height / 2, wallCapMat);
      const mid = opening.offset + opening.width / 2 - length / 2, sill = opening.sill ?? 0;
      if (opening.type === 'window') {
        box(parent, opening.width, sill, wall.thickness, mid, sill / 2);
        box(parent, opening.width, sill + 38, wall.thickness + 35, mid, sill + 19, frameMaterial);
        box(parent, opening.width, 35, wall.thickness + 25, mid, sill + opening.height - 17, frameMaterial);
        box(parent, 45, opening.height, wall.thickness + 25, opening.offset + 24 - length / 2, sill + opening.height / 2, frameMaterial);
        box(parent, 45, opening.height, wall.thickness + 25, opening.offset + opening.width - 24 - length / 2, sill + opening.height / 2, frameMaterial);
        box(parent, 35, opening.height, 38, mid, sill + opening.height / 2, frameMaterial);
            const glass = box(parent, opening.width - 70, opening.height - 70, 8, mid, sill + opening.height / 2, glassMaterial);
        if (glass) glass.name = `${opening.id} glass`;
      } else {
        const hinge = new THREE.Group(); hinge.name = `${opening.id} panel`;
        hinge.position.set((opening.offset - length / 2) / 1000, 0, 0);
        hinge.rotation.y = opening.swing === 'right' ? -Math.PI / 3 : Math.PI / 3;
        if (opening.type === 'door') {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(opening.width / 1000 - 0.022, opening.height / 1000 - 0.025, 0.038), doorMaterial);
          panel.position.set(opening.width / 2000, opening.height / 2000 + 0.012, 0); panel.castShadow = true; hinge.add(panel);
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshStandardMaterial({ color: '#b7a36b', metalness: 0.8, roughness: 0.3 }));
          knob.position.set(opening.width / 1000 - 0.07, 1.04, 0.035); hinge.add(knob);
        }
        parent.add(hinge);
      }
      box(parent, opening.width, height - sill - opening.height, wall.thickness, mid, (height + sill + opening.height) / 2, wallCapMat);
      cursor = opening.offset + opening.width;
    }
    box(parent, length - cursor, height, wall.thickness, (cursor + length) / 2 - length / 2, height / 2, wallCapMat);
    group.add(parent);
  }
  return group;
}

export function disposeWorld(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.SpriteMaterial) material.map?.dispose();
        material.dispose();
      }
    }
  });
  root.clear();
}
