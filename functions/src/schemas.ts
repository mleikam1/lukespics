import {z} from "zod";
import {GAME_STATUSES, MEMBER_ROLES, PROVIDER_NAMES} from "./types.js";

export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const requestIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const dateSchema = z.coerce.date();

export const mutationBaseSchema = z.object({
  requestId: requestIdSchema,
});

export const teamSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(80),
  abbreviation: z.string().trim().min(1).max(12),
  logoUrl: z.url().nullable().default(null),
});

export const normalizedGameSchema = z
  .object({
    id: idSchema,
    provider: z.enum(PROVIDER_NAMES),
    providerGameId: idSchema,
    // Older stored manual/test games predate this field. Normalize those reads
    // to leagueCode while all newly fetched provider games persist the
    // canonical provider league identifier.
    providerLeagueId: idSchema.optional(),
    sportCode: idSchema,
    leagueCode: idSchema,
    leagueName: z.string().trim().min(1).max(120),
    season: z.string().trim().min(1).max(32),
    weekOrRound: z.string().trim().max(80).nullable().default(null),
    scheduledAtUtc: dateSchema,
    publishedScheduledAtUtc: dateSchema,
    effectiveLockAtUtc: dateSchema,
    venueName: z.string().trim().max(160).nullable().default(null),
    neutralSite: z.boolean().default(false),
    homeTeam: teamSchema,
    awayTeam: teamSchema,
    status: z.enum(GAME_STATUSES),
    homeScore: z.number().int().nonnegative().nullable().default(null),
    awayScore: z.number().int().nonnegative().nullable().default(null),
    winnerTeamId: idSchema.nullable().default(null),
    providerLastUpdatedAt: dateSchema,
    lastSyncedAt: dateSchema,
    manualOverride: z.boolean().default(false),
    manualOverrideReason: z.string().trim().min(3).max(500).nullable().default(null),
    manualOverrideBy: idSchema.nullable().default(null),
    resultVersion: z.string().trim().min(8).max(128),
    sourcePayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .transform((game) => ({
    ...game,
    providerLeagueId: game.providerLeagueId ?? game.leagueCode,
  }))
  .superRefine((game, context) => {
    if (game.homeTeam.id === game.awayTeam.id) {
      context.addIssue({
        code: "custom",
        path: ["awayTeam", "id"],
        message: "Teams must be distinct.",
      });
    }
    if (
      game.winnerTeamId !== null &&
      game.winnerTeamId !== game.homeTeam.id &&
      game.winnerTeamId !== game.awayTeam.id
    ) {
      context.addIssue({
        code: "custom",
        path: ["winnerTeamId"],
        message: "Winner must be one of the two teams.",
      });
    }
  });

const leagueSettingsPatchSchema = z
  .object({
    pickerParticipatesInPicks: z.boolean(),
    pickLockPolicy: z.enum(["perGame", "firstGame"]),
    weekStartDay: z.number().int().min(0).max(6),
    weekStartTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    enabledSports: z.array(idSchema),
    enabledLeagues: z.array(idSchema),
    manualFinalizationRequired: z.boolean(),
    providerName: z.enum(PROVIDER_NAMES),
  })
  .partial();

export const leagueSettingsSchema = leagueSettingsPatchSchema.transform(
  (settings) => ({
    pickerParticipatesInPicks: false,
    pickLockPolicy: "perGame" as const,
    weekStartDay: 1,
    weekStartTime: "09:00",
    enabledSports: [] as string[],
    enabledLeagues: [] as string[],
    manualFinalizationRequired: true,
    providerName: "manual" as const,
    ...settings,
  }),
);

export const ensureUserProfileSchema = mutationBaseSchema.extend({
  displayName: z.string().trim().min(1).max(80).optional(),
  photoUrl: z.url().nullable().optional(),
});

export const createLeagueSchema = mutationBaseSchema.extend({
  name: z.string().trim().min(2).max(80).default("Luke's Picks Arena"),
  timezone: z.string().trim().min(1).max(80).default("America/Chicago"),
  settings: leagueSettingsPatchSchema.default({}),
});

export const joinLeagueSchema = mutationBaseSchema.extend({
  inviteCode: z
    .string()
    .trim()
    .min(16)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  nickname: z.string().trim().min(1).max(80).optional(),
});

export const leagueMutationSchema = mutationBaseSchema.extend({
  leagueId: idSchema,
});

export const leaveLeagueSchema = leagueMutationSchema;

export const rotateInviteCodeSchema = leagueMutationSchema.extend({
  expiresAt: dateSchema.nullable().default(null),
  maxUses: z.number().int().positive().max(10000).nullable().default(null),
});

export const updateLeagueSettingsSchema = leagueMutationSchema.extend({
  settings: leagueSettingsPatchSchema.refine(
    (value) => Object.keys(value).length > 0,
    "At least one setting is required.",
  ),
});

export const updateMemberSchema = leagueMutationSchema
  .extend({
    memberUid: idSchema,
    role: z.enum(MEMBER_ROLES).optional(),
    status: z.enum(["active", "inactive", "removed"]).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "A role or status change is required.",
  });

export const reorderRotationSchema = leagueMutationSchema.extend({
  orderedMemberUids: z.array(idSchema).min(1),
});

export const createDraftWeekSchema = leagueMutationSchema
  .extend({
    sequentialNumber: z.number().int().positive(),
    label: z.string().trim().min(1).max(80),
    startAt: dateSchema,
    endAt: dateSchema,
    pickerUid: idSchema.optional(),
  })
  .refine((value) => value.endAt > value.startAt, {
    path: ["endAt"],
    message: "Week end must be after its start.",
  });

export const weekMutationSchema = leagueMutationSchema.extend({
  weekId: idSchema,
});

const revealCursorUidSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes("/"), "Cursor uid cannot contain a slash.");

export const revealLockedPicksSchema = weekMutationSchema.extend({
  revealCursor: z
    .object({
      gameId: idSchema,
      afterUid: revealCursorUidSchema.nullable().default(null),
    })
    .nullable()
    .default(null),
  revealPageSize: z.number().int().min(1).max(200).default(200),
});

export const assignPickerSchema = weekMutationSchema.extend({
  pickerUid: idSchema,
});

export const saveDraftSlateSchema = weekMutationSchema.extend({
  games: z.array(normalizedGameSchema).default([]),
  removeGameIds: z.array(idSchema).default([]),
  chunkKey: requestIdSchema,
});

export const publishSlateSchema = weekMutationSchema;

export const pickInputSchema = z.object({
  gameId: idSchema,
  selectedTeamId: idSchema,
});

export const submitEntrySchema = weekMutationSchema.extend({
  picks: z.array(pickInputSchema).min(1),
});

export const providerQuerySchema = leagueMutationSchema.extend({
  sportCode: idSchema.optional(),
  leagueCode: idSchema.optional(),
  leagueIdForProvider: idSchema.optional(),
  season: z.string().trim().min(1).max(32).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", {timeZone: value}).format();
        return true;
      } catch {
        return false;
      }
    }, "A valid IANA timezone is required.")
    .optional(),
  dateMode: z
    .enum(["today", "tomorrow", "later", "allDates", "custom"])
    .optional(),
  forceRefresh: z.boolean().default(false),
});

const MAX_CATALOG_RANGE_DAYS = 7;

export const sportsCatalogSchema = providerQuerySchema
  .extend({
    weekId: idSchema,
  })
  .superRefine((value, context) => {
    if ((value.from === undefined) !== (value.to === undefined)) {
      context.addIssue({
        code: "custom",
        path: value.from === undefined ? ["from"] : ["to"],
        message: "Catalog start and end dates must be supplied together.",
      });
      return;
    }
    if (value.from === undefined || value.to === undefined) return;
    const from = new Date(`${value.from}T00:00:00.000Z`);
    const to = new Date(`${value.to}T00:00:00.000Z`);
    const rangeDays =
      Math.floor((to.valueOf() - from.valueOf()) / 86_400_000) + 1;
    if (rangeDays < 1) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Catalog end date must be on or after its start date.",
      });
    } else if (rangeDays > MAX_CATALOG_RANGE_DAYS) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: `Catalog date range cannot exceed ${MAX_CATALOG_RANGE_DAYS} days.`,
      });
    }
  });

export const selectedGamesSchema = weekMutationSchema.extend({
  forceRefresh: z.boolean().default(false),
});

export const gameMutationSchema = weekMutationSchema.extend({
  gameId: idSchema,
});

export const overrideGameSchema = gameMutationSchema.extend({
  status: z.enum(["final", "void", "reviewRequired"]),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  winnerTeamId: idSchema.nullable(),
  reason: z.string().trim().min(10).max(500),
});

export const reasonSchema = weekMutationSchema.extend({
  reason: z.string().trim().min(10).max(500),
});

export const voidGameSchema = gameMutationSchema.extend({
  reason: z.string().trim().min(10).max(500),
});

export const manualGameSchema = weekMutationSchema
  .extend({
    sportCode: idSchema,
    leagueCode: idSchema,
    leagueName: z.string().trim().min(1).max(120),
    season: z.string().trim().min(1).max(32),
    scheduledAtUtc: dateSchema,
    venueName: z.string().trim().max(160).nullable().default(null),
    neutralSite: z.boolean().default(false),
    homeTeam: teamSchema.omit({logoUrl: true}),
    awayTeam: teamSchema.omit({logoUrl: true}),
  })
  .refine((value) => value.homeTeam.id !== value.awayTeam.id, {
    path: ["awayTeam", "id"],
    message: "Teams must be distinct.",
  });

export const deleteAccountSchema = mutationBaseSchema.extend({
  confirmation: z.literal("DELETE"),
});
