/**
 * Story data types — shared between story reader and story tools.
 *
 * Mirrors PRTS-MCP's storyReader.ts types but adapted to Endfield's
 * data shape (conv files have actor/text inline, not name/content props).
 */

/** A single line in a dialogue scene, normalized to two kinds. */
export interface StoryLine {
  /** "dialog" (spoken by a character) or "narration" (stage text). Player
   *  choices live in StoryScene.choices, not in the lines array — Endfield's
   *  data puts them in a separate optionGroups structure. */
  type: "dialog" | "narration";
  /** Speaker display name for dialog lines; null for narration. */
  role: string | null;
  /** The line text. */
  text: string;
}

/** One entry in the story catalog (one dialogue scene). */
export interface StoryEntry {
  /** Conv key — also the filename stem under conv/. */
  key: string;
  /** Source domain: black, dlg, cutscene, env, mail, sns, etc. */
  domain: string;
  /** Mission id, e.g. "e1m1", "a1m6d2", "sm1l1m1". */
  mission: string;
  /** Scene number within the mission. */
  scene: number;
  /** Content type tag: e (episode), c (character), sm (side), etc. */
  type: string;
  /** Number of actors in the scene. */
  actorCount: number;
  /** Number of lines. */
  lineCount: number;
  /** Preview snippet (first line text). */
  preview: string;
  /** Category tags. */
  tags: string[];
}

/** A chapter grouping of story entries. */
export interface StoryChapter {
  /** Chapter id, e.g. "e1", "e2", "sm1", "c6". */
  chapterId: string;
  /** Display name, resolved from missions.json where possible. */
  displayName: string;
  /** Number of scenes in this chapter. */
  entryCount: number;
}

/** A fully-loaded dialogue scene (conv file parsed). */
export interface StoryScene {
  /** Conv key. */
  key: string;
  /** Mission id. */
  mission: string;
  /** Mission display name (from missions.json). */
  missionName: string;
  /** Scene number. */
  scene: number;
  /** Parsed lines. */
  lines: StoryLine[];
  /** Player choice options, if any. */
  choices: Array<{ index: number; text: string }>;
}
