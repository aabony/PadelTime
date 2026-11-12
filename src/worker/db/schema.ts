import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Better Auth core tables
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  // Player profile (src/shared/profile.ts) — null until registration is finished.
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  /** ISO date "YYYY-MM-DD". */
  dob: text("dob"),
  /** "woman" | "man". */
  gender: text("gender"),
  /** 1 newbie, 2 beginner, 3 intermediate, 4 advanced. */
  level: integer("level"),
  /** Optional Playtomic level, 0.5–7.0. */
  playtomicLevel: real("playtomic_level"),
  /** Admins run tournaments; set from ADMIN_EMAILS on sign-in. */
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("ix_session_user").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("ix_account_user").on(t.userId)],
);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

// ---------------------------------------------------------------------------
// App tables — timestamps are plain epoch-ms integers
// ---------------------------------------------------------------------------

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  isPersonal: integer("is_personal", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const groupMembers = sqliteTable(
  "group_members",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_group_member").on(t.groupId, t.userId), index("ix_gm_user").on(t.userId)],
);

export const gameSessions = sqliteTable(
  "game_sessions",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    venue: text("venue"),
    startsAt: integer("starts_at"),
    durationMin: integer("duration_min"),
    courts: integer("courts").notNull().default(2),
    /** The courts actually rented, comma-separated ("3,4"); null = numbered 1..n. */
    courtLabels: text("court_labels"),
    maxPlayers: integer("max_players").notNull().default(12),
    pointsPerMatch: integer("points_per_match").notNull().default(24),
    format: text("format").notNull().default("americano"),
    /** Every team is one woman + one man whenever the numbers allow. */
    mixedPairs: integer("mixed_pairs", { mode: "boolean" }).notNull().default(false),
    /** Group players by organizer-set playing level (beginners together, intermediate/advanced together). */
    groupByLevel: integer("group_by_level", { mode: "boolean" }).notNull().default(false),
    /** Keep teams together: partners play the whole night as a pair. */
    fixedTeams: integer("fixed_teams", { mode: "boolean" }).notNull().default(false),
    /** Beginner court: one court is reserved for organizer-tagged newbies, who rotate among themselves. */
    beginnerCourt: integer("beginner_court", { mode: "boolean" }).notNull().default(false),
    /** Which court that is (1-based internal number; players see its rented name). */
    beginnerCourtNo: integer("beginner_court_no").notNull().default(1),
    /** That court is coached instead of played: newbies train there and are left out of the draw. */
    beginnerCourtCoached: integer("beginner_court_coached", { mode: "boolean" }).notNull().default(false),
    /** Competitive sit-outs: after the drop round, the bottom of the table sits. */
    competitiveSitouts: integer("competitive_sitouts", { mode: "boolean" }).notNull().default(false),
    /** The drop: sit-outs rotate fairly up to this round; from the next one the table decides. */
    competitiveAfterRound: integer("competitive_after_round").notNull().default(3),
    /** Finals: called by the organizer mid-session — each round goes to the top of the table, the rest sit. */
    finals: integer("finals", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("draft"),
    inviteCode: text("invite_code").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("ix_gs_group").on(t.groupId)],
);

export const sessionPlayers = sqliteTable(
  "session_players",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    guestName: text("guest_name"),
    status: text("status").notNull().default("confirmed"),
    joinedAt: integer("joined_at").notNull(),
    checkedInAt: integer("checked_in_at"),
    /** Organizer-set level: 1 newbie, 2 beginner, 3 intermediate, 4 advanced; null = not set. Organizer-only. */
    level: integer("level"),
    /** "woman" | "man" | null — drives the mixed-pairs option. */
    gender: text("gender"),
    /** Fixed partner (a session_players id) when the session keeps teams together; both rows point at each other. */
    partnerId: text("partner_id"),
    /** Organizer-tagged newbie: plays on the beginner court when the session has one. Organizer-only. */
    newbie: integer("newbie", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("ix_sp_session").on(t.sessionId),
    uniqueIndex("uq_sp_user").on(t.sessionId, t.userId),
  ],
);

export const rounds = sqliteTable(
  "rounds",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    byesJson: text("byes_json").notNull().default("[]"),
    /** 'main' | 'beginner' (the beginner court's own games, numbered from BEGINNER_TRACK_BASE); null = dealt before the tracks existed. */
    track: text("track"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ix_rounds_session").on(t.sessionId),
    uniqueIndex("uq_round_number").on(t.sessionId, t.number),
  ],
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    court: integer("court").notNull(),
    a1: text("a1").notNull(),
    a2: text("a2").notNull(),
    b1: text("b1").notNull(),
    b2: text("b2").notNull(),
    scoreA: integer("score_a"),
    scoreB: integer("score_b"),
    status: text("status").notNull().default("pending"),
    submittedBy: text("submitted_by"),
    submittedAt: integer("submitted_at"),
    confirmedBy: text("confirmed_by"),
    confirmedAt: integer("confirmed_at"),
  },
  (t) => [index("ix_matches_session").on(t.sessionId), index("ix_matches_round").on(t.roundId)],
);

// Denormalised per-player per-match results (plan §6) — the analytics backbone.
export const playerResults = sqliteTable(
  "player_results",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    roundId: text("round_id").notNull(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull(),
    partnerId: text("partner_id").notNull(),
    pointsFor: integer("points_for").notNull(),
    pointsAgainst: integer("points_against").notNull(),
    result: text("result").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ix_pr_session").on(t.sessionId),
    index("ix_pr_match").on(t.matchId),
    index("ix_pr_player").on(t.playerId),
  ],
);

export const scoreAudit = sqliteTable(
  "score_audit",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    matchId: text("match_id").notNull(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    scoreA: integer("score_a"),
    scoreB: integer("score_b"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_audit_session").on(t.sessionId)],
);
