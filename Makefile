# Makefile — grimoire-server 수동 배포 진입점
# 정본: docs/DEPLOY.md

.PHONY: help preflight deploy-dev deploy-inhouse deploy-prod logs rollback \
        docker-login image-list image-clean dev-local test build \
        db-sync-prod-to-inhouse db-sync-prod-to-dev db-sync-inhouse-to-dev db-sync-dev-to-local

SHELL := /usr/bin/env bash

# ─────────────────────────────────────────────────────────────
# 도움말
# ─────────────────────────────────────────────────────────────
help:
	@echo "grimoire-server Makefile — 수동 배포 진입점 (docs/DEPLOY.md)"
	@echo ""
	@echo "배포 타겟:"
	@echo "  make preflight ENV=dev           배포 전수검사만 (배포 안 함)"
	@echo "  make preflight ENV=inhouse"
	@echo "  make preflight ENV=prod          (interactive 확인 포함)"
	@echo ""
	@echo "  make deploy-dev                  dev 배포 (preflight + build + push + update)"
	@echo "  make deploy-inhouse              inhouse 배포"
	@echo "  make deploy-prod                 prod 배포 (interactive 확인 필수)"
	@echo ""
	@echo "운영 타겟:"
	@echo "  make logs ENV=dev                Container App 로그 tail (Ctrl-C로 종료)"
	@echo "  make logs ENV=inhouse"
	@echo "  make logs ENV=prod"
	@echo "  make rollback ENV=prod SHA=abc1234...   특정 SHA로 되돌림"
	@echo "  make image-list ENV=dev          해당 환경 이미지 태그 목록"
	@echo ""
	@echo "로컬 개발 타겟:"
	@echo "  make test                        Jest 테스트"
	@echo "  make build                       NestJS 빌드"
	@echo "  make dev-local                   docker-compose로 로컬 전체 스택 기동"
	@echo ""
	@echo "DB 동기화 타겟 (INFRASTRUCTURE.md §10 — 비상용 수동 실행):"
	@echo "  make db-sync-prod-to-inhouse     prod → inhouse (PII 유지, interactive 확인)"
	@echo "  make db-sync-prod-to-dev         prod → dev (PII 마스킹, interactive 확인)"
	@echo "  make db-sync-inhouse-to-dev      inhouse → dev (PII 마스킹, prod 우회용)"
	@echo "  make db-sync-dev-to-local        dev → localhost (Docker DB 필요)"
	@echo "  * 모두 DB_PASSWORD 환경변수 필요. az login 선행."

# ─────────────────────────────────────────────────────────────
# 배포 전수검사 / 배포
# ─────────────────────────────────────────────────────────────
preflight:
	@if [ -z "$(ENV)" ]; then echo "ENV 필수 (dev|inhouse|prod)"; exit 1; fi
	@bash scripts/preflight.sh $(ENV)

deploy-dev:
	@bash scripts/deploy-dev.sh

deploy-inhouse:
	@bash scripts/deploy-inhouse.sh

deploy-prod:
	@bash scripts/deploy-prod.sh

# ─────────────────────────────────────────────────────────────
# 운영: 로그
# ─────────────────────────────────────────────────────────────
logs:
	@if [ -z "$(ENV)" ]; then echo "ENV 필수 (dev|inhouse|prod)"; exit 1; fi
	@az containerapp logs show \
		--name grimoire-server-$(ENV) \
		--resource-group zenith-rg \
		--follow

# ─────────────────────────────────────────────────────────────
# 운영: 롤백 (특정 SHA 태그로 Container App 되돌림)
# 이미지 빌드/푸시 없음. ACR에 이미 해당 태그가 있어야 함.
# ─────────────────────────────────────────────────────────────
rollback:
	@if [ -z "$(ENV)" ] || [ -z "$(SHA)" ]; then \
		echo "사용: make rollback ENV=prod SHA=<full-sha>"; exit 1; \
	fi
	@echo "▶ ENV=$(ENV) SHA=$(SHA) 로 롤백합니다."
	@TAG="grimoireacr.azurecr.io/grimoire-server:$(ENV)-$(SHA)"; \
	echo "  이미지 존재 확인: $$TAG"; \
	az acr repository show --name grimoireacr --image "grimoire-server:$(ENV)-$(SHA)" -o none \
		|| { echo "[FAIL] 이미지 없음: $$TAG"; exit 1; }; \
	echo "  Container App 업데이트 중..."; \
	az containerapp update \
		--name grimoire-server-$(ENV) \
		--resource-group zenith-rg \
		--image $$TAG \
		-o none; \
	echo "[ OK ] 롤백 완료 → $$TAG"

# ─────────────────────────────────────────────────────────────
# 운영: ACR 이미지 목록 조회
# ─────────────────────────────────────────────────────────────
image-list:
	@if [ -z "$(ENV)" ]; then echo "ENV 필수 (dev|inhouse|prod)"; exit 1; fi
	@az acr repository show-tags \
		--name grimoireacr \
		--repository grimoire-server \
		--orderby time_desc \
		--query "[?starts_with(@, '$(ENV)-')]" \
		-o tsv | head -20

# ─────────────────────────────────────────────────────────────
# 로컬 개발
# ─────────────────────────────────────────────────────────────
test:
	@npm test

build:
	@npm run build

dev-local:
	@docker-compose up -d
	@echo ""
	@echo "로컬 서버: http://localhost:3000"
	@echo "종료: docker-compose down"

# ─────────────────────────────────────────────────────────────
# DB 동기화 (INFRASTRUCTURE.md §10)
# 자동화: .github/workflows/db-sync-nightly.yml (매일 자정 KST)
# 비상용: CI 다운 시 아래 타겟으로 로컬에서 수동 실행. 스크립트가 정본.
# 전제: export DB_PASSWORD=...; az login 선행.
# ─────────────────────────────────────────────────────────────
db-sync-prod-to-inhouse:
	@bash scripts/db-sync-remote.sh prod inhouse

db-sync-prod-to-dev:
	@bash scripts/db-sync-remote.sh prod dev --mask-pii

db-sync-inhouse-to-dev:
	@bash scripts/db-sync-remote.sh inhouse dev --mask-pii

db-sync-dev-to-local:
	@bash scripts/db-sync-local.sh
