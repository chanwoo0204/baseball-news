// ─────────────────────────────────────────────
// 사이트 설정 파일 — 여기 값만 바꾸면 됩니다.
// ─────────────────────────────────────────────
window.SITE_CONFIG = {
  // 사이트 이름 (왼쪽 위 로고에 표시)
  SITE_NAME: 'BASEBALL KOREA',

  // Supabase 연결 정보 (README.md 의 2단계 참고)
  // 두 값이 비어 있으면 "샘플 모드"로 동작합니다. (글이 내 브라우저에만 저장됨)
  SUPABASE_URL: 'https://duuhpktrbjrbskkxadlb.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_9IUYVf505HXYnAz_AhinqA_1urZQZLD',

  // 스마트스토어 주소 (예: 'https://smartstore.naver.com/가게이름')
  STORE_URL: 'https://smartstore.naver.com/baseballkorea',

  // 인스타그램 주소 (예: 'https://www.instagram.com/계정이름/')
  INSTAGRAM_URL: 'https://www.instagram.com/baseballkorea_official/',

  // 뉴스 카테고리 — 자유롭게 추가/삭제하세요
  CATEGORIES: ['이적', '인터뷰', '스카우팅', '드래프트', '칼럼'],

  // 게시판 말머리 — 자유롭게 추가/삭제하세요 ('공지'는 관리자 전용으로 자동 추가됩니다)
  BOARD_CATEGORIES: ['잡담', '경기', '질문', '정보'],
};
