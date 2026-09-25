/**
 * English content for the player: descriptions keyed by the id `core` uses.
 *
 * **The table itself lives in core** (`content/player-text.ts`), because two
 * readers need it and they are not both here: the player, on a card, and the
 * Director, which writes its card options from it. Core's *own* descriptions
 * are the designer's — they say which build a spell suits and where it sits
 * in the pool — and a Director that reads those is handed the answer to the
 * question it is being asked (finding 11). One table, one voice, one place.
 *
 * This file is what makes it a `ContentTable`: names are core's own and are
 * not repeated, so every entry here is a description and nothing else.
 */
import { PLAYER_TEXT } from "@jr/core";
import type { ContentTable } from "./index.ts";

export const EN_CONTENT: ContentTable = Object.fromEntries(
  Object.entries(PLAYER_TEXT).map(([id, description]) => [id, { description }]),
);
