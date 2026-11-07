@echo off
rem ============================================================================
rem  BetaNova : installer ou mettre a jour Beta sur le NAS, depuis Windows.
rem  Double-clic, et c'est tout. Il faut Windows 10 ou 11 (ssh et curl y sont deja).
rem
rem  1. telecharge la derniere version sur GitHub
rem  2. l'envoie sur le NAS, dans le dossier choisi (BetaNova)
rem  3. lance l'installateur : questions la premiere fois, aucune pour une mise a jour
rem ============================================================================
setlocal
chcp 65001 >nul
title BetaNova - installation sur le NAS

set "DEPOT=https://github.com/Ukiyo2208/Ukiyo2208/archive/refs/heads/claude/beta-ia-local-voice-kd7s5z.tar.gz"
set "REGLAGES=%APPDATA%\BetaNova\reglages.bat"

rem Valeurs par defaut, puis celles de la derniere fois
set "IP=192.168.68.90"
set "UTILISATEUR=bastien.ukiyo"
set "DOSSIER=/volume3/Docker/Beta IA"
if exist "%REGLAGES%" call "%REGLAGES%"

echo.
echo   ============================================
echo     BetaNova - installation / mise a jour
echo   ============================================
echo.

where ssh >nul 2>nul || goto pas_de_ssh
where curl >nul 2>nul || goto pas_de_curl

echo   Entree = garder la valeur entre crochets.
echo.
set /p "IP=  Adresse du NAS [%IP%] : "
set /p "UTILISATEUR=  Utilisateur SSH du NAS [%UTILISATEUR%] : "
set /p "DOSSIER=  Dossier sur le NAS [%DOSSIER%] : "

if not exist "%APPDATA%\BetaNova" mkdir "%APPDATA%\BetaNova"
> "%REGLAGES%" (
  echo set "IP=%IP%"
  echo set "UTILISATEUR=%UTILISATEUR%"
  echo set "DOSSIER=%DOSSIER%"
)
set "CIBLE=%UTILISATEUR%@%IP%"

rem ---------------------------------------------------------------- cle SSH (facultatif)
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new %CIBLE% true >nul 2>nul
if not errorlevel 1 goto cle_ok
echo.
echo   Pour ne plus taper le mot de passe SSH a chaque fois, je peux creer une cle sur ce PC.
choice /c ON /n /m "  Creer et installer une cle SSH ? (O/N) "
if errorlevel 2 goto cle_ok
if not exist "%USERPROFILE%\.ssh\id_ed25519.pub" ssh-keygen -q -t ed25519 -N "" -f "%USERPROFILE%\.ssh\id_ed25519"
echo   Tape le mot de passe du NAS une derniere fois :
type "%USERPROFILE%\.ssh\id_ed25519.pub" | ssh -o StrictHostKeyChecking=accept-new %CIBLE% "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
:cle_ok

rem ---------------------------------------------------------------- 1. telechargement
echo.
echo   [1/3] Telechargement de la derniere version...
curl -fL --progress-bar -o "%TEMP%\BetaNova.tar.gz" "%DEPOT%" || goto erreur_telechargement

rem ---------------------------------------------------------------- 2. envoi sur le NAS
echo.
echo   [2/3] Envoi sur le NAS (%IP%)...
ssh -o StrictHostKeyChecking=accept-new %CIBLE% "cat > /tmp/BetaNova.tar.gz" < "%TEMP%\BetaNova.tar.gz" || goto erreur_envoi
del "%TEMP%\BetaNova.tar.gz" >nul 2>nul

rem ---------------------------------------------------------------- 3. installation
echo.
echo   [3/3] Installation (le mot de passe demande ensuite est celui de sudo, ton mot de passe du NAS)
echo.
ssh -t %CIBLE% "set -e; mkdir -p '%DOSSIER%'; cd '%DOSSIER%'; if [ -e BetaNova ] && [ ! -f BetaNova/installer.sh ]; then echo 'Le dossier BetaNova existe mais ne contient pas Beta : je ne touche a rien.'; exit 1; fi; rm -rf BetaNova.nouveau; mkdir BetaNova.nouveau; tar -xzf /tmp/BetaNova.tar.gz -C BetaNova.nouveau --strip-components=1; rm -f /tmp/BetaNova.tar.gz; rm -rf BetaNova; mv BetaNova.nouveau BetaNova; cd BetaNova; if [ -f ../beta/beta-nas/.env ]; then echo 'Mise a jour : tes reglages sont conserves.'; sudo bash installer.sh --auto; else sudo bash installer.sh; fi"
if errorlevel 1 goto erreur_installation

echo.
echo   C'est fait ! Ouverture de Beta dans le navigateur...
start "" "http://%IP%:8800"
echo.
pause
exit /b 0

:pas_de_ssh
echo   ssh est introuvable. Windows : Parametres ^> Applications ^> Fonctionnalites facultatives ^> Ajouter ^> Client OpenSSH.
goto fin_erreur
:pas_de_curl
echo   curl est introuvable : il faut Windows 10 (version 1803 ou plus recente) ou Windows 11.
goto fin_erreur
:erreur_telechargement
echo   Telechargement impossible. Verifie la connexion Internet du PC.
goto fin_erreur
:erreur_envoi
echo   Envoi impossible. Verifie l'adresse du NAS, l'utilisateur, et que SSH est active dans UGOS (Panneau de configuration ^> Terminal).
goto fin_erreur
:erreur_installation
echo   L'installation s'est arretee : lis le message au-dessus (journal sur le NAS : %DOSSIER%/beta/installation-beta.log).
goto fin_erreur
:fin_erreur
echo.
pause
exit /b 1
