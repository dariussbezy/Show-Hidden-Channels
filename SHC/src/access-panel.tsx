import * as React from "react";
import * as RN from "react-native";
import { findByStoreName } from "./valenced";
import {
  createAccessEvaluator,
  values,
  takeValues,
  permissionNames,
  bits,
  type Role,
  type Member,
  type Overwrite,
} from "./access";
function snapshot(channelId: string) {
  const channels = findByStoreName("ChannelStore"),
    guilds = findByStoreName("GuildStore"),
    roleStore = findByStoreName("GuildRoleStore"),
    memberStore = findByStoreName("GuildMemberStore"),
    users = findByStoreName("UserStore");
  const ch = channels?.getChannel(channelId),
    gid = String(ch?.guild_id || ch?.guildId || ""),
    guild = guilds?.getGuild(gid);
  const owner = String(guild?.ownerId || guild?.owner_id || "");
  const rawRoles =
    roleStore?.getRolesSnapshot?.(gid) ??
    roleStore?.getRoles?.(gid) ??
    guild?.roles;
  const roles = new Map<string, Role>(
    values(rawRoles)
      .filter((r) => r?.id)
      .map((r) => [String(r.id), r]),
  );
  const raw = ch?.permissionOverwrites ?? ch?.permission_overwrites;
  const overwrites: Overwrite[] | null =
    raw == null ? null : values(raw).filter((o) => o?.id);
  const roleName = (id: string) =>
    id === gid ? "@everyone" : roles.get(id)?.name || `Role ${id} (not cached)`;
  const memberName = (id: string, member?: any) => {
    const u = users?.getUser?.(id) || member?.user;
    return (
      member?.nick ||
      u?.globalName ||
      u?.global_name ||
      u?.username ||
      `User ${id} (not cached)`
    );
  };
  const evaluate = createAccessEvaluator(gid, roles, overwrites, owner);
  const roleIds = new Set([
    ...roles.keys(),
    ...(overwrites || [])
      .filter((o) => Number(o.type) === 0)
      .map((o) => String(o.id)),
  ]);
  const allowedRoles = [...roleIds]
    .filter((id) => evaluate([id]) === true)
    .map((id) => ({
      id,
      name: roleName(id),
      reason:
        (bits(roles.get(id)?.permissions) ?? 0n) & 8n
          ? "Administrator"
          : "View channel granted by base permissions and channel rules",
    }));
  const members = new Map<string, Member>();
  for (const id of [
    owner,
    ...(overwrites || [])
      .filter((o) => Number(o.type) === 1)
      .map((o) => String(o.id)),
  ]) {
    if (!id) continue;
    const m = memberStore?.getMember?.(gid, id);
    if (m) members.set(id, m);
    else if (id === owner) members.set(id, { userId: id, roles: [] });
  }
  const cached = takeValues(memberStore?.getMembers?.(gid), 501);
  for (const m of cached.slice(0, 500)) {
    const id = m?.userId || m?.user_id || m?.id || m?.user?.id;
    if (id) members.set(String(id), m);
  }
  const allowedMembers: any[] = [];
  let unknown = 0;
  for (const [id, m] of members) {
    const result = evaluate(Array.isArray(m.roles) ? m.roles : null, id);
    if (result === null) unknown++;
    if (result === true)
      allowedMembers.push({
        id,
        name: memberName(id, m),
        reason:
          id === owner
            ? "Server owner"
            : "View channel granted by effective permissions",
      });
  }
  const rules = (overwrites || []).map((o) => ({
    id: `${o.type}:${o.id}`,
    name:
      Number(o.type) === 0
        ? roleName(String(o.id))
        : memberName(String(o.id), members.get(String(o.id))),
    details: `${Number(o.type) === 0 ? "Role" : "Member"} override\nAllowed: ${permissionNames(o.allow).join(", ")}\nDenied: ${permissionNames(o.deny).join(", ")}`,
  }));
  return {
    allowedRoles,
    allowedMembers,
    rules,
    rolesKnown:
      roles.has(gid) &&
      [...roleIds].every((id) => bits(roles.get(id)?.permissions) !== null),
    rulesKnown: overwrites !== null,
    cachedCount: members.size,
    limited: cached.length > 500,
    unknown,
  };
}
export default function AccessPanel({
  channelId,
  palette,
  Section,
  Row,
  Action,
}: any) {
  const [revision, refresh] = React.useState(0),
    [roleLimit, setRoles] = React.useState(20),
    [memberLimit, setMembers] = React.useState(20),
    [ruleLimit, setRules] = React.useState(10),
    [showMembers, toggleMembers] = React.useState(false),
    [showRules, toggleRules] = React.useState(false);
  const data = React.useMemo(() => {
    try {
      return snapshot(channelId);
    } catch {
      return null;
    }
  }, [channelId, revision]);
  const C = palette();
  const note = (s: string) => (
    <RN.Text
      style={{ color: C.sub, fontSize: 12, lineHeight: 17, padding: 12 }}
    >
      {s}
    </RN.Text>
  );
  if (!data)
    return note(
      "Access details are unavailable from the current Discord cache.",
    );
  return (
    <>
      <Section title={`Allowed roles · ${data.allowedRoles.length}`} compact>
        {note(
          "Roles are evaluated with @everyone. Combined roles and member-specific overrides can change access. Administrator bypasses channel restrictions.",
        )}
        {data.allowedRoles.slice(0, roleLimit).map((r: any) => (
          <Row key={r.id} title={r.name} subtitle={r.reason} icon="server" />
        ))}
        {!data.rolesKnown || !data.rulesKnown
          ? note(
              "Some role or channel permission data is unavailable. This list may be incomplete.",
            )
          : !data.allowedRoles.length
            ? note(
                "No role granting visibility was found in the available data.",
              )
            : null}
        {data.allowedRoles.length > roleLimit ? (
          <Action
            title="Show more roles"
            secondary
            compact
            onPress={() => setRoles((n) => n + 20)}
          />
        ) : null}
      </Section>
      <Action
        title={`${showMembers ? "Hide" : "Show"} allowed members · ${data.allowedMembers.length}`}
        secondary
        compact
        onPress={() => toggleMembers((v) => !v)}
      />
      {showMembers ? (
        <Section title="Allowed members (cached)" compact>
          {note(
            `Evaluated ${data.cachedCount} cached members, including available explicit targets and the server owner. This is not a full server member list.${data.limited ? " The general cache scan is limited to 500 members." : ""}${data.unknown ? ` Access could not be determined for ${data.unknown} members.` : ""}`,
          )}
          {data.allowedMembers.slice(0, memberLimit).map((m: any) => (
            <Row key={m.id} title={m.name} subtitle={m.reason} icon="chat" />
          ))}
          {!data.allowedMembers.length
            ? note(
                "No allowed members could be identified from the available cache.",
              )
            : null}
          {data.allowedMembers.length > memberLimit ? (
            <Action
              title="Show more members"
              secondary
              compact
              onPress={() => setMembers((n) => n + 20)}
            />
          ) : null}
        </Section>
      ) : null}
      <Action
        title={`${showRules ? "Hide" : "Show"} permission overrides · ${data.rules.length}`}
        secondary
        compact
        onPress={() => toggleRules((v) => !v)}
      />
      {showRules ? (
        <Section title="Permission overrides" compact>
          {note(
            "These are explicit channel rules, not the full effective permissions. Unlisted permissions are inherited. A role allow can override another role deny; member overrides apply last. Server owners and administrators bypass channel restrictions.",
          )}
          {data.rules.slice(0, ruleLimit).map((r: any) => (
            <Row
              key={r.id}
              title={r.name}
              subtitle={r.details}
              subtitleLines={100}
              icon="lock"
            />
          ))}
          {!data.rulesKnown
            ? note("Discord did not provide permission overwrite metadata.")
            : !data.rules.length
              ? note(
                  "No explicit channel overrides. Permissions are inherited.",
                )
              : null}
          {data.rules.length > ruleLimit ? (
            <Action
              title="Show more permission overrides"
              secondary
              compact
              onPress={() => setRules((n) => n + 10)}
            />
          ) : null}
        </Section>
      ) : null}
      <Action
        title="Refresh access details"
        secondary
        compact
        onPress={() => refresh((n) => n + 1)}
      />
    </>
  );
}
