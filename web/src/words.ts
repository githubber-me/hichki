// The feature names, in the room's language. The host picks it when creating the
// gathering. "Hichki" is the name everywhere: it is never swapped for another
// language's word, only written in the room's script (हिचकी, ಹಿಚ್ಕಿ, ஹிச்கி...).
// The feature names are written in Roman letters, the way people type them on a phone.
// Hindi is the default. Rows other than Hindi, English and Kannada should be checked
// by native speakers.

export type RoomLang = 'hi' | 'en' | 'kn' | 'ta' | 'te' | 'bn' | 'mr' | 'gu' | 'pa' | 'ml';

export type Words = {
  behalf: string; // Meri taraf se: someone does something on your behalf
  letter: string; // Jab kholna: a voice letter that opens at a moment
  story: string; // Dadi ki kahani: an elder's story
  memories: string; // Yaadein: what the celebration leaves behind
  duty: string; // Duty pe: working through the celebration
};

export const ROOM_LANGS: [RoomLang, string][] = [
  ['hi', 'Hindi'],
  ['en', 'English'],
  ['kn', 'Kannada'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['bn', 'Bengali'],
  ['mr', 'Marathi'],
  ['gu', 'Gujarati'],
  ['pa', 'Punjabi'],
  ['ml', 'Malayalam'],
];

const WORDS: Record<RoomLang, Words> = {
  hi: { behalf: 'Meri taraf se', letter: 'Jab kholna', story: 'Dadi ki kahani', memories: 'Yaadein', duty: 'Duty pe' },
  en: { behalf: 'On my behalf', letter: 'Open when', story: 'Grandma’s story', memories: 'Memories', duty: 'On duty' },
  kn: { behalf: 'Nanna paravaagi', letter: 'Yaavaga terebeku', story: 'Ajji kathe', memories: 'Nenapugalu', duty: 'Duty alli' },
  ta: { behalf: 'En saarbaaga', letter: 'Eppo thirakkanum', story: 'Paati kadhai', memories: 'Ninaivugal', duty: 'Duty-la' },
  te: { behalf: 'Naa tarapuna', letter: 'Eppudu teravaali', story: 'Ammamma katha', memories: 'Gnaapakaalu', duty: 'Duty lo' },
  bn: { behalf: 'Amar hoye', letter: 'Jokhon khulbe', story: 'Thakumar jhuli', memories: 'Smriti', duty: 'Duty te' },
  mr: { behalf: 'Mazhya tarfe', letter: 'Jevha ughdal', story: 'Aajichi goshta', memories: 'Athavani', duty: 'Duty var' },
  gu: { behalf: 'Mara taraf thi', letter: 'Jyare kholo', story: 'Baa ni vaarta', memories: 'Yaado', duty: 'Duty par' },
  pa: { behalf: 'Meri taraf ton', letter: 'Jado kholna', story: 'Daadi di kahani', memories: 'Yaadan', duty: 'Duty te' },
  ml: { behalf: 'Ente perkku', letter: 'Eppol thurakkanam', story: 'Ammoommayude katha', memories: 'Ormakal', duty: 'Duty-il' },
};

// "Hichki" itself, written in each room's script. Same word, never translated.
export const HICHKI_SCRIPT: Record<RoomLang, string> = {
  hi: 'हिचकी',
  en: 'Hichki',
  kn: 'ಹಿಚ್ಕಿ',
  ta: 'ஹிச்கி',
  te: 'హిచ్కీ',
  bn: 'হিচকি',
  mr: 'हिचकी',
  gu: 'હિચકી',
  pa: 'ਹਿਚਕੀ',
  ml: 'ഹിച്കി',
};

// HTML lang codes, so phones pick the right font for each script.
const SCRIPT_LANG: Record<RoomLang, string> = { hi: 'hi', en: 'en', kn: 'kn', ta: 'ta', te: 'te', bn: 'bn', mr: 'mr', gu: 'gu', pa: 'pa', ml: 'ml' };

// One gathering per page, so the current room language is kept here. Screens set it
// as soon as they know the gathering.
let current: RoomLang = 'hi';

export function setRoomLang(lang: string | null | undefined) {
  current = lang && lang in WORDS ? (lang as RoomLang) : 'hi';
}

// The feature names for the current room.
export function w(): Words {
  return WORDS[current];
}

// The plain English meaning, shown small next to a name when the room isn't in English.
export function gloss(english: string): string | null {
  return current === 'en' ? null : english;
}

// "Hichki" in this room's script, with its lang code.
export function hichkiWord(): { text: string; lang: string } {
  return { text: HICHKI_SCRIPT[current], lang: SCRIPT_LANG[current] };
}

// "Someone remembered you": the Hindi line in Hindi rooms, plain English elsewhere,
// so no room shows a sentence in a language it didn't choose.
export function rememberedLine(from?: string): { text: string; lang: string } {
  if (current === 'hi') return { text: from ? `${from} ने याद किया` : 'किसी ने याद किया', lang: 'hi' };
  return { text: from ? `${from} remembered you` : 'Someone remembered you', lang: 'en' };
}

// The count on the memories page: "12 बार याद किया" or "12 times remembered".
export function rememberedCount(): { text: string; lang: string } {
  return current === 'hi' ? { text: 'बार याद किया', lang: 'hi' } : { text: 'times remembered', lang: 'en' };
}
