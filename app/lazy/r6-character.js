// A Roblox R6 character and a baseplate, for the Progress Bar Maker's 3D
// preview (bar-scene.js). From Webskill Shenanigans' 3D view.

import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

export function faceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#111';
  x.fillRect(20, 22, 6, 10);
  x.fillRect(38, 22, 6, 10);
  x.lineWidth = 4;
  x.strokeStyle = '#111';
  x.beginPath();
  x.arc(32, 34, 14, 0.2 * Math.PI, 0.8 * Math.PI);
  x.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// An R6 body in studs: 2-wide torso, 1-wide limbs, pivots at the joints.
export function buildCharacter(colours, face) {
  const root = new Group();
  const mat = (c) => new MeshLambertMaterial({ color: c });
  const part = (w, h, d, c) => new Mesh(new BoxGeometry(w, h, d), mat(c));
  const torso = part(2, 2, 1, colours.torso);
  torso.position.y = 3;
  const head = new Group();
  head.position.y = 4;
  const headMesh = part(1.2, 1.2, 1.2, colours.skin);
  headMesh.position.y = 0.6;
  head.add(headMesh);
  const faceMesh = new Mesh(
    new PlaneGeometry(1.1, 1.1),
    new MeshBasicMaterial({ map: face, transparent: true }),
  );
  faceMesh.position.set(0, 0.6, 0.61);
  head.add(faceMesh);
  const limb = (x, y, c) => {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    const m = part(1, 2, 1, c);
    m.position.y = -1;
    pivot.add(m);
    return pivot;
  };
  // "Right" is the character's own right: -x when facing +z.
  const rightArm = limb(-1.5, 4, colours.skin);
  const leftArm = limb(1.5, 4, colours.skin);
  const rightLeg = limb(-0.5, 2, colours.legs);
  const leftLeg = limb(0.5, 2, colours.legs);
  const body = new Group();
  body.add(torso, head, rightArm, leftArm, rightLeg, leftLeg);
  root.add(body);
  const parts = {
    HumanoidRootPart: torso,
    Torso: torso,
    Head: headMesh,
    'Right Arm': rightArm.children[0],
    'Left Arm': leftArm.children[0],
    'Right Leg': rightLeg.children[0],
    'Left Leg': leftLeg.children[0],
  };
  return {
    root,
    body,
    head,
    rightArm,
    leftArm,
    rightLeg,
    leftLeg,
    parts,
    torso,
  };
}

// Stand-in poses for JJS's animations: the same animation always gets the

export function baseplateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#a3a3a3';
  x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#8f8f8f';
  x.lineWidth = 2;
  x.strokeRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(128, 128);
  t.magFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return t;
}
