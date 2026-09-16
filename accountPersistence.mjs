export const ACCOUNTS_KEY = 'botmanager_accounts_v2';
export const ACTIVE_KEY = 'botmanager_active_account_id';
export const tokenKey = (id, revision = 'v2') => revision === 'v2' ? `botmanager_account_token_${id}` : `botmanager_account_token_${revision}_${id}`;
function parse(raw, source) { try { return JSON.parse(raw); } catch { throw new Error(`${source}_corrupt`); } }
function revision() { return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }
export async function saveAccounts(storage, accounts, activeId) {
  for (const account of accounts) if (!account?.id || !account.apiKey) throw new Error('missing_session_token');
  const rev = revision();
  for (const account of accounts) await storage.setItemAsync(tokenKey(account.id, rev), account.apiKey);
  const metadata = accounts.map(({ apiKey, ...account }) => account);
  await storage.setItemAsync(ACCOUNTS_KEY, JSON.stringify({ version: 3, revision: rev, accounts: metadata }));
  if (activeId) await storage.setItemAsync(ACTIVE_KEY, activeId);
  else await storage.deleteItemAsync(ACTIVE_KEY);
}
export async function loadAccounts(storage, legacyKey = 'botmanager_accounts') {
  const raw = await storage.getItemAsync(ACCOUNTS_KEY);
  if (raw != null) {
    const saved = parse(raw, 'account_metadata');
    const metadata = Array.isArray(saved) ? saved : saved?.version === 3 && Array.isArray(saved.accounts) ? saved.accounts : null;
    if (!metadata) throw new Error('account_metadata_corrupt');
    const rev = Array.isArray(saved) ? 'v2' : saved.revision;
    if (!rev) throw new Error('account_metadata_corrupt');
    const accounts = [];
    for (const account of metadata) {
      if (!account?.id) continue;
      const apiKey = await storage.getItemAsync(tokenKey(account.id, rev));
      if (apiKey) accounts.push({ ...account, apiKey });
    }
    return accounts;
  }
  const legacy = await storage.getItemAsync(legacyKey);
  if (legacy == null) return [];
  const parsed = parse(legacy, 'legacy_accounts');
  if (!Array.isArray(parsed)) throw new Error('legacy_accounts_corrupt');
  const accounts = parsed.filter((a) => a?.id && a?.apiKey);
  if (accounts.length) await saveAccounts(storage, accounts, await storage.getItemAsync(ACTIVE_KEY));
  return accounts;
}
