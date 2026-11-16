-- Startet die Verbindung zum Copper-Deck-Helper im Hintergrund.
local LrTasks = import 'LrTasks'
local Bridge = require 'Bridge'

LrTasks.startAsyncTask(function()
  Bridge.run()
end)
