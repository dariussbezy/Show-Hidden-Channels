export interface Role {
  id: string;
  name?: string;
  permissions?: unknown;
}
export interface Member {
  userId?: string;
  user_id?: string;
  id?: string;
  roles?: string[];
}
export interface Overwrite {
  id: string;
  type: number | string;
  allow: unknown;
  deny: unknown;
}
const VIEW = 1n << 10n,
  ADMIN = 8n;
export function bits(value: unknown): bigint | null {
  if (value == null) return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  try {
    const n = BigInt(String(value));
    return n >= 0n ? n : null;
  } catch {
    return null;
  }
}
function apply(base: bigint, overwrite: Overwrite | undefined): bigint | null {
  if (!overwrite) return base;
  const allow = bits(overwrite.allow),
    deny = bits(overwrite.deny);
  return allow === null || deny === null ? null : (base & ~deny) | allow;
}
/** Uses unmodified Discord metadata, never the plugin's spoofed permission checks. */
export function createAccessEvaluator(
  guildId: string,
  roles: Map<string, Role>,
  overwrites: Overwrite[] | null,
  ownerId?: string,
) {
  const indexed = new Map(
    (overwrites || []).map((o) => [`${Number(o.type)}:${o.id}`, o]),
  );
  const permissions = new Map(
    [...roles].map(([id, r]) => [id, bits(r.permissions)]),
  );
  const everyone = permissions.get(guildId) ?? null;
  const lookup = (id: string, type: number) => indexed.get(`${type}:${id}`);
  return (roleIds: string[] | null, memberId?: string): boolean | null => {
    if (memberId && ownerId && memberId === ownerId) return true;
    let base = everyone ?? 0n,
      missing = everyone === null || roleIds === null;
    for (const id of roleIds || []) {
      if (id === guildId) continue;
      const p = permissions.get(id) ?? null;
      if (p === null) missing = true;
      else base |= p;
    }
    if (base & ADMIN) return true;
    if (overwrites === null) return null;
    const personal = memberId ? lookup(memberId, 1) : undefined;
    // A known member-specific allow wins over channel role denies, even if some role data is missing.
    if (personal && (bits(personal.allow) ?? 0n) & VIEW) return true;
    if (missing && roleIds !== null) {
      const granted = roleIds.some(
        (id) => id !== guildId && !!((bits(lookup(id, 0)?.allow) ?? 0n) & VIEW),
      );
      const personalDeny = personal ? bits(personal.deny) : 0n;
      if (granted && personalDeny !== null && !(personalDeny & VIEW))
        return true;
    }
    if (missing) return null;
    let effective = apply(base, lookup(guildId, 0));
    if (effective === null) return null;
    let allow = 0n,
      deny = 0n;
    for (const id of roleIds || []) {
      if (id === guildId) continue;
      const o = lookup(id, 0);
      if (!o) continue;
      const a = bits(o.allow),
        d = bits(o.deny);
      if (a === null || d === null) return null;
      allow |= a;
      deny |= d;
    }
    effective = (effective & ~deny) | allow;
    effective = apply(effective, personal);
    return effective === null ? null : !!(effective & VIEW);
  };
}
export function canView(
  guildId: string,
  roles: Map<string, Role>,
  roleIds: string[] | null,
  overwrites: Overwrite[] | null,
  memberId?: string,
  ownerId?: string,
): boolean | null {
  return createAccessEvaluator(
    guildId,
    roles,
    overwrites,
    ownerId,
  )(roleIds, memberId);
}
const LABELS: Record<number, string> = {
  0: "Create invites",
  1: "Kick members",
  2: "Ban members",
  3: "Administrator",
  4: "Manage channels",
  5: "Manage server",
  6: "Add reactions",
  7: "View audit log",
  8: "Priority speaker",
  9: "Video",
  10: "View channel",
  11: "Send messages",
  12: "Send text-to-speech messages",
  13: "Manage messages",
  14: "Embed links",
  15: "Attach files",
  16: "Read message history",
  17: "Mention everyone and roles",
  18: "Use external emoji",
  19: "View server insights",
  20: "Connect",
  21: "Speak",
  22: "Mute members",
  23: "Deafen members",
  24: "Move members",
  25: "Use voice activity",
  26: "Change nickname",
  27: "Manage nicknames",
  28: "Manage roles",
  29: "Manage webhooks",
  30: "Manage expressions",
  31: "Use application commands",
  32: "Request to speak",
  33: "Manage events",
  34: "Manage threads",
  35: "Create public threads",
  36: "Create private threads",
  37: "Use external stickers",
  38: "Send messages in threads",
  39: "Use activities",
  40: "Timeout members",
  41: "View monetization analytics",
  42: "Use soundboard",
  43: "Create expressions",
  44: "Create events",
  45: "Use external sounds",
  46: "Send voice messages",
  48: "Set voice channel status",
  49: "Send polls",
  50: "Use external apps",
  51: "Pin messages",
  52: "Bypass slowmode",
};
export function permissionNames(value: unknown): string[] {
  const n = bits(value);
  if (n === null) return ["Unavailable"];
  if (n === 0n) return ["None"];
  const out: string[] = [];
  for (let i = 0; i < 64; i++)
    if (n & (1n << BigInt(i))) out.push(LABELS[i] || `Permission bit ${i}`);
  if (n >> 64n) out.push("Additional permission bits");
  return out;
}
export function values(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  if (typeof value.toArray === "function") return value.toArray();
  if (typeof value.values === "function") return Array.from(value.values());
  return typeof value === "object" ? Object.values(value) : [];
}
/** Stop before materializing a large guild member cache. */
export function takeValues(value: any, limit: number): any[] {
  if (!value || limit <= 0) return [];
  if (Array.isArray(value)) return value.slice(0, limit);
  const out: any[] = [];
  if (typeof value.values === "function") {
    for (const item of value.values()) {
      out.push(item);
      if (out.length >= limit) break;
    }
  } else if (typeof value === "object") {
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      out.push(value[key]);
      if (out.length >= limit) break;
    }
  }
  return out;
}
