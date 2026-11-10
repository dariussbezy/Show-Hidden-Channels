import { View } from "react-native";
import * as React from "react";
import { Design } from "@valenced/discord/design";
import { NativeRow as Row, NativeSection as Section } from "../../../shared/native-ui";
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
    id === gid ? "@everyone" : roles.get(id)?.name || `Role ${id}`;
  const memberName = (id: string, member?: any) => {
    const u = users?.getUser?.(id) || member?.user;
    return (
      member?.nick ||
      u?.globalName ||
      u?.global_name ||
      u?.username ||
      `User ${id}`
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
type AccessSection = "roles" | "members" | "rules";

export default function AccessPanel({ channelId, active, onSelect }: {
  channelId: string;
  active: AccessSection | null;
  onSelect: (section: AccessSection | null) => void;
}) {
  const [limit, setLimit] = React.useState(0);
  const data = React.useMemo(() => {
    try {
      return snapshot(channelId);
    } catch {
      return null;
    }
  }, [channelId]);
  if (!data) return <Design.Text color="text-muted">Access details unavailable.</Design.Text>;

  const sections = [
    { key: "roles", title: "Allowed roles", short: "Roles", items: data.allowedRoles, preview: 6 },
    { key: "members", title: "Allowed members", short: "Members", items: data.allowedMembers, preview: 6 },
    { key: "rules", title: "Permission overrides", short: "Rules", items: data.rules, preview: 3 },
  ] as const;
  const section = sections.find((entry) => entry.key === active);
  const visibleCount = Math.min(section?.items.length ?? 0, limit || section?.preview || 0);
  const details = active === "roles" && (!data.rolesKnown || !data.rulesKnown)
    ? "Some access data is unavailable."
    : active === "members"
      ? `${data.cachedCount} cached members checked${data.limited ? " · scan limited to 500" : ""}${data.unknown ? ` · ${data.unknown} undetermined` : ""}.`
      : active === "rules" && !data.rulesKnown
        ? "Permission data unavailable."
        : undefined;

  return (
    <Design.Stack spacing={10}>
      <Design.Text variant="text-sm/medium" color="text-muted">Access</Design.Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {sections.map(({ key, title, short, items }) => (
          <Design.Button
            key={key}
            text={`${short} · ${items.length}`}
            size="sm"
            variant={active === key ? "primary" : "secondary"}
            accessibilityLabel={`${title}, ${items.length}`}
            accessibilityState={{ expanded: active === key }}
            style={{ flex: 1, minWidth: 0 }}
            onPress={() => {
              setLimit(0);
              onSelect(active === key ? null : key);
            }}
          />
        ))}
      </View>
      {section && (
        <Section title={section.title} footer={details}>
          {section.key === "rules" ? (
            data.rules.slice(0, visibleCount).map(({ id, name, details }) => (
              <Row key={id} title={name} subtitle={details} subtitleLines={100} />
            ))
          ) : (
            <Row
              title={section.items.length ? `Showing ${visibleCount} of ${section.items.length}` : "No entries in available data"}
              subtitle={section.items.slice(0, visibleCount).map(({ name }) => name).join(" · ")}
              subtitleLines={100}
            />
          )}
          {section.key === "rules" && !section.items.length && (
            <Row title="No explicit overrides in available data" />
          )}
          {section.items.length > visibleCount && (
            <Row title="Show more" icon="plus" onPress={() => setLimit(visibleCount + section.preview)} />
          )}
        </Section>
      )}
    </Design.Stack>
  );
}
