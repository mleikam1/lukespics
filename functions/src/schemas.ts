import {z} from "zod";
import {
  GAME_STATUSES,
  MEMBER_ROLES,
  PERSISTED_PROVIDER_NAMES,
  PROVIDER_NAMES,
} from "./types.js";

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
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .nullable()
    .default(null),
  providerTeamId: idSchema.nullable().default(null),
  providerGlobalTeamId: idSchema.nullable().default(null),
});

export const normalizedGameSchema = z
  .object({
    id: idSchema,
    provider: z.enum(PERSISTED_PROVIDER_NAMES),
    providerGameId: idSchema,
    providerScoreId: idSchema.nullable().default(null),
    providerLeagueGameId: idSchema.nullable().default(null),
    providerGlobalGameId: idSchema.nullable().default(null),
    providerGameKey: idSchema.nullable().default(null),
    // Older stored manual/test games predate this field. Normalize those reads
    // to leagueCode while all newly fetched provider games persist the
    // canonical provider league identifier.
    providerLeagueId: idSchema.optional(),
    sportCode: idSchema,
    leagueCode: idSchema,
    leagueName: z.string().trim().min(1).max(120),
    season: z.string().trim().min(1).max(32),
    seasonType: z.string().trim().min(1).max(40).nullable().default(null),
    weekOrRound: z.string().trim().max(80).nullable().default(null),
    scheduledAtUtc: dateSchema.nullable(),
    publishedScheduledAtUtc: dateSchema.nullable(),
    effectiveLockAtUtc: dateSchema.nullable(),
    scheduledDayEastern: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    timeTbd: z.boolean().default(false),
    venueName: z.string().trim().max(160).nullable().default(null),
    venueCity: z.string().trim().max(80).nullable().default(null),
    venueState: z.string().trim().max(80).nullable().default(null),
    venueCountry: z.string().trim().max(80).nullable().default(null),
    neutralSite: z.boolean().default(false),
    homeTeam: teamSchema,
    awayTeam: teamSchema,
    status: z.enum(GAME_STATUSES),
    statusDetail: z.string().trim().max(120).nullable().default(null),
    isClosed: z.boolean().nullable().default(null),
    rescheduledFromLeagueGameId: idSchema.nullable().default(null),
    rescheduledToLeagueGameId: idSchema.nullable().default(null),
    homeScore: z.number().int().nonnegative().nullable().default(null),
    awayScore: z.number().int().nonnegative().nullable().default(null),
    winnerTeamId: idSchema.nullable().default(null),
    broadcast: z.string().trim().max(240).nullable().default(null),
    eventDetail: z.string().trim().max(160).nullable().default(null),
    sourceGameUrl: z.url().nullable().default(null),
    kickoffDisplayText: z.string().trim().max(160).nullable().default(null),
    dateHeading: z.string().trim().max(160).nullable().default(null),
    rawResponseVersion: z.number().int().positive().max(100).default(1),
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
    if (game.timeTbd) {
      for (const field of [
        "scheduledAtUtc",
        "publishedScheduledAtUtc",
        "effectiveLockAtUtc",
      ] as const) {
        if (game[field] !== null) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: "A time-TBD game cannot carry an invented lock instant.",
          });
        }
      }
    } else if (
      game.scheduledAtUtc === null ||
      game.publishedScheduledAtUtc === null ||
      game.effectiveLockAtUtc === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["scheduledAtUtc"],
        message: "A confirmed game requires schedule and lock instants.",
      });
    }
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
    providerBySport: z
      .record(idSchema, z.enum(PROVIDER_NAMES))
      .refine((value) => Object.keys(value).length <= 20, {
        message: "At most 20 per-sport providers may be configured.",
      }),
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
    providerBySport: {} as Record<
      string,
      (typeof PROVIDER_NAMES)[number]
    >,
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

const modernInviteCodePattern = /^[A-Za-z0-9]{8}$/;
const legacyInviteCodePattern = /^[A-Za-z0-9_-]{16,64}$/;

export const joinLeagueSchema = mutationBaseSchema.extend({
  inviteCode: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .transform((value) => modernInviteCodePattern.test(value)
      ? value.toUpperCase()
      : value)
    .refine(
      (value) => modernInviteCodePattern.test(value) ||
        legacyInviteCodePattern.test(value),
      "Invite code format is invalid.",
    ),
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

export const issueArenaInviteSchema = leagueMutationSchema.extend({
  expiresAt: dateSchema.optional(),
  maxUses: z.number().int().positive().max(10000).default(50),
  codeFormatVersion: z.literal(2).optional(),
});

export const revokeArenaInviteSchema = leagueMutationSchema.extend({
  inviteId: idSchema,
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
  // The service validates and writes the full request in one transaction.
  // Bound the batch well below Firestore's transaction limits; the connected
  // client normally submits one changed game at a time.
  picks: z.array(pickInputSchema).min(1).max(100),
});

export const providerQuerySchema = leagueMutationSchema.extend({
  sportCode: idSchema.optional(),
  leagueCode: idSchema.optional(),
  leagueIdForProvider: idSchema.optional(),
  season: z.string().trim().min(1).max(32).optional(),
  seasonType: z.enum(["regular", "postseason"]).optional(),
  week: z.number().int().min(0).max(25).optional(),
  division: z.literal("FBS").optional(),
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

export const collegeFootballScheduleSchema = leagueMutationSchema
  .extend({
    season: z.number().int().min(2000).max(2100),
    seasonType: z.enum(["regular", "postseason"]),
    week: z.number().int().min(0).max(25),
    division: z.literal("FBS").default("FBS"),
  })
  .strict();

export const collegeFootballAdminRefreshSchema =
  collegeFootballScheduleSchema.extend({
    weekId: idSchema,
    reason: z.string().trim().min(3).max(240),
  }).strict();

export const selectedGamesSchema = weekMutationSchema
  .extend({
    forceRefresh: z.boolean().default(false),
    gameId: idSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.gameId !== undefined && !value.forceRefresh) {
      context.addIssue({
        code: "custom",
        path: ["forceRefresh"],
        message: "A one-game provider refresh must be forced.",
      });
    }
  });

export const gameMutationSchema = weekMutationSchema.extend({
  gameId: idSchema,
});

export const overrideGameSchema = gameMutationSchema
  .extend({
    scheduledAtUtc: dateSchema.optional(),
    status: z.enum([
      "scheduled",
      "delayed",
      "postponed",
      "suspended",
      "final",
      "void",
      "reviewRequired",
    ]),
    homeScore: z.number().int().nonnegative().nullable(),
    awayScore: z.number().int().nonnegative().nullable(),
    winnerTeamId: idSchema.nullable(),
    reason: z.string().trim().min(10).max(500),
  })
  .superRefine((value, context) => {
    if (value.status === "final") {
      if (
        value.homeScore === null ||
        value.awayScore === null ||
        value.homeScore === value.awayScore ||
        value.winnerTeamId === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "A final override needs non-tied scores and a winner.",
        });
      }
      return;
    }
    if (value.status === "reviewRequired") {
      if (value.winnerTeamId !== null) {
        context.addIssue({
          code: "custom",
          path: ["winnerTeamId"],
          message: "A review-required game cannot have a winner.",
        });
      }
      return;
    }
    if (
      value.homeScore !== null ||
      value.awayScore !== null ||
      value.winnerTeamId !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "This game status cannot carry scores or a winner.",
      });
    }
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
