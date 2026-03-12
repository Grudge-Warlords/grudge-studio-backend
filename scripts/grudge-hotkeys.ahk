; ═══════════════════════════════════════════════════════════════
; GRUDGE STUDIO — Global Hotkeys (ALE)
; AutoHotkey v2 — Runs on startup via shell:startup shortcut
; ═══════════════════════════════════════════════════════════════
#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

; ─── CONFIG ────────────────────────────────────────────────────
GRUDGE_ROOT := "D:\GrudgeLink\OneDrive\Desktop\grudge-studio-backend"
WARP_EXE    := "C:\Users\Mary\AppData\Local\Programs\Warp\warp.exe"
AHK_EXE     := "C:\Users\Mary\AppData\Local\Programs\AutoHotkey\v2\AutoHotkey64.exe"

; ─── TRAY MENU ─────────────────────────────────────────────────
A_IconTip := "Grudge Studio Hotkeys"
TraySetIcon("shell32.dll", 13)

tray := A_TrayMenu
tray.Delete()
tray.Add("Grudge Studio Hotkeys", (*) => "")
tray.Disable("Grudge Studio Hotkeys")
tray.Add()
tray.Add("Open Project in Warp", (*) => OpenInWarp(GRUDGE_ROOT))
tray.Add("Open Project in VS Code", (*) => Run('code "' GRUDGE_ROOT '"'))
tray.Add("Health Check", (*) => RunHealthCheck())
tray.Add("Docker Status", (*) => RunDockerStatus())
tray.Add()
tray.Add("Reload", (*) => Reload())
tray.Add("Exit", (*) => ExitApp())

; ═══════════════════════════════════════════════════════════════
; HOTKEYS
; ═══════════════════════════════════════════════════════════════

; ─── Shift+RMB: Open folder of selected file/folder in Warp ──
; Works in Explorer windows
+RButton:: {
    if !WinActive("ahk_class CabinetWClass") && !WinActive("ahk_class ExploreWClass")
        return

    ; Try to get the selected item path from Explorer
    explorerPath := GetExplorerPath()
    if (explorerPath != "") {
        ; Get the selected item
        selectedItem := GetSelectedItem()
        if (selectedItem != "") {
            ; If it's a file, open its parent directory
            if FileExist(selectedItem) && !InStr(FileExist(selectedItem), "D") {
                SplitPath(selectedItem, , &parentDir)
                OpenInWarp(parentDir)
            } else {
                ; It's a directory, open it directly
                OpenInWarp(selectedItem)
            }
        } else {
            ; No selection, open current Explorer directory
            OpenInWarp(explorerPath)
        }
    }
}

; ─── Shift+LMB: Open file location (select in Explorer) ──────
; Works when you have a file path in clipboard or selected in Explorer
+LButton:: {
    if !WinActive("ahk_class CabinetWClass") && !WinActive("ahk_class ExploreWClass") {
        ; Let normal Shift+Click pass through outside Explorer
        Send("+{LButton}")
        return
    }

    selectedItem := GetSelectedItem()
    if (selectedItem != "" && FileExist(selectedItem)) {
        ; Open Explorer and select the file
        Run('explorer /select,"' selectedItem '"')
    }
}

; ─── Ctrl+Shift+G: Open grudge-studio-backend in Warp ────────
^+g:: {
    OpenInWarp(GRUDGE_ROOT)
}

; ─── Ctrl+Shift+D: Docker compose status ─────────────────────
^+d:: {
    RunDockerStatus()
}

; ─── Ctrl+Shift+H: Health check all endpoints ────────────────
^+h:: {
    RunHealthCheck()
}

; ─── Ctrl+Shift+V: Open project in VS Code ───────────────────
^+v:: {
    Run('code "' GRUDGE_ROOT '"')
}

; ─── Ctrl+Shift+W: Open Warp (no specific dir) ───────────────
^+w:: {
    Run('"' WARP_EXE '"')
}

; ═══════════════════════════════════════════════════════════════
; FUNCTIONS
; ═══════════════════════════════════════════════════════════════

OpenInWarp(dirPath) {
    global WARP_EXE
    if !DirExist(dirPath) {
        ToolTip("Directory not found: " dirPath)
        SetTimer(() => ToolTip(), -2000)
        return
    }
    ; Warp on Windows: just launch it — it opens in last dir or home
    ; Use powershell to cd first, then open Warp
    Run('"' WARP_EXE '"', dirPath)
    ToolTip("Warp → " dirPath)
    SetTimer(() => ToolTip(), -2000)
}

GetExplorerPath() {
    try {
        hwnd := WinGetID("A")
        for window in ComObject("Shell.Application").Windows {
            if (window.HWND = hwnd) {
                return window.Document.Folder.Self.Path
            }
        }
    }
    return ""
}

GetSelectedItem() {
    try {
        hwnd := WinGetID("A")
        for window in ComObject("Shell.Application").Windows {
            if (window.HWND = hwnd) {
                sel := window.Document.SelectedItems
                if (sel.Count > 0) {
                    return sel.Item(0).Path
                }
            }
        }
    }
    return ""
}

RunHealthCheck() {
    global GRUDGE_ROOT
    scriptPath := GRUDGE_ROOT "\scripts\hub-health.ps1"
    Run("powershell -NoExit -ExecutionPolicy Bypass -File `"" scriptPath "`"")
}

RunDockerStatus() {
    global GRUDGE_ROOT
    composeFile := GRUDGE_ROOT "\docker-compose.yml"
    Run("powershell -NoExit -Command `"docker compose -f '" composeFile "' ps`"")
}

; ─── STARTUP TOOLTIP ───────────────────────────────────────────
ToolTip("Grudge Studio Hotkeys loaded`nShift+RMB = Open in Warp`nCtrl+Shift+G = Project`nCtrl+Shift+H = Health Check")
SetTimer(() => ToolTip(), -3000)
