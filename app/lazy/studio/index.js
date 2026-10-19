// Everything 3D Studio's page loads on demand, in one chunk (with three.js).
export * as mesh from './mesh.js';
export * as uv from './uv.js';
export * as rig from './rig.js';
export * as anim from './anim.js';
export * as tex from './texture.js';
export * as paint from './paint.js';
export * as sculpt from './sculpt.js';
export * as docs from './doc.js';
export * as project from './project.js';
export { PRIMITIVES, buildPrimitive } from './primitives.js';
export { MODIFIERS, MODIFIER_ORDER, newModifier } from './modifiers.js';
export { Evaluator, transformMesh } from './evaluate.js';
export { TextureEngine } from './textures.js';
export { BAKERS } from './bake.js';
export { EXPORTERS } from './export.js';
export { mountView } from './view.js';
export { importModel } from './import.js';
export { CONTROL_SHAPES } from './scene-build.js';
