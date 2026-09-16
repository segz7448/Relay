export function idempotencyKey(r: Request) {
  const v = r.headers.get("Idempotency-Key")?.trim();
  if (!v) return null;
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(v)) throw Error();
  return v;
}
export async function priorResource(
  db: D1Database,
  u: string,
  k: string | null,
  o: string,
) {
  return k
    ? db
        .prepare(
          "SELECT resource_id FROM idempotency_records WHERE user_id=? AND idempotency_key=? AND operation=?",
        )
        .bind(u, k, o)
        .first<{ resource_id: string }>()
    : null;
}
export async function rememberResource(
  db: D1Database,
  u: string,
  k: string | null,
  o: string,
  r: string,
) {
  if (k)
    await db
      .prepare(
        "INSERT OR IGNORE INTO idempotency_records(user_id,idempotency_key,operation,resource_id,created_at)VALUES(?,?,?,?,?)",
      )
      .bind(u, k, o, r, Date.now())
      .run();
}
