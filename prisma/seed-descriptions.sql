-- 사슴악마 에피소드 description 백필
-- 배포 후 1회 실행: psql 또는 Azure Query Editor에서 실행

UPDATE episodes SET description = '전래동화 속 신수(神獸)의 눈으로 다시 읽는 선녀와 나무꾼. 날개옷은 가벼웠다 — 세상을 바꿔온 것들은 대부분 가볍다.' WHERE slug = 'ep1' AND work_id IN (SELECT w.id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '야생의 여우 요괴에게 부잣집 막내딸 환생을 제안한 사슴악마. 결핍은 질문을 삼키고, 온돌의 따뜻함은 모든 것을 덮는다.' WHERE slug = 'ep2' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '21세기, 판교. 트래픽 가뭄에 시달리는 스타트업 CEO 앞에 정장을 입은 사슴악마가 나타났다. USB는 32기가였다. 가벼웠다.' WHERE slug = 'ep3' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '조선의 행정 기계 앞에 선 한 남자. 정직함은 미덕이었다 — 시스템이 그것을 이용하기 전까지.' WHERE slug = 'ep4' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '개구리는 계약을 원했고, 공주는 도박을 했다. 변신은 끝이 아니라 시작이었다.' WHERE slug = 'ep5' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '우렁이는 소원을 말하지 않았다. 사슴악마는 ''끌끌'' 소리 없이 떠났다. 어떤 결핍은 질문조차 삼키지 않는다.' WHERE slug = 'ep6' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '버려진 공주가 제국을 불태웠다. 복수인가, 구원인가. 사슴악마는 판단을 내리지 않는다.' WHERE slug = 'ep7' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '쥐는 손톱을 먹고 인간이 되고 싶었다. 인간은 더 나은 부품을 원했다. 욕망의 방향은 항상 위를 향한다.' WHERE slug = 'ep8' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '도리안 그레이는 자신의 늙음을 다락방에 가두었다. 그러나 자격지심으로 뭉친 현대의 위선자에게 필요한 것은, 자신의 추악함을 맹목적으로 핥아줄 완벽한 ''타자''의 초상화였다. 인간은 욕망의 진짜 원료를 직시하는 순간 파멸한다.' WHERE slug = 'ep9' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '억울한 귀신이란 무엇인가. 장화와 홍련은 죽어서도 민원을 넣었다. 시스템은 산 자의 것이었지만, 귀신은 그것을 빌려 썼다.' WHERE slug = 'ep10' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '결핍의 냄새를 닮았으되 결핍이 아닌 것. 사슴악마는 처음으로 기계에게서 냄새를 맡았다. 이름 없는 괴물의 이야기.' WHERE slug = 'ep11' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '노이쾰른의 힌터호프에서 사슴악마는 동족을 만난다. 패스트푸드와 슬로우 푸드, 관조와 개입 — 수만 년을 산 두 존재의 첫 대화.' WHERE slug = 'ep12' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');

UPDATE episodes SET description = '2026년, 베를린. 사슴악마가 담배를 피우며 독자에게 말을 건다. 히틀러의 마지막 밤에 그가 있었다.' WHERE slug = 'bonus1' AND work_id IN (SELECT id FROM works w JOIN authors a ON w.author_id = a.id WHERE a.slug = 'deerdevil');
