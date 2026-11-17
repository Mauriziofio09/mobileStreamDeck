-- Wählt einen Menüeintrag in Adobe Lightroom (Cloud-Version) aus – zuverlässiger als Tastendrücke
-- (Ziffern für Sterne kommen als synthetische Taste nicht an, Menüeinträge immer).
-- Aufruf: osascript lightroom-menu.applescript <bundle-id> <menü-nr> key <zeichen> <modifier-code>
--         osascript lightroom-menu.applescript <bundle-id> <menü-nr> name <name1|name2> <untermenü1|untermenü2 oder ->
-- menü-nr: Position in der Menüleiste (3 = Datei, 4 = Bearbeiten, 5 = Foto, 6 = Ansicht).
-- modifier-code wie AXMenuItemCmdModifiers: 0 = ⌘, 1 = ⇧⌘, 8 = ohne ⌘, 9 = ⇧ ohne ⌘.
-- Suche nach Kurzbefehl statt Name: unabhängig von der Sprache von Lightroom.
-- Ausgabe: "ok", sonst Fehler mit Code (not_found, disabled, not_running).

on run argv
	set bundleId to item 1 of argv
	set topIdx to (item 2 of argv) as integer
	set mode to item 3 of argv
	set v1 to item 4 of argv
	set v2 to item 5 of argv
	tell application "System Events"
		set procs to (every application process whose bundle identifier is bundleId)
		if (count of procs) is 0 then error "not_running" number 9001
		set p to item 1 of procs
		set frontmost of p to true
		tell p
			set m to menu 1 of menu bar item topIdx of menu bar 1
			if mode is "key" then
				set hit to my findKey(m, v1, v2 as integer)
			else
				set AppleScript's text item delimiters to "|"
				set names to text items of v1
				set parents to {}
				if v2 is not "-" then set parents to text items of v2
				set AppleScript's text item delimiters to ""
				set hit to my findName(m, names, parents, (count of parents) is 0)
			end if
			if hit is missing value then error "not_found" number 9002
			if not (enabled of hit) then error "disabled" number 9003
			click hit
		end tell
	end tell
	return "ok"
end run

-- Eintrag mit Kurzbefehl (Zeichen + Modifier). Erst die Ebene selbst (alle Attribute in einem Abruf),
-- dann die Untermenüs – so sind Einträge der obersten Ebene in unter einer Sekunde gefunden.
on findKey(m, ch, mods)
	tell application "System Events"
		set items_ to menu items of m
		set n to count of items_
		if n is 0 then return missing value
		set chars to value of attribute "AXMenuItemCmdChar" of menu items of m
		set modsList to value of attribute "AXMenuItemCmdModifiers" of menu items of m
		repeat with i from 1 to n
			set k to item i of chars
			if k is not missing value then
				if (k as text) is ch then
					if (item i of modsList) is mods then return item i of items_
				end if
			end if
		end repeat
		-- Welche Einträge Untermenüs haben, in einem Abruf (Liste von Listen; leer = keins)
		set subMenus to menus of menu items of m
		repeat with i from 1 to n
			if (count of (item i of subMenus)) > 0 then
				set sub to my findKey(item 1 of (item i of subMenus), ch, mods)
				if sub is not missing value then return sub
			end if
		end repeat
	end tell
	return missing value
end findKey

-- Eintrag nach Name; mit parents nur innerhalb eines Untermenüs dieses Namens.
on findName(m, names, parents, inScope)
	tell application "System Events"
		repeat with mi in menu items of m
			set nm to missing value
			try
				set nm to name of mi
			end try
			if inScope and nm is not missing value then
				if names contains (nm as text) then return contents of mi
			end if
			try
				if (count of menus of mi) > 0 then
					set scoped to inScope
					if nm is not missing value then
						if parents contains (nm as text) then set scoped to true
					end if
					set sub to my findName(menu 1 of mi, names, parents, scoped)
					if sub is not missing value then return sub
				end if
			end try
		end repeat
	end tell
	return missing value
end findName
