// Occasion packs: ready-made requests for the person who couldn't come, so they
// don't have to think of what to ask for. One tap fills the request, ready to edit.
//
// The live packs come from Flagsmith, as the value of the `request_packs` flag
// (JSON shaped like DEFAULT_PACKS below). Editing that value in the Flagsmith
// dashboard changes the ideas on every away screen within seconds. These defaults
// are used until Flagsmith answers, or when the flag is off or its value is invalid.

export type PackItem = { kind: 'see' | 'do' | 'story'; text: string };
export type Packs = Record<string, PackItem[]>;

export const DEFAULT_PACKS: Packs = {
  wedding: [
    { kind: 'see', text: 'Show me Dadi’s face when she sees the bride' },
    { kind: 'see', text: 'Send me a photo of the mehendi on the bride’s hands' },
    { kind: 'do', text: 'Dance one song at the sangeet for me' },
    { kind: 'see', text: 'Show me the baraat arriving' },
    { kind: 'do', text: 'Touch Nani’s feet for me and take her blessing' },
    { kind: 'do', text: 'Put a little haldi on the groom from me' },
    { kind: 'see', text: 'Send me the first photo of the couple after the pheras' },
    { kind: 'story', text: 'Ask Dadi to tell the story of her own wedding day' },
  ],
  diwali: [
    { kind: 'see', text: 'Show me the rangoli before anyone walks on it' },
    { kind: 'do', text: 'Light the first diya for me' },
    { kind: 'see', text: 'Send me a photo of the whole family at the puja' },
    { kind: 'do', text: 'Light one phuljhadi in my name' },
    { kind: 'see', text: 'Show me Mummy’s kitchen full of sweets' },
    { kind: 'do', text: 'Give Papa a hug from me after the puja' },
    { kind: 'story', text: 'Ask Dadi how she celebrated Diwali as a girl' },
  ],
  christmas: [
    { kind: 'see', text: 'Show me the tree when the lights come on' },
    { kind: 'do', text: 'Sing one carol for me' },
    { kind: 'see', text: 'Send me a photo of the table before anyone eats' },
    { kind: 'do', text: 'Put my gift under the tree' },
    { kind: 'see', text: 'Show me everyone in their Christmas jumpers' },
    { kind: 'do', text: 'Give Grandma a hug from me at midnight' },
  ],
  'new year': [
    { kind: 'see', text: 'Show me the countdown at midnight' },
    { kind: 'do', text: 'Make a wish for me at twelve' },
    { kind: 'see', text: 'Send me the first photo of the new year' },
    { kind: 'do', text: 'Raise a toast to me' },
    { kind: 'see', text: 'Show me who’s still dancing at 1 AM' },
    { kind: 'do', text: 'Shout my name when the year turns' },
  ],
  eid: [
    { kind: 'see', text: 'Show me the table after Eid namaz' },
    { kind: 'do', text: 'Give Ammi a hug from me after namaz' },
    { kind: 'see', text: 'Send me a photo of everyone in new clothes' },
    { kind: 'do', text: 'Give the kids their eidi from me' },
    { kind: 'see', text: 'Show me the sheer khurma before it’s gone' },
    { kind: 'do', text: 'Say Eid Mubarak to Nani for me' },
  ],
  birthday: [
    { kind: 'see', text: 'Show me the cake before it’s cut' },
    { kind: 'do', text: 'Sing happy birthday extra loud for me' },
    { kind: 'see', text: 'Send me the birthday face when the candles are lit' },
    { kind: 'do', text: 'Give the first piece of cake from me' },
    { kind: 'see', text: 'Show me the gifts being opened' },
    { kind: 'do', text: 'Give the birthday person a hug from me' },
  ],
  trip: [
    { kind: 'see', text: 'Send me a group photo, and leave a gap for me' },
    { kind: 'see', text: 'Show me the view from where you’re standing' },
    { kind: 'do', text: 'Order my usual and eat it for me' },
    { kind: 'do', text: 'Write my name in the sand' },
    { kind: 'see', text: 'Show me the room you’re all crashing in' },
    { kind: 'do', text: 'Raise a glass to me tonight' },
    { kind: 'see', text: 'Send me the sunset from the top' },
    { kind: 'story', text: 'Tell me the funniest thing that happened today' },
  ],
  gathering: [
    { kind: 'see', text: 'Show me everyone around the table' },
    { kind: 'do', text: 'Give the host a hug from me' },
    { kind: 'see', text: 'Send me a photo of the food before it’s gone' },
    { kind: 'do', text: 'Tell one story about me' },
    { kind: 'see', text: 'Show me who’s laughing the loudest' },
    { kind: 'do', text: 'Save me a plate' },
  ],
};

// Accepts the flag's value only if it has the right shape; otherwise null.
export function parsePacks(value: unknown): Packs | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const data = JSON.parse(value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const packs: Packs = {};
    for (const [occasion, items] of Object.entries(data)) {
      if (!Array.isArray(items)) return null;
      packs[occasion.toLowerCase()] = items
        .filter((i) => i && (i.kind === 'see' || i.kind === 'do' || i.kind === 'story') && typeof i.text === 'string' && i.text.trim())
        .slice(0, 12)
        .map((i) => ({ kind: i.kind, text: String(i.text).trim().slice(0, 140) }));
    }
    return packs;
  } catch {
    return null;
  }
}

export function packFor(packs: Packs, occasion: string): PackItem[] {
  return packs[occasion.toLowerCase()] ?? packs.gathering ?? DEFAULT_PACKS.gathering;
}
