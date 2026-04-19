#!/bin/bash
# Grimoire Azure 인프라 초기 세팅 스크립트
# projectZenith 패턴 그대로 적용
set -e

RESOURCE_GROUP="grimoire-rg"
LOCATION="koreacentral"
ACR_NAME="grimoireacr"
DB_ADMIN="grimoireadmin"
# DB_PASSWORD는 실행 시 입력받기
read -sp "Enter DB admin password: " DB_PASSWORD
echo

echo "=== 1. 리소스 그룹 ==="
az group create --name $RESOURCE_GROUP --location $LOCATION

echo "=== 2. Container Registry ==="
az acr create --name $ACR_NAME --resource-group $RESOURCE_GROUP --sku Basic --admin-enabled true

echo "=== 3. PostgreSQL (dev/prod) ==="
for ENV in dev prod; do
  az postgres flexible-server create \
    --resource-group $RESOURCE_GROUP \
    --name grimoire-db-$ENV \
    --location $LOCATION \
    --admin-user $DB_ADMIN \
    --admin-password "$DB_PASSWORD" \
    --sku-name Standard_B1ms \
    --tier Burstable \
    --version 16 \
    --storage-size 32

  # Azure 서비스 접근 허용
  az postgres flexible-server firewall-rule create \
    --resource-group $RESOURCE_GROUP \
    --name grimoire-db-$ENV \
    --rule-name AllowAzureServices \
    --start-ip-address 0.0.0.0 \
    --end-ip-address 0.0.0.0

  # DB 생성
  az postgres flexible-server db create \
    --resource-group $RESOURCE_GROUP \
    --server-name grimoire-db-$ENV \
    --database-name grimoire
done

echo "=== 4. Container Apps Environment ==="
az containerapp env create \
  --name grimoire-env \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION

echo "=== 5. Container Apps (server x3) ==="
ACR_SERVER=$(az acr show --name $ACR_NAME --query loginServer -o tsv)
ACR_USER=$(az acr credential show --name $ACR_NAME --query username -o tsv)
ACR_PASS=$(az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv)

for ENV in dev prod; do
  az containerapp create \
    --name grimoire-server-$ENV \
    --resource-group $RESOURCE_GROUP \
    --environment grimoire-env \
    --target-port 3000 \
    --ingress external \
    --min-replicas 0 \
    --max-replicas 1 \
    --cpu 0.25 \
    --memory 0.5Gi \
    --registry-server $ACR_SERVER \
    --registry-username $ACR_USER \
    --registry-password $ACR_PASS
done

echo "=== 6. Container Apps (web x3) ==="
for ENV in dev prod; do
  az containerapp create \
    --name grimoire-web-$ENV \
    --resource-group $RESOURCE_GROUP \
    --environment grimoire-env \
    --target-port 3001 \
    --ingress external \
    --min-replicas 0 \
    --max-replicas 1 \
    --cpu 0.25 \
    --memory 0.5Gi \
    --registry-server $ACR_SERVER \
    --registry-username $ACR_USER \
    --registry-password $ACR_PASS
done

echo "=== 7. 예산 알림 설정 ==="
az consumption budget create \
  --resource-group $RESOURCE_GROUP \
  --budget-name grimoire-budget \
  --amount 50 \
  --time-grain monthly \
  --category cost

echo ""
echo "=== 완료 ==="
echo "ACR: $ACR_SERVER"
echo "다음 단계:"
echo "1. GitHub Secrets 설정 (AZURE_CREDENTIALS, ACR_*)"
echo "2. Cloudflare DNS 설정"
echo "3. 환경변수 설정 (Azure Portal → Container App → 환경변수)"
