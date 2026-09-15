// worker/src/lib/botCommands.ts
//
// PHASE 14 — pulled out of routes/bots.ts so the runtime dispatcher
// (lib/botMessagePipeline.ts, "PROCESS COMMAND / BOT LOGIC / WEBHOOK") and
// the owner-facing command CRUD routes (routes/bots.ts) share exactly one
// definition of what a valid command name looks like and what action
// types exist. Before this phase, COMMAND_RE/COMMAND_ACTION_TYPES only
// existed inline in routes/bots.ts — fine while only the CRUD routes
// needed them, but the dispatcher needs the identical rules (a command it
// executes must be one the CRUD routes could have created) or the two
// could silently drift apart.
//
// Values are unchanged from the pre-Phase-14 inline versions in
// routes/bots.ts — this is a pure extraction, not a behavior change.

// Lowercase letters/numbers/underscores, must start with a letter, up to
// 32 chars. Mirrors the format rule app/bot/[id]/command-edit.jsx already
// enforces client-side.
export const COMMAND_RE = /^[a-z][a-z0-9_]{0,31}$/;

// Mirrors `ACTION_TYPES` in botsApi.js. There is no shared module between
// the Worker bundle and the Expo app bundle in this project's layout, so
// that list is intentionally duplicated rather than imported — keep the
// two in sync by hand if a new action type is added. "Command behavior"
// (the spec's term) is deliberately a fixed, closed set rather than a
// free-form string: the runtime dispatcher (Phase 14/15) only knows how
// to interpret these exact values.
export const COMMAND_ACTION_TYPES = new Set([
  'Reply with text',
  'Send welcome message',
  'Open menu',
  'Trigger webhook',
  'No action',
]);

export function normalizeCommandName(raw: unknown): string {
  return String(raw ?? '').trim().replace(/^\//, '').toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 15 — Bot Commands: Execution Engine
// ─────────────────────────────────────────────────────────────────────────────
//
// Spec: "Support commands such as /start, /help, /settings, /custom_command."
//
// The spec offers two ways to satisfy /start and /help: seed them as real
// default rows per new bot, or treat them as reserved names with fixed
// behavior when absent. This project picks the first option deliberately:
// a reserved, hardcoded fallback would work *without* a row in
// `bot_commands`, which means it would never show up on
// `app/bot/[id]/commands.jsx`, could never be renamed/disabled/edited
// through the CRUD this project already built (Phase 11), and would fail
// "Appear correctly in the BotManager UI" the moment an owner looked for
// it there. Seeding real rows means /start and /help are — from the
// moment a bot exists — ordinary commands: editable, disable-able,
// deletable, visible, exactly like any command the owner adds later.
//
// DEFAULT_COMMANDS is consumed exactly once, by `POST /bots` in
// routes/bots.ts, right after the new bot's own row is inserted. Bots
// that already existed before this phase shipped do not get these two
// rows retroactively — this project's schema (worker/src/db/schema.sql)
// has no separate versioned-migrations mechanism to backfill existing
// data (see notes/11-bot-settings-commands-api.md's caveat on the same
// point for the unique-command-name index), and an owner who wants them
// can already add either command by hand through the existing "Add
// command" screen in under ten seconds. Inventing a data backfill step
// that doesn't match how every other piece of data in this project comes
// to exist would be the fake shortcut here, not the honest one.
export const DEFAULT_COMMANDS: ReadonlyArray<{
  command: string;
  description: string;
  actionType: string;
  actionValue: string;
}> = [
  { command: 'start', description: 'Say hello and show the welcome message', actionType: 'Send welcome message', actionValue: '' },
  { command: 'help', description: 'List everything this bot can do', actionType: 'Open menu', actionValue: '' },
];

// The result shape a webhook call produces, as consumed by the command
// engine. Deliberately NOT imported from lib/botMessagePipeline.ts (whose
// `WebhookCallResult` this is structurally identical to) — that module
// already imports `normalizeCommandName` from this one, and importing
// back would make the two files circular. TypeScript's structural typing
// means a real `WebhookCallResult` value satisfies this interface with no
// cast needed; there is exactly one implementation of "make this HTTP
// call" in the codebase (`callBotWebhook` in botMessagePipeline.ts) and it
// is passed in here, never reimplemented.
export interface CommandWebhookResult {
  ok: boolean;
  code: number | null;
  latencyMs: number;
  replyText: string | null;
}

export interface CommandExecutionResult {
  text: string | null;
  source: 'command' | 'webhook' | null;
  commandMatched: string | null;
  delivery: CommandWebhookResult | null;
}

function buildMenuText(commands: Array<{ command: string; description: string }>): string {
  if (!commands.length) return 'No commands are available right now.';
  return commands.map((c) => (c.description ? `/${c.command} — ${c.description}` : `/${c.command}`)).join('\n');
}

// The execution engine itself: a fixed, closed dispatch over
// `COMMAND_ACTION_TYPES` — the exact set the owner-facing CRUD in
// routes/bots.ts already validates every `action_type` against on write,
// so a command this function is ever asked to run is guaranteed to be one
// of these five values. There is no `eval`, `Function()`, or any other
// dynamic code path here or anywhere else in the dispatch chain — per the
// spec, "Do not allow arbitrary server-side code execution from
// user-created commands." A command's `action_value` is only ever used as
// inert data (the literal reply text, or a URL passed to `fetch`), never
// interpreted as code.
export async function executeCommandAction(
  db: D1Database,
  bot: { id: string; webhook_url: string | null; welcome_message: string },
  botUser: { id: string } | null,
  cmd: { command: string; action_type: string; action_value: string },
  text: string | null,
  callWebhook: (url: string, event: string, data: Record<string, unknown>) => Promise<CommandWebhookResult>,
): Promise<CommandExecutionResult> {
  const commandMatched = cmd.command;

  switch (cmd.action_type) {
    case 'Reply with text':
      return { text: cmd.action_value || null, source: 'command', commandMatched, delivery: null };

    case 'Send welcome message':
      return { text: bot.welcome_message || null, source: 'command', commandMatched, delivery: null };

    case 'Open menu': {
      // Real, current data only — the bot's own enabled commands, read
      // fresh from `bot_commands` on every invocation (never a cached or
      // hand-written list), so the menu can never drift from what the
      // owner actually configured. A disabled command is deliberately
      // left out — same rule `GET /bot-runtime/commands` already applies.
      const rows = await db.prepare(
        'SELECT command, description FROM bot_commands WHERE bot_id = ? AND enabled = 1 ORDER BY created_at ASC'
      ).bind(bot.id).all<{ command: string; description: string }>();
      return { text: buildMenuText(rows.results ?? []), source: 'command', commandMatched, delivery: null };
    }

    case 'Trigger webhook': {
      // Respects "Respect bot settings": a command configured to trigger
      // the bot's webhook genuinely cannot do anything if the bot has no
      // webhook_url configured — no fallback text is fabricated.
      if (!bot.webhook_url) return { text: null, source: null, commandMatched, delivery: null };
      const result = await callWebhook(bot.webhook_url, 'command', {
        botId: bot.id, botUserId: botUser?.id ?? null, command: commandMatched, text,
      });
      return { text: result.replyText, source: 'webhook', commandMatched, delivery: result };
    }

    case 'No action':
    default:
      // `default` only exists as a defensive fallback for a row that
      // predates a since-removed action type (there is no other way to
      // reach it — every write path validates against
      // `COMMAND_ACTION_TYPES` first). Produces no reply, same as an
      // explicit "No action" — never an error, never a fabricated string.
      return { text: null, source: null, commandMatched, delivery: null };
  }
}
