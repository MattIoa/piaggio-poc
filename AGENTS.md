# AGENTS.md - 3D Configurator Development Guide

## Project Overview
This is a **Next.js 16** product configurator application for interactive 3D bag customization. Built with v0.app and featuring Three.js/WebGL rendering, Radix UI components, and OpenAI integration for natural language configuration commands.

**Key Stack:** Next.js 16 (SSR disabled for 3D), React 19, Three.js, Tailwind CSS, TypeScript, Radix UI

## Architecture

### Core Application Structure
```
app/                    - Next.js App Router (SSR disabled for 3D components)
├── page.tsx            - Main configurator page (Client component managing state)
└── layout.tsx          - Root layout with Vercel Analytics

components/
├── configurator/       - Domain logic (3D rendering, model handling)
│   ├── viewer-3d.tsx   - Three.js canvas with material/visibility control (forwardRef)
│   ├── config-sidebar.tsx - UI controls (colors, lights, textures, AI commands)
│   └── model-uploader.tsx - GLTF/GLB file handling with multi-file support
└── ui/                 - Radix UI primitives (accordion, slider, dialog, etc.)
```

### Data Flow
1. **Model Loading**: `ModelUploader` → drag-drop/folder upload → `fileMap` (filename → blob URL mapping)
2. **Scene Ready**: `Viewer3D` loads GLTF/GLB → extracts `SceneNode[]` + naming patterns → parent state
3. **State Management**: Parent (`page.tsx`) holds: models, lights, selected groups, textures via refs/callbacks
4. **3D Updates**: `Viewer3D.forwardRef` receives imperatively via `viewerRef` methods: `setNodeColor()`, `setLogoVisibility()`, `setNodeTextures()`

## Critical Patterns & Conventions

### Model & Material Naming (Domain Convention)
```typescript
// From page.tsx - NAMING_CONFIG
modelGroupPrefix: "prada_galleria_grp_"      // Model variants: "prada_galleria_grp_1BA906"
logoGroupPrefix: "logo_"                      // Logo types: "logo_S_grp_C" (S=type, C=position)
leatherMaterialName: "leather_shd"            // Primary material for textures
textureBasePath: "/models/M7Y8_Pelle_BC_"     // Texture files: BC (base color), N (normal), ORM (metallic)
```
This naming is **critical** - scene graph and texture loading depend on it. When working with new models, verify these prefixes match the GLTF structure.

### 3D Component Pattern (SSR-disabled)
```typescript
// page.tsx - Viewer3D uses dynamic import
const Viewer3D = dynamic(() => import("...viewer-3d"), {
  ssr: false,
  loading: () => <LoadingOverlay />
})
```
**Important:** Never SSR-render Viewer3D (Three.js requires DOM). Always use `"use client"` + dynamic import with `ssr: false`.

### Forward Reference for Imperative Control
```typescript
// Viewer3D exports ViewerHandle interface with methods like:
export interface ViewerHandle {
  setNodeColor(nodeId, color): void
  setLogoVisibility(modelSuffix, logoType, logoPosition, prefix): void
  setNodeTextures(nodeId, textures): Promise<void>
  updateLights(config): void
}
// Parent calls: viewerRef.current?.setNodeColor(...)
```
This bypasses React props for expensive 3D updates. **Common mistake:** forgetting to await async methods like `setNodeTextures()`.

### Material Textures (3-Map System)
Materials use standard PBR setup:
- **BC** (Base Color): `/models/M7Y8_Pelle_BC_Mango.jpg`
- **N** (Normal): `/models/M7Y8_Pelle_N.jpg`
- **ORM** (Occlusion/Roughness/Metallic): `/models/M7Y8_Pelle_ORM.jpg`

Passed as `TextureSet` to `setNodeTextures()`. Check `textureBasePath` when adding new leather colors.

### File Mapping for External Assets
`ModelUploader` creates `fileMap: Map<string, string>` (filename → blob URL) to resolve GLTF external files (textures, bins). **Always pass fileMap to Viewer3D** for proper asset loading. Cleanup with `URL.revokeObjectURL()` when replacing models.

### OpenAI Color Command Pattern
Natural language input → `resolveColorCommand()` → structured `OpenAICommand[]` (type: "color"|"texture"|"size"|"logo"). Commands execute sequentially. API key stored in component state (not secure for production). See `lib/openai-color-command.ts` for schema.

## Developer Workflows

### Development Server
```bash
pnpm dev       # Starts Next.js dev server on :3000
npm run build  # Validates TS, builds for deployment
npm run lint   # ESLint check (currently configured but minimal)
```
TypeScript strict mode enabled. Build ignores TS errors (see `next.config.mjs`), but IDE will still flag them.

### Working with 3D Models
1. **Export from 3D software** (Blender/Maya) as `.glb` with proper naming: `prada_galleria_grp_XXX` for models, `logo_TYPE_grp_POSITION` for logos
2. **Upload via drag-drop** or folder upload in UI (recreates fileMap)
3. **Verify in scene** via sidebar accordion (shows scene nodes grouped by material)
4. **Test color/texture changes** on known material names

### Adding New UI Controls
1. Add state to `page.tsx` (e.g., `[tintAmount, setTintAmount]`)
2. Pass callback to `ConfigSidebar` (e.g., `onTintChange`)
3. Implement in sidebar accordion section with Radix UI primitives (Slider, Select, etc.)
4. Call `viewerRef.current?.updateShaderProperty()` or imperative method
5. Radix UI uses CSS vars via `cn()` utility (clsx + tw-merge)

### Debugging 3D Rendering
- **Model not loading**: Check console for GLTF parsing errors; verify blob URLs in fileMap
- **Colors not applying**: Confirm nodeId exists in scene; check material has `color` property (not texture-only)
- **Textures missing**: Verify texture filenames in fileMap match GLTF references; check textureBasePath
- **Performance**: Use Chrome DevTools → Rendering tab to detect shader bottlenecks; Three.js caches meshes on first render

## Integration Points

### External Dependencies
- **Three.js** (0.172.0): Core 3D rendering, no React wrapper (custom useRef integration)
- **Radix UI** (@radix-ui/*): Headless UI (accordion, slider, dialog). See `components/ui/` for shadcn wrappers
- **React Hook Form** + Zod: Form validation (minimal use in current code; extendable)
- **OpenAI API**: `/models/openai-color-command.ts` makes HTTP calls (requires API key)
- **Vercel Analytics**: Passive telemetry in root layout

### Configuration Files
- **next.config.mjs**: Disables image optimization (`unoptimized: true`), ignores TS build errors
- **tsconfig.json**: Path alias `@/*` → root, strict mode ON
- **tailwind.config.ts**: v4 with Radix UI theme integration (auto dark mode)
- **components.json**: Shadcn component registry (metadata only for CLI)

## Common Gotchas

1. **Three.js memory leaks**: Always dispose geometries/materials in cleanup. Model replacement calls `URL.revokeObjectURL()` for old fileMap
2. **Blob URL limits**: Each file creates a blob URL; large multi-file models may hit limits on some browsers. Monitor in DevTools
3. **Imperatively controlling 3D**: Never hold canvas refs directly; always use `ViewerHandle` interface
4. **Texture naming sensitivity**: "M7Y8_Pelle_BC_Mango" vs "M7Y8_Pelle_BC_mango" will fail silently (case matters on some systems)
5. **API key exposure**: OpenAI key stored in client state; use environment variable + backend proxy in production

## Extending the Codebase

- **New material type**: Add to `SceneNode` interface, update sidebar node grouping logic
- **New configuration option**: Add state to `page.tsx`, pass to sidebar/viewer, implement callback
- **New 3D feature** (shadows, reflections): Extend `ViewerHandle` with new methods, implement in `viewer-3d.tsx`
- **Mobile support**: Use `use-mobile.tsx` hook; sidebar currently fixed layout (needs responsive redesign)

## File Size Note
The `/public/models/` directory contains large texture maps (PBR). Keep `.gitignore` updated to avoid bloating repo (or use CDN for production deployment).

