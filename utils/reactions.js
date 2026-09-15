// utils/reactions.js
//
// Message reactions live on `message.reactions` as one entry PER REACTOR:
//   { emoji: '❤️', name: 'Priya Shah', mine: true|false }
// (not pre-aggregated counts) so we can always answer "who reacted with
// what" for the view-reactions sheet without a separate lookup. Anything
// that just needs the pill counts groups this on the fly with
// groupReactions() below.

// The six-pack shown inline on long-press, matching Telegram's default
// quick-reaction row order.
export const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];

// Curated categories for the "+" full picker. Not an exhaustive emoji
// database — a representative set per category, each tagged with a few
// search keywords, in the same spirit as this app's other mock data.
export const EMOJI_CATEGORIES = [
  {
    title: 'Smileys',
    icon: 'happy-outline',
    emojis: [
      { char: '😀', keywords: ['grin', 'happy', 'smile'] },
      { char: '😁', keywords: ['grin', 'happy'] },
      { char: '😂', keywords: ['laugh', 'lol', 'tears'] },
      { char: '🤣', keywords: ['rofl', 'laugh'] },
      { char: '😊', keywords: ['smile', 'blush'] },
      { char: '😍', keywords: ['love', 'heart eyes'] },
      { char: '😘', keywords: ['kiss', 'love'] },
      { char: '😉', keywords: ['wink'] },
      { char: '😎', keywords: ['cool', 'sunglasses'] },
      { char: '🤔', keywords: ['think', 'hmm'] },
      { char: '🙄', keywords: ['eyeroll', 'annoyed'] },
      { char: '😴', keywords: ['sleep', 'tired'] },
      { char: '🥳', keywords: ['party', 'celebrate'] },
      { char: '🤗', keywords: ['hug'] },
      { char: '😮', keywords: ['wow', 'surprised'] },
      { char: '😢', keywords: ['sad', 'cry'] },
      { char: '😭', keywords: ['sob', 'cry'] },
      { char: '😡', keywords: ['angry', 'mad'] },
      { char: '🥺', keywords: ['pleading', 'please'] },
      { char: '😱', keywords: ['scream', 'shock'] },
    ],
  },
  {
    title: 'Gestures',
    icon: 'hand-left-outline',
    emojis: [
      { char: '👍', keywords: ['thumbs up', 'yes', 'like'] },
      { char: '👎', keywords: ['thumbs down', 'no', 'dislike'] },
      { char: '👏', keywords: ['clap', 'applause'] },
      { char: '🙌', keywords: ['praise', 'hooray'] },
      { char: '🙏', keywords: ['thanks', 'please', 'pray'] },
      { char: '👋', keywords: ['wave', 'hi', 'bye'] },
      { char: '🤝', keywords: ['handshake', 'deal'] },
      { char: '✌️', keywords: ['peace', 'victory'] },
      { char: '🤞', keywords: ['fingers crossed', 'luck'] },
      { char: '💪', keywords: ['strong', 'flex', 'muscle'] },
      { char: '👌', keywords: ['ok', 'perfect'] },
      { char: '🤌', keywords: ['chef kiss', 'italian'] },
      { char: '☝️', keywords: ['point up'] },
      { char: '🫡', keywords: ['salute'] },
    ],
  },
  {
    title: 'Hearts',
    icon: 'heart-outline',
    emojis: [
      { char: '❤️', keywords: ['love', 'heart'] },
      { char: '🧡', keywords: ['heart', 'orange'] },
      { char: '💛', keywords: ['heart', 'yellow'] },
      { char: '💚', keywords: ['heart', 'green'] },
      { char: '💙', keywords: ['heart', 'blue'] },
      { char: '💜', keywords: ['heart', 'purple'] },
      { char: '🖤', keywords: ['heart', 'black'] },
      { char: '💔', keywords: ['broken heart', 'sad'] },
      { char: '💕', keywords: ['love', 'hearts'] },
      { char: '💯', keywords: ['100', 'perfect'] },
    ],
  },
  {
    title: 'Celebration',
    icon: 'sparkles-outline',
    emojis: [
      { char: '🔥', keywords: ['fire', 'lit', 'hot'] },
      { char: '🎉', keywords: ['party', 'tada', 'confetti'] },
      { char: '🎊', keywords: ['confetti', 'party'] },
      { char: '✨', keywords: ['sparkle', 'shine'] },
      { char: '⭐', keywords: ['star'] },
      { char: '🏆', keywords: ['trophy', 'win'] },
      { char: '🚀', keywords: ['rocket', 'launch', 'ship it'] },
      { char: '🎯', keywords: ['target', 'bullseye', 'nailed it'] },
      { char: '💥', keywords: ['boom', 'explosion'] },
      { char: '🎁', keywords: ['gift', 'present'] },
    ],
  },
  {
    title: 'Animals',
    icon: 'paw-outline',
    emojis: [
      { char: '🐶', keywords: ['dog'] },
      { char: '🐱', keywords: ['cat'] },
      { char: '🦊', keywords: ['fox'] },
      { char: '🐼', keywords: ['panda'] },
      { char: '🐸', keywords: ['frog'] },
      { char: '🐵', keywords: ['monkey'] },
      { char: '🦄', keywords: ['unicorn'] },
      { char: '🐝', keywords: ['bee'] },
    ],
  },
  {
    title: 'Food',
    icon: 'fast-food-outline',
    emojis: [
      { char: '🍕', keywords: ['pizza'] },
      { char: '🍔', keywords: ['burger'] },
      { char: '🍩', keywords: ['donut'] },
      { char: '🍰', keywords: ['cake'] },
      { char: '☕', keywords: ['coffee'] },
      { char: '🍺', keywords: ['beer'] },
      { char: '🍷', keywords: ['wine'] },
      { char: '🍎', keywords: ['apple'] },
    ],
  },
];

export const ALL_PICKER_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

// One row per reactor -> one pill per distinct emoji, in first-seen order,
// with the reactor list preserved for the view-reactions sheet.
export function groupReactions(reactions) {
  if (!reactions || !reactions.length) return [];
  const order = [];
  const byEmoji = new Map();
  for (const r of reactions) {
    if (!byEmoji.has(r.emoji)) {
      byEmoji.set(r.emoji, { emoji: r.emoji, count: 0, mine: false, reactors: [] });
      order.push(r.emoji);
    }
    const group = byEmoji.get(r.emoji);
    group.count += 1;
    if (r.mine) group.mine = true;
    group.reactors.push({ name: r.name, mine: !!r.mine });
  }
  return order.map((emoji) => byEmoji.get(emoji));
}

export function totalReactionCount(reactions) {
  return reactions?.length ?? 0;
}

// Telegram's default single-reaction-per-person behavior: tapping the
// emoji you already gave removes it; tapping a different one switches
// your reaction to it; anyone else's entries are left untouched.
export function toggleReaction(reactions, emoji, myName = 'You') {
  const list = reactions ?? [];
  const others = list.filter((r) => !r.mine);
  const mine = list.find((r) => r.mine);
  if (mine && mine.emoji === emoji) {
    return others;
  }
  return [...others, { emoji, name: myName, mine: true }];
}
