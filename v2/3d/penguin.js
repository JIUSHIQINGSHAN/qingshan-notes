import * as THREE from 'three';
import { mergeGeometries } from './vendor/addons/utils/BufferGeometryUtils.js';

// Original reference-inspired procedural sculpt. All visible features are
// real mesh/curve geometry, not a billboard or a sequence of reference photos.
const C = {
  teal: '#7fc7bd', ivory: '#f4f1df', sage: '#bfd6aa', trim: '#c9deb5',
  seam: '#91b082', embroidery: '#d4e4bd', coral: '#df6e57', coralDark: '#bd5143',
  cordLight: '#ee9070', button: '#274740', eye: '#111a20', eyeRim: '#66584b'
};
let seed = 1729;
function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

function fiberTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  const image = context.createImageData(256, 256);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 125 + Math.floor(random() * 65);
    image.data.set([value, value, value, 255], i);
  }
  context.putImageData(image, 0, 0);
  context.lineWidth = .65;
  for (let i = 0; i < 1800; i++) {
    const x = random() * 256, y = random() * 256;
    context.strokeStyle = `rgba(${random() > .5 ? '250,250,250' : '60,60,60'},.32)`;
    context.beginPath(); context.moveTo(x, y);
    context.quadraticCurveTo(x + random() * 3 - 1.5, y + 2, x + random() * 4 - 2, y + 3 + random() * 5);
    context.stroke();
  }
  const height = context.getImageData(0, 0, 256, 256);
  const normals = context.createImageData(256, 256);
  const sample = (x, y) => height.data[(((y + 256) % 256) * 256 + ((x + 256) % 256)) * 4] / 255;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const normal = new THREE.Vector3((sample(x - 1, y) - sample(x + 1, y)) * 2.5, (sample(x, y - 1) - sample(x, y + 1)) * 2.5, 1).normalize();
    normals.data.set([Math.round((normal.x * .5 + .5) * 255), Math.round((normal.y * .5 + .5) * 255), Math.round((normal.z * .5 + .5) * 255), 255], (y * 256 + x) * 4);
  }
  context.putImageData(normals, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(13, 12);
  texture.anisotropy = 8;
  return texture;
}

function material(color, bump, scale = .009) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: .94, metalness: 0, normalMap: bump, normalScale: new THREE.Vector2(scale * 65, scale * 65),
    sheen: .45, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), .16),
    sheenRoughness: .9
  });
}

function ellipsoid(parent, name, position, scale, mat, segments = 56) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, 40), mat);
  mesh.name = name;
  mesh.position.set(...position); mesh.scale.set(...scale);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function tube(parent, name, points, radius, mat, segments = 80, radial = 7, closed = false) {
  const curve = points instanceof THREE.Curve ? points : new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, radial, closed), mat);
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}

function surfacePatch(parent, name, path, center, origin, radii, mat) {
  const contour = path.getSpacedPoints(128);
  contour.pop();
  const positions = [], uvs = [], indices = [];
  const rings = 22, sectors = contour.length;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    for (let i = 0; i < sectors; i++) {
      const x = center[0] + (contour[i].x - center[0]) * t;
      const y = center[1] + (contour[i].y - center[1]) * t;
      const z = radii[2] * Math.sqrt(Math.max(.001, 1 - (x / radii[0]) ** 2 - (y / radii[1]) ** 2)) + .007;
      positions.push(x + origin[0], y + origin[1], z + origin[2]);
      uvs.push(x / (radii[0] * 2) + .5, y / (radii[1] * 2) + .5);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < sectors; i++) {
    const next = (i + 1) % sectors, a = j * sectors + i, b = j * sectors + next;
    indices.push(a, b, a + sectors, b, b + sectors, a + sectors);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, mat); mesh.name = name;
  mesh.receiveShadow = mesh.castShadow = true; parent.add(mesh);
  return mesh;
}

const bodyY = 1.36, bodyR = [1.04, 1.16, .79];
function vestRadius(y) {
  const radius = Math.sqrt(Math.max(.06, 1 - ((y - bodyY) / bodyR[1]) ** 2));
  return [bodyR[0] * radius + .048, bodyR[2] * radius + .045];
}
function frontDistance(angle) { return Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))); }
function vestTop(angle) { return 2.105 - .155 * Math.exp(-((frontDistance(angle) / .45) ** 2)); }
function vestBottom(angle) { return .94 + .105 * Math.exp(-((frontDistance(angle) / .32) ** 2)); }
function vestPoint(angle, t, lift = 0) {
  const y = THREE.MathUtils.lerp(vestBottom(angle), vestTop(angle), t);
  const [rx, rz] = vestRadius(y);
  return new THREE.Vector3((rx + lift) * Math.sin(angle), y, (rz + lift) * Math.cos(angle));
}

function panel(parent, side, mat, trimMat, seamMat) {
  const start = side === 1 ? .065 : -Math.PI;
  const end = side === 1 ? Math.PI : -.065;
  const rows = 28, cols = 80;
  const positions = [], uvs = [], indices = [];
  for (let layer = 0; layer < 2; layer++) for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const p = vestPoint(THREE.MathUtils.lerp(start, end, i / cols), j / rows, layer === 0 ? 0 : -.03);
    positions.push(p.x, p.y, p.z); uvs.push(i / cols, j / rows);
  }
  const count = (rows + 1) * (cols + 1);
  for (let layer = 0; layer < 2; layer++) for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = layer * count + j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    if (layer === 0) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
  }
  for (let i = 0; i < cols; i++) {
    for (const j of [0, rows]) {
      const a = j * (cols + 1) + i, b = a + 1;
      indices.push(a, b, a + count, b, b + count, a + count);
    }
  }
  for (let j = 0; j < rows; j++) for (const i of [0, cols]) {
    const a = j * (cols + 1) + i, b = a + cols + 1;
    indices.push(a, a + count, b, b, a + count, b + count);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, mat); mesh.name = side === 1 ? 'Padded robe right panel' : 'Padded robe left panel';
  mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
  for (const t of [0, 1]) {
    const points = Array.from({ length: 81 }, (_, i) => vestPoint(THREE.MathUtils.lerp(start, end, i / 80), t, .005));
    tube(parent, t ? 'Rolled collar' : 'Padded robe hem', new THREE.CatmullRomCurve3(points), t ? .042 : .025, trimMat, 110, 9);
  }
  const edge = side === 1 ? start : end;
  const points = Array.from({ length: 24 }, (_, j) => vestPoint(edge, j / 23, .008));
  tube(parent, 'Front opening piping', new THREE.CatmullRomCurve3(points), .023, trimMat, 44, 8);
  const stitchGeometry = [];
  for (let i = 2; i < 118; i++) {
    const angle = THREE.MathUtils.lerp(start, end, i / 120);
    const a = vestPoint(angle, .065, .015), b = vestPoint(angle + (end - start) / 220, .065, .015);
    stitchGeometry.push(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, .0055, 4, false));
  }
  const stitches = new THREE.Mesh(mergeGeometries(stitchGeometry), seamMat);
  stitches.name = 'Hem hand-stitching'; parent.add(stitches);
  stitchGeometry.forEach(g => g.dispose());
}

function braid(parent, name, curve, radius, mat, twists = 45, segments = 450) {
  const strands = 3;
  const frames = curve.computeFrenetFrames(segments, false);
  const vertices = [];
  for (let k = 0; k < strands; k++) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments, p = curve.getPointAt(t), angle = t * Math.PI * 2 * twists + k * Math.PI * 2 / strands;
      p.addScaledVector(frames.normals[i], Math.cos(angle) * radius * .45);
      p.addScaledVector(frames.binormals[i], Math.sin(angle) * radius * .45);
      points.push(p);
    }
    vertices.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius * .52, 5, false));
  }
  const mesh = new THREE.Mesh(mergeGeometries(vertices), mat);
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
  vertices.forEach(g => g.dispose());
}

function cloud(parent, centerX, centerY, scale, back, mat) {
  const paths = [];
  const outline = new THREE.Path();
  outline.moveTo(-.26, -.07);
  outline.bezierCurveTo(-.17, -.05, -.16, .02, -.17, .09);
  outline.bezierCurveTo(-.22, .19, -.13, .25, -.07, .19);
  outline.bezierCurveTo(-.03, .16, -.04, .10, -.08, .10);
  outline.bezierCurveTo(-.04, .16, .02, .18, .06, .13);
  outline.bezierCurveTo(.11, .07, .04, .015, .01, .05);
  outline.bezierCurveTo(.08, -.05, .17, -.05, .26, .01);
  outline.bezierCurveTo(.18, -.17, -.01, -.19, -.15, -.10);
  outline.bezierCurveTo(-.18, -.08, -.22, -.08, -.26, -.07);
  paths.push(outline);
  const line = new THREE.Path();
  line.moveTo(-.16, -.05); line.bezierCurveTo(-.02, -.12, .14, -.12, .21, -.04); paths.push(line);
  for (const [i, path] of paths.entries()) {
    const points = path.getSpacedPoints(i ? 28 : 65).map(p => {
      const x = centerX + p.x * scale, y = centerY + p.y * scale;
      const [rx, rz] = vestRadius(y);
      const z = (Math.sqrt(Math.max(.01, 1 - (x / rx) ** 2)) * rz + .025) * (back ? -1 : 1);
      return [x, y, z];
    });
    tube(parent, (back ? 'Back' : 'Front') + ' raised cloud embroidery', points, .013 * scale, mat, i ? 30 : 85, 6);
  }
}

function plushFibers(parent, name, center, radii, count, color, allowed, rotation = 0) {
  const positions = [], colors = [];
  const base = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    const v = random() * 2 - 1, phi = random() * Math.PI * 2, r = Math.sqrt(1 - v * v);
    const n = new THREE.Vector3(r * Math.sin(phi), v, r * Math.cos(phi));
    let p = new THREE.Vector3(n.x * radii[0], n.y * radii[1], n.z * radii[2]);
    if (allowed && !allowed(p, n)) continue;
    p.applyAxisAngle(new THREE.Vector3(0, 0, 1), rotation).add(new THREE.Vector3(...center));
    n.applyAxisAngle(new THREE.Vector3(0, 0, 1), rotation);
    const end = p.clone().addScaledVector(n, .005 + random() * .007);
    positions.push(p.x, p.y, p.z, end.x, end.y, end.z);
    const c = base.clone().multiplyScalar(.84 + random() * .27);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const fiber = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .14, depthWrite: false }));
  fiber.name = name; parent.add(fiber);
}

export function createPenguin() {
  seed = 1729;
  const model = new THREE.Group(); model.name = 'Qingshan Penguin - reference-inspired mesh sculpt';
  const bump = fiberTexture();
  const teal = material(C.teal, bump, .008), ivory = material(C.ivory, bump, .007);
  const sage = material(C.sage, bump, .004), trim = material(C.trim, bump, .005);
  sage.side = THREE.DoubleSide;
  const seam = new THREE.MeshStandardMaterial({ color: C.seam, roughness: .95 });
  const coral = material(C.coral, bump, .003);
  const embroidery = material(C.embroidery, bump, .003);
  const dark = material(C.button, bump, .002);

  ellipsoid(model, 'Plush body', [0, bodyY, 0], bodyR, teal, 72);
  const belly = new THREE.Shape();
  belly.moveTo(0, -.99);
  belly.bezierCurveTo(-.72, -.98, -.93, -.30, -.79, .25);
  belly.bezierCurveTo(-.62, .60, .62, .60, .79, .25);
  belly.bezierCurveTo(.93, -.30, .72, -.98, 0, -.99);
  surfacePatch(model, 'Ivory belly patch', belly, [0, -.32], [0, bodyY, 0], bodyR, ivory);

  const headCenter = [0, 2.42, -.005], headR = [.85, .84, .745];
  ellipsoid(model, 'Rounded turquoise head', headCenter, headR, teal, 80);
  const face = new THREE.Shape();
  face.moveTo(0, -.66);
  face.bezierCurveTo(-.46, -.68, -.73, -.41, -.68, -.13);
  face.bezierCurveTo(-.64, .12, -.54, .31, -.36, .31);
  face.bezierCurveTo(-.18, .31, -.18, .10, 0, .07);
  face.bezierCurveTo(.18, .10, .18, .31, .36, .31);
  face.bezierCurveTo(.54, .31, .64, .12, .68, -.13);
  face.bezierCurveTo(.73, -.41, .46, -.68, 0, -.66);
  surfacePatch(model, 'Heart-shaped ivory face', face, [0, -.25], headCenter, headR, ivory);

  for (const side of [-1, 1]) {
    const x = side * .335, y = 2.56;
    const z = .745 * Math.sqrt(1 - (x / .85) ** 2 - ((y - 2.42) / .84) ** 2) - .005;
    const group = new THREE.Group(); group.name = side < 0 ? 'Left eye' : 'Right eye';
    group.position.set(x, y, z + .009);
    const normal = new THREE.Vector3(x / (.85 ** 2), (y - 2.42) / (.84 ** 2), (z + .005) / (.745 ** 2)).normalize();
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    model.add(group);
    const rim = new THREE.MeshStandardMaterial({ color: C.eyeRim, roughness: .5 });
    const eye = new THREE.MeshPhysicalMaterial({ color: C.eye, roughness: .15, clearcoat: 1, clearcoatRoughness: .08 });
    ellipsoid(group, 'Soft brown eye rim', [0, 0, 0], [.105, .121, .036], rim, 36);
    ellipsoid(group, 'Glossy dark eye', [0, 0, .025], [.088, .103, .051], eye, 36);
    const glint = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    ellipsoid(group, 'Eye catchlight', [-.024, .037, .071], [.018, .022, .004], glint, 16);
    const cx = side * .48, cy = 2.29;
    const cz = .745 * Math.sqrt(1 - (cx / .85) ** 2 - ((cy - 2.42) / .84) ** 2);
    const cheek = ellipsoid(model, 'Mint cheek patch', [cx, cy, cz + .008], [.103, .075, .016], trim, 32);
    cheek.rotation.y = side * .53;
  }
  ellipsoid(model, 'Upper coral beak', [0, 2.325, .772], [.17, .078, .118], coral, 48);
  ellipsoid(model, 'Lower coral beak', [0, 2.252, .765], [.128, .052, .086], coral, 40);
  const mouth = new THREE.MeshStandardMaterial({ color: C.coralDark, roughness: .9 });
  tube(model, 'Beak seam', [[-.125,2.274,.82],[-.06,2.267,.866],[0,2.265,.879],[.06,2.267,.866],[.125,2.274,.82]], .005, mouth, 32, 5);

  for (const side of [-1, 1]) {
    const wing = ellipsoid(model, side < 0 ? 'Left flipper' : 'Right flipper', [side * .98, 1.4, .015], [.275, .65, .265], teal, 56);
    wing.rotation.z = side * .26;
    plushFibers(model, 'Flipper pile', [side * .98, 1.4, .015], [.277,.652,.267], 1700, C.teal, null, side*.26);
    ellipsoid(model, 'Soft ankle connection', [side*.39,.26,.11],[.21,.145,.19],teal,36);
    ellipsoid(model, 'Foot pad', [side*.39,.145,.20],[.245,.12,.22],teal,36);
    for (let toe=0;toe<3;toe++) ellipsoid(model, 'Plush toe', [side*.39+(toe-1)*.145,.135,.335-(toe===1?-.025:0)],[.095,.113,.17],teal,32);
  }
  const tail=ellipsoid(model,'Little back tail',[0,.7,-.75],[.24,.32,.33],teal,44);
  tail.rotation.x=-.55;

  panel(model, -1, sage, trim, seam); panel(model, 1, sage, trim, seam);
  for (const x of [-.48,.48]) for (const y of [1.2,1.64]) cloud(model,x,y,.80,false,embroidery);
  for (const [x,y,s] of [[-.47,1.27,.83],[.47,1.27,.83],[0,1.72,.86]]) cloud(model,x,y,s,true,embroidery);

  const neckPoints=Array.from({length:145},(_,i)=>{
    const angle=-Math.PI+i/144*Math.PI*2;
    const p=vestPoint(angle,.89,.033);p.y-=.012;return p;
  });
  braid(model,'Braided coral collar cord',new THREE.CatmullRomCurve3(neckPoints),.034,coral,85,800);
  const bowZ=vestRadius(1.94)[1]+.095;
  for (const side of [-1,1]) {
    const pts=[[0,1.91,bowZ],[side*.16,2.035,bowZ+.035],[side*.30,2.00,bowZ+.065],[side*.31,1.87,bowZ+.085],[side*.20,1.80,bowZ+.08],[0,1.91,bowZ]];
    braid(model,'Braided bow loop',new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p))),.030,coral,12,170);
  }
  ellipsoid(model,'Bow knot',[0,1.91,bowZ+.045],[.075,.09,.065],coral,32);
  braid(model,'Left loose cord',new THREE.CatmullRomCurve3([[0,1.88,bowZ+.03],[-.055,1.69,.87],[-.11,1.45,.885],[-.14,1.31,.875]].map(p=>new THREE.Vector3(...p))),.028,coral,19,180);
  braid(model,'Right loose cord',new THREE.CatmullRomCurve3([[.025,1.87,bowZ+.05],[.13,1.74,.89],[.15,1.60,.90],[.12,1.51,.90]].map(p=>new THREE.Vector3(...p))),.028,coral,14,140);
  for (const y of [1.43,1.15]) {
    const z=vestRadius(y)[1]+.058;
    tube(model,'Chinese frog button', [[-.13,y,z],[-.08,y+.015,z+.02],[0,y,z+.02],[.08,y+.015,z+.02],[.13,y,z]],.019,dark,35,8);
    for (const side of [-1,1]) ellipsoid(model,'Frog button knot',[side*.14,y,z],[.036,.035,.026],dark,20);
  }

  plushFibers(model,'Head short plush pile',headCenter,headR,12500,C.teal,(p,n)=> !(n.z>.50 && p.y<.32 && Math.abs(p.x)<.71));
  plushFibers(model,'Body short plush pile',[0,bodyY,0],bodyR,6500,C.teal,(p,n)=> (p.y<-.45 && n.z<.4));
  model.traverse(object => {
    if (!object.isMesh) return;
    if (object.material.normalMap) {
      object.geometry.computeTangents();
      const tangent = object.geometry.attributes.tangent;
      const normal = object.geometry.attributes.normal;
      const n = new THREE.Vector3(), t = new THREE.Vector3();
      for (let i = 0; i < tangent.count; i++) {
        n.fromBufferAttribute(normal, i).normalize();
        t.set(tangent.getX(i), tangent.getY(i), tangent.getZ(i));
        if (!Number.isFinite(t.lengthSq()) || t.lengthSq() < 1e-10) {
          t.crossVectors(Math.abs(n.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), n);
        } else {
          t.addScaledVector(n, -n.dot(t));
        }
        t.normalize();
        tangent.setXYZW(i, t.x, t.y, t.z, tangent.getW(i) < 0 ? -1 : 1);
      }
      tangent.needsUpdate = true;
    } else if (!object.material.map) {
      object.geometry.deleteAttribute('uv');
    }
  });
  model.userData = {
    title:'Qingshan Penguin — first 3D sculpt',
    method:'Reference-inspired procedural mesh sculpt, not photogrammetry or image-to-3D recovery.',
    features:['rounded plush body','heart-shaped face','padded sage robe','raised cloud embroidery','braided coral bow','Chinese frog buttons','toes and tail'],
    license:'Personal project asset; original source images retained separately.'
  };
  return model;
}
