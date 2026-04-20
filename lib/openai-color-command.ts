export type AICommandType = "color" | "texture" | "logo" | "engraving" | "model"

export interface AICommand {
  type: AICommandType
  targetLabel?: string   // color: nome del materiale
  color?: string         // color: hex #RRGGBB
  textureId?: string     // texture: id della texture pelle
  logoType?: string      // logo: id del tipo logo
  letters?: string[]     // engraving: max 3 lettere A-Z maiuscole ([] = rimuovi)
  modelSuffix?: string   // model: id variante borsa (es. "1ba906")
}

interface ResolveCommandParams {
  apiKey: string
  userMessage: string
  materialLabels: string[]
  textureOptions: { id: string; label: string }[]
  logoOptions: { id: string; label: string }[]
  modelOptions: { id: string; label: string }[]
}

function validateCommand(
  cmd: Partial<AICommand>,
  textureOptions: { id: string; label: string }[],
  logoOptions: { id: string; label: string }[],
  modelOptions: { id: string; label: string }[]
): AICommand {
  if (cmd.type === "texture") {
    if (!cmd.textureId) throw new Error("Comando texture senza textureId")
    const match = textureOptions.find(
      (t) => t.id.toLowerCase() === cmd.textureId!.toLowerCase()
    )
    if (!match) throw new Error(`Texture non trovata: ${cmd.textureId}`)
    return { type: "texture", textureId: match.id }
  }

  if (cmd.type === "logo") {
    if (!cmd.logoType) throw new Error("Comando logo senza logoType")
    const match = logoOptions.find(
      (l) => l.id.toLowerCase() === cmd.logoType!.toLowerCase()
    )
    if (!match) throw new Error(`Logo non trovato: ${cmd.logoType}`)
    return { type: "logo", logoType: match.id }
  }

  if (cmd.type === "model") {
    if (!cmd.modelSuffix) throw new Error("Comando model senza modelSuffix")
    const suffix = String(cmd.modelSuffix).toLowerCase()
    const match = modelOptions.find(
      (m) => m.id.toLowerCase() === suffix || m.label.toLowerCase() === suffix
    )
    if (!match) throw new Error(`Variante modello non trovata: ${cmd.modelSuffix}`)
    return { type: "model", modelSuffix: match.id }
  }

  if (cmd.type === "engraving") {
    const letters = (Array.isArray(cmd.letters) ? cmd.letters : [])
      .map((l: string) => String(l).toUpperCase().replace(/[^A-Z]/g, ""))
      .filter(Boolean)
      .slice(0, 3)
    return { type: "engraving", letters }
  }

  if (cmd.type === "color") {
    if (!cmd.targetLabel || !cmd.color) throw new Error("Comando color incompleto")
    const hex = cmd.color.trim()
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Colore non valido: ${hex}`)
    return { type: "color", targetLabel: cmd.targetLabel.trim(), color: hex }
  }

  throw new Error(`Tipo comando sconosciuto: ${cmd.type}`)
}

export async function resolveAICommand({
  apiKey,
  userMessage,
  materialLabels,
  textureOptions,
  logoOptions,
  modelOptions,
}: ResolveCommandParams): Promise<AICommand[]> {
  const textureList = textureOptions.map((t) => `"${t.id}" (${t.label})`).join(", ")
  const logoList = logoOptions.map((l) => `"${l.id}" (${l.label})`).join(", ")
  const modelList = modelOptions.map((m) => `"${m.id}" (${m.label})`).join(", ")
  const materialList = materialLabels.join(", ")

  const systemPrompt = `Sei un assistente per un configuratore 3D di veicoli.
Converti le richieste dell'utente in uno o più comandi JSON.
Restituisci SEMPRE un oggetto con chiave "commands" contenente un array di comandi.

Esistono 5 tipi di comando:

1. TEXTURE – cambia la texture o il materiale del veicolo.
   { "type": "texture", "textureId": "<id>" }
   Texture disponibili: ${textureList}

2. LOGO – cambia il tipo di logo o emblema sul veicolo.
   { "type": "logo", "logoType": "<id>" }
   Loghi disponibili: ${logoList}

3. COLOR – cambia il colore di un componente specifico del modello 3D.
   { "type": "color", "targetLabel": "<nomeComponente>", "color": "#RRGGBB" }
   Componenti disponibili: ${materialList}

4. MODEL – cambia la variante del modello 3D.
   { "type": "model", "modelSuffix": "<id>" }
   Varianti disponibili: ${modelList}
   Esempi: "piccola", "mini" → prima variante; "media", "normale" → seconda variante; "grande", "maxi" → terza variante.

5. ENGRAVING – incide fino a 3 lettere su un componente del modello.
   { "type": "engraving", "letters": ["M", "A", "T"] }
   Regole engraving:
   - Massimo 3 lettere, solo A-Z maiuscole nell'array.
   - Se l'utente fa lo spelling ("M A T", "m-a-t", "emme a ti") usa quelle lettere nell'ordine dato.
   - Se l'utente dice un nome o una parola ("matteo", "incidi LUCA"), prendi le prime 3 lettere maiuscole.
   - Se l'utente vuole rimuovere l'incisione ("togli incisione", "rimuovi lettere"), usa array vuoto: [].

Regole generali:
- Restituisci SOLO { "commands": [ ... ] } — niente altro.
- Se l'utente chiede più cose, inserisci un comando per ognuna nell'array.
- Per texture e logo usa esattamente gli id forniti (case-sensitive).
- Per color usa hex #RRGGBB.
- Se la richiesta riguarda un materiale o rivestimento preferisci "texture" su "color".

CONFIGURAZIONI E STILI:
Quando l'utente chiede uno "stile", una "configurazione" o un "look" (es. "sportivo", "elegante", "racing", "luxury", "minimalista", "aggressivo"), devi restituire PIÙ comandi che insieme creino quel look coerente. Usa TUTTE le leve disponibili: texture, logo, colore, variante, incisione.
Non limitarti a un solo comando — pensa come un designer che configura il prodotto da zero.

Esempi di ragionamento:
- "configurazione sportiva" → variante grande + texture scura/robusta + logo minimal + colori scuri/carbonio sui componenti
- "look elegante" → variante media + texture pregiata + logo raffinato + colori neutri/dorati
- "setup racing" → variante grande + colori vivaci (rosso, giallo) + texture aggressiva + logo bold
- "configurazione minimalista" → variante piccola + texture neutra + nessuna incisione + colori monocromatici`

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI API ha restituito una risposta vuota")
  }

  const parsed = JSON.parse(content) as { commands?: Partial<AICommand>[] }
  if (!Array.isArray(parsed.commands) || parsed.commands.length === 0) {
    throw new Error("Nessun comando valido nella risposta AI")
  }

  return parsed.commands.map((cmd) => validateCommand(cmd, textureOptions, logoOptions, modelOptions))
}
