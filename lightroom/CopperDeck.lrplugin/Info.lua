--[[
  Copper Deck – Lightroom-Classic-Plugin.
  Verbindet Lightroom Classic mit dem Copper-Deck-Helper auf demselben Rechner (nur 127.0.0.1),
  damit iPhone/iPad Regler, Bewertungen, Markierungen, Navigation und Vorgaben steuern können.
  Läuft unter macOS und Windows. Benötigt Lightroom Classic 10 oder neuer (Color-Grading-Regler).
]]
return {
  LrSdkVersion = 10.0,
  LrSdkMinimumVersion = 10.0,
  LrToolkitIdentifier = 'ch.copperdeck.lightroom',
  LrPluginName = 'Copper Deck',
  LrPluginInfoUrl = 'https://github.com/Mauriziofio09/mobileStreamDeck',
  LrInitPlugin = 'Init.lua',
  LrShutdownPlugin = 'Shutdown.lua',
  -- Beim Start von Lightroom laden, nicht erst beim ersten Menüaufruf.
  LrForceInitPlugin = true,
  VERSION = { major = 0, minor = 8, revision = 0, build = 0 },
}
