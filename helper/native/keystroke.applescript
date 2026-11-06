-- Sendet eine Tastenkombination über System Events.
-- Werte kommen ausschliesslich als Argumente (on run argv), nie per String-Interpolation.
-- argv: <taste> [modifier ...]
--   taste: einzelnes Zeichen (keystroke, folgt dem aktiven Tastaturlayout, z. B. Schweizerdeutsch)
--          oder "code:<n>" für layoutunabhängige Sondertasten (Pfeile, F-Tasten, Return …)
--   modifier: command | option | control | shift
on run argv
	if (count of argv) < 1 then error "keine Taste" number 1
	set theKey to item 1 of argv
	set mods to {}
	repeat with i from 2 to count of argv
		set m to item i of argv
		if m is "command" then
			set end of mods to command down
		else if m is "option" then
			set end of mods to option down
		else if m is "control" then
			set end of mods to control down
		else if m is "shift" then
			set end of mods to shift down
		else
			error "unbekannter Modifier" number 2
		end if
	end repeat
	tell application "System Events"
		if theKey starts with "code:" then
			key code ((text 6 thru -1 of theKey) as integer) using mods
		else
			keystroke theKey using mods
		end if
	end tell
end run
