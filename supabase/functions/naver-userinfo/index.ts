// 네이버 로그인용 중계 함수 (Supabase Edge Function)
// 네이버의 회원정보 응답은 표준 형식과 달라서, Supabase가 읽을 수 있는 형식으로 바꿔 줍니다.
// Supabase 설정에서 "JWT 확인(Verify JWT)"은 꺼야 합니다. 인증은 네이버 토큰으로 합니다.
Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'missing token' }, 401);

  const res = await fetch('https://openapi.naver.com/v1/nid/me', { headers: { Authorization: auth } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.resultcode !== '00' || !data.response) {
    return json({ error: 'naver userinfo failed' }, 401);
  }
  const r = data.response;
  return json({
    sub: String(r.id),
    email: r.email || undefined,
    email_verified: !!r.email,
    name: r.nickname || r.name || '',
    nickname: r.nickname || '',
    picture: r.profile_image || undefined,
  });
});
