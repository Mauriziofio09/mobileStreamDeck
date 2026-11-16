--[[
  Reine Hilfsfunktionen ohne Lightroom-Abhängigkeiten: Zeilen zerlegen, Werte prüfen, JSON schreiben.

  Helper -> Plugin (eine Zeile, Tabulator-getrennt):  <id>\t<befehl>\t<arg1>\t<arg2>
  Plugin -> Helper (eine Zeile JSON):                 {"type":"result","id":"…","ok":true}
]]
local Protocol = {}

-- Erlaubte Entwicklungsregler; muss mit LR_PARAMS in shared/src/lightroom.ts übereinstimmen
-- (ein Test im Helper vergleicht beide Listen).
Protocol.PARAMS = {
  'Temperature', 'Tint', 'Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012',
  'Texture', 'Clarity2012', 'Dehaze', 'Vibrance', 'Saturation',
  'ParametricHighlights', 'ParametricLights', 'ParametricDarks', 'ParametricShadows',
  'HueAdjustmentRed', 'SaturationAdjustmentRed', 'LuminanceAdjustmentRed',
  'HueAdjustmentOrange', 'SaturationAdjustmentOrange', 'LuminanceAdjustmentOrange',
  'HueAdjustmentYellow', 'SaturationAdjustmentYellow', 'LuminanceAdjustmentYellow',
  'HueAdjustmentGreen', 'SaturationAdjustmentGreen', 'LuminanceAdjustmentGreen',
  'HueAdjustmentAqua', 'SaturationAdjustmentAqua', 'LuminanceAdjustmentAqua',
  'HueAdjustmentBlue', 'SaturationAdjustmentBlue', 'LuminanceAdjustmentBlue',
  'HueAdjustmentPurple', 'SaturationAdjustmentPurple', 'LuminanceAdjustmentPurple',
  'HueAdjustmentMagenta', 'SaturationAdjustmentMagenta', 'LuminanceAdjustmentMagenta',
  'SplitToningShadowHue', 'SplitToningShadowSaturation', 'ColorGradeShadowLum',
  'ColorGradeMidtoneHue', 'ColorGradeMidtoneSat', 'ColorGradeMidtoneLum',
  'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'ColorGradeHighlightLum',
  'ColorGradeBlending', 'SplitToningBalance',
  'Sharpness', 'SharpenRadius', 'SharpenDetail', 'SharpenEdgeMasking', 'LuminanceSmoothing', 'ColorNoiseReduction',
  'PostCropVignetteAmount', 'PostCropVignetteMidpoint', 'PostCropVignetteFeather',
  'GrainAmount', 'GrainSize', 'GrainFrequency',
}

local paramSet = {}
for _, name in ipairs(Protocol.PARAMS) do paramSet[name] = true end

function Protocol.isParam(name)
  return paramSet[name] == true
end

Protocol.FLAGS = { pick = true, reject = true, none = true }
Protocol.LABELS = { red = true, yellow = true, green = true, blue = true, purple = true, none = true }
Protocol.TOOLS = { loupe = true, crop = true, dust = true, redeye = true, masking = true }
Protocol.MODULES = { library = true, develop = true }

--- Zerlegt eine Zeile an Tabulatoren (leere Felder bleiben erhalten).
function Protocol.split(line)
  local out = {}
  line = (line or ''):gsub('[\r\n]+$', '')
  local start = 1
  while true do
    local i = string.find(line, '\t', start, true)
    if not i then
      out[#out + 1] = string.sub(line, start)
      break
    end
    out[#out + 1] = string.sub(line, start, i - 1)
    start = i + 1
  end
  return out
end

--- Endliche Zahl oder nil.
function Protocol.number(s)
  local n = tonumber(s)
  if n == nil or n ~= n or n == math.huge or n == -math.huge then return nil end
  return n
end

function Protocol.clamp(v, lo, hi)
  if lo ~= nil and v < lo then return lo end
  if hi ~= nil and v > hi then return hi end
  return v
end

-- ---------------------------------------------------------------- JSON

local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function encodeString(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    return escapes[c] or string.format('\\u%04x', string.byte(c))
  end) .. '"'
end

local function isArray(t)
  local n = 0
  for k in pairs(t) do
    if type(k) ~= 'number' or k < 1 or k % 1 ~= 0 then return false end
    n = n + 1
  end
  for i = 1, n do
    if t[i] == nil then return false end
  end
  return n > 0
end

local encode
encode = function(v)
  local t = type(v)
  if v == nil then return 'null' end
  if t == 'boolean' then return v and 'true' or 'false' end
  if t == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    if v % 1 == 0 and v > -1e15 and v < 1e15 then return string.format('%d', v) end
    return string.format('%.6g', v)
  end
  if t == 'string' then return encodeString(v) end
  if t == 'table' then
    local parts = {}
    if isArray(v) then
      for i = 1, #v do parts[#parts + 1] = encode(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    for _, k in ipairs(keys) do
      parts[#parts + 1] = encodeString(k) .. ':' .. encode(v[k])
    end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return 'null'
end
Protocol.encode = encode

--- Leeres JSON-Objekt (eine leere Lua-Tabelle würde sonst als {} geschrieben, das ist hier gewollt).
Protocol.EMPTY = {}

return Protocol
