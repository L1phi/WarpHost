!include LogicLib.nsh
!include nsDialogs.nsh

Var EasyTierCheckbox
Var EasyTierInstallSelected

!macro customPageAfterChangeDir
  Page custom EasyTierOptionsPage EasyTierOptionsPageLeave
!macroend

Function EasyTierOptionsPage
  !insertmacro MUI_HEADER_TEXT "SD-WAN / EasyTier" "选择是否启用内置虚拟局域网引擎。"

  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 42u "EasyTier 用于无公网 IP、NAT、宿舍网、校园网或朋友 P2P 联机。$\r$\n如果你只使用云服务器开服，或本机已经有公网 IPv6，可以暂时不启用。"
  Pop $0

  ${NSD_CreateCheckbox} 0 54u 100% 16u "安装 EasyTier SD-WAN 组件（推荐）"
  Pop $EasyTierCheckbox
  ${NSD_Check} $EasyTierCheckbox

  ${NSD_CreateLabel} 0 78u 100% 30u "未安装也没关系，安装完成后可以在 WarpHost 的 SD-WAN 区域随时安装。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function EasyTierOptionsPageLeave
  ${NSD_GetState} $EasyTierCheckbox $EasyTierInstallSelected
FunctionEnd

!macro customInstall
  ${If} $EasyTierInstallSelected == ""
    StrCpy $EasyTierInstallSelected ${BST_CHECKED}
  ${EndIf}

  SetShellVarContext current
  CreateDirectory "$APPDATA\WarpHost\easytier"

  ${If} $EasyTierInstallSelected == ${BST_CHECKED}
    CopyFiles /SILENT "$INSTDIR\resources\easytier-core.exe" "$APPDATA\WarpHost\easytier\easytier-core.exe"
  ${Else}
    Delete "$APPDATA\WarpHost\easytier\easytier-core.exe"
  ${EndIf}
!macroend
