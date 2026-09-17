// Word banks and scoring for the Typing Speed Test.

import { randomInt } from './random';

// The 200 or so most common English words: the standard bank typing tests use,
// so scores are comparable with the popular sites.
const COMMON =
  `the be of and a to in he have it that for they I with as not on she at by this we you do but from or which one would all will there say who make when can more if no man out other so what time up go about than into could state only new year some take come these know see use get like then first any work now may such give over think most even find day also after way many must look before great back through long where much should well people down own just because good each those feel seem how high too place little world very still nation hand old life tell write become here show house both between need mean call develop under last right move thing general school never same another begin while number part turn real leave might want point form off child few small since against ask late home interest large person end open public follow during present without again hold govern around possible head consider word program problem however lead system set order eye plan run keep face fact group play stand increase early course change help line city put close case force meet once water upon war build hear light unite live every country bring center let side try provide continue name certain power pay result question study woman member until far night always service away report something company week church toward start social room figure nature though young less enough almost read include president nothing yet better big boy cost business value second why clear expect family complete act sense mind experience art next near direct car law industry important girl god several matter usual rather per often kind among white reason action return foot care simple within love human along appear doctor believe speak active student month drive concern best door hope example inform body ever least probable understand reach effect different idea whole control condition field pass fall note special talk particular today measure walk teach low hour type carry rate remain full street easy although record sit determine level local sure receive thus moment spirit train college religion perhaps music grow free cause serve age book board recent sound office cut step class true history position above strong friend necessary add court deal tax support party whether either land material happen education death agree arm mother across quite anything town past view society manage answer break organize half fire lose money stop actually already effort wait department able political learn voice air together shall cover common subject draw short wife treat limit road letter color behind produce send term total university rise century success minute remember purpose test fight watch situation south ago difference stage father table rest bear entire market prepare explain offer plant charge ground west picture hard front lie modern dark surface rule regard dance peace observe future wall farm claim firm operation further pressure property morning amount top outside piece sometimes beside wonder instead trade thousand`
    .split(/\s+/)
    .filter(Boolean);

export const QUOTES = [
  'The quick brown fox jumps over the lazy dog.',
  'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.',
  'All that we see or seem is but a dream within a dream.',
  'Not all those who wander are lost.',
  'The only way to do great work is to love what you do.',
  'In the middle of difficulty lies opportunity.',
  'Whatever you are, be a good one.',
  'It is not the strongest of the species that survives, nor the most intelligent, but the one most responsive to change.',
  'Simplicity is the ultimate sophistication.',
  'You miss one hundred percent of the shots you do not take.',
  'Programs must be written for people to read, and only incidentally for machines to execute.',
  'The best time to plant a tree was twenty years ago. The second best time is now.',
  'Any sufficiently advanced technology is indistinguishable from magic.',
  'Talk is cheap. Show me the code.',
  'Premature optimization is the root of all evil.',
  'There are only two hard things in computer science: cache invalidation and naming things.',
  'A journey of a thousand miles begins with a single step.',
  'Happiness is not something ready made. It comes from your own actions.',
  'Do what you can, with what you have, where you are.',
  'The secret of getting ahead is getting started.',
];

export const MODES = [
  { id: 'words', label: 'Words' },
  { id: 'time', label: 'Time' },
  { id: 'quote', label: 'Quote' },
];

export const WORD_COUNTS = [10, 25, 50, 100];
export const DURATIONS = [15, 30, 60, 120];

// A run of random common words with no two neighbours the same.
export function randomWords(count) {
  const out = [];
  while (out.length < count) {
    const word = COMMON[randomInt(COMMON.length)];
    if (word !== out[out.length - 1]) out.push(word);
  }
  return out;
}

export function randomQuote() {
  return QUOTES[randomInt(QUOTES.length)];
}

// Typing tests count a "word" as five characters, spaces included, so
// scores don't depend on how long the words happened to be.
export function score({ typed, target, seconds }) {
  const minutes = Math.max(seconds, 0.001) / 60;
  const length = Math.min(typed.length, target.length);
  let correct = 0;
  for (let i = 0; i < length; i++) if (typed[i] === target[i]) correct++;
  const errors = typed.length - correct;
  const raw = typed.length / 5 / minutes;
  const wpm = Math.max(0, correct / 5 / minutes);
  const accuracy = typed.length ? correct / typed.length : 1;
  return {
    wpm: Math.round(wpm),
    raw: Math.round(raw),
    accuracy: Math.round(accuracy * 100),
    correct,
    errors,
    characters: typed.length,
  };
}
