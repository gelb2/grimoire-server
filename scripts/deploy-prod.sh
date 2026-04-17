#!/usr/bin/env bash
# deploy-prod.sh — grimoire-server prod 환경 배포
# 정본: docs/DEPLOY.md §4.3
# 주의: 이 스크립트는 preflight에서 interactive 'yes' 확인을 요구한다.
#       CI 환경 등 비대화형 환경에선 SKIP_INTERACTIVE=1 로 환경변수 지정.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"
source "${SCRIPT_DIR}/deploy-common.sh"

ENV="prod"
info "=== grimoire-server deploy [$ENV] 시작 ==="
warn "이것은 PRODUCTION 배포입니다."

bash "${SCRIPT_DIR}/preflight.sh" "$ENV" || fail "preflight 실패. 배포 중단."

SHA=$(current_sha)
info "배포 대상 SHA: $SHA"

action_acr_login
action_docker_build_push "$ENV" "$SHA"
action_containerapp_update "$ENV" "$SHA"
action_purge_old_images "$ENV"
action_post_deploy_healthcheck "$ENV"

step "배포 완료"
ok "server [$ENV] 배포 성공"
info "  이미지: $(image_fq_sha "$ENV" "$SHA")"
info "  공개 URL: $(env_to_public_api_url "$ENV")"
