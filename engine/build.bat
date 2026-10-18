@echo off
rem Builds the nec2c antenna engine for the browser (WebAssembly).
rem Needs Emscripten installed in E:\tools\emsdk.
rem Output: build\nec2c.js and build\nec2c.wasm

call E:\tools\emsdk\emsdk_env.bat >nul 2>&1
cd /d "%~dp0"
if not exist build mkdir build

emcc ^
  nec2c\main.c nec2c\calculations.c nec2c\fields.c nec2c\geometry.c ^
  nec2c\ground.c nec2c\input.c nec2c\matrix.c nec2c\misc.c ^
  nec2c\network.c nec2c\radiation.c nec2c\shared.c nec2c\somnec.c ^
  -Inec2c -DPACKAGE_STRING=\"nec2c\" -O3 ^
  -sMODULARIZE=1 -sEXPORT_NAME=createNec2c ^
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 ^
  -sEXPORTED_RUNTIME_METHODS=FS,callMain ^
  -sENVIRONMENT=web,worker -sEXIT_RUNTIME=0 ^
  -o build\nec2c.js

if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo Built build\nec2c.js and build\nec2c.wasm
