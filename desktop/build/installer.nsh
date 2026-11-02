; Sur certains postes, le dossier Programs porte une ACL AppContainer sans entrée
; ALL APPLICATION PACKAGES : Electron refuse alors de démarrer (sandbox sans droit
; de lecture). On accorde la lecture seule, sur le dossier de l'application uniquement.
!macro customInstall
  nsExec::Exec 'icacls "$INSTDIR" /grant *S-1-15-2-1:(OI)(CI)(RX) /T /C /Q'
  Pop $0
!macroend
