Build a browser-based, general-purpose 3D creation application.

The application should combine the ease of Blockbench and Womp 3D with useful parts of Blender and a texture-painting workflow inspired by Substance 3D Painter.

It should support modeling, sculpting, UVs, materials, texture painting, rigging, animation, and exporting.

The application must be a general-purpose 3D tool. Roblox is one possible use case and export target, but the architecture and UI should not be centered around Roblox.

## 3D Viewport

Make navigation feel similar to Roblox Studio.

Support:

* WASD movement
* Right mouse button for camera look
* Mouse wheel for zoom
* Middle mouse orbit and pan
* Shift for faster movement
* F to focus the selected object
* Move, rotate, and scale gizmos
* Axis constraints
* Grid snapping
* Rotation snapping
* Surface snapping
* Vertex snapping

Movement should feel smooth, responsive, and natural.

## Modeling

Support editable procedural primitives:

* Cube
* Sphere
* Cylinder
* Cone
* Wedge
* Plane
* Torus
* Capsule
* Other useful primitives

Primitive properties should remain editable.

For example, cylinders should allow changing:

* Radius
* Height
* Number of sides
* Top radius
* Bottom radius
* Smoothness

## Mesh Editing

Include an Edit Mode with:

* Vertex selection
* Edge selection
* Face selection
* Extrude
* Inset
* Bevel
* Merge
* Weld
* Delete
* Bridge
* Loop cuts
* Flip normals
* Separate

Support switching between object-level and direct mesh editing.

## Boolean Modeling

Support non-destructive:

* Union
* Subtract
* Intersect

Boolean objects should remain editable and update automatically.

Example:

```text
Model
├── Base Cube
└── Boolean Subtract
    └── Cylinder
```

## Modifier System

Create a non-destructive modifier stack.

Include:

* Bevel
* Solidify
* Mirror
* Smooth
* Subdivision
* Decimate
* Outline
* Other useful modifiers

Modifiers should be editable, reorderable, and removable.

## Automatic Outline

Add a Create Outline feature.

Generate an inverted shell or duplicate mesh around the selected object.

Support:

* Thickness
* Smoothness
* Inverted normals
* Normal-based expansion
* Automatic updates when the source changes

Keep the outline linked to the original model.

## Materials

Create a proper physically based material system.

Support:

* Base color
* Roughness
* Metallic
* Normal maps
* Height
* Ambient occlusion
* Emission
* Opacity
* Texture maps

Allow multiple materials per object.

## Texture Painting

Add a dedicated texture-painting workspace inspired by Substance 3D Painter.

Support:

* Brush painting
* Eraser
* Fill
* Color picker
* Material painting
* Texture projection
* Decals
* Stencils
* Gradients
* Smudge
* Blur
* Brush size
* Hardness
* Opacity
* Spacing
* Falloff

Painting should update directly on the 3D model in real time.

## Texture Layers

Use a layer system similar to modern image editors and Substance 3D Painter.

Example:

```text
Material
├── Dirt
├── Scratches
├── Metal
├── Paint
└── Base Color
```

Layers should support:

* Visibility
* Opacity
* Blending modes
* Masks
* Rename
* Reorder

## Smart Materials

Support reusable procedural materials such as:

* Metal
* Plastic
* Wood
* Stone
* Glass
* Painted metal
* Rust
* Dirt
* Concrete

Smart materials should consist of editable procedural layers.

## Procedural Material Generators

Include generators for:

* Noise
* Scratches
* Dirt
* Rust
* Edge wear
* Grunge
* Wood grain
* Stone patterns
* Color variation

Allow generators to be used as masks or texture sources.

## Baking

Support baking:

* Ambient occlusion
* Normal maps
* Curvature
* Position
* Thickness
* World-space normals
* ID maps

Allow high-poly models to be baked onto low-poly models.

## UV Tools

Include:

* Automatic UV unwrap
* Planar projection
* Box projection
* Cylindrical projection
* UV islands
* Relax
* Pack
* Scale
* Rotate
* Move

Include a 2D UV editor that works alongside the 3D viewport.

## Rigging

Add a dedicated Rigging workspace.

Support:

* Bones
* Bone chains
* Parent and child bones
* Bone hierarchy
* Bone naming
* Bone constraints
* IK
* FK
* IK/FK switching
* Pole targets
* Controllers
* Custom control shapes
* Automatic weight painting
* Manual weight painting
* Mirror weights
* Weight normalization
* Vertex groups

Allow users to create a basic skeleton manually or generate common rigs automatically.

For example:

```text
Character
└── Armature
    ├── Root
    │   ├── Spine
    │   │   ├── Chest
    │   │   │   ├── Neck
    │   │   │   │   └── Head
    │   │   │   ├── LeftArm
    │   │   │   └── RightArm
    │   │   ├── LeftLeg
    │   │   └── RightLeg
```

Provide simple automatic rig templates for common characters and creatures.

## Weight Painting

Create a visual weight-painting mode.

Display bone influence directly on the model.

Support:

* Add weight
* Remove weight
* Smooth weight
* Blur weight
* Normalize
* Mirror
* Transfer weights

Show a clear color gradient for bone influence.

Make it possible to select a bone and immediately see which parts of the mesh it controls.

## Rig Controls

Make posing easy for beginners.

Allow users to click and drag visible controllers to pose characters.

Provide useful controls for:

* Hands
* Feet
* Elbows
* Knees
* Head
* Spine
* Hips

Users should not need to manually select and rotate every bone for common poses.

## Animation

Add a dedicated Animation workspace.

Support:

* Keyframes
* Timeline
* Dope Sheet
* Animation clips
* Play
* Pause
* Loop
* Scrubbing
* Frame selection
* Copy/paste keyframes
* Delete keyframes
* Interpolation controls

Allow keyframing:

* Position
* Rotation
* Scale
* Bone transforms
* Object visibility
* Material properties
* Other animatable properties

## Animation Timeline

Create a clear timeline similar to Blender and other professional animation tools.

Example:

```text
Animation: Walk

Frame     0    10    20    30    40
          │     │     │     │     │
Root      ●─────●─────●─────●─────●
Arm       ●────────●────────●──────
Leg       ●──●────────●────────●───
Head      ●────────────●────────────
```

Make keyframes easy to move, duplicate, select, and edit.

## Animation Curves

Include a basic Graph Editor for advanced users.

Support:

* Position curves
* Rotation curves
* Scale curves
* Tangents
* Bezier interpolation
* Linear interpolation
* Constant interpolation
* Ease in
* Ease out

Keep the Graph Editor optional so beginners do not have to interact with it.

## Animation Tools

Add useful animation features such as:

* Pose library
* Animation clips
* Looping
* Mirror poses
* Copy/paste poses
* Animation retargeting
* Motion preview
* Onion skinning
* Ghosted previous/next poses

Allow users to save poses and reuse them.

## Animation Retargeting

Allow animations to be transferred between compatible rigs.

Support mapping bones between different skeletons.

Provide a simple bone-mapping interface:

```text
Source          Target

Hips      →     Hips
Spine     →     Spine
Head      →     Head
LeftArm   →     LeftArm
RightArm  →     RightArm
LeftLeg   →     LeftLeg
RightLeg  →     RightLeg
```

## Animation Preview

Allow users to preview animations directly in the viewport.

Include:

* Play
* Pause
* Loop
* Playback speed
* Timeline scrubbing
* Frame stepping

Allow multiple animation clips to be previewed without leaving the editor.

## Scene System

Support:

* Object hierarchy
* Groups
* Parent and child objects
* Visibility
* Locking
* Renaming
* Cameras
* Lights
* Materials
* Multiple objects
* Armatures
* Animation clips

## Procedural Model System

Do not store models only as raw vertices.

Use a procedural and non-destructive internal representation.

Example:

```text
Sword
├── Cube
├── Bevel
├── Boolean Subtract
│   └── Cylinder
├── Smooth
└── Outline
```

The final mesh should be generated from this structure.

Keep model data, geometry, UVs, materials, textures, rigs, and animations as separate but connected systems.

## User Interface

Create a clean interface inspired by:

* Blockbench
* Womp 3D
* Blender
* Roblox Studio
* Substance 3D Painter

Use dedicated workspaces such as:

```text
Model
Sculpt
UV
Texture
Material
Rig
Animate
```

Users should be able to switch between workspaces without losing their scene.

Keep common tools easy to access while allowing advanced controls when needed.

## Export

Support:

* GLB/GLTF
* OBJ
* STL
* Texture maps
* Material data
* Rigged meshes
* Skeletal animations
* Animation clips

Keep the export system modular so additional formats can be added later.

Roblox-compatible workflows should be possible through supported formats, but Roblox should not control the application's architecture.

## Performance

Keep the application responsive with moderately complex scenes.

Use efficient geometry, texture, rig, animation, and rendering updates.

Separate:

```text
Model Data
    ↓
Geometry
    ↓
UV Data
    ↓
Materials
    ↓
Textures
    ↓
Rig
    ↓
Animation
    ↓
Renderer
```

Only regenerate or update the systems that actually changed.

## Overall Goal

Create a polished general-purpose 3D creation application combining:

Blockbench for approachable modeling

Womp 3D for intuitive creative workflows

Blender for advanced modeling, rigging, animation, and scene tools

Substance 3D Painter for professional texture and material workflows

Roblox Studio for familiar viewport navigation

The result should feel like its own modern 3D application, not a clone of any existing software.

It should be approachable for beginners while providing enough depth for experienced 3D artists.

Prioritize intuitive controls, responsive interaction, non-destructive workflows, reliable geometry, clean architecture, and a consistent user experience across modeling, texturing, rigging, and animation.
