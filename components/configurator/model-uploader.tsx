"use client"

import { useCallback, useRef, useState } from "react"
import { Upload, FileBox, Folder } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ModelUploaderProps {
  onModelLoad: (url: string, fileName: string, fileMap: Map<string, string>) => void
  currentFileName: string | null
}

export default function ModelUploader({ onModelLoad, currentFileName }: ModelUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      if (fileArray.length === 0) return

      // Build a map of filename -> blob URL for all files
      const fileMap = new Map<string, string>()

      // Find the main GLTF/GLB file
      let mainFile: File | null = null

      for (const file of fileArray) {
        // Get relative path (from webkitRelativePath or just the name)
        const relativePath = file.webkitRelativePath || file.name
        // Extract just the filename portion
        const fileName = relativePath.split("/").pop() || file.name

        const blobUrl = URL.createObjectURL(file)
        fileMap.set(fileName, blobUrl)

        // Also store with the full relative path (useful for nested structures)
        if (file.webkitRelativePath) {
          // Store path relative to the root folder
          const parts = file.webkitRelativePath.split("/")
          if (parts.length > 1) {
            // Path without the root folder name
            const withoutRoot = parts.slice(1).join("/")
            fileMap.set(withoutRoot, blobUrl)
          }
        }

        const ext = fileName.split(".").pop()?.toLowerCase()
        if (ext === "gltf" || ext === "glb") {
          mainFile = file
        }
      }

      if (!mainFile) {
        alert("Nessun file .gltf o .glb trovato. Assicurati di caricare una cartella contenente il modello.")
        // Cleanup blob URLs
        fileMap.forEach((url) => URL.revokeObjectURL(url))
        return
      }

      const mainFileName = mainFile.webkitRelativePath?.split("/").pop() || mainFile.name
      const mainUrl = fileMap.get(mainFileName)!

      onModelLoad(mainUrl, mainFileName, fileMap)
    },
    [onModelLoad]
  )

  const handleSingleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        processFiles(files)
      }
      // Reset input so same file can be selected again
      e.target.value = ""
    },
    [processFiles]
  )

  const handleFolderSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        processFiles(files)
      }
      e.target.value = ""
    },
    [processFiles]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      // Try to read as directory entries (for folder drag & drop)
      const items = e.dataTransfer.items
      if (items && items.length > 0) {
        const allFiles: File[] = []

        const readEntry = async (entry: FileSystemEntry): Promise<void> => {
          if (entry.isFile) {
            const file = await new Promise<File>((resolve, reject) => {
              (entry as FileSystemFileEntry).file(resolve, reject)
            })
            allFiles.push(file)
          } else if (entry.isDirectory) {
            const reader = (entry as FileSystemDirectoryEntry).createReader()
            const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
              reader.readEntries(resolve, reject)
            })
            for (const child of entries) {
              await readEntry(child)
            }
          }
        }

        const promises: Promise<void>[] = []
        for (let i = 0; i < items.length; i++) {
          const entry = items[i].webkitGetAsEntry?.()
          if (entry) {
            promises.push(readEntry(entry))
          }
        }

        if (promises.length > 0) {
          await Promise.all(promises)
          if (allFiles.length > 0) {
            processFiles(allFiles)
            return
          }
        }
      }

      // Fallback: plain file drop
      if (e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files)
      }
    },
    [processFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  return (
    <div className="flex flex-col gap-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-5 transition-colors ${
          isDragOver
            ? "border-primary bg-primary/10"
            : "border-border bg-secondary/30 hover:border-primary/50 hover:bg-secondary/50"
        }`}
        role="region"
        aria-label="Area di caricamento modello 3D"
      >
        <Upload
          className={`h-6 w-6 transition-colors ${
            isDragOver ? "text-primary" : "text-muted-foreground group-hover:text-primary"
          }`}
        />
        <div className="text-center">
          <p className="text-xs font-medium text-foreground">
            Trascina qui il modello o la cartella
          </p>
          <p className="text-[10px] text-muted-foreground">.gltf / .glb con texture e risorse</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-2 text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileBox className="h-3.5 w-3.5" />
          File singolo
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-2 text-xs"
          onClick={() => folderInputRef.current?.click()}
        >
          <Folder className="h-3.5 w-3.5" />
          Cartella
        </Button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".gltf,.glb"
        className="hidden"
        onChange={handleSingleFile}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        onChange={handleFolderSelect}
        {...({ webkitdirectory: "", directory: "" } as any)}
      />

      {/* Current file indicator */}
      {currentFileName && (
        <div className="flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-2">
          <FileBox className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-xs text-foreground">{currentFileName}</span>
        </div>
      )}
    </div>
  )
}
