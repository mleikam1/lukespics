import {load, type Cheerio, type CheerioAPI} from "cheerio";
import type {AnyNode} from "domhandler";
import type {GameStatus, NormalizedGame, Team} from "../types.js";
import {sha256} from "../utils.js";
import {finalWinner, withSourceHash} from "./normalization.js";

const CBS_ORIGIN = "https://www.cbssports.com";
const CBS_SCOREBOARD_PREFIX = "/college-football/scoreboard/";
const CBS_LOGO_HOSTS = new Set([
  "sports.cbsimg.net",
  "sportshub.cbsistatic.com",
]);
const MIN_SEASON = 2000;
const MAX_SEASON = 2100;
const MAX_WEEK = 25;
const GAME_CARD_SELECTOR = ".single-score-card";
const TEAM_ROW_SELECTOR = [
  ".team",
  ".team-row",
  "[data-team]",
  "[data-team-name]",
].join(", ");
const DATE_HEADING_SELECTOR = [
  "[data-scoreboard-date]",
  "[data-game-date]",
  "[data-date]",
  ".scoreboard-date",
  ".scoreboard-group-date",
  ".date-header",
  ".game-date-heading",
  "h2",
  "h3",
  "h4",
].join(", ");
const CBS_PROVIDER = "cbsSports" as NormalizedGame["provider"];

export const CBS_COLLEGE_FOOTBALL_PARSER_VERSION = "1.0.0";
export const CBS_COLLEGE_FOOTBALL_LOGO_HOSTS = [...CBS_LOGO_HOSTS] as const;

export type CbsCollegeFootballSeasonType = "regular" | "postseason";

export type CbsCollegeFootballScoreboardInput = {
  season: number;
  seasonType: CbsCollegeFootballSeasonType;
  week: number;
  division?: "FBS";
};

export type CbsCollegeFootballParseContext =
  CbsCollegeFootballScoreboardInput & {
    observedAt?: Date;
  };

export type CbsNormalizedGame = NormalizedGame & {
  /** Public CBS game/preview link already present in the scoreboard HTML. */
  sourceGameUrl: string | null;
  /** Display value as published in the scoreboard, for example "7:30 PM ET". */
  kickoffDisplayText: string | null;
  /** The public date heading associated with this card. */
  dateHeading: string | null;
};

export type CbsCollegeFootballParseResult = {
  games: CbsNormalizedGame[];
  identityConfirmed: boolean;
  explicitNoGames: boolean;
  parserFailure: boolean;
  failureCode: "CBS_PARSE_ZERO_GAMES" | null;
  duplicateCount: number;
  rejectedGameCount: number;
};

type TeamCandidate = {
  name: string;
  slug: string;
  abbreviation: string | null;
  logoUrl: string | null;
};

type VenueCandidate = {
  name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
};

type GameCandidate = {
  origin: "structured" | "card";
  explicitGameId: string | null;
  sourceGameUrl: string | null;
  startTimeUtc: Date | null;
  scheduledDayEastern: string | null;
  kickoffDisplayText: string | null;
  dateHeading: string | null;
  status: GameStatus;
  statusDetail: string | null;
  awayTeam: TeamCandidate;
  homeTeam: TeamCandidate;
  awayScore: number | null;
  homeScore: number | null;
  broadcast: string | null;
  venue: VenueCandidate;
  neutralSite: boolean;
};

type JsonRecord = Record<string, unknown>;

function cleanText(value: unknown, maximumLength = 240): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).replaceAll(/\s+/g, " ").trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, maximumLength);
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSeasonType(value: unknown): value is CbsCollegeFootballSeasonType {
  return value === "regular" || value === "postseason";
}

function isFbsDivision(value: unknown): value is "FBS" {
  return value === "FBS";
}

function validatedInput(
  input: CbsCollegeFootballScoreboardInput,
): Required<CbsCollegeFootballScoreboardInput> {
  if (
    !Number.isInteger(input.season) ||
    input.season < MIN_SEASON ||
    input.season > MAX_SEASON
  ) {
    throw new RangeError(
      `CBS college-football season must be an integer from ${MIN_SEASON} through ${MAX_SEASON}.`,
    );
  }
  if (!isSeasonType(input.seasonType)) {
    throw new TypeError(
      "CBS college-football seasonType must be regular or postseason.",
    );
  }
  // College football publicly labels its opening slate Week 0. It is the one
  // intentional exception to the otherwise positive week-number contract.
  if (
    !Number.isInteger(input.week) ||
    input.week < 0 ||
    input.week > MAX_WEEK
  ) {
    throw new RangeError(
      `CBS college-football week must be an integer from 0 through ${MAX_WEEK}.`,
    );
  }
  if (!isFbsDivision(input.division ?? "FBS")) {
    throw new TypeError("CBS college-football division must be FBS.");
  }
  return {
    season: input.season,
    seasonType: input.seasonType,
    week: input.week,
    division: "FBS",
  };
}

/**
 * Constructs the only CBS URL this integration may request. No caller-provided
 * hostname, path, credentials, fragment, or query string is accepted.
 */
export function buildCbsCollegeFootballScoreboardUrl(
  input: CbsCollegeFootballScoreboardInput,
): URL {
  const valid = validatedInput(input);
  const url = new URL(
    `${CBS_SCOREBOARD_PREFIX}${valid.division}/${valid.season}/${valid.seasonType}/${valid.week}/`,
    CBS_ORIGIN,
  );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.cbssports.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith(CBS_SCOREBOARD_PREFIX) ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("CBS scoreboard URL failed the provider allowlist.");
  }
  return url;
}

export const resolveCbsCollegeFootballScoreboardUrl =
  buildCbsCollegeFootballScoreboardUrl;

function scoreboardPageIdentityConfirmed(
  $: CheerioAPI,
  context: Required<CbsCollegeFootballScoreboardInput>,
): boolean {
  const expected = buildCbsCollegeFootballScoreboardUrl(context);
  for (const element of $(
    "link[rel~='canonical'][href], meta[property='og:url'][content]",
  ).toArray()) {
    const selection = $(element);
    const value = selection.attr("href") ?? selection.attr("content");
    try {
      const candidate = new URL(value ?? "", CBS_ORIGIN);
      if (
        candidate.protocol === expected.protocol &&
        candidate.hostname === expected.hostname &&
        candidate.port === expected.port &&
        candidate.pathname === expected.pathname &&
        candidate.search === "" &&
        candidate.hash === ""
      ) {
        return true;
      }
    } catch {
      // A malformed page identity marker cannot confirm the requested week.
    }
  }

  const title = cleanText($("title").first().text(), 300);
  if (title === null) return false;
  const seasonMatches = new RegExp(`\\b${context.season}\\b`).test(title);
  const weekMatches = new RegExp(
    `\\bWeek\\s+${context.week}\\b`,
    "i",
  ).test(title);
  const divisionMatches = /\bFBS\b/i.test(title);
  const postseasonTitle = /\b(postseason|bowl|playoff)\b/i.test(title);
  const seasonTypeMatches = context.seasonType === "postseason"
    ? postseasonTitle
    : !postseasonTitle;
  return seasonMatches && weekMatches && divisionMatches && seasonTypeMatches;
}

/** Returns a displayable logo URL only for the two scoreboard asset hosts. */
export function sanitizeCbsCollegeFootballLogoUrl(
  value: unknown,
): string | null {
  const text = cleanText(value, 2_048);
  if (text === null) return null;
  try {
    const url = new URL(text);
    if (
      url.protocol !== "https:" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      !CBS_LOGO_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeCbsGameUrl(value: unknown): string | null {
  const text = cleanText(value, 2_048);
  if (text === null) return null;
  try {
    const url = new URL(text, CBS_ORIGIN);
    const approvedGamePath =
      /^\/college-football\/(?:gametracker\/(?:live|preview|recap|playbyplay|boxscore)\/[^/]+|games?\/[^/]+|preview\/[^/]+|recap\/[^/]+)\/?$/i;
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.cbssports.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      !approvedGamePath.test(url.pathname)
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function stableSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 72);
  return slug || `team-${sha256(value).slice(0, 16)}`;
}

function safeIdentifier(value: unknown): string | null {
  const text = cleanText(value, 256);
  if (text === null) return null;
  const safe = text
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^A-Za-z0-9._:-]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 96);
  return safe.length === 0 ? null : safe;
}

function fallbackAbbreviation(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1 && /^[A-Za-z0-9]{2,5}$/.test(words[0] ?? "")) {
    return (words[0] ?? "TEAM").toUpperCase();
  }
  const abbreviation = words
    .map((word) => (/[A-Za-z0-9]/.exec(word))?.[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 8);
  return abbreviation || "TEAM";
}

function normalizedAbbreviation(value: unknown, name: string): string {
  const text = cleanText(value, 12);
  if (text !== null) {
    const safe = text.replaceAll(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (safe.length > 0) return safe.slice(0, 12);
  }
  return fallbackAbbreviation(name);
}

function normalizedTeam(candidate: TeamCandidate): Team {
  const abbreviation = normalizedAbbreviation(
    candidate.abbreviation,
    candidate.name,
  );
  const words = candidate.name.split(/\s+/);
  return {
    id: `cbsSports:ncaaf:${candidate.slug}`,
    name: candidate.name.slice(0, 120),
    shortName: (words.at(-1) ?? candidate.name).slice(0, 80),
    abbreviation,
    logoUrl: candidate.logoUrl,
    providerTeamId: candidate.slug,
    providerGlobalTeamId: null,
  };
}

function firstAttribute(
  selection: Cheerio<AnyNode>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = cleanText(selection.attr(name), 2_048);
    if (value !== null) return value;
  }
  return null;
}

function firstDescendantText(
  root: Cheerio<AnyNode>,
  selectors: readonly string[],
  maximumLength = 240,
): string | null {
  for (const selector of selectors) {
    const selection = root.find(selector).first();
    const value = cleanText(selection.text(), maximumLength);
    if (value !== null) return value;
  }
  return null;
}

function firstDescendantAttribute(
  root: Cheerio<AnyNode>,
  selectors: readonly string[],
  names: readonly string[],
): string | null {
  for (const selector of selectors) {
    const matches = root.find(selector);
    for (const match of matches.toArray()) {
      const value = firstAttribute(root._make(match), names);
      if (value !== null) return value;
    }
  }
  return null;
}

function stripRanking(value: string): string {
  const markedRankRemoved = value
    .replace(/^\s*(?:\(\s*\d{1,2}\s*\)|#\s*\d{1,2}|No\.?\s*\d{1,2})\s*/i, "")
    .trim();
  const bareRank = /^(\d{1,2})\s+(.+)$/.exec(markedRankRemoved);
  if (bareRank === null) return markedRankRemoved;
  const rank = Number(bareRank[1]);
  return rank >= 1 && rank <= 25
    ? (bareRank[2] ?? markedRankRemoved).trim()
    : markedRankRemoved;
}

function teamNameFromRow(row: Cheerio<AnyNode>): string | null {
  const attributeName = firstAttribute(row, [
    "data-team-name",
    "data-name",
    "aria-label",
  ]);
  if (attributeName !== null) return stripRanking(attributeName).slice(0, 120);

  for (const selector of [
    ".team-name-link",
    "[itemprop='name']",
    ".team-name",
    ".team-location",
  ]) {
    const selection = row.find(selector).first();
    if (selection.length === 0) continue;
    const clone = selection.clone();
    clone.find(".rank, .team-rank, [data-rank]").remove();
    const name = cleanText(clone.text(), 120);
    if (name !== null) return stripRanking(name);
  }
  return null;
}

function teamSlugFromHref(value: unknown): string | null {
  const text = cleanText(value, 2_048);
  if (text === null) return null;
  try {
    const url = new URL(text, CBS_ORIGIN);
    const match = /^\/college-football\/teams\/([^/]+)(?:\/|$)/i.exec(url.pathname);
    return match?.[1] === undefined
      ? null
      : stableSlug(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function logoFromSelection(row: Cheerio<AnyNode>): string | null {
  const images = row.find("img");
  for (const image of images.toArray()) {
    const selection = row._make(image);
    for (const attribute of ["src", "data-src", "data-lazy-src"]) {
      const logo = sanitizeCbsCollegeFootballLogoUrl(selection.attr(attribute));
      if (logo !== null) return logo;
    }
  }
  return null;
}

function teamFromRow(row: Cheerio<AnyNode>): TeamCandidate | null {
  const name = teamNameFromRow(row);
  if (name === null || name.length === 0) return null;
  const link = row.find(".team-name-link[href], a[href*='/teams/']").first();
  const explicitSlug = firstAttribute(row, [
    "data-team-slug",
    "data-team-id",
    "data-team",
  ]);
  const slug =
    (explicitSlug === null ? null : stableSlug(explicitSlug)) ??
    teamSlugFromHref(link.attr("href")) ??
    stableSlug(name);
  const abbreviation =
    firstAttribute(row, ["data-abbreviation", "data-team-abbreviation"]) ??
    firstDescendantText(row, [
      ".team-abbreviation",
      ".team-short-name",
      "abbr",
    ], 12);
  return {
    name,
    slug,
    abbreviation,
    logoUrl: logoFromSelection(row),
  };
}

function explicitSideRow(
  card: Cheerio<AnyNode>,
  side: "away" | "home",
): Cheerio<AnyNode> | null {
  const selectors = [
    `[data-side='${side}']`,
    `[data-home-away='${side}']`,
    `[data-team-type='${side}']`,
    `[data-team-role='${side}']`,
    `.${side}-team`,
    `.team-${side}`,
    `.team.${side}`,
  ];
  for (const selector of selectors) {
    for (const element of card.find(selector).toArray()) {
      const selection = card._make(element);
      if (teamFromRow(selection) !== null) return selection;
    }
  }
  return null;
}

function orderedTeamRows(card: Cheerio<AnyNode>): Cheerio<AnyNode>[] {
  const rows: Cheerio<AnyNode>[] = [];
  const seen = new Set<AnyNode>();
  for (const element of card.find(TEAM_ROW_SELECTOR).toArray()) {
    if (seen.has(element)) continue;
    const selection = card._make(element);
    if (selection.parents(TEAM_ROW_SELECTOR).filter(card.find(TEAM_ROW_SELECTOR)).length > 0) {
      continue;
    }
    if (teamFromRow(selection) === null) continue;
    seen.add(element);
    rows.push(selection);
  }
  return rows;
}

function teamsFromCard(
  card: Cheerio<AnyNode>,
): {awayTeam: TeamCandidate; homeTeam: TeamCandidate} | null {
  const explicitAway = explicitSideRow(card, "away");
  const explicitHome = explicitSideRow(card, "home");
  const away = explicitAway === null ? null : teamFromRow(explicitAway);
  const home = explicitHome === null ? null : teamFromRow(explicitHome);
  if (away !== null && home !== null) return {awayTeam: away, homeTeam: home};

  const ordered = orderedTeamRows(card);
  if (away !== null) {
    const remaining = ordered
      .map((row) => teamFromRow(row))
      .find((team) => team !== null && team.slug !== away.slug);
    if (remaining !== undefined && remaining !== null) {
      return {awayTeam: away, homeTeam: remaining};
    }
  }
  if (home !== null) {
    const remaining = ordered
      .map((row) => teamFromRow(row))
      .find((team) => team !== null && team.slug !== home.slug);
    if (remaining !== undefined && remaining !== null) {
      return {awayTeam: remaining, homeTeam: home};
    }
  }

  // CBS public scoreboard cards conventionally render the visitor first and
  // the home team second. This is deliberately the final fallback after all
  // explicit home/away metadata and classes have been exhausted.
  const awayFallback = ordered[0] === undefined ? null : teamFromRow(ordered[0]);
  const homeFallback = ordered[1] === undefined ? null : teamFromRow(ordered[1]);
  return awayFallback === null || homeFallback === null
    ? null
    : {awayTeam: awayFallback, homeTeam: homeFallback};
}

function scoreFromRow(row: Cheerio<AnyNode> | null): number | null {
  if (row === null) return null;
  const raw =
    firstAttribute(row, ["data-score"]) ??
    firstDescendantText(row, [
      "[itemprop='score']",
      ".total-score",
      ".team-score",
      ".score",
    ], 16);
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  return Number(raw);
}

function statusFromText(value: unknown, hasKickoff: boolean): GameStatus {
  const status = cleanText(value, 120)?.toLowerCase() ?? "";
  const compactStatus = status.replaceAll(/[^a-z]/g, "");
  if (compactStatus.includes("eventcompleted")) return "final";
  if (compactStatus.includes("eventinprogress")) return "live";
  if (compactStatus.includes("eventcancelled")) return "cancelled";
  if (compactStatus.includes("eventpostponed")) return "postponed";
  if (compactStatus.includes("eventsuspended")) return "suspended";
  if (compactStatus.includes("eventscheduled")) return "scheduled";
  if (/\b(final|completed?|ended)\b/.test(status)) return "final";
  if (/\b(postponed|ppd)\b/.test(status)) return "postponed";
  if (/\b(cancelled|canceled)\b/.test(status)) return "cancelled";
  if (/\bsuspended\b/.test(status)) return "suspended";
  if (/\bdelayed\b/.test(status)) return "delayed";
  if (
    /\b(halftime|half|in[ -]?progress|live|quarter|q[1-4]|overtime|ot)\b/.test(
      status,
    ) ||
    /\b\d{1,2}:\d{2}\s+(?:left|q[1-4])\b/.test(status)
  ) {
    return "live";
  }
  if (
    /\b(scheduled|pre-?game|upcoming|tbd|tba)\b/.test(status) ||
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/.test(status) ||
    hasKickoff
  ) {
    return "scheduled";
  }
  return "reviewRequired";
}

function validDateParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isoDay(year: number, month: number, day: number): string | null {
  if (!validDateParts(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateHeading(
  value: unknown,
  season: number,
  seasonType: CbsCollegeFootballSeasonType,
): string | null {
  const text = cleanText(value, 160);
  if (text === null) return null;
  const isoMatch = /\b(20\d{2}|2100)-(\d{2})-(\d{2})(?=$|[T\s])/.exec(text);
  if (isoMatch !== null) {
    return isoDay(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }
  const monthMatch = /\b(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:\s*,?\s*(20\d{2}|2100))?\b/i.exec(text);
  if (monthMatch === null) return null;
  const month = MONTHS[(monthMatch[1] ?? "").toLowerCase()];
  if (month === undefined) return null;
  const explicitYear = monthMatch[3];
  const inferredYear =
    explicitYear === undefined
      ? seasonType === "postseason" && month <= 2
        ? season + 1
        : season
      : Number(explicitYear);
  return isoDay(inferredYear, month, Number(monthMatch[2]));
}

function zonedDateTime(
  day: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  const dayParts = day.split("-").map(Number);
  const [year, month, date] = dayParts;
  if (
    year === undefined ||
    month === undefined ||
    date === undefined ||
    !validDateParts(year, month, date)
  ) {
    return null;
  }
  const desired = Date.UTC(year, month - 1, date, hour, minute);
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const displayed = Date.UTC(
      values.year ?? 0,
      (values.month ?? 1) - 1,
      values.day ?? 1,
      values.hour ?? 0,
      values.minute ?? 0,
    );
    const adjustment = desired - displayed;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  const result = new Date(candidate);
  return Number.isNaN(result.valueOf()) ? null : result;
}

function easternDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${fields.year ?? "0000"}-${fields.month ?? "00"}-${fields.day ?? "00"}`;
}

function parseAbsoluteOrEasternTimestamp(
  value: unknown,
  fallbackDay: string | null,
): Date | null {
  const text = cleanText(value, 160);
  if (text === null || /^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  if (/^\d{10,13}$/.test(text)) {
    const numeric = Number(text);
    const parsed = new Date(text.length === 10 ? numeric * 1_000 : numeric);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  }
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  }
  if (fallbackDay === null) return null;
  const time = /\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b(?:\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT))?/i.exec(text);
  if (time === null) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2] ?? "0");
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if ((time[3] ?? "").toUpperCase() === "PM" && hour !== 12) hour += 12;
  if ((time[3] ?? "").toUpperCase() === "AM" && hour === 12) hour = 0;

  const zone = time[4]?.toUpperCase();
  if (zone === undefined) return null;
  const genericZones: Readonly<Record<string, string>> = {
    ET: "America/New_York",
    CT: "America/Chicago",
    MT: "America/Denver",
    PT: "America/Los_Angeles",
  };
  const genericZone = genericZones[zone];
  if (genericZone !== undefined) {
    return zonedDateTime(fallbackDay, hour, minute, genericZone);
  }
  const explicitOffsets: Readonly<Record<string, number>> = {
    EST: -5,
    EDT: -4,
    CST: -6,
    CDT: -5,
    MST: -7,
    MDT: -6,
    PST: -8,
    PDT: -7,
  };
  const offset = explicitOffsets[zone];
  if (offset === undefined) return null;
  const parts = fallbackDay.split("-").map(Number);
  if (parts[0] === undefined || parts[1] === undefined || parts[2] === undefined) {
    return null;
  }
  return new Date(
    Date.UTC(parts[0], parts[1] - 1, parts[2], hour - offset, minute),
  );
}

function cardDateHeadings(
  $: CheerioAPI,
  season: number,
  seasonType: CbsCollegeFootballSeasonType,
): Map<AnyNode, string> {
  const headings = new Map<AnyNode, string>();
  let currentHeading: string | null = null;
  $("*").each((_index, element) => {
    const selection = $(element);
    if (selection.is(GAME_CARD_SELECTOR)) {
      if (currentHeading !== null) headings.set(element, currentHeading);
      return;
    }
    if (selection.closest(GAME_CARD_SELECTOR).length > 0) return;
    if (!selection.is(DATE_HEADING_SELECTOR)) return;
    const candidate =
      firstAttribute(selection, [
        "data-scoreboard-date",
        "data-game-date",
        "data-date",
        "datetime",
      ]) ?? cleanText(selection.text(), 160);
    if (parseDateHeading(candidate, season, seasonType) !== null) {
      currentHeading = candidate;
    }
  });
  return headings;
}

function gameUrlFromCard(card: Cheerio<AnyNode>): string | null {
  const direct = firstAttribute(card, ["data-game-url", "data-event-url"]);
  const directSafe = sanitizeCbsGameUrl(direct);
  if (directSafe !== null) return directSafe;
  for (const link of card.find("a[href]").toArray()) {
    const safe = sanitizeCbsGameUrl(card._make(link).attr("href"));
    if (
      safe !== null &&
      /\/college-football\/(?:gametracker|games?|preview|recap)\//i.test(
        new URL(safe).pathname,
      )
    ) {
      return safe;
    }
  }
  return null;
}

function gameIdFromUrl(value: string | null): string | null {
  if (value === null) return null;
  const pathname = new URL(value).pathname;
  const match = /\/(?:gametracker\/(?:live|preview|recap|playbyplay|boxscore)\/|games?\/)([^/]+)/i.exec(pathname);
  return safeIdentifier(match?.[1]);
}

function venueNameFromCard(card: Cheerio<AnyNode>): string | null {
  const attribute = firstAttribute(card, ["data-venue", "data-venue-name"]);
  if (attribute !== null) return attribute;
  const excludedAncestors = [
    ".tickets",
    ".ticket-link",
    ".editorial",
    ".article",
    "a[href*='ticket']",
    "a[href*='/news/']",
    "a[href*='/story/']",
  ].join(", ");
  for (const selector of [
    "[itemprop='location'] [itemprop='name']",
    "[itemprop='location']",
    ".game-venue",
    ".venue",
    ".game-info .location",
    ".game-location",
    ".location",
  ]) {
    for (const element of card.find(selector).toArray()) {
      const selection = card._make(element);
      if (selection.closest(excludedAncestors).length > 0) continue;
      const value = cleanText(selection.text(), 160);
      if (value !== null) return value;
    }
  }
  return null;
}

function venueFromCard(card: Cheerio<AnyNode>): VenueCandidate {
  return {
    name: venueNameFromCard(card),
    city:
      firstAttribute(card, ["data-venue-city"]) ??
      firstDescendantText(card, ["[itemprop='addressLocality']", ".venue-city"], 80),
    state:
      firstAttribute(card, ["data-venue-state"]) ??
      firstDescendantText(card, ["[itemprop='addressRegion']", ".venue-state"], 80),
    country:
      firstAttribute(card, ["data-venue-country"]) ??
      firstDescendantText(card, ["[itemprop='addressCountry']", ".venue-country"], 80),
  };
}

function cardCandidate(
  $: CheerioAPI,
  element: AnyNode,
  context: Required<CbsCollegeFootballScoreboardInput>,
  heading: string | null,
): GameCandidate | null {
  const card = $(element);
  const teams = teamsFromCard(card);
  if (teams === null || teams.awayTeam.slug === teams.homeTeam.slug) return null;
  const headingValue =
    firstAttribute(card, ["data-game-date", "data-date"]) ?? heading;
  const kickoffDisplayText =
    firstDescendantText(card, [
      "time",
      ".pregame-date",
      ".game-time",
      ".kickoff-time",
    ], 160) ?? firstAttribute(card, ["data-kickoff-display"]);
  const semanticStart =
    firstAttribute(card, [
      "data-start-time",
      "data-start-date",
      "data-game-time",
      "data-kickoff",
      "data-date-time",
    ]) ??
    firstDescendantAttribute(card, [
      "time[datetime]",
      "[itemprop='startDate']",
    ], ["datetime", "content"]);
  const day =
    parseDateHeading(semanticStart, context.season, context.seasonType) ??
    parseDateHeading(headingValue, context.season, context.seasonType) ??
    parseDateHeading(kickoffDisplayText, context.season, context.seasonType);
  const start =
    parseAbsoluteOrEasternTimestamp(semanticStart, day) ??
    parseAbsoluteOrEasternTimestamp(kickoffDisplayText, day);
  const statusDetail =
    firstAttribute(card, ["data-game-status", "data-status"]) ??
    firstDescendantText(card, [
      "[itemprop='eventStatus']",
      ".game-status",
      ".game-status-text",
      ".status",
    ], 120) ??
    kickoffDisplayText;
  const hasPregameMarker = card.find(".pregame, .pregame-date").length > 0;
  const ordered = orderedTeamRows(card);
  const awayRow =
    ordered.find((row) => teamFromRow(row)?.slug === teams.awayTeam.slug) ?? null;
  const homeRow =
    ordered.find((row) => teamFromRow(row)?.slug === teams.homeTeam.slug) ?? null;
  const sourceGameUrl = gameUrlFromCard(card);
  const explicitGameId =
    safeIdentifier(
      firstAttribute(card, ["data-game-id", "data-event-id", "data-cbs-game-id"]),
    ) ?? gameIdFromUrl(sourceGameUrl);
  const neutralText = firstDescendantText(
    card,
    [".neutral-site", "[data-neutral-site]"],
    80,
  );
  return {
    origin: "card",
    explicitGameId,
    sourceGameUrl,
    startTimeUtc: start,
    scheduledDayEastern: start === null ? day : easternDay(start),
    kickoffDisplayText,
    dateHeading: headingValue,
    status: statusFromText(
      statusDetail ?? (hasPregameMarker ? "pregame" : null),
      start !== null,
    ),
    statusDetail,
    awayTeam: teams.awayTeam,
    homeTeam: teams.homeTeam,
    awayScore: scoreFromRow(awayRow),
    homeScore: scoreFromRow(homeRow),
    broadcast:
      firstAttribute(card, ["data-broadcast", "data-network"]) ??
      firstDescendantText(card, [
        "[itemprop='broadcastChannel']",
        ".broadcaster",
        ".broadcast-network",
        ".network",
      ], 240),
    venue: venueFromCard(card),
    neutralSite:
      firstAttribute(card, ["data-neutral-site"])?.toLowerCase() === "true" ||
      card.hasClass("neutral-site") ||
      /neutral\s+site/i.test(neutralText ?? ""),
  };
}

function jsonTypeIncludes(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value.toLowerCase() === expected;
  return (
    Array.isArray(value) &&
    value.some(
      (entry) => typeof entry === "string" && entry.toLowerCase() === expected,
    )
  );
}

function scalarFromJson(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return cleanText(value, 2_048);
  }
  if (!isRecord(value)) return null;
  for (const key of ["value", "name", "@id", "url", "contentUrl"]) {
    const scalar = cleanText(value[key], 2_048);
    if (scalar !== null) return scalar;
  }
  return null;
}

function logoFromJson(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const logo = logoFromJson(item);
      if (logo !== null) return logo;
    }
    return null;
  }
  return sanitizeCbsCollegeFootballLogoUrl(scalarFromJson(value));
}

function teamFromJson(value: unknown): TeamCandidate | null {
  if (typeof value === "string") {
    const name = cleanText(value, 120);
    return name === null
      ? null
      : {
          name,
          slug: stableSlug(name),
          abbreviation: null,
          logoUrl: null,
        };
  }
  if (!isRecord(value)) return null;
  const name = cleanText(value.name, 120);
  if (name === null) return null;
  const urlSlug = teamSlugFromHref(scalarFromJson(value.url));
  const identifier = scalarFromJson(value.identifier) ?? scalarFromJson(value["@id"]);
  return {
    name,
    slug:
      urlSlug ??
      (identifier === null ? null : stableSlug(identifier)) ??
      stableSlug(name),
    abbreviation:
      cleanText(value.abbreviation, 12) ?? cleanText(value.alternateName, 12),
    logoUrl: logoFromJson(value.logo) ?? logoFromJson(value.image),
  };
}

function teamWithRoleFromJson(
  value: unknown,
  side: "away" | "home",
): TeamCandidate | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const role = cleanText(
      entry.homeAway ?? entry.role ?? entry.teamRole ?? entry["@type"],
      40,
    )?.toLowerCase();
    if (role !== undefined && role.includes(side)) {
      return teamFromJson(entry.team ?? entry.competitor ?? entry);
    }
  }
  return null;
}

function scoreFromJson(value: unknown): number | null {
  const text = scalarFromJson(value);
  if (text === null || !/^\d{1,3}$/.test(text)) return null;
  return Number(text);
}

function venueFromJson(value: unknown): VenueCandidate {
  if (typeof value === "string") {
    return {name: cleanText(value, 160), city: null, state: null, country: null};
  }
  if (!isRecord(value)) {
    return {name: null, city: null, state: null, country: null};
  }
  const address = isRecord(value.address) ? value.address : {};
  return {
    name: cleanText(value.name, 160),
    city: cleanText(address.addressLocality ?? value.addressLocality, 80),
    state: cleanText(address.addressRegion ?? value.addressRegion, 80),
    country: cleanText(address.addressCountry ?? value.addressCountry, 80),
  };
}

function broadcastFromJson(event: JsonRecord): string | null {
  const direct = scalarFromJson(
    event.broadcastNetwork ?? event.broadcastChannel ?? event.broadcast,
  );
  if (direct !== null) return direct.slice(0, 240);
  const broadcastEvent = event.broadcastEvent;
  if (isRecord(broadcastEvent)) {
    return cleanText(
      scalarFromJson(broadcastEvent.broadcastService) ?? broadcastEvent.name,
      240,
    );
  }
  return null;
}

function structuredCandidate(
  event: JsonRecord,
  context: Required<CbsCollegeFootballScoreboardInput>,
): GameCandidate | null {
  const awayTeam =
    teamFromJson(event.awayTeam) ??
    teamWithRoleFromJson(event.competitor ?? event.competitors, "away");
  const homeTeam =
    teamFromJson(event.homeTeam) ??
    teamWithRoleFromJson(event.competitor ?? event.competitors, "home");
  if (
    awayTeam === null ||
    homeTeam === null ||
    awayTeam.slug === homeTeam.slug
  ) {
    return null;
  }
  const semanticStart = scalarFromJson(event.startDate);
  const day = parseDateHeading(
    semanticStart,
    context.season,
    context.seasonType,
  );
  const start = parseAbsoluteOrEasternTimestamp(semanticStart, day);
  const sourceGameUrl = sanitizeCbsGameUrl(
    scalarFromJson(event.url) ?? scalarFromJson(event["@id"]),
  );
  const statusDetail = scalarFromJson(event.eventStatus ?? event.status);
  const homeRecord = isRecord(event.homeTeam) ? event.homeTeam : {};
  const awayRecord = isRecord(event.awayTeam) ? event.awayTeam : {};
  return {
    origin: "structured",
    explicitGameId:
      safeIdentifier(scalarFromJson(event.identifier)) ??
      gameIdFromUrl(sourceGameUrl),
    sourceGameUrl,
    startTimeUtc: start,
    scheduledDayEastern: start === null ? day : easternDay(start),
    kickoffDisplayText: semanticStart,
    dateHeading: day,
    status: statusFromText(statusDetail, start !== null),
    statusDetail,
    awayTeam,
    homeTeam,
    awayScore: scoreFromJson(event.awayScore ?? awayRecord.score),
    homeScore: scoreFromJson(event.homeScore ?? homeRecord.score),
    broadcast: broadcastFromJson(event),
    venue: venueFromJson(event.location),
    neutralSite:
      event.neutralSite === true ||
      cleanText(event.gameLocation, 40)?.toLowerCase() === "neutral",
  };
}

/**
 * Walks only JSON-LD containers that can designate the page's primary event
 * data. Arbitrary recursive traversal would also ingest SportsEvent objects
 * from related stories, recommendations, or other embedded widgets.
 */
function collectStructuredEvents(value: unknown, events: JsonRecord[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectStructuredEvents(entry, events);
    return;
  }
  if (!isRecord(value)) return;
  if (
    jsonTypeIncludes(value["@type"], "sportsevent") ||
    jsonTypeIncludes(value["@type"], "sports event")
  ) {
    events.push(value);
    return;
  }
  for (const key of [
    "@graph",
    "mainEntity",
    "itemListElement",
    "item",
    "event",
    "events",
  ] as const) {
    collectStructuredEvents(value[key], events);
  }
}

function structuredCandidates(
  $: CheerioAPI,
  context: Required<CbsCollegeFootballScoreboardInput>,
): {candidates: GameCandidate[]; rejectedGameCount: number} {
  const candidates: GameCandidate[] = [];
  let rejectedGameCount = 0;
  $("script[type='application/ld+json']").each((_index, script) => {
    const source = $(script).text().trim();
    if (source.length === 0) return;
    try {
      const decoded: unknown = JSON.parse(source);
      const events: JsonRecord[] = [];
      collectStructuredEvents(decoded, events);
      for (const event of events) {
        const candidate = structuredCandidate(event, context);
        if (candidate !== null) {
          candidates.push(candidate);
        } else if (
          event.awayTeam !== undefined ||
          event.homeTeam !== undefined ||
          event.competitor !== undefined ||
          event.competitors !== undefined
        ) {
          rejectedGameCount += 1;
        }
      }
    } catch {
      // Malformed unrelated JSON-LD must not prevent semantic-card fallback.
    }
  });
  return {candidates, rejectedGameCount};
}

function candidateIdentityKeys(candidate: GameCandidate): string[] {
  const keys: string[] = [];
  if (candidate.explicitGameId !== null) {
    keys.push(`id:${candidate.explicitGameId.toLowerCase()}`);
  }
  if (candidate.sourceGameUrl !== null) {
    keys.push(`url:${new URL(candidate.sourceGameUrl).pathname.toLowerCase()}`);
  }
  const kickoff =
    candidate.startTimeUtc?.toISOString() ??
    candidate.scheduledDayEastern ??
    "date-tbd";
  keys.push(
    `match:${kickoff}:${candidate.awayTeam.slug}:${candidate.homeTeam.slug}`,
  );
  return keys;
}

function mergeTeam(primary: TeamCandidate, fallback: TeamCandidate): TeamCandidate {
  return {
    name: primary.name,
    slug: primary.slug,
    abbreviation: primary.abbreviation ?? fallback.abbreviation,
    logoUrl: primary.logoUrl ?? fallback.logoUrl,
  };
}

function mergeCandidate(
  primary: GameCandidate,
  fallback: GameCandidate,
): GameCandidate {
  const status = strongerGameStatus(primary.status, fallback.status);
  const fallbackStatusWon =
    status === fallback.status && status !== primary.status;
  return {
    ...primary,
    explicitGameId: primary.explicitGameId ?? fallback.explicitGameId,
    sourceGameUrl: primary.sourceGameUrl ?? fallback.sourceGameUrl,
    startTimeUtc: primary.startTimeUtc ?? fallback.startTimeUtc,
    scheduledDayEastern:
      primary.scheduledDayEastern ?? fallback.scheduledDayEastern,
    kickoffDisplayText:
      primary.kickoffDisplayText ?? fallback.kickoffDisplayText,
    dateHeading: primary.dateHeading ?? fallback.dateHeading,
    status,
    statusDetail: fallbackStatusWon
      ? fallback.statusDetail ?? primary.statusDetail
      : primary.statusDetail ?? fallback.statusDetail,
    awayTeam: mergeTeam(primary.awayTeam, fallback.awayTeam),
    homeTeam: mergeTeam(primary.homeTeam, fallback.homeTeam),
    awayScore: primary.awayScore ?? fallback.awayScore,
    homeScore: primary.homeScore ?? fallback.homeScore,
    broadcast: primary.broadcast ?? fallback.broadcast,
    venue: {
      name: primary.venue.name ?? fallback.venue.name,
      city: primary.venue.city ?? fallback.venue.city,
      state: primary.venue.state ?? fallback.venue.state,
      country: primary.venue.country ?? fallback.venue.country,
    },
    neutralSite: primary.neutralSite || fallback.neutralSite,
  };
}

function strongerGameStatus(
  primary: GameStatus,
  fallback: GameStatus,
): GameStatus {
  const strength: Readonly<Record<GameStatus, number>> = {
    reviewRequired: 0,
    scheduled: 1,
    delayed: 2,
    postponed: 2,
    suspended: 2,
    live: 3,
    cancelled: 4,
    void: 4,
    final: 4,
  };
  return strength[fallback] > strength[primary] ? fallback : primary;
}

function normalizedCandidate(
  candidate: GameCandidate,
  context: Required<CbsCollegeFootballScoreboardInput>,
  observedAt: Date,
): CbsNormalizedGame | null {
  const providerGameId =
    candidate.explicitGameId ??
    `fallback-${sha256({
      source: "cbsSports",
      season: context.season,
      seasonType: context.seasonType,
      week: context.week,
      kickoff:
        candidate.startTimeUtc?.toISOString() ??
        candidate.scheduledDayEastern ??
        "TBD",
      awayTeam: candidate.awayTeam.slug,
      homeTeam: candidate.homeTeam.slug,
    }).slice(0, 32)}`;
  const awayTeam = normalizedTeam(candidate.awayTeam);
  const homeTeam = normalizedTeam(candidate.homeTeam);
  const winner = finalWinner(
    candidate.status,
    homeTeam.id,
    awayTeam.id,
    candidate.homeScore,
    candidate.awayScore,
  );
  const timeTbd = candidate.startTimeUtc === null;
  const normalized = withSourceHash(
    {
      id: `cbsSports:NCAAF:${providerGameId}`,
      provider: CBS_PROVIDER,
      providerGameId,
      providerScoreId: null,
      providerLeagueGameId: providerGameId,
      providerGlobalGameId: null,
      providerGameKey: providerGameId,
      providerLeagueId: context.division,
      sportCode: "NCAAF",
      leagueCode: "ncaaf",
      leagueName: "NCAA Football",
      season: String(context.season),
      seasonType: context.seasonType,
      weekOrRound: String(context.week),
      scheduledAtUtc: candidate.startTimeUtc,
      publishedScheduledAtUtc: candidate.startTimeUtc,
      effectiveLockAtUtc: candidate.startTimeUtc,
      scheduledDayEastern: candidate.scheduledDayEastern,
      timeTbd,
      venueName: candidate.venue.name,
      venueCity: candidate.venue.city,
      venueState: candidate.venue.state,
      venueCountry: candidate.venue.country,
      neutralSite: candidate.neutralSite,
      homeTeam,
      awayTeam,
      status: winner.status,
      statusDetail: candidate.statusDetail,
      isClosed: winner.status === "final" ? true : null,
      rescheduledFromLeagueGameId: null,
      rescheduledToLeagueGameId: null,
      homeScore: candidate.homeScore,
      awayScore: candidate.awayScore,
      winnerTeamId: winner.winnerTeamId,
      broadcast: candidate.broadcast,
      eventDetail: null,
      sourceGameUrl: candidate.sourceGameUrl,
      kickoffDisplayText: candidate.kickoffDisplayText,
      dateHeading: candidate.dateHeading,
      rawResponseVersion: 1,
      providerLastUpdatedAt: observedAt,
      lastSyncedAt: observedAt,
      manualOverride: false,
      manualOverrideReason: null,
      manualOverrideBy: null,
    },
    {
      parserVersion: CBS_COLLEGE_FOOTBALL_PARSER_VERSION,
      providerGameId,
      sourceGameUrl: candidate.sourceGameUrl,
      startTimeUtc: candidate.startTimeUtc,
      scheduledDayEastern: candidate.scheduledDayEastern,
      kickoffDisplayText: candidate.kickoffDisplayText,
      dateHeading: candidate.dateHeading,
      status: winner.status,
      statusDetail: candidate.statusDetail,
      awayTeam,
      homeTeam,
      awayScore: candidate.awayScore,
      homeScore: candidate.homeScore,
      broadcast: candidate.broadcast,
      venue: candidate.venue,
      neutralSite: candidate.neutralSite,
    },
  );
  return {
    ...normalized,
    sourceGameUrl: candidate.sourceGameUrl,
    kickoffDisplayText: candidate.kickoffDisplayText,
    dateHeading: candidate.dateHeading,
  };
}

function pageExplicitlyHasNoGames($: CheerioAPI): boolean {
  const scoreboardScope = [
    "[data-scoreboard]",
    "[data-scoreboard-root]",
    ".scoreboard",
    ".scoreboard-page",
    ".scoreboard-container",
    ".college-football-scoreboard",
  ].join(", ");
  for (const element of $(
    [
      "[data-no-games='true']",
      "[data-empty-scoreboard='true']",
      ".no-games",
      ".no-games-message",
      ".scoreboard-empty",
      ".empty-scoreboard",
    ].join(", "),
  ).toArray()) {
    const selection = $(element);
    if (!selection.is(scoreboardScope) && selection.closest(scoreboardScope).length === 0) {
      continue;
    }
    const text = cleanText(selection.text(), 240) ?? "";
    if (
      /\b(?:no games?(?: are)? (?:scheduled|available)|there are no games?|no matchups?)\b/i.test(
        text,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Parses only the supplied public scoreboard document. The HTML exists solely
 * in this call's memory; diagnostics and source hashes contain normalized
 * factual fields, never the raw page or editorial/betting content.
 */
export function parseCbsCollegeFootballScoreboardHtml(
  html: string,
  input: CbsCollegeFootballParseContext,
): CbsCollegeFootballParseResult {
  if (typeof html !== "string") {
    throw new TypeError("CBS scoreboard HTML must be a string.");
  }
  const context = validatedInput(input);
  const observedAt = input.observedAt ?? new Date();
  if (Number.isNaN(observedAt.valueOf())) {
    throw new TypeError("CBS parser observedAt must be a valid Date.");
  }
  // The parser never returns Cheerio nodes or source strings, ensuring the
  // scoreboard document becomes unreachable as soon as this function exits.
  const $ = load(html);
  const identityConfirmed = scoreboardPageIdentityConfirmed($, context);
  const structured = structuredCandidates($, context);
  let rejectedGameCount = structured.rejectedGameCount;
  const headings = cardDateHeadings($, context.season, context.seasonType);
  const cardCandidates: GameCandidate[] = [];
  $(GAME_CARD_SELECTOR).each((_index, element) => {
    const candidate = cardCandidate(
      $,
      element,
      context,
      headings.get(element) ?? null,
    );
    if (candidate === null) rejectedGameCount += 1;
    else cardCandidates.push(candidate);
  });

  const merged: GameCandidate[] = [];
  const identityToIndex = new Map<string, number>();
  let duplicateCount = 0;
  for (const candidate of [...structured.candidates, ...cardCandidates]) {
    const keys = candidateIdentityKeys(candidate);
    const existingIndex = keys
      .map((key) => identityToIndex.get(key))
      .find((index) => index !== undefined);
    if (existingIndex === undefined) {
      const nextIndex = merged.length;
      merged.push(candidate);
      for (const key of keys) identityToIndex.set(key, nextIndex);
      continue;
    }
    const existing = merged[existingIndex];
    if (existing === undefined) continue;
    if (existing.origin === candidate.origin) duplicateCount += 1;
    const combined = mergeCandidate(existing, candidate);
    merged[existingIndex] = combined;
    for (const key of candidateIdentityKeys(combined)) {
      identityToIndex.set(key, existingIndex);
    }
  }

  const normalized: CbsNormalizedGame[] = [];
  const normalizedIds = new Set<string>();
  for (const candidate of merged) {
    const game = normalizedCandidate(candidate, context, observedAt);
    if (game === null) {
      rejectedGameCount += 1;
      continue;
    }
    if (normalizedIds.has(game.providerGameId)) {
      duplicateCount += 1;
      continue;
    }
    normalizedIds.add(game.providerGameId);
    normalized.push(game);
  }
  normalized.sort((left, right) => {
    const leftStart = left.scheduledAtUtc?.valueOf() ?? Number.MAX_SAFE_INTEGER;
    const rightStart = right.scheduledAtUtc?.valueOf() ?? Number.MAX_SAFE_INTEGER;
    return leftStart - rightStart || left.providerGameId.localeCompare(right.providerGameId);
  });

  const explicitNoGames = pageExplicitlyHasNoGames($);
  const parserFailure = normalized.length === 0 && !explicitNoGames;
  return {
    games: normalized,
    identityConfirmed,
    explicitNoGames,
    parserFailure,
    failureCode: parserFailure ? "CBS_PARSE_ZERO_GAMES" : null,
    duplicateCount,
    rejectedGameCount,
  };
}

export const parseCbsCollegeFootballHtml =
  parseCbsCollegeFootballScoreboardHtml;
