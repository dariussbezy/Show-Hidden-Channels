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
  const [roleLimit, setRoles] = React.useState(20),
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
  }, [channelId]);
  const C = palette();
  const note = (s: string) => (
    <RN.Text
      style={{ color: C.sub, fontSize: 12, lineHeight: 16, marginBottom: 6 }}
    >
      {s}
    </RN.Text>
  );
  const control = (label: string, onPress: () => void) => (
    <RN.View style={{ marginBottom: 10 }}>
      <Action title={label} secondary compact top={0} onPress={onPress} />
    </RN.View>
  );
  const chips = (items: any[]) => (
    <RN.View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {items.map((item) => (
        <RN.View
          key={item.id}
          style={{
            backgroundColor: C.chip || C.card,
            borderRadius: 17,
            paddingHorizontal: 14,
            paddingVertical: 8,
            marginRight: 8,
            marginBottom: 8,
            maxWidth: "100%",
          }}
        >
          <RN.Text
            style={{
              color: C.text,
              fontSize: 14,
              fontWeight: "600",
              flexShrink: 1,
            }}
          >
            {item.name}
          </RN.Text>
        </RN.View>
      ))}
    </RN.View>
  );
  if (!data) return note("Access details unavailable.");
  return (
    <RN.View>
      <Section title={`Allowed roles · ${data.allowedRoles.length}`} compact>
        <RN.View style={{ padding: 12 }}>
          {chips(data.allowedRoles.slice(0, roleLimit))}
          {!data.rolesKnown || !data.rulesKnown
            ? note("Some access data is unavailable.")
            : !data.allowedRoles.length
              ? note("No roles found in the available data.")
              : null}
          {data.allowedRoles.length > roleLimit
            ? control("Show more roles", () => setRoles((n) => n + 20))
            : null}
        </RN.View>
      </Section>
      {control(
        `${showMembers ? "Hide" : "Show"} members · ${data.allowedMembers.length}`,
        () => toggleMembers((v) => !v),
      )}
      {showMembers ? (
        <Section title="Allowed members (cached)" compact>
          <RN.View style={{ padding: 12 }}>
            {note(
              `Cached members only · ${data.cachedCount} checked${data.limited ? " · scan limited to 500" : ""}${data.unknown ? ` · ${data.unknown} undetermined` : ""}. This is not a full server member list.`,
            )}
            {chips(data.allowedMembers.slice(0, memberLimit))}
            {!data.allowedMembers.length
              ? note("No members identified from the cache.")
              : null}
            {data.allowedMembers.length > memberLimit
              ? control("Show more members", () => setMembers((n) => n + 20))
              : null}
          </RN.View>
        </Section>
      ) : null}
      {control(
        `${showRules ? "Hide" : "Show"} permissions · ${data.rules.length}`,
        () => toggleRules((v) => !v),
      )}
      {showRules ? (
        <Section title="Permission overrides" compact>
          <RN.View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
            {note(
              "Explicit channel rules. Unlisted permissions are inherited.",
            )}
          </RN.View>
          {data.rules.slice(0, ruleLimit).map((r: any) => (
            <Row
              key={r.id}
              title={r.name}
              subtitle={r.details}
              subtitleLines={100}
              dense
              noIcon
            />
          ))}
          {!data.rulesKnown || !data.rules.length ? (
            <RN.View style={{ paddingHorizontal: 14, paddingTop: 6 }}>
              {note(
                !data.rulesKnown
                  ? "Permission data unavailable."
                  : "No explicit overrides.",
              )}
            </RN.View>
          ) : null}
          {data.rules.length > ruleLimit ? (
            <RN.View style={{ padding: 12 }}>
              {control("Show more permissions", () => setRules((n) => n + 10))}
            </RN.View>
          ) : null}
        </Section>
      ) : null}
    </RN.View>
  );
}
