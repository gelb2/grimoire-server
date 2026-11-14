# 외부 코드 고지

`npm ci` 뒤 `npm run notices`를 실행하면 설치된 운영 의존성의 버전과 원문 고지를 수집한다. 네트워크 호출·추가 설치·외부 키 사용은 하지 않는다. Docker 빌드에서는 대상 플랫폼에서 다시 생성하고 실행 이미지의 `/app/licenses`에 보관한다.

- [운영 의존성 고지 전문](licenses/npm-runtime-notices.txt)
- [패키지 버전·이용 조건·원문 해시·출처](licenses/npm-runtime-manifest.json)
- 생성 코드: `scripts/generate-third-party-notices.mjs`
- 원본 저장소 보충 고지와 고정 출처: `licenses/upstream/manifest.json`

설치 패키지의 LICENSE·NOTICE·COPYING·COPYRIGHT, README의 라이선스 전문과 원본 저장소의 고정 버전 고지를 구분해 보존한다. 원문 없이 이용 조건만 제공하는 패키지는 `package-declaration-only`로 표시한다.

`@polar-sh/sdk@0.47.0`은 설치 파일과 해당 Git revision에 LICENSE가 없다. 현재 원본 저장소의 MIT 고지는 고정 commit에서 가져온 보충 자료로 포함하며, 0.47.0에 원래 포함된 고지라고 표시하지 않는다. `dingbat-to-unicode`·`stream-events`·`stubs`·`tr46` 등 원문이 없는 항목도 생성 목록에서 개별적으로 확인한다.

이 문서는 외부 의존성의 제공 자료와 검토 범위를 기록한다. Grimoire 자체 프로그램·문학 원고의 이용 조건을 임의로 바꾸지 않는다. 바이너리·Docker 이미지를 외부에 배포할 때는 실제 포함한 네이티브 라이브러리와 OS 패키지의 고지도 함께 확인한다.
