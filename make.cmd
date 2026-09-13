@echo off
setlocal

set "target=%~1"
if not defined target set "target=quality"

if /i "%target%"=="worktree" goto worktree
if /i "%target%"=="typecheck" goto typecheck
if /i "%target%"=="test" goto test
if /i "%target%"=="build" goto build
if /i "%target%"=="quality" goto quality

>&2 echo Unknown target "%target%". Available targets: worktree, typecheck, test, build, quality.
exit /b 2

:worktree
if not defined FAKTORIAL_WORKTREE_PATH goto missing_worktree_path
pushd "%FAKTORIAL_WORKTREE_PATH%" 2>nul
if errorlevel 1 goto invalid_worktree_path
call npm ci
set "exit_code=%errorlevel%"
popd
exit /b %exit_code%

:missing_worktree_path
>&2 echo FAKTORIAL_WORKTREE_PATH is required.
exit /b 2

:invalid_worktree_path
>&2 echo FAKTORIAL_WORKTREE_PATH does not identify an accessible directory: "%FAKTORIAL_WORKTREE_PATH%".
exit /b 2

:typecheck
call npm run typecheck
exit /b %errorlevel%

:test
call npm test
exit /b %errorlevel%

:build
call npm run build
exit /b %errorlevel%

:quality
call :typecheck
if errorlevel 1 exit /b %errorlevel%
call :test
if errorlevel 1 exit /b %errorlevel%
call :build
exit /b %errorlevel%
