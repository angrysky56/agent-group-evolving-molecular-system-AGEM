/**
 * typedb-claims.ts
 *
 * TypeDB-backed claim store. Holds extracted claims as schema-enforced n-ary
 * relations with named roles and mandatory provenance.
 *
 * WHY THIS EXISTS
 *   The concept graph records that two lemmas were near each other. It cannot
 *   record that IIT *excludes* broadcast, so a formalizer reading it has to
 *   guess — and guessed wrong three times on one corpus (3, then 6, then 2
 *   contradictions; IIT/GWT flipped from contradictory to consistent because
 *   the exclusion silently vanished from the encoding).
 *
 *   Here the shape is a contract. `exclusion` requires both roles; a claim
 *   requires at least one source segment; `causal-claim` requires a polarity.
 *   An extraction that loses the negation cannot be written at all — verified
 *   against a live server (see schema/contract-probe.sh):
 *       [CNT5]  Constraint '@card(1..1)' violated: found 0 instances
 *       [DVL11] relation type 'exclusion' has a relates constraint violation
 *
 * DEGRADATION
 *   TypeDB is OPTIONAL. AGEM ran without it and must keep running without it.
 *   Every method is safe to call when the server is down or unconfigured; the
 *   store reports `available: false` and callers fall back. It must never be
 *   possible for a missing database to take the reasoning engine offline.
 */

import {
  TypeDBHttpDriver,
  isOkResponse,
  type ApiResponse,
  type TransactionType,
} from "@typedb/driver-http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { settings } from "../config.js";

/** Schemas are ordered: findings.tql refers to types defined by claims.tql. */
export const SCHEMA_RELATIVE_PATHS = [
  path.join("schema", "claims.tql"),
  path.join("schema", "findings.tql"),
] as const;

export interface ClaimStoreStatus {
  available: boolean;
  database: string;
  address: string;
  serverVersion?: string;
  /** Present when unavailable — says what to do about it, not just that it failed. */
  note?: string;
}

export interface StoredJointIncompatibility {
  claimId: string;
  claimKey: string;
  scope: "corpus" | "position";
  incompatible: string[];
  sourceSegmentIds: string[];
}

/**
 * Connection settings. Defaults come from config; overrides exist so the
 * degradation path is testable — `settings` parses process.env once at module
 * load, so a test cannot simulate "server is down" by mutating the environment.
 */
export interface ClaimStoreOptions {
  enabled?: boolean;
  address?: string;
  database?: string;
  username?: string;
  password?: string;
}

export class TypeDBClaimStore {
  #driver: TypeDBHttpDriver | null = null;
  #available = false;
  #note: string | undefined;
  #serverVersion: string | undefined;
  readonly #opts: Required<ClaimStoreOptions>;

  constructor(overrides: ClaimStoreOptions = {}) {
    this.#opts = {
      enabled: overrides.enabled ?? settings.all.TYPEDB_ENABLED,
      address: overrides.address ?? settings.all.TYPEDB_ADDRESS,
      database: overrides.database ?? settings.all.TYPEDB_DATABASE,
      username: overrides.username ?? settings.all.TYPEDB_USERNAME,
      password: overrides.password ?? settings.all.TYPEDB_PASSWORD,
    };
  }

  get available(): boolean {
    return this.#available;
  }

  status(): ClaimStoreStatus {
    return {
      available: this.#available,
      database: this.#opts.database,
      address: this.#opts.address,
      serverVersion: this.#serverVersion,
      note: this.#note,
    };
  }

  /**
   * Connect, create the database if absent, and define the schema.
   *
   * Idempotent: safe on every boot. `define` on an already-defined schema is a
   * no-op in TypeDB, so this converges rather than erroring on restart.
   *
   * Never throws. A failure here disables the claim store and leaves the rest
   * of AGEM untouched.
   */
  async initialize(projectRoot: string): Promise<ClaimStoreStatus> {
    if (!this.#opts.enabled) {
      this.#available = false;
      this.#note = "TYPEDB_ENABLED=false — claim store off by configuration.";
      return this.status();
    }

    try {
      this.#driver = new TypeDBHttpDriver({
        username: this.#opts.username,
        password: this.#opts.password,
        addresses: [this.#opts.address],
      });

      const health = await this.#driver.health();
      if (!isOkResponse(health)) {
        return this.#disable(
          `no TypeDB at ${this.#opts.address}. Start it with ` +
            `\`typedb server\` (see README → TypeDB claim store), or set ` +
            `TYPEDB_ENABLED=false to silence this.`,
        );
      }

      const version = await this.#driver.version();
      if (isOkResponse(version)) {
        this.#serverVersion = (version.ok as { version?: string })?.version;
      }

      const dbs = await this.#driver.getDatabases();
      if (!isOkResponse(dbs)) return this.#disable("could not list databases.");
      const names = (dbs.ok?.databases ?? []).map((d) => d.name);

      if (!names.includes(this.#opts.database)) {
        const created = await this.#driver.createDatabase(
          this.#opts.database,
        );
        if (!isOkResponse(created))
          return this.#disable(
            `could not create database '${this.#opts.database}'.`,
          );
      }

      for (const relativePath of SCHEMA_RELATIVE_PATHS) {
        const schema = await readFile(path.join(projectRoot, relativePath), "utf8");
        const defined = await this.#query(schema, "schema", true);
        if (!isOkResponse(defined)) {
          return this.#disable(
            `schema define failed (${relativePath}): ${describeError(defined)}`,
          );
        }
      }

      this.#available = true;
      this.#note = undefined;
      console.log(
        `[TypeDBClaimStore] ready — ${this.#opts.database} @ ` +
          `${this.#opts.address}` +
          (this.#serverVersion ? ` (server ${this.#serverVersion})` : ""),
      );
      return this.status();
    } catch (e: unknown) {
      return this.#disable(
        `connection failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Run a write query. Returns the raw driver response so callers can inspect
   * constraint violations — a REJECTED write is a finding about the extraction,
   * not an incident to swallow.
   */
  async write(query: string): Promise<ApiResponse | null> {
    if (!this.#available || !this.#driver) return null;
    return this.#query(query, "write", true);
  }

  /** Run a read query. Null when the store is unavailable. */
  async read(query: string): Promise<ApiResponse | null> {
    if (!this.#available || !this.#driver) return null;
    return this.#query(query, "read", false);
  }

  /** Read an n-ary claim without projecting it into pairwise edges. */
  async readJointIncompatibility(
    claimId: string,
  ): Promise<StoredJointIncompatibility | null> {
    if (!claimId.trim()) return null;
    const response = await this.read(`match
  $claim isa joint-incompatibility,
    has claim-id "${escapeTypeQLString(claimId)}",
    has claim-key $claimKey,
    has claim-scope $scope,
    links (incompatible: $member, source: $source);
  $member has label $label;
  $source has segment-id $segmentId;
fetch {
  "claimId": "${escapeTypeQLString(claimId)}",
  "claimKey": $claimKey,
  "scope": $scope,
  "member": $label,
  "sourceSegmentId": $segmentId
};`);
    return parseStoredJointIncompatibility(response, claimId);
  }

  async #query(
    query: string,
    kind: TransactionType,
    commit: boolean,
  ): Promise<ApiResponse> {
    return this.#driver!.oneShotQuery(
      query,
      commit,
      this.#opts.database,
      kind,
    );
  }

  #disable(note: string): ClaimStoreStatus {
    this.#available = false;
    this.#note = note;
    // Warn, never throw: TypeDB being down must not take AGEM down.
    console.warn(`[TypeDBClaimStore] unavailable — ${note}`);
    return this.status();
  }
}

export function parseStoredJointIncompatibility(
  response: ApiResponse | null,
  expectedClaimId: string,
): StoredJointIncompatibility | null {
  if (!response || !isOkResponse(response)) return null;
  const ok = response.ok as {
    answerType?: string;
    answers?: Array<Record<string, unknown>>;
  };
  if (ok.answerType !== "conceptDocuments" || !Array.isArray(ok.answers)) {
    return null;
  }
  const rows = ok.answers;
  if (rows.length === 0) return null;
  const strings = (key: string) =>
    rows
      .map((row) => row[key])
      .filter((value): value is string => typeof value === "string");
  const claimIds = [...new Set(strings("claimId"))];
  const claimKeys = [...new Set(strings("claimKey"))];
  const scopes = [...new Set(strings("scope"))];
  const incompatible = [...new Set(strings("member"))].sort();
  const sourceSegmentIds = [...new Set(strings("sourceSegmentId"))].sort();
  if (
    claimIds.length !== 1 ||
    claimIds[0] !== expectedClaimId ||
    claimKeys.length !== 1 ||
    scopes.length !== 1 ||
    (scopes[0] !== "corpus" && scopes[0] !== "position") ||
    incompatible.length < 2 ||
    sourceSegmentIds.length < 1
  ) {
    return null;
  }
  return {
    claimId: expectedClaimId,
    claimKey: claimKeys[0]!,
    scope: scopes[0],
    incompatible,
    sourceSegmentIds,
  };
}

function escapeTypeQLString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Pull a readable message out of a driver error response. */
function describeError(res: ApiResponse): string {
  const err = (res as { err?: { message?: string; code?: string } }).err;
  if (!err) return "unknown error";
  return [err.code, err.message].filter(Boolean).join(" ");
}

export const claimStore = new TypeDBClaimStore();
