-- Pair each account's inbox row with the other account's row. This keeps
-- per-account inbox state while giving a direct message one shared path.
ALTER TABLE conversations ADD COLUMN peer_conversation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_conversation_pair
  ON conversations(user_id, ref_id) WHERE kind = 'direct';
ALTER TABLE messages ADD COLUMN attachment_data TEXT;
