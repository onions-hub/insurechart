@echo off
title InsureChart Hub 실행기
echo ==================================================
echo   InsureChart Hub - 보험 상담 차트 로컬 서버 시작
echo ==================================================
echo.
echo 1. 브라우저로 시스템을 엽니다 (http://localhost:5000)...
start http://localhost:5000
echo.
echo 2. 백엔드 API 및 파일 동기화 서버 가동 중...
echo    (이 창을 열어두셔야 상담 차트가 작동합니다.)
echo    (종료하려면 이 창을 닫거나 Ctrl+C를 누르세요.)
echo.
npm run start
pause
