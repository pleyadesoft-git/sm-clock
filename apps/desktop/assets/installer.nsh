; Script NSIS personalizado para SM-Clock Agente
; Se asegura de terminar cualquier proceso previo en ejecución antes de instalar o desinstalar
; evitando el error de archivo en uso ("el programa está abierto")

!macro customInit
  DetailPrint "Deteniendo instancias previas de SM-Clock Agente..."
  nsExec::Exec 'taskkill /F /IM "SM-Clock Agente.exe" /T'
  nsExec::Exec 'taskkill /F /IM "sm-clock-agent.exe" /T'
  Sleep 1000
!macroend

!macro customUnInstall
  DetailPrint "Deteniendo instancias de SM-Clock Agente..."
  nsExec::Exec 'taskkill /F /IM "SM-Clock Agente.exe" /T'
  nsExec::Exec 'taskkill /F /IM "sm-clock-agent.exe" /T'
  Sleep 1000
!macroend
