"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import ModelUploader from "./model-uploader"
import { Paintbrush, Layers, Sun, Box, RotateCcw, Mic, MicOff, Send, PenLine, Globe, Eye, EyeOff } from "lucide-react"
import type { SceneNode, LightConfig } from "./viewer-3d"
import { resolveAICommand } from "@/lib/openai-color-command"

/** A group of nodes sharing the same materialName */
interface NodeGroup {
  materialName: string
  nodeIds: string[]
  originalColor: string
  count: number
}

interface ConfigSidebarProps {
  onModelLoad: (url: string, fileName: string, fileMap: Map<string, string>) => void
  currentFileName: string | null
  sceneNodes: SceneNode[]
  selectedGroupName: string | null
  onSelectGroup: (name: string | null) => void
  onChangeGroupColor: (nodeIds: string[], color: string) => void
  onResetGroupColor: (nodeIds: string[]) => void
  lightConfig: LightConfig
  onLightChange: (config: LightConfig) => void
  // Opzioni per i comandi AI
  leatherTextures: { id: string; label: string }[]
  logoOptions: { id: string; label: string }[]
  onChangeTexture: (textureId: string) => Promise<void>
  onChangeLogo: (logoType: string) => void
  // Incisione
  onSetEngravingLetters: (letters: string[]) => void
  // Misura borsa
  modelOptions: { id: string; label: string }[]
  onChangeModel: (modelSuffix: string) => void
  // Mondo
  worldConfig: { backgroundColor: string; envIntensity: number }
  onWorldChange: (config: { backgroundColor: string; envIntensity: number }) => void
  // Roughness del gruppo selezionato
  onChangeGroupRoughness: (nodeIds: string[], roughness: number) => void
  // Visibilità
  onToggleGroupVisibility: (nodeIds: string[], visible: boolean) => void
}

function buildGroups(nodes: SceneNode[]): NodeGroup[] {
  const map = new Map<string, NodeGroup>()
  for (const node of nodes) {
    const key = node.materialName
    const existing = map.get(key)
    if (existing) {
      existing.nodeIds.push(node.id)
      existing.count++
    } else {
      map.set(key, {
        materialName: key,
        nodeIds: [node.id],
        originalColor: node.originalColor,
        count: 1,
      })
    }
  }
  return Array.from(map.values())
}

export default function ConfigSidebar({
  onModelLoad,
  currentFileName,
  sceneNodes,
  selectedGroupName,
  onSelectGroup,
  onChangeGroupColor,
  onResetGroupColor,
  lightConfig,
  onLightChange,
  leatherTextures,
  logoOptions,
  onChangeTexture,
  onChangeLogo,
  onSetEngravingLetters,
  modelOptions,
  onChangeModel,
  worldConfig,
  onWorldChange,
  onChangeGroupRoughness,
  onToggleGroupVisibility,
}: ConfigSidebarProps) {
  const [openAiApiKey, setOpenAiApiKey] = useState("sk-proj-your-openai-key")
  const [chatPrompt, setChatPrompt] = useState("")
  const [assistantStatus, setAssistantStatus] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<any>(null)

  // Incisione (max 3 lettere)
  const [engravingLetters, setEngravingLettersState] = useState<string[]>([])
  // Roughness del gruppo selezionato
  const [groupRoughness, setGroupRoughness] = useState<number>(0.5)
  useEffect(() => { setGroupRoughness(0.5) }, [selectedGroupName])

  // Visibilità gruppi
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set())
  useEffect(() => { setHiddenGroups(new Set()) }, [sceneNodes])

  const groups = buildGroups(sceneNodes)
  const groupLabelList = useMemo(
    () => groups.map((group) => group.materialName),
    [groups]
  )

  const findGroupFromLabel = (label: string): NodeGroup | null => {
    const normalized = label.trim().toLowerCase()
    if (!normalized) return null

    const exact = groups.find((group) => group.materialName.toLowerCase() === normalized)
    if (exact) return exact

    const contains = groups.find((group) =>
      group.materialName.toLowerCase().includes(normalized)
    )
    if (contains) return contains

    return (
      groups.find((group) => normalized.includes(group.materialName.toLowerCase())) || null
    )
  }

  const runPrompt = async (prompt: string) => {
    if (!prompt.trim()) {
      setAssistantStatus("Inserisci una richiesta.")
      return
    }
    if (!openAiApiKey.trim()) {
      setAssistantStatus("Inserisci una OpenAI API key valida.")
      return
    }

    try {
      setIsProcessing(true)
      setAssistantStatus("Elaborazione in corso...")

      const commands = await resolveAICommand({
        apiKey: openAiApiKey,
        userMessage: prompt,
        materialLabels: groupLabelList,
        textureOptions: leatherTextures,
        logoOptions,
        modelOptions,
      })

      const applied: string[] = []

      for (const command of commands) {
        if (command.type === "texture" && command.textureId) {
          await onChangeTexture(command.textureId)
          const label = leatherTextures.find(t => t.id === command.textureId)?.label ?? command.textureId
          applied.push(`Pelle: ${label}`)
          continue
        }

        if (command.type === "logo" && command.logoType) {
          onChangeLogo(command.logoType)
          const label = logoOptions.find(l => l.id === command.logoType)?.label ?? command.logoType
          applied.push(`Logo: ${label}`)
          continue
        }

        if (command.type === "model" && command.modelSuffix) {
          onChangeModel(command.modelSuffix)
          const label = modelOptions.find(m => m.id === command.modelSuffix)?.label ?? command.modelSuffix
          applied.push(`Misura: ${label}`)
          continue
        }

        if (command.type === "engraving" && command.letters !== undefined) {
          const letters = command.letters
          setEngravingLettersState(letters)
          onSetEngravingLetters(letters)
          applied.push(letters.length > 0 ? `Incisione: ${letters.join("")}` : "Incisione rimossa")
          continue
        }

        if (command.type === "color" && command.targetLabel && command.color) {
          if (groups.length === 0) continue
          const matchedGroup = findGroupFromLabel(command.targetLabel)
          if (!matchedGroup) continue
          onChangeGroupColor(matchedGroup.nodeIds, command.color)
          onSelectGroup(matchedGroup.materialName)
          applied.push(`${matchedGroup.materialName} → ${command.color}`)
          continue
        }
      }

      setAssistantStatus(applied.length > 0 ? applied.join(" · ") : "Nessuna modifica applicata.")
    } catch (error) {
      setAssistantStatus(
        error instanceof Error ? error.message : "Errore durante la chiamata OpenAI"
      )
    } finally {
      setIsProcessing(false)
    }
  }

  const toggleVoice = () => {
    const SpeechRecognitionApi =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : undefined

    if (!SpeechRecognitionApi) {
      setAssistantStatus("Riconoscimento vocale non supportato in questo browser.")
      return
    }

    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }

    const recognition = new SpeechRecognitionApi()
    recognition.lang = "it-IT"
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? ""
      if (transcript) {
        setChatPrompt(transcript)
        void runPrompt(transcript)
      }
    }

    recognition.onerror = () => {
      setAssistantStatus("Errore durante l'acquisizione vocale.")
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
    setAssistantStatus("Ascolto attivo... premi di nuovo il microfono per fermare.")
  }

  const selectedGroup = groups.find((g) => g.materialName === selectedGroupName) || null
  const uniqueGroupCount = groups.length

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4">
        <Box className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-sm font-semibold text-foreground tracking-tight">
            Configuratore 3D
          </h1>
          <p className="text-[10px] text-muted-foreground">
            Carica e personalizza il tuo modello
          </p>
        </div>
      </div>

      <Separator />

      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col gap-1 p-4">
          {/* Upload Section */}
          <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
            <label className="block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              OpenAI API Key
            </label>
            <input
              type="text"
              value={openAiApiKey}
              onChange={(e) => setOpenAiApiKey(e.target.value)}
              placeholder="sk-proj-..."
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />

            <label className="block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Prompt colore
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={chatPrompt}
                onChange={(e) => setChatPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void runPrompt(chatPrompt)
                  }
                }}
                placeholder='Es: "make the tires red"'
                className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={() => void runPrompt(chatPrompt)}
                disabled={isProcessing}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent active:scale-90 transition-all duration-100 disabled:opacity-50"
                title="Invia prompt"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={toggleVoice}
                className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition-all duration-100 active:scale-90 ${
                  isListening
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-accent"
                }`}
                title={isListening ? "Ferma registrazione" : "Avvia registrazione"}
              >
                {isListening && (
                  <span className="absolute inset-0 rounded-md animate-ping bg-primary/40" />
                )}
                {isListening ? (
                  <MicOff className="relative h-3.5 w-3.5" />
                ) : (
                  <Mic className="relative h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {assistantStatus && (
              <p className="text-[10px] text-muted-foreground">{assistantStatus}</p>
            )}
          </div>

          <Separator className="my-3" />

          <div className="mb-2">
            <label className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Modello
            </label>
            <ModelUploader onModelLoad={onModelLoad} currentFileName={currentFileName} />
          </div>

          <Separator className="my-3" />

          <Accordion
            type="multiple"
            defaultValue={["components", "world", "lights", "engraving"]}
            className="w-full"
          >
            {/* Components / Meshes Section */}
            <AccordionItem value="components" className="border-b-0">
              <AccordionTrigger className="py-3 hover:no-underline">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">Componenti</span>
                  {uniqueGroupCount > 0 && (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {uniqueGroupCount}
                    </span>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                {sceneNodes.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    Nessun componente disponibile.
                    <br />
                    Carica un modello per iniziare.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {groups.map((group) => {
                      const isSelected = selectedGroupName === group.materialName
                      const isHidden = hiddenGroups.has(group.materialName)
                      return (
                        <div key={group.materialName} className="flex items-center gap-1">
                          <button
                            onClick={() =>
                              onSelectGroup(isSelected ? null : group.materialName)
                            }
                            className={`group flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-left text-xs transition-all duration-150 active:scale-[0.97] ${
                              isHidden
                                ? "opacity-40"
                                : ""
                            } ${
                              isSelected
                                ? "bg-primary/10 text-primary"
                                : "text-foreground hover:bg-accent"
                            }`}
                          >
                            {/* Color swatch */}
                            <div
                              className="h-3.5 w-3.5 shrink-0 rounded border border-border transition-transform duration-150 group-hover:scale-125"
                              style={{ backgroundColor: group.originalColor }}
                            />
                            <span className="truncate font-medium flex-1">
                              {group.materialName}
                            </span>
                            {group.count > 1 && (
                              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {group.count}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={() => {
                              const newHidden = new Set(hiddenGroups)
                              if (isHidden) {
                                newHidden.delete(group.materialName)
                              } else {
                                newHidden.add(group.materialName)
                              }
                              setHiddenGroups(newHidden)
                              onToggleGroupVisibility(group.nodeIds, isHidden)
                            }}
                            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            title={isHidden ? "Mostra componente" : "Nascondi componente"}
                          >
                            {isHidden
                              ? <EyeOff className="h-3.5 w-3.5" />
                              : <Eye className="h-3.5 w-3.5" />
                            }
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Color editor for selected group */}
                {selectedGroup && (
                  <div className="mt-3 rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Paintbrush className="h-3.5 w-3.5 text-primary" />
                        <span className="text-[11px] font-medium text-foreground truncate max-w-[160px]">
                          {selectedGroup.materialName}
                        </span>
                        {selectedGroup.count > 1 && (
                          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {selectedGroup.count} oggetti
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => onResetGroupColor(selectedGroup.nodeIds)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-100 active:scale-90"
                        title="Ripristina colore originale"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset
                      </button>
                    </div>
                    <Label className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                      Colore
                    </Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        defaultValue={selectedGroup.originalColor}
                        key={selectedGroup.materialName + "-color"}
                        onChange={(e) =>
                          onChangeGroupColor(selectedGroup.nodeIds, e.target.value)
                        }
                        className="h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5 transition-transform duration-100 hover:scale-105 active:scale-95"
                      />
                      <input
                        type="text"
                        defaultValue={selectedGroup.originalColor}
                        key={selectedGroup.materialName + "-hex"}
                        onBlur={(e) => {
                          const val = e.target.value
                          if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                            onChangeGroupColor(selectedGroup.nodeIds, val)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = (e.target as HTMLInputElement).value
                            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                              onChangeGroupColor(selectedGroup.nodeIds, val)
                            }
                          }
                        }}
                        className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="#ffffff"
                      />
                    </div>

                    <div className="mt-3 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          Roughness
                        </Label>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {groupRoughness.toFixed(2)}
                        </span>
                      </div>
                      <Slider
                        key={selectedGroup.materialName + "-roughness"}
                        value={[groupRoughness]}
                        onValueChange={([val]) => {
                          setGroupRoughness(val)
                          onChangeGroupRoughness(selectedGroup.nodeIds, val)
                        }}
                        min={0}
                        max={1}
                        step={0.01}
                      />
                    </div>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* World Section */}
            <AccordionItem value="world" className="border-b-0">
              <AccordionTrigger className="py-3 hover:no-underline">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">Mondo</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <div className="rounded-lg border border-border bg-secondary/30 p-3 flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Colore sfondo
                    </Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={worldConfig.backgroundColor}
                        onChange={(e) =>
                          onWorldChange({ ...worldConfig, backgroundColor: e.target.value })
                        }
                        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
                      />
                      <span className="text-xs font-mono text-muted-foreground">
                        {worldConfig.backgroundColor}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Intensità ambiente
                      </Label>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {worldConfig.envIntensity.toFixed(1)}
                      </span>
                    </div>
                    <Slider
                      value={[worldConfig.envIntensity]}
                      onValueChange={([val]) =>
                        onWorldChange({ ...worldConfig, envIntensity: val })
                      }
                      min={0}
                      max={3}
                      step={0.1}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Lights Section */}
            <AccordionItem value="lights" className="border-b-0">
              <AccordionTrigger className="py-3 hover:no-underline">
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">Luci</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <div className="flex flex-col gap-5">
                  {/* Ambient Light */}
                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <p className="mb-3 text-[11px] font-medium text-foreground">
                      Luce Ambientale
                    </p>

                    <div className="mb-3 flex flex-col gap-1.5">
                      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Colore
                      </Label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={lightConfig.ambientColor}
                          onChange={(e) =>
                            onLightChange({
                              ...lightConfig,
                              ambientColor: e.target.value,
                            })
                          }
                          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
                        />
                        <span className="text-xs font-mono text-muted-foreground">
                          {lightConfig.ambientColor}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          Intensita
                        </Label>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {lightConfig.ambientIntensity.toFixed(1)}
                        </span>
                      </div>
                      <Slider
                        value={[lightConfig.ambientIntensity]}
                        onValueChange={([val]) =>
                          onLightChange({
                            ...lightConfig,
                            ambientIntensity: val,
                          })
                        }
                        min={0}
                        max={3}
                        step={0.1}
                      />
                    </div>
                  </div>

                  {/* Directional Light */}
                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <p className="mb-3 text-[11px] font-medium text-foreground">
                      Luce Direzionale
                    </p>

                    <div className="mb-3 flex flex-col gap-1.5">
                      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Colore
                      </Label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={lightConfig.directionalColor}
                          onChange={(e) =>
                            onLightChange({
                              ...lightConfig,
                              directionalColor: e.target.value,
                            })
                          }
                          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
                        />
                        <span className="text-xs font-mono text-muted-foreground">
                          {lightConfig.directionalColor}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          Intensita
                        </Label>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {lightConfig.directionalIntensity.toFixed(1)}
                        </span>
                      </div>
                      <Slider
                        value={[lightConfig.directionalIntensity]}
                        onValueChange={([val]) =>
                          onLightChange({
                            ...lightConfig,
                            directionalIntensity: val,
                          })
                        }
                        min={0}
                        max={5}
                        step={0.1}
                      />
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Incisione */}
            <AccordionItem value="engraving" className="border-b-0">
              <AccordionTrigger className="py-3 hover:no-underline">
                <div className="flex items-center gap-2">
                  <PenLine className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">Incisione</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] text-muted-foreground px-1">
                    Scrivi fino a 3 lettere o usa l&apos;AI per inciderle sul ciondolino.
                  </p>

                  {/* Campo testo libero */}
                  <input
                    type="text"
                    maxLength={3}
                    value={engravingLetters.join("")}
                    onChange={(e) => {
                      const raw = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3)
                      const next = raw.split("")
                      setEngravingLettersState(next)
                      onSetEngravingLetters(next)
                    }}
                    placeholder="Es: ABC"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold tracking-[0.3em] text-foreground placeholder:text-muted-foreground placeholder:tracking-normal focus:outline-none focus:ring-1 focus:ring-primary uppercase"
                  />

                  {/* Slot lettere selezionate */}
                  <div className="flex items-center justify-center gap-2">
                    {[0, 1, 2].map((slot) => (
                      <div key={slot} className="flex flex-col items-center gap-1">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-md border text-sm font-semibold transition-all duration-100 ${
                            engravingLetters[slot]
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-dashed border-border text-muted-foreground"
                          }`}
                        >
                          {engravingLetters[slot] ?? "—"}
                        </div>
                        <span className="text-[9px] text-muted-foreground">{slot + 1}</span>
                      </div>
                    ))}
                  </div>

                  {/* Stato corrente + rimuovi tutto */}
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] text-muted-foreground">
                      {engravingLetters.length > 0
                        ? `Incisione: ${engravingLetters.join(" · ")}`
                        : "Nessuna incisione attiva"}
                    </span>
                    {engravingLetters.length > 0 && (
                      <button
                        onClick={() => {
                          setEngravingLettersState([])
                          onSetEngravingLetters([])
                        }}
                        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
                        Rimuovi
                      </button>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </ScrollArea>

      {/* Footer */}
      <Separator />
      <div className="px-5 py-3">
        <p className="text-[10px] text-muted-foreground text-center">
          WebGPU Configurator v0.1
        </p>
      </div>
    </div>
  )
}
