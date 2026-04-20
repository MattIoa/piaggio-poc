"use client"

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react"
import { Loader2, MonitorCog, RotateCcw } from "lucide-react"

/** Info about an extracted scene node (mesh) */
export interface SceneNode {
  id: string
  name: string
  materialName: string
  originalColor: string
}

/** Light configuration the parent can control */
export interface LightConfig {
  ambientColor: string
  ambientIntensity: number
  directionalColor: string
  directionalIntensity: number
}

/** Set di texture PBR da poter sostituire dinamicamente */
export interface TextureSet {
  baseColorMap?: string;
  normalMap?: string;
  ormMap?: string;
}

export interface ViewerHandle {
  setNodeColor: (nodeId: string, color: string) => void
  resetNodeColor: (nodeId: string) => void
  highlightNode: (nodeId: string | null) => void
  updateLights: (config: LightConfig) => void
  setModelVisibility: (modelSuffix: string, prefix: string) => void
  setLogoVisibility: (modelSuffix: string, logoType: string, logoPosition: string, prefix: string) => void
  setNodeTextures: (nodeId: string, textures: TextureSet) => Promise<void>
  setEngravingLetters: (modelSuffix: string, letters: string[]) => void
  setNodeRoughness: (nodeId: string, roughness: number) => void
  setNodeVisibility: (nodeId: string, visible: boolean) => void
  updateWorld: (config: { backgroundColor?: string; envIntensity?: number }) => void
}

// Passiamo anche l'elenco di tutti i nomi dei nodi al genitore
export interface SceneMetadata {
  nodes: SceneNode[];
  allNodeNames: string[];
}

interface ViewerProps {
  modelUrl: string | null
  fileMap: Map<string, string> | null
  onSceneReady: (metadata: SceneMetadata) => void
}

function LoadingOverlay() {
  return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 z-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-sans">
          Caricamento scena 3D...
        </p>
      </div>
  )
}

function EmptyState() {
  return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none z-10">
        <div className="flex flex-col items-center gap-2 opacity-50">
          <MonitorCog className="h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground font-sans">
            Carica un modello GLTF/GLB per iniziare
          </p>
        </div>
      </div>
  )
}

type MeshRecord = {
  mesh: any
  originalColor: string
  originalEmissive: string
}

const Viewer3D = forwardRef<ViewerHandle, ViewerProps>(function Viewer3D(
    { modelUrl, fileMap, onSceneReady },
    ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const stateRef = useRef<{
    renderer: any
    scene: any
    camera: any
    controls: any
    frame: number
    placeholderMesh: any
    currentModel: any
    disposed: boolean
    ambientLight: any
    directionalLight: any
    meshMap: Map<string, MeshRecord>
    highlightedId: string | null
    isWebGPU: boolean
    modelGroup: any
    autoRotate: boolean
    composer: any
  }>({
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    frame: 0,
    placeholderMesh: null,
    currentModel: null,
    disposed: false,
    ambientLight: null,
    directionalLight: null,
    meshMap: new Map(),
    highlightedId: null,
    isWebGPU: false,
    modelGroup: null,
    autoRotate: false,
    composer: null,
  })

  const [rendererType, setRendererType] = useState<"webgpu" | "webgl" | "loading">("loading")
  const [ready, setReady] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)
  const autoRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleAutoRotateToggle = useCallback(() => {
    if (autoRestoreTimerRef.current) {
      clearTimeout(autoRestoreTimerRef.current)
      autoRestoreTimerRef.current = null
    }
    setAutoRotate(v => !v)
  }, [])

  useImperativeHandle(
      ref,
      () => ({
        setNodeColor(nodeId: string, color: string) {
          const record = stateRef.current.meshMap.get(nodeId)
          if (!record) return
          record.mesh.material.color.set(color)
        },
        resetNodeColor(nodeId: string) {
          const record = stateRef.current.meshMap.get(nodeId)
          if (!record) return
          record.mesh.material.color.set(record.originalColor)
        },
        highlightNode(nodeId: string | null) {
          const state = stateRef.current
          if (state.highlightedId) {
            const prev = state.meshMap.get(state.highlightedId)
            if (prev && prev.mesh.material.emissive) {
              prev.mesh.material.emissive.set(prev.originalEmissive)
            }
          }
          state.highlightedId = nodeId
          if (nodeId) {
            const record = state.meshMap.get(nodeId)
            if (record && record.mesh.material.emissive) {
              record.mesh.material.emissive.set("#222244")
            }
          }
        },
        updateLights(config: LightConfig) {
          const state = stateRef.current
          if (state.ambientLight) {
            state.ambientLight.color.set(config.ambientColor)
            state.ambientLight.intensity = config.ambientIntensity
          }
          if (state.directionalLight) {
            state.directionalLight.color.set(config.directionalColor)
            state.directionalLight.intensity = config.directionalIntensity
          }
        },
        // Nasconde/Mostra i modelli basandosi su un prefisso passato dal genitore
        setModelVisibility(modelSuffix: string, prefix: string) {
          const state = stateRef.current
          if (!state.currentModel) return

          state.currentModel.traverse((node: any) => {
            if (node.name && node.name.startsWith(prefix)) {
              node.visible = node.name.endsWith(modelSuffix)
            }
          })
        },
        // Gestisce la visibilità dinamica dei loghi
        setLogoVisibility(modelSuffix: string, logoType: string, logoPosition: string, prefix: string) {
          const state = stateRef.current
          if (!state.currentModel) return

          const targetLogoName = `${prefix}${logoType}_${logoPosition}_grp_${modelSuffix}`

          state.currentModel.traverse((node: any) => {
            if (
                node.name &&
                node.name.startsWith(prefix) &&
                node.name.includes(`_grp_${modelSuffix}`)
            ) {
              node.visible = (node.name === targetLogoName)
            }
          })
        },
        async setNodeTextures(nodeId: string, textures: TextureSet) {
          const state = stateRef.current
          const record = state.meshMap.get(nodeId)
          if (!record || !record.mesh.material) return

          const THREE = await import("three")
          const textureLoader = new THREE.TextureLoader()
          const material = record.mesh.material

          if (textures.baseColorMap) {
            const map = await textureLoader.loadAsync(textures.baseColorMap)
            map.flipY = false
            map.colorSpace = THREE.SRGBColorSpace
            material.map = map
          }

          if (textures.normalMap) {
            const normalMap = await textureLoader.loadAsync(textures.normalMap)
            normalMap.flipY = false
            material.normalMap = normalMap
          }

          if (textures.ormMap) {
            const ormMap = await textureLoader.loadAsync(textures.ormMap)
            ormMap.flipY = false
            material.aoMap = ormMap
            material.roughnessMap = ormMap
            material.metalnessMap = ormMap
          }

          material.needsUpdate = true
        },
        setEngravingLetters(modelSuffix: string, letters: string[]) {
          const state = stateRef.current
          if (!state.currentModel) return

          // Raccogli il gruppo e tutti i nodi lettera
          let lettersGroup: any = null
          const letterNodeMap = new Map<string, any>()

          state.currentModel.traverse((node: any) => {
            if (!node.name) return
            if (node.name === `Letters_F_${modelSuffix}`) {
              lettersGroup = node
            }
            if (
              node.name.startsWith("letter_") &&
              node.name.endsWith(`_${modelSuffix}`)
            ) {
              const char = node.name
                .slice("letter_".length, -("_" + modelSuffix).length)
                .toUpperCase()
              letterNodeMap.set(char, node)
            }
          })

          if (!lettersGroup) return
          lettersGroup.visible = letters.length > 0
          if (letters.length === 0) {
            letterNodeMap.forEach((n) => { n.position.x = 0; n.visible = false })
            return
          }

          // Reset tutte le lettere
          letterNodeMap.forEach((n) => { n.position.x = 0; n.visible = false })

          // Calcola bounding box di una lettera campione per ricavare la larghezza
          import("three").then(({ Box3, Vector3 }) => {
            let charWidth = 0.018 // fallback in unità Three.js
            const sample = letterNodeMap.get("M") ?? letterNodeMap.values().next().value
            if (sample) {
              const box = new Box3().setFromObject(sample)
              const size = new Vector3()
              box.getSize(size)
              if (size.x > 0) charWidth = size.x
            }

            const spacing = charWidth * 0.85
            const totalWidth = spacing * (letters.length - 1)

            letters.forEach((letter, idx) => {
              const node = letterNodeMap.get(letter.toUpperCase())
              if (!node) return
              node.position.x = idx * spacing - totalWidth / 2
              node.visible = true
            })
          })
        },
        setNodeVisibility(nodeId: string, visible: boolean) {
          const record = stateRef.current.meshMap.get(nodeId)
          if (record) record.mesh.visible = visible
        },
        setNodeRoughness(nodeId: string, roughness: number) {
          const record = stateRef.current.meshMap.get(nodeId)
          if (!record) return
          const mat = record.mesh.material as any
          if (mat && mat.roughness !== undefined) {
            mat.roughness = roughness
            mat.needsUpdate = true
          }
        },
        updateWorld({ backgroundColor, envIntensity }: { backgroundColor?: string; envIntensity?: number }) {
          const state = stateRef.current
          if (!state.scene) return
          if (backgroundColor !== undefined) {
            ;(state.scene.background as any)?.set(backgroundColor)
          }
          if (envIntensity !== undefined) {
            ;(state.scene as any).environmentIntensity = envIntensity
          }
        },
      }),
      []
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const state = stateRef.current
    state.disposed = false
    let resizeObserver: ResizeObserver | null = null

    async function init() {
      const THREE = await import("three")

      if (state.disposed) return

      const width = container!.clientWidth
      const height = container!.clientHeight

      const scene = new THREE.Scene()
      state.scene = scene

      // Gruppo che contiene il modello — ruota indipendentemente dalla scena/cove
      const modelGroup = new THREE.Group()
      scene.add(modelGroup)
      state.modelGroup = modelGroup

      // ── Gizmo assi (inset top-right) ────────────────────────────────
      const gizmoScene = new THREE.Scene()
      const gizmoCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10)
      gizmoCamera.position.set(0, 0, 5)
      gizmoCamera.lookAt(0, 0, 0)
      const gizmoGroup = new THREE.Group()
      gizmoScene.add(gizmoGroup)
      const mkArrow = (dir: [number, number, number], color: number) =>
        new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(), 1.0, color, 0.32, 0.18)
      gizmoGroup.add(
        mkArrow([1, 0, 0], 0xff3333),  // X — rosso
        mkArrow([0, 1, 0], 0x33cc44),  // Y — verde
        mkArrow([0, 0, 1], 0x3377ff),  // Z — blu
      )
      // ────────────────────────────────────────────────────────────────

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
      camera.position.set(4, 1.6, 3.5)
      camera.lookAt(0, 0, 0)
      state.camera = camera

      // WebGL sempre — WebGPU Three.js è ancora sperimentale (no shadow map, no PMREM)
      const isWebGPU = false
      const renderer = new THREE.WebGLRenderer({
        canvas: canvas!,
        antialias: true,
        alpha: true,
      })

      if (state.disposed || !renderer) return

      // Tone mapping — applicato ad entrambi i renderer
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.0

      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      // Shadow map solo su WebGL — WebGPU non le supporta ancora stabili in Three.js
      if (!isWebGPU) {
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = THREE.PCFSoftShadowMap
      }
      state.renderer = renderer

      // ── Post-processing: SMAA anti-aliasing ─────────────────────────
      const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js")
      const { RenderPass }     = await import("three/examples/jsm/postprocessing/RenderPass.js")
      const { SMAAPass }       = await import("three/examples/jsm/postprocessing/SMAAPass.js")
      const dpr = renderer.getPixelRatio()
      const composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      composer.addPass(new SMAAPass(width * dpr, height * dpr))
      state.composer = composer
      // ─────────────────────────────────────────────────────────────────

      state.isWebGPU = isWebGPU
      setRendererType(isWebGPU ? "webgpu" : "webgl")

      // EXR solo per riflessi e illuminazione — sfondo bianco piatto
      if (!isWebGPU) {
        const { EXRLoader } = await import("three/examples/jsm/loaders/EXRLoader.js")
        const pmrem = new THREE.PMREMGenerator(renderer)
        pmrem.compileEquirectangularShader()
        const exrTexture = await new EXRLoader().loadAsync("/scene/showroom.exr")
        const envMap = pmrem.fromEquirectangular(exrTexture).texture
        scene.environment = envMap
        exrTexture.dispose()
        pmrem.dispose()
      }
      scene.background = new THREE.Color("#ffffff")

      // Luce ambiente ampia — showroom luminoso
      const ambient = new THREE.AmbientLight(0xffffff, 0.3)
      scene.add(ambient)
      state.ambientLight = ambient

      // Luce principale dall'alto (spot salone)
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
      dirLight.position.set(4, 10, 5)
      if (!isWebGPU) {
        dirLight.castShadow = true
        dirLight.shadow.mapSize.width = 2048
        dirLight.shadow.mapSize.height = 2048
        dirLight.shadow.camera.near = 0.5
        dirLight.shadow.camera.far = 50
        dirLight.shadow.bias = -0.0005
      }
      scene.add(dirLight)
      state.directionalLight = dirLight

      // Fill light laterale sinistra
      const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.2)
      dirLight2.position.set(-6, 5, -3)
      scene.add(dirLight2)



      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js")
      if (state.disposed) return

      // OrbitControls — solo zoom/pinch, rotazione disabilitata (la fa il drag sul modello)
      const controls = new OrbitControls(camera, canvas!)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.enableRotate = false
      controls.enablePan = false
      controls.minDistance = 1.5
      controls.maxDistance = 25
      state.controls = controls

      // ── Drag per ruotare il modello (solo asse Y) ────────────────────
      let isDragging = false, prevPX = 0, prevPY = 0
      let rotVelY = 0

      const onPointerDown = (e: PointerEvent) => {
        isDragging = true
        prevPX = e.clientX; prevPY = e.clientY
        rotVelY = 0

        // Spegni auto-rotazione al touch
        state.autoRotate = false
        setAutoRotate(false)

        // (Re)avvia il timer di ripristino a 30 secondi
        if (autoRestoreTimerRef.current) clearTimeout(autoRestoreTimerRef.current)
        autoRestoreTimerRef.current = setTimeout(() => {
          autoRestoreTimerRef.current = null
          state.autoRotate = true
          setAutoRotate(true)
        }, 30_000)

        ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
      }
      const onPointerMove = (e: PointerEvent) => {
        if (!isDragging || !state.modelGroup) return
        const dx = e.clientX - prevPX
        prevPX = e.clientX; prevPY = e.clientY
        rotVelY = dx * 0.008
        state.modelGroup.rotation.y += rotVelY
        state.modelGroup.rotation.x = 0
        state.modelGroup.rotation.z = 0
      }
      const onPointerUp = () => { isDragging = false }
      canvas!.addEventListener('pointerdown', onPointerDown)
      canvas!.addEventListener('pointermove', onPointerMove)
      canvas!.addEventListener('pointerup', onPointerUp)
      canvas!.addEventListener('pointercancel', onPointerUp)
      // ────────────────────────────────────────────────────────────────

      function animate() {
        if (state.disposed) return
        state.frame = requestAnimationFrame(animate)
        // Inerzia + auto-rotate sul modelGroup (solo asse Y)
        if (!isDragging && state.modelGroup) {
          rotVelY *= 0.88
          state.modelGroup.rotation.y += rotVelY
          state.modelGroup.rotation.x = 0
          state.modelGroup.rotation.z = 0
          if (state.autoRotate) state.modelGroup.rotation.y += 0.002
        }
        controls.update()
        if (state.composer) {
          state.composer.render()
        } else {
          renderer.render(scene, camera)
        }

        // ── Gizmo assi — inset in alto a destra ─────────────────────
        // Gizmo orientato sulla camera: mostra gli assi mondo come visti dal punto di vista della camera
        if (state.camera) gizmoGroup.quaternion.copy(state.camera.quaternion).conjugate()
        const cw = renderer.domElement.clientWidth   // CSS px (setViewport li gestisce internamente)
        const ch = renderer.domElement.clientHeight
        const gs = 200
        renderer.setViewport(cw - gs, ch - gs, gs, gs)
        renderer.setScissor(cw - gs, ch - gs, gs, gs)
        renderer.setScissorTest(true)
        renderer.autoClear = false   // non cancellare la scena principale nel corner
        renderer.clearDepth()
        renderer.render(gizmoScene, gizmoCamera)
        renderer.autoClear = true
        renderer.setScissorTest(false)
        renderer.setViewport(0, 0, cw, ch)
        // ─────────────────────────────────────────────────────────────
      }
      animate()

      const handleResize = () => {
        if (state.disposed || !container) return
        const w = container.clientWidth
        const h = container.clientHeight
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
        const dpr = renderer.getPixelRatio()
        state.composer?.setSize(w * dpr, h * dpr)
      }
      resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(container)

      setReady(true)
    }

    init()

    return () => {
      state.disposed = true
      if (autoRestoreTimerRef.current) { clearTimeout(autoRestoreTimerRef.current); autoRestoreTimerRef.current = null }
      if (resizeObserver) resizeObserver.disconnect()
      cancelAnimationFrame(state.frame)
      state.controls?.dispose()
      state.renderer?.dispose()
      state.renderer = null
      state.scene = null
      state.camera = null
      state.controls = null
      state.placeholderMesh = null
      state.currentModel = null
      state.meshMap.clear()
    }
  }, [])

  const loadModel = useCallback(async () => {
    const state = stateRef.current
    if (!modelUrl || !state.scene) return

    setModelLoading(true)

    try {
      const THREE = await import("three")
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js")
      const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js")

      const manager = new THREE.LoadingManager()

      if (fileMap && fileMap.size > 0) {
        manager.setURLModifier((url: string) => {
          const fileName = url.split("/").pop()?.split("?")[0] || ""
          if (fileMap.has(url)) return fileMap.get(url)!
          if (fileMap.has(fileName)) return fileMap.get(fileName)!
          const decoded = decodeURIComponent(fileName)
          if (fileMap.has(decoded)) return fileMap.get(decoded)!
          return url
        })
      }

      const loader = new GLTFLoader(manager)
      const dracoLoader = new DRACOLoader()
      dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
      loader.setDRACOLoader(dracoLoader)

      const gltf = await new Promise<any>((resolve, reject) => {
        loader.load(modelUrl, resolve, undefined, reject)
      })

      if (state.placeholderMesh) {
        state.scene.remove(state.placeholderMesh)
        state.placeholderMesh.geometry?.dispose()
        state.placeholderMesh.material?.dispose()
        state.placeholderMesh = null
      }

      if (state.currentModel) {
        ;(state.modelGroup || state.scene).remove(state.currentModel)
        state.currentModel.traverse((child: any) => {
          if (child.geometry) child.geometry.dispose()
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material]
            mats.forEach((m: any) => m.dispose())
          }
        })
      }
      state.meshMap.clear()

      const model = gltf.scene

      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const scale = 3 / maxDim
      model.scale.setScalar(scale)
      model.position.x = -center.x * scale
      model.position.z = -center.z * scale

      // Ricalcola il bounding box dopo lo scaling e posiziona il fondo a y=0
      const boxScaled = new THREE.Box3().setFromObject(model)
      model.position.y = -boxScaled.min.y


      const sceneNodes: SceneNode[] = []
      const allNodeNames: string[] = []
      let meshIndex = 0

      model.traverse((child: any) => {
        if (child.name) allNodeNames.push(child.name) // Salviamo i nomi per l'analisi dinamica

        if (child.isMesh) {
          child.castShadow = !state.isWebGPU
          child.receiveShadow = !state.isWebGPU

          if (child.material) {
            child.material = child.material.clone()
          }

          const id = `mesh_${meshIndex++}`
          const mat = child.material
          const colorHex = mat.color ? "#" + mat.color.getHexString() : "#ffffff"
          const emissiveHex = mat.emissive ? "#" + mat.emissive.getHexString() : "#000000"

          state.meshMap.set(id, {
            mesh: child,
            originalColor: colorHex,
            originalEmissive: emissiveHex,
          })

          sceneNodes.push({
            id,
            name: child.name || `Mesh ${meshIndex}`,
            materialName: mat.name || `Material_${meshIndex}`,
            originalColor: colorHex,
          })
        }
      })

      if (state.modelGroup) {
        state.modelGroup.rotation.set(0, 0, 0)  // reset rotazione al caricamento nuovo modello
        state.modelGroup.add(model)
      } else {
        state.scene.add(model)
      }
      state.currentModel = model

      // Nascondi tutte le lettere sovrapposte — visibili solo su selezione
      model.traverse((node: any) => {
        if (node.name && node.name.startsWith("Letters_F_")) {
          node.visible = false
        }
      })

      // Passiamo anche l'array di tutti i nomi per poterli estrarre in page.tsx
      onSceneReady({ nodes: sceneNodes, allNodeNames })

      if (state.controls) {
        state.controls.target.set(0, (boxScaled.max.y - boxScaled.min.y) / 2, 0)
        state.controls.update()
      }
    } catch (err) {
      console.error("[v0] Error loading GLTF model:", err)
    } finally {
      setModelLoading(false)
    }
  }, [modelUrl, fileMap, onSceneReady])

  useEffect(() => {
    if (ready && modelUrl) {
      loadModel()
    }
  }, [ready, modelUrl, loadModel])

  useEffect(() => {
    stateRef.current.autoRotate = autoRotate
  }, [autoRotate])

  return (
      <div ref={containerRef} className="relative h-full w-full bg-background">
        <canvas ref={canvasRef} className="h-full w-full block cursor-grab active:cursor-grabbing" />

        {!ready && <LoadingOverlay />}

        {modelLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10">
              <div className="flex items-center gap-3 rounded-lg bg-card px-4 py-3 shadow-lg">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-foreground font-sans">
              Caricamento modello...
            </span>
              </div>
            </div>
        )}

        {/* Renderer Badge + Auto-rotate toggle */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 z-10">
          <div className="flex items-center gap-2 rounded-md bg-card/80 border border-border px-2.5 py-1.5 shadow-sm">
            <div
                className={`h-2 w-2 rounded-full ${
                    rendererType === "webgpu"
                        ? "bg-emerald-400"
                        : rendererType === "webgl"
                            ? "bg-amber-400"
                            : "bg-muted-foreground animate-pulse"
                }`}
            />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {rendererType === "loading" ? "Detecting..." : rendererType}
            </span>
          </div>

          <button
              onClick={handleAutoRotateToggle}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 shadow-sm transition-all duration-150 active:scale-95 ${
                  autoRotate
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card/80 border-border text-muted-foreground hover:bg-card"
              }`}
              title={autoRotate ? "Ferma rotazione" : "Avvia rotazione"}
          >
            <RotateCcw className={`h-3 w-3 ${autoRotate ? "animate-spin" : ""}`} style={autoRotate ? { animationDuration: "3s" } : {}} />
            <span className="text-[10px] font-mono uppercase tracking-wider">
              {autoRotate ? "On" : "Off"}
            </span>
          </button>
        </div>

        {!modelUrl && ready && !modelLoading && <EmptyState />}
      </div>
  )
})

export default Viewer3D