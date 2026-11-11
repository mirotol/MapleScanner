; Added to electron-builder's installer (its default include). The installer shows what MapleScanner
; sends and asks whether to share scans, as SignPath's terms ask of software that sends data.
; The answer goes in installer-choice.json in the app's data folder, which the app takes into its
; settings on the next start (takeInstallerChoice in serve.js). Updates install with --updated and
; usually silently, so they skip the page and leave the setting alone.

!include nsDialogs.nsh
!include LogicLib.nsh

!define SHARE_DATA_DIR "$APPDATA\Maple Scanner" ; pinned in desktop/main.js, keep the two the same
!define SHARE_PRIVACY_URL "https://maplescanner.app/about#sends"

!ifndef BUILD_UNINSTALLER ; the uninstaller is built from this file too, without the page
  Var shareScans
  Var shareBox
!endif

; Always for this Windows user only, as the one-click installer did, so there's no question about it.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customPageAfterChangeDir
  Page custom sharePageShow sharePageLeave

  ; Ticked, unless this PC's settings already have sharing off, so reinstalling keeps the choice.
  ; settings.json is written by serve.js with one key per line.
  Function shareStartState
    StrCpy $shareScans ${BST_CHECKED}
    ClearErrors
    FileOpen $0 "${SHARE_DATA_DIR}\settings.json" r
    IfErrors done
    loop:
      FileRead $0 $1
      IfErrors close
      ${If} $1 == ' "shareScans": false$\n'
      ${OrIf} $1 == ' "shareScans": false,$\n'
      ${OrIf} $1 == ' "shareScans": false$\r$\n'
      ${OrIf} $1 == ' "shareScans": false,$\r$\n'
        StrCpy $shareScans ${BST_UNCHECKED}
      ${EndIf}
      Goto loop
    close:
      FileClose $0
    done:
  FunctionEnd

  Function sharePageShow
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ${If} $shareScans == ""
      Call shareStartState
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Sharing prices" "Choose whether MapleScanner shares the shops it reads."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 72u "MapleScanner reads Free Market shops off your game window. To keep every player's prices fresh, it can share the listings it reads: each one's item, seller, amount, price, channel, room and shop title, with an anonymous key made for this install. The price server keeps only a scrambled copy of the key, and never your IP address. It never sends pictures of your screen or anything about your account."
    Pop $0
    ${NSD_CreateLabel} 0 76u 100% 26u "You can change this at any time with Share my scans in the app's Settings. With it off, nothing is sent and you still see everyone else's prices."
    Pop $0
    ${NSD_CreateCheckbox} 0 106u 100% 12u "&Share my scans with the price database"
    Pop $shareBox
    ${NSD_SetState} $shareBox $shareScans
    ${NSD_CreateLink} 0 124u 100% 12u "Read what MapleScanner sends (maplescanner.app/about)"
    Pop $0
    ${NSD_OnClick} $0 shareOpenPrivacy
    nsDialogs::Show
  FunctionEnd

  Function sharePageLeave
    ${NSD_GetState} $shareBox $shareScans
  FunctionEnd

  Function shareOpenPrivacy
    ExecShell "open" "${SHARE_PRIVACY_URL}"
  FunctionEnd
!macroend

!macro customInstall
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
  ${AndIf} $shareScans != ""
    CreateDirectory "${SHARE_DATA_DIR}"
    FileOpen $0 "${SHARE_DATA_DIR}\installer-choice.json" w
    ${If} $shareScans == ${BST_CHECKED}
      FileWrite $0 '{"shareScans":true}$\n'
    ${Else}
      FileWrite $0 '{"shareScans":false}$\n'
    ${EndIf}
    FileClose $0
  ${EndIf}
!macroend
