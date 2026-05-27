# Makefile — grimoire-server 수동 배포 진입점
# 정본: docs/DEPLOY.md
# 2026-05-27 GCP 정합 — Cloud Run + Artifact Registry + Cloud SQL Auth Proxy

.PHONY: help preflight deploy-dev deploy-prod logs rollback \
        docker-login image-list image-clean dev-local test build \
        db-sync-prod-to-dev db-sync-dev-to-local

SHELL := /usr/bin/env bash

# ─────────────────────────────────────────────────────────────
# GCP 정합 상수 (참조용 — 스크립트가 동일 값을 사용)
# ─────────────────────────────────────────────────────────────
GCP_PROJECT_ID := grimoire-491708
GCP_REGION     := asia-northeast1
ARTIFACT_REPO  := asia-northeast1-docker.pkg.dev/$(GCP_PROJECT_ID)/grimoire-docker

# ─────────────────────────────────────────────────────────────
# 도움말
# ─────────────────────────────────────────────────────────────
help:
	@echo "grimoire-server Makefile — 수동 배포 진입점 (docs/DEPLOY.md)"
	@echo ""
	@echo "배포 타겟 (2환경 — 2026-04-19 inhouse 제거, 2026-05-27 GCP 정합):"
	@echo "  make preflight ENV=dev           배포 전수검사만 (배포 안 함)"
	@echo "  make preflight ENV=prod          (interactive 확인 포함)"
	@echo ""
	@echo "  make deploy-dev                  dev 배포 (preflight + build + push + update)"
	@echo "  make deploy-prod                 prod 배포 (interactive 확인 필수)"
	@echo ""
	@echo "운영 타겟 (gcloud 정합):"
	@echo "  make logs ENV=dev                Cloud Run 로그 tail (Ctrl-C로 종료)"
	@echo "  make logs ENV=prod"
	@echo "  make rollback ENV=prod SHA=abc1234...   특정 SHA로 되돌림 (Cloud Run revision 갱신)"
	@echo "  make image-list ENV=dev          Artifact Registry 이미지 태그 목록"
	@echo ""
	@echo "로컬 개발 타겟:"
	@echo "  make test                        Jest 테스트"
	@echo "  make build                       NestJS 빌드"
	@echo "  make dev-local                   docker-compose로 로컬 전체 스택 기동"
	@echo ""
	@echo "DB 동기화 타겟 (INFRASTRUCTURE.md §10 — 비상용 수동 실행):"
	@echo "  make db-sync-prod-to-dev         prod → dev (PII 마스킹, interactive 확인)"
	@echo "  make db-sync-dev-to-local        dev → localhost (Docker DB 필요)"
	@echo "  * DB_PASSWORD_PROD + DB_PASSWORD_DEV 환경변수 필요. gcloud auth login 선행."

# ─────────────────────────────────────────────────────────────
# 배포 전수검사 / 배포
# ─────────────────────────────────────────────────────────────
preflight:
	@if [ -z "$(ENV)" ]; then echo "ENV 필수 (dev|prod)"; exit 1; fi
	@bash scripts/preflight.sh $(ENV)

deploy-dev:
	@bash scripts/deploy-dev.sh

deploy-prod:
	@bash scripts/deploy-prod.sh

# ─────────────────────────────────────────────────────────────
# 운영: 로그 (Cloud Run)
# ─────────────────────────────────────────────────────────────
logs:
	@if [ -z "$(ENV)" ]; then echo "ENV 필수 (dev|prod)"; exit 1; fi
	@gcloud run services logs tail grimoire-server-$(ENV) \
		--region $(GCP_REGION) \
		--project $(GCP_PROJECT_ID)

# ─────────────────────────────────────────────────────────────
# 운영: 롤백 (특정 SHA 태그로 Cloud Run revision 갱신)
# 이미지 빌드/푸시 없음. Artifact Registry에 이미 해당 태그가 있어야 함.
# ─────────────────────────────────────────────────────────────
rollback:
	@if [ -z "$(ENV)" ] || [ -z "$(SHA)" ]; then \
		echo "사용: make rollback ENV=prod SHA=<full-sha>"; exit 1; \
	fi
	@echo "▶ ENV=$(ENV) SHA=$(SHA) 로 롤백합니다."
	@TAG="$(ARTIFACT_REPO)/grimoire-server:$(ENV)-$(SHA)"; \
	echo "  이미지 존재 확인: $$TAG"; \
	gcloud artifacts docker images describe $$TAG --project $(GCP_PROJECT_ID) >/dev/null 2>&1 \
		|| { echo "[FAIL] 이미지 없음: $$TAG"; exit 1; }; \
	echo "  Cloud Run revision 갱신 중..."; \
	gcloud run services update grimoire-server-$(ENV) \
		--region $(GCP_REGION) \
		--project $(GCP_PROJECT_ID) \
		--image $$TAG \
		--quiet; \
	echo "[ OK ] 롤백 완료 → $$TAG"

# ─────────────────────────────────────────────────────────────
# 운영: Artifact Registry 이미지 목록 조회
# ─────────────────────────────────────────────────────────────
image-list:
	@if [ -z "$(ENV)" ]; then echo "ENV 필수 (dev|prod)"; exit 1; fi
	@gcloud artifacts docker tags list \
		$(ARTIFACT_REPO)/grimoire-server \
		--project $(GCP_PROJECT_ID) \
		--sort-by="~CREATE_TIME" --limit=30 \
		--format="value(TAG)" | grep "^$(ENV)-" | head -20

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
# 2환경(dev/prod) 전용.
# 전제: export DB_PASSWORD=...; az login 선행.
# ─────────────────────────────────────────────────────────────
db-sync-prod-to-dev:
	@bash scripts/db-sync-remote.sh prod dev --mask-pii

db-sync-dev-to-local:
	@bash scripts/db-sync-local.sh
