/**
 * English content for the player: descriptions keyed by the id `core` uses.
 *
 * The table itself lives in core (`content/player-text.ts`) so the tests that
 * walk core's pools can check every offerable card has a player line. It is
 * the player's text only: the Director is sent core's own neutral
 * `description` instead (doc 006, "What a spell tells Jev"; finding 11), so
 * this copy can be rewritten freely without moving a single plan.
 *
 * This file is what makes it a `ContentTable`: names are core's own and are
 * not repeated, so every entry here is a description and nothing else.
 */
import { PLAYER_TEXT } from "@jr/core";
import type { ContentTable } from "./index.ts";

export const EN_CONTENT: ContentTable = Object.fromEntries(
  Object.entries(PLAYER_TEXT).map(([id, description]) => [id, { description }]),
);
