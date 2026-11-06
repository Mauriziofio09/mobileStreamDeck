-- Holt eine (gerade gestartete) App über System Events in den Vordergrund.
-- Nötig, weil macOS seit Version 14 Apps, die ein Hintergrundprozess öffnet,
-- nicht automatisch aktiviert ("kooperative Aktivierung").
-- argv: <bundle-id>   (nur als Argument, nie per String-Interpolation)
on run argv
	set bid to item 1 of argv
	tell application "System Events"
		repeat 40 times
			if exists (first application process whose bundle identifier is bid) then
				set frontmost of (first application process whose bundle identifier is bid) to true
				return "ok"
			end if
			delay 0.1
		end repeat
	end tell
	error "Prozess nicht gefunden" number 3
end run
