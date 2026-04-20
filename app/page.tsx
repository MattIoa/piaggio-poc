"use client"

import { useState, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import ConfigSidebar from "@/components/configurator/config-sidebar"
import type { SceneNode, ViewerHandle, LightConfig, SceneMetadata } from "@/components/configurator/viewer-3d"

const Viewer3D = dynamic(() => import("@/components/configurator/viewer-3d"), {
    ssr: false,
    loading: () => (
        <div className="flex h-full w-full items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-xs text-muted-foreground font-sans">
                    Inizializzazione renderer...
                </p>
            </div>
        </div>
    ),
})

const DEFAULT_LIGHTS: LightConfig = {
    ambientColor: "#ffffff",
    ambientIntensity: 0.6,
    directionalColor: "#ffffff",
    directionalIntensity: 1.2,
}

// ----------------------------------------------------------------------
// CONFIGURAZIONE SOVRASCRIVIBILE (Per adattarsi a Prada, Gucci, ecc.)
// ----------------------------------------------------------------------
export const NAMING_CONFIG = {
    modelGroupPrefix: "prada_galleria_grp_", // Cambia questo se usi un altro modello base
    logoGroupPrefix: "logo_",               // Prefisso per i loghi
    leatherMaterialName: "leather_shd",     // Nome del materiale della pelle da texturizzare
    textureBasePath: "/models/M7Y8_Pelle_BC_" // Prefisso dei file immagine fisici su server
}

// Texture della pelle fisicamente presenti in cartella
const LEATHER_TEXTURES = [
    { id: "Mango", label: "Pelle Mango" },
    { id: "Papaya", label: "Pelle Papaya" },
    { id: "Nero", label: "Saffiano Nero" },
    { id: "Rosso", label: "Pelle Rossa" },
]

// Mappatura per rendere belli da leggere i loghi trovati
const LOGO_LABELS: Record<string, string> = {
    "S": "Smaltato",
    "L": "Pelle",
    "P": "Pietre",
    "C": "Cristalli"
}

// Mappatura misure borsa (suffix GLTF → etichetta leggibile)
const MODEL_SIZE_LABELS: Record<string, string> = {
    "1ba906": "Piccola",
    "1ba896": "Media",
    "1ba863": "Grande",
}

// Modelli statici presenti in /public/models/
const STATIC_MODELS = [
    { id: "vespa_pbr",       label: "Vespa PBR",       url: "/models/vespa_pbr.glb" },
    { id: "vespa_sketchfab", label: "Vespa Sketchfab",  url: "/models/vespa_sketchfab.glb" },
    { id: "aprilia_rs660",   label: "Aprilia RS 660",   url: "/models/aprilia_rs660.glb" },
]
// ----------------------------------------------------------------------

export default function ConfiguratorPage() {
    const viewerRef = useRef<ViewerHandle>(null)

    const [selectedStaticModel, setSelectedStaticModel] = useState("vespa_pbr")
    const [modelUrl, setModelUrl] = useState<string | null>("/models/vespa_pbr.glb")
    const [fileMap, setFileMap] = useState<Map<string, string> | null>(null)
    const [fileName, setFileName] = useState<string | null>("vespa_pbr.glb")
    const [sceneNodes, setSceneNodes] = useState<SceneNode[]>([])
    const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null)
    const [lightConfig, setLightConfig] = useState<LightConfig>(DEFAULT_LIGHTS)
    const [worldConfig, setWorldConfig] = useState({ backgroundColor: "#ffffff", envIntensity: 1.0 })

    // STATI ESTRATTI DINAMICAMENTE DAL GLTF
    const [availableModels, setAvailableModels] = useState<string[]>([])
    const [availableLogos, setAvailableLogos] = useState<string[]>([])

    // SELEZIONI UTENTE CORRENTI
    const [activeModel, setActiveModel] = useState<string>("")
    const [logoType, setLogoType] = useState<string>("")
    const [logoPosition, setLogoPosition] = useState<string>("C") // Fisso a Center
    const [leatherType, setLeatherType] = useState<string>(LEATHER_TEXTURES[0].id)

    const handleModelLoad = useCallback(
        (url: string, name: string, map: Map<string, string>) => {
            if (fileMap) fileMap.forEach((blobUrl) => URL.revokeObjectURL(blobUrl))
            setModelUrl(url)
            setFileName(name)
            setFileMap(map)
            setSceneNodes([])
            setSelectedGroupName(null)
            setLightConfig(DEFAULT_LIGHTS)
        },
        [fileMap]
    )

    // ESTREZIONE DINAMICA DELLE OPZIONI AL CARICAMENTO DELLA SCENA
    const handleSceneReady = useCallback((metadata: SceneMetadata) => {
        setSceneNodes(metadata.nodes)

        const modelsSet = new Set<string>()
        const logosSet = new Set<string>()

        metadata.allNodeNames.forEach(name => {
            // Trova le misure/modelli (es. estrae "1BA906" da "prada_galleria_grp_1BA906")
            if (name.startsWith(NAMING_CONFIG.modelGroupPrefix)) {
                const suffix = name.replace(NAMING_CONFIG.modelGroupPrefix, "")
                modelsSet.add(suffix)
            }

            // Trova i tipi di logo (es. estrae "S" da "logo_S_C_grp_1BA906")
            if (name.startsWith(NAMING_CONFIG.logoGroupPrefix) && name.includes("_grp_")) {
                const parts = name.split("_")
                if (parts.length > 1) logosSet.add(parts[1])
            }
        })

        const modelArray = Array.from(modelsSet)
        const logoArray = Array.from(logosSet)

        setAvailableModels(modelArray)
        setAvailableLogos(logoArray)

        // Seleziona automaticamente il primo modello/logo disponibile
        const initialModel = modelArray.length > 0 ? modelArray[0] : ""
        const initialLogo = logoArray.length > 0 ? logoArray[0] : ""

        setActiveModel(initialModel)
        setLogoType(initialLogo)

        // Imposta la visibilità nel visualizzatore 3D
        if (viewerRef.current && initialModel) {
            viewerRef.current.setModelVisibility(initialModel, NAMING_CONFIG.modelGroupPrefix)
            if (initialLogo) {
                viewerRef.current.setLogoVisibility(initialModel, initialLogo, logoPosition, NAMING_CONFIG.logoGroupPrefix)
            }
        }
    }, [logoPosition])

    const applyModelChange = useCallback((newModel: string) => {
        setActiveModel(newModel)
        if (viewerRef.current) {
            viewerRef.current.setModelVisibility(newModel, NAMING_CONFIG.modelGroupPrefix)
            viewerRef.current.setLogoVisibility(newModel, logoType, logoPosition, NAMING_CONFIG.logoGroupPrefix)
        }
    }, [logoType, logoPosition])

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        applyModelChange(e.target.value)
    }

    const handleLogoTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        applyLogoChange(e.target.value)
    }

    // Applicazione programmatica della texture — usata sia dal select che dall'AI
    const applyLeatherTexture = useCallback(async (textureId: string) => {
        setLeatherType(textureId)
        if (viewerRef.current) {
            const leatherNodes = sceneNodes.filter(n => n.materialName === NAMING_CONFIG.leatherMaterialName)
            const textures = { baseColorMap: `${NAMING_CONFIG.textureBasePath}${textureId}.jpg` }
            for (const node of leatherNodes) {
                await viewerRef.current.setNodeTextures(node.id, textures)
            }
        }
    }, [sceneNodes])

    const handleLeatherTextureChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        void applyLeatherTexture(e.target.value)
    }

    // Applicazione programmatica del logo — usata sia dal select che dall'AI
    const applyLogoChange = useCallback((newLogoType: string) => {
        setLogoType(newLogoType)
        if (viewerRef.current) {
            viewerRef.current.setLogoVisibility(activeModel, newLogoType, logoPosition, NAMING_CONFIG.logoGroupPrefix)
        }
    }, [activeModel, logoPosition])

    // --- Funzioni Originali per la Sidebar ---
    const handleSelectGroup = useCallback((name: string | null) => {
        setSelectedGroupName(name)
        if (name) {
            const firstNode = sceneNodes.find((n) => n.materialName === name)
            viewerRef.current?.highlightNode(firstNode?.id ?? null)
        } else {
            viewerRef.current?.highlightNode(null)
        }
    }, [sceneNodes])

    const handleChangeGroupColor = useCallback((nodeIds: string[], color: string) => {
        for (const id of nodeIds) viewerRef.current?.setNodeColor(id, color)
    }, [])

    const handleResetGroupColor = useCallback((nodeIds: string[]) => {
        for (const id of nodeIds) viewerRef.current?.resetNodeColor(id)
    }, [])

    const handleLightChange = useCallback((config: LightConfig) => {
        setLightConfig(config)
        viewerRef.current?.updateLights(config)
    }, [])

    const applyEngravingLetters = useCallback((letters: string[]) => {
        viewerRef.current?.setEngravingLetters(activeModel, letters)
    }, [activeModel])

    const handleWorldChange = useCallback((config: { backgroundColor: string; envIntensity: number }) => {
        setWorldConfig(config)
        viewerRef.current?.updateWorld({ backgroundColor: config.backgroundColor, envIntensity: config.envIntensity })
    }, [])

    const handleChangeGroupRoughness = useCallback((nodeIds: string[], roughness: number) => {
        for (const id of nodeIds) viewerRef.current?.setNodeRoughness(id, roughness)
    }, [])

    const handleToggleGroupVisibility = useCallback((nodeIds: string[], visible: boolean) => {
        for (const id of nodeIds) viewerRef.current?.setNodeVisibility(id, visible)
    }, [])

    const handleStaticModelSelect = useCallback((id: string) => {
        const model = STATIC_MODELS.find(m => m.id === id)
        if (!model) return
        setSelectedStaticModel(id)
        if (fileMap) fileMap.forEach((blobUrl) => URL.revokeObjectURL(blobUrl))
        setModelUrl(model.url)
        setFileName(model.label)
        setFileMap(null)
        setSceneNodes([])
        setSelectedGroupName(null)
        setAvailableModels([])
        setAvailableLogos([])
    }, [fileMap])

    return (
        <main className="flex h-screen w-screen overflow-hidden bg-background">
            <div className="relative flex-1 min-w-0">

                {/* SELETTORE MODELLO STATICO */}
                <div className="absolute top-4 left-4 z-20 bg-card p-3 rounded-lg shadow-lg border border-border w-[220px]">
                    <label className="block text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
                        Modello
                    </label>
                    <select
                        value={selectedStaticModel}
                        onChange={(e) => handleStaticModelSelect(e.target.value)}
                        className="w-full bg-background border border-input rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
                    >
                        {STATIC_MODELS.map(m => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                    </select>
                </div>

                {/* INTERFACCIA GENERATA DINAMICAMENTE (bag/Prada models) */}
                {(availableModels.length > 0 || availableLogos.length > 0) && (
                    <div className="absolute top-20 left-4 z-20 flex flex-col gap-4 bg-card p-4 rounded-lg shadow-lg border border-border w-[220px]">

                        {/* Selettore Misura (Generato dal GLTF) */}
                        {availableModels.length > 0 && (
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                                    Misura Borsa
                                </label>
                                <select
                                    value={activeModel}
                                    onChange={handleModelChange}
                                    className="w-full bg-background border border-input rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
                                >
                                    {availableModels.map(model => (
                                        <option key={model} value={model}>Modello {model}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Selettore Logo (Generato dal GLTF) */}
                        {availableLogos.length > 0 && (
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                                    Tipologia Logo
                                </label>
                                <select
                                    value={logoType}
                                    onChange={handleLogoTypeChange}
                                    className="w-full bg-background border border-input rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
                                >
                                    {availableLogos.map(logo => (
                                        <option key={logo} value={logo}>
                                            {LOGO_LABELS[logo] || `Logo ${logo}`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Selettore Texture Pelle (Dalla costante LEATHER_TEXTURES) */}
                        <div>
                            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                                Texture Pelle
                            </label>
                            <select
                                value={leatherType}
                                onChange={handleLeatherTextureChange}
                                className="w-full bg-background border border-input rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
                            >
                                {LEATHER_TEXTURES.map(tex => (
                                    <option key={tex.id} value={tex.id}>{tex.label}</option>
                                ))}
                            </select>
                        </div>

                    </div>
                )}

                <Viewer3D
                    ref={viewerRef}
                    modelUrl={modelUrl}
                    fileMap={fileMap}
                    onSceneReady={handleSceneReady}
                />
            </div>

            <aside className="w-[320px] shrink-0 border-l border-border overflow-hidden">
                <ConfigSidebar
                    onModelLoad={handleModelLoad}
                    currentFileName={fileName}
                    sceneNodes={sceneNodes}
                    selectedGroupName={selectedGroupName}
                    onSelectGroup={handleSelectGroup}
                    onChangeGroupColor={handleChangeGroupColor}
                    onResetGroupColor={handleResetGroupColor}
                    lightConfig={lightConfig}
                    onLightChange={handleLightChange}
                    leatherTextures={LEATHER_TEXTURES}
                    logoOptions={availableLogos.map(id => ({ id, label: LOGO_LABELS[id] || id }))}
                    onChangeTexture={applyLeatherTexture}
                    onChangeLogo={applyLogoChange}
                    onSetEngravingLetters={applyEngravingLetters}
                    modelOptions={availableModels.map(id => ({ id, label: MODEL_SIZE_LABELS[id] || id }))}
                    onChangeModel={applyModelChange}
                    worldConfig={worldConfig}
                    onWorldChange={handleWorldChange}
                    onChangeGroupRoughness={handleChangeGroupRoughness}
                    onToggleGroupVisibility={handleToggleGroupVisibility}
                />
            </aside>
        </main>
    )
}