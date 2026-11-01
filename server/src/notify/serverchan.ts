const TITLE_MAX = 32;

/** Turbo keys start with SCT. Server酱³ keys look like sctp{uid}t… and use another host. */
export function serverchanEndpoint(key: string): string {
  const trimmed = key.trim();
  const sc3 = /^sctp(\d+)t/i.exec(trimmed);
  if (sc3) return `https://${sc3[1]}.push.ft07.com/send/${encodeURIComponent(trimmed)}.send`;
  return `https://sctapi.ftqq.com/${encodeURIComponent(trimmed)}.send`;
}

export async function postServerchan(
  fetchImpl: typeof fetch,
  key: string,
  title: string,
  desp: string,
): Promise<{ ok: boolean; status: number | null }> {
  const res = await fetchImpl(serverchanEndpoint(key), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      title: title.replace(/[\r\n]+/g, ' ').slice(0, TITLE_MAX),
      desp,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json().catch(() => null)) as { code?: number | string } | null;
  return { ok: data?.code === 0 || data?.code === '0', status: res.status };
}
