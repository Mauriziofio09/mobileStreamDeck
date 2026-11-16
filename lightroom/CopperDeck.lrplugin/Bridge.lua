--[[
  Verbindung zum Copper-Deck-Helper.

  Zwei lokale Sockets (LrSocket bindet nur an 127.0.0.1):
    47801  Plugin empfängt Befehle vom Helper
    47802  Plugin sendet Zustand und Antworten an den Helper
  Der Helper verbindet sich als Client und versucht es alle 2 s erneut, solange Lightroom läuft.

  Alle Befehle stammen aus einer festen Liste (Protocol.lua). Es gibt keinen Weg, beliebigen Code
  oder beliebige Entwicklungseinstellungen auszuführen.
]]
local LrApplication = import 'LrApplication'
local LrApplicationView = import 'LrApplicationView'
local LrDevelopController = import 'LrDevelopController'
local LrFunctionContext = import 'LrFunctionContext'
local LrSelection = import 'LrSelection'
local LrSocket = import 'LrSocket'
local LrTasks = import 'LrTasks'
local LrUndo = import 'LrUndo'

local Protocol = require 'Protocol'

local PORT_IN = 47801
local PORT_OUT = 47802
local POLL_SECONDS = 0.25
-- Regler mit fotoabhängigem Bereich (Raw: Kelvin, JPEG: -100…100)
local RANGE_PARAMS = { 'Temperature', 'Tint' }

local Bridge = { running = false }

local sender = nil
local senderConnected = false
local last = { photoKey = nil, module = nil, values = {}, presetsSent = false }
local beforeAfter = false

local function send(message)
  if sender ~= nil and senderConnected then
    sender:send(Protocol.encode(message) .. '\n')
  end
end

local function reply(id, ok, message)
  send({ type = 'result', id = id, ok = ok, message = message })
end

-- ---------------------------------------------------------------- Zustand

local function currentPhoto()
  local catalog = LrApplication.activeCatalog()
  local photo = catalog:getTargetPhoto()
  if photo == nil then return nil, nil end
  local pick = photo:getRawMetadata('pickStatus') or 0
  local flag = 'none'
  if pick == 1 then flag = 'pick' elseif pick == -1 then flag = 'reject' end
  local label = photo:getRawMetadata('colorNameForLabel') or 'none'
  if not Protocol.LABELS[label] then label = 'none' end
  local info = {
    name = photo:getFormattedMetadata('fileName') or '',
    rating = photo:getRawMetadata('rating') or 0,
    flag = flag,
    label = label,
  }
  local key = tostring(photo.localIdentifier) .. '|' .. info.rating .. '|' .. flag .. '|' .. label
  return info, key
end

local function readValues()
  local values = {}
  for _, name in ipairs(Protocol.PARAMS) do
    local ok, v = pcall(LrDevelopController.getValue, name)
    if ok and type(v) == 'number' then values[name] = v end
  end
  return values
end

local function readRanges()
  local ranges = {}
  for _, name in ipairs(RANGE_PARAMS) do
    local ok, lo, hi = pcall(LrDevelopController.getRange, name)
    if ok and type(lo) == 'number' and type(hi) == 'number' then ranges[name] = { lo, hi } end
  end
  return ranges
end

--- Sendet den vollständigen Zustand (bei neuem Foto, Moduswechsel oder neuer Verbindung).
local function sendState()
  local module = LrApplicationView.getCurrentModuleName()
  local photo = currentPhoto()
  local values, ranges = Protocol.EMPTY, Protocol.EMPTY
  if module == 'develop' and photo ~= nil then
    values = readValues()
    ranges = readRanges()
  end
  last.values = values
  send({
    type = 'state', module = module, photo = photo, values = values, ranges = ranges,
    beforeAfter = beforeAfter, lrVersion = LrApplication.versionString(),
  })
end

--- Alle POLL_SECONDS: Foto, Modul und (im Entwickeln-Modul) geänderte Reglerwerte melden.
local function poll()
  if not senderConnected then return end
  local module = LrApplicationView.getCurrentModuleName()
  local photo, key = currentPhoto()
  if module ~= last.module or key ~= last.photoKey then
    last.module = module
    last.photoKey = key
    sendState()
    return
  end
  if module == 'develop' and photo ~= nil then
    local values = readValues()
    local changed, any = {}, false
    for name, v in pairs(values) do
      if last.values[name] ~= v then
        changed[name] = v
        any = true
      end
    end
    if any then
      last.values = values
      send({ type = 'values', values = changed })
    end
  end
end

local function sendPresets()
  local folders = {}
  for _, folder in ipairs(LrApplication.developPresetFolders()) do
    local presets = {}
    for _, preset in ipairs(folder:getDevelopPresets()) do
      presets[#presets + 1] = { id = preset:getUuid(), name = preset:getName() }
    end
    if #presets > 0 then folders[#folders + 1] = { name = folder:getName(), presets = presets } end
  end
  send({ type = 'presets', folders = folders })
end

-- ---------------------------------------------------------------- Befehle

local function ensureDevelop()
  if LrApplicationView.getCurrentModuleName() ~= 'develop' then
    LrApplicationView.switchToModule('develop')
    LrTasks.sleep(0.3)
  end
end

local function needPhoto()
  return LrApplication.activeCatalog():getTargetPhoto() ~= nil
end

--- Führt einen Befehl aus; Rückgabe: nil bei Erfolg, sonst Fehlertext.
local function execute(cmd, a, b)
  if cmd == 'set' or cmd == 'inc' or cmd == 'dec' or cmd == 'reset' then
    if not Protocol.isParam(a) then return 'Unbekannter Regler' end
    if not needPhoto() then return 'Kein Foto ausgewählt' end
    ensureDevelop()
    if cmd == 'set' then
      local v = Protocol.number(b)
      if v == nil then return 'Ungültiger Wert' end
      local lo, hi = LrDevelopController.getRange(a)
      LrDevelopController.setValue(a, Protocol.clamp(v, lo, hi))
    elseif cmd == 'inc' then
      LrDevelopController.increment(a)
    elseif cmd == 'dec' then
      LrDevelopController.decrement(a)
    else
      LrDevelopController.resetToDefault(a)
    end
    return nil
  end

  if cmd == 'rating' then
    local n = Protocol.number(a)
    if n == nil or n < 0 or n > 5 or n % 1 ~= 0 then return 'Ungültige Bewertung' end
    if not needPhoto() then return 'Kein Foto ausgewählt' end
    if n == 0 then LrSelection.clearRating() else LrSelection.setRating(n) end
    return nil
  end

  if cmd == 'flag' then
    if not Protocol.FLAGS[a] then return 'Ungültige Markierung' end
    if not needPhoto() then return 'Kein Foto ausgewählt' end
    if a == 'pick' then LrSelection.flagAsPick() elseif a == 'reject' then LrSelection.flagAsReject() else LrSelection.removeFlag() end
    return nil
  end

  if cmd == 'label' then
    if not Protocol.LABELS[a] then return 'Ungültige Farbmarkierung' end
    if not needPhoto() then return 'Kein Foto ausgewählt' end
    LrSelection.setColorLabel(a)
    return nil
  end

  if cmd == 'nav' then
    if a == 'next' then LrSelection.nextPhoto() elseif a == 'prev' then LrSelection.previousPhoto() else return 'Ungültige Richtung' end
    return nil
  end

  if cmd == 'module' then
    if not Protocol.MODULES[a] then return 'Ungültiges Modul' end
    LrApplicationView.switchToModule(a)
    return nil
  end

  if cmd == 'tool' then
    if not Protocol.TOOLS[a] then return 'Ungültiges Werkzeug' end
    if not needPhoto() then return 'Kein Foto ausgewählt' end
    ensureDevelop()
    LrDevelopController.selectTool(a)
    return nil
  end

  if cmd == 'auto' then
    if not needPhoto() then return 'Kein Foto ausgewählt' end
    ensureDevelop()
    if a == 'tone' then LrDevelopController.setAutoTone()
    elseif a == 'wb' then LrDevelopController.setAutoWhiteBalance()
    else return 'Ungültige Automatik' end
    return nil
  end

  if cmd == 'resetall' then
    if not needPhoto() then return 'Kein Foto ausgewählt' end
    ensureDevelop()
    LrDevelopController.resetAllDevelopAdjustments()
    return nil
  end

  if cmd == 'beforeafter' then
    ensureDevelop()
    beforeAfter = not beforeAfter
    LrApplicationView.showView(beforeAfter and 'develop_before_after_horiz' or 'develop_loupe')
    sendState()
    return nil
  end

  if cmd == 'copy' then
    local photo = LrApplication.activeCatalog():getTargetPhoto()
    if photo == nil then return 'Kein Foto ausgewählt' end
    photo:copySettings()
    return nil
  end

  if cmd == 'paste' then
    local photos = LrApplication.activeCatalog():getTargetPhotos()
    if #photos == 0 then return 'Kein Foto ausgewählt' end
    for _, photo in ipairs(photos) do photo:pasteSettings() end
    return nil
  end

  if cmd == 'undo' then
    if not LrUndo.canUndo() then return 'Nichts zum Rückgängigmachen' end
    LrUndo.undo()
    return nil
  end

  if cmd == 'redo' then
    if not LrUndo.canRedo() then return 'Nichts zum Wiederholen' end
    LrUndo.redo()
    return nil
  end

  if cmd == 'presets' then
    sendPresets()
    return nil
  end

  if cmd == 'preset' then
    if type(a) ~= 'string' or not a:match('^[%w%-]+$') then return 'Ungültige Vorgabe' end
    local preset = LrApplication.developPresetByUuid(a)
    if preset == nil then return 'Vorgabe nicht gefunden' end
    local catalog = LrApplication.activeCatalog()
    local photos = catalog:getTargetPhotos()
    if #photos == 0 then return 'Kein Foto ausgewählt' end
    catalog:withWriteAccessDo('Copper Deck: ' .. preset:getName(), function()
      for _, photo in ipairs(photos) do photo:applyDevelopPreset(preset, _PLUGIN) end
    end, { timeout = 10 })
    return nil
  end

  if cmd == 'hello' or cmd == 'state' then
    sendState()
    return nil
  end

  return 'Unbekannter Befehl'
end

local function handle(line)
  local parts = Protocol.split(line)
  local id, cmd = parts[1], parts[2]
  if id == nil or id == '' or cmd == nil then return end
  -- Jeder Befehl in einer eigenen Aufgabe: Katalogzugriffe dürfen dort warten (yield).
  LrTasks.startAsyncTask(function()
    local ok, err = LrTasks.pcall(execute, cmd, parts[3], parts[4])
    if not ok then
      reply(id, false, 'Lightroom-Fehler: ' .. tostring(err))
    elseif err ~= nil then
      reply(id, false, err)
    else
      reply(id, true)
    end
  end)
end

-- ---------------------------------------------------------------- Lebenszyklus

function Bridge.run()
  if Bridge.running then return end
  Bridge.running = true
  LrFunctionContext.callWithContext('CopperDeckBridge', function(context)
    local receiver = LrSocket.bind {
      functionContext = context,
      plugin = _PLUGIN,
      port = PORT_IN,
      mode = 'receive',
      onMessage = function(_, message) handle(message) end,
      onClosed = function(socket) if Bridge.running then socket:reconnect() end end,
      onError = function(socket) if Bridge.running then socket:reconnect() end end,
    }
    sender = LrSocket.bind {
      functionContext = context,
      plugin = _PLUGIN,
      port = PORT_OUT,
      mode = 'send',
      onConnected = function()
        senderConnected = true
        last.photoKey = nil -- beim nächsten Poll vollständigen Zustand senden
      end,
      onClosed = function(socket)
        senderConnected = false
        if Bridge.running then socket:reconnect() end
      end,
      onError = function(socket)
        senderConnected = false
        if Bridge.running then socket:reconnect() end
      end,
    }
    while Bridge.running do
      LrTasks.pcall(poll)
      LrTasks.sleep(POLL_SECONDS)
    end
    senderConnected = false
    receiver:close()
    sender:close()
    sender = nil
  end)
end

function Bridge.stop()
  Bridge.running = false
end

return Bridge
