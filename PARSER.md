# PARSER.md — 파서 규격 정본

> 모든 파서(MD, DOCX, HWPX)의 출력 규격을 정의한다.
> 정본: **MD 파서** (`src/lib/md-parser.ts`)
> 다른 파서는 MD 파서의 출력 규격에 맞춰야 한다.

---

## 1. 서비스 원칙

- Grimoire는 **에디터가 아니라 퍼블리셔**
- 서버 파서의 역할: 텍스트를 **블록 단위로 분리** (인라인 서식 변환은 하지 않음)
- 인라인 서식(`*이탤릭*`, `**볼드**`)은 **프론트엔드 `parseInlineText`**에서 렌더링 시점에 처리
- DB에는 **원본 마크다운 텍스트**가 그대로 저장됨 (HTML 혼입 없음)

---

## 2. Block 인터페이스 (정본)

```typescript
interface Block {
  type: string       // 블록 타입 (아래 표 참조)
  title?: string     // heading-1, heading-2, chapter에서 사용
  text?: string      // paragraph, italic, bold, refrain에서 사용
  num?: string       // chapter의 번호 ("1", "2" 등)
  stars?: string     // review의 별점
  reviewText?: string // review의 리뷰 텍스트
  variant?: string   // review의 변형 ("professor" 등)
  children?: Block[] // reviews-wrap의 하위 블록
}
```

### 블록 타입 전체 목록

| type | 마크다운 원본 | 주 필드 | 설명 |
|------|-------------|--------|------|
| `heading-1` | `# 대제목` | `title` | 에피소드 대제목 |
| `heading-2` | `## 소제목` | `title` | 소제목/부제 |
| `chapter` | `### N. 챕터` | `title` + `num` | 챕터 제목 (번호 선택) |
| `paragraph` | 일반 텍스트 | `text` | 본문 문단 |
| `separator` | `---` | — | 구분선 (수평선) |
| `divider` | `* * *` 또는 `· · ·` | — | 장식 구분선 (사슴뿔 등) |
| `italic` | `*전체 줄 이탤릭*` | `text` | 이탤릭 전용 문단 |
| `bold` | `**전체 줄 볼드**` | `text` | 볼드 전용 문단 |
| `refrain` | `> 인용문` | `text` | 인용/후렴구 |
| `epilogue` | `### 에필로그` | — | 에필로그 마커 |
| `reviews-wrap` | (리뷰 컨테이너) | `children` | 리뷰 블록 묶음 |
| `review` | (개별 리뷰) | `stars` + `reviewText` | 별점 + 리뷰 텍스트 |

### 필드 사용 규칙

- `title`: heading/chapter 계열에서만 사용 (제목 텍스트)
- `text`: paragraph/italic/bold/refrain에서만 사용 (본문 텍스트)
- `title`과 `text`를 동시에 사용하지 않는다
- 인라인 서식(`*이탤릭*`, `**볼드**`)은 `text` 필드에 마크다운 원본 그대로 저장

---

## 3. 파서별 역할

| 파서 | 파일 | 입력 | 역할 |
|------|------|------|------|
| MD 파서 (정본) | `src/lib/md-parser.ts` | `.md` 텍스트 | 마크다운 → Block[] |
| DOCX 파서 | `src/lib/docx-parser.ts` | `.docx` Buffer | mammoth HTML → Block[] |
| HWPX 파서 | `src/lib/hwp-parser.ts` | `.hwpx` ZIP | section XML → Block[] |
| HWP 파서 | `src/lib/hwp-parser.ts` | `.hwp` Buffer | @ohah/hwpjs → Block[] |
| TXT 파서 | `src/lib/txt-parser.ts` | `.txt` 텍스트 | 줄 분리 → Block[] |

### 정본 동기화 규칙

1. MD 파서에 새 블록 타입 추가 시 → `Block` 인터페이스 + 이 문서 업데이트
2. 다른 파서가 동일한 의미의 콘텐츠를 만나면 → MD 파서와 동일한 `type` + 필드 사용
3. 프론트엔드 `ChapterBlock`은 `block.type`만으로 렌더링 — 파서 출처 무관

---

## 4. 프론트엔드 렌더링 (참고)

| 컴포넌트 | 역할 |
|---------|------|
| `ChapterBlock` | Block[] → React 렌더링 (switch on type) |
| `parseInlineText` | `text` 필드 내 `*이탤릭*`, `**볼드**`, `***볼드이탤릭***` → React 요소 변환 |

> 인라인 서식은 서버가 아닌 프론트에서 처리한다.
> DB에는 원본 마크다운이 저장되고, 렌더링 시점에 변환한다.

---

## 5. 참조

- `src/domain/model/block.ts` — Block 인터페이스 정의
- `grimoire-web/src/features/reader/ui/ChapterBlock.tsx` — 렌더링 컴포넌트
- `grimoire-web/src/features/reader/ui/ChapterBlock.tsx:parseInlineText` — 인라인 서식 변환
