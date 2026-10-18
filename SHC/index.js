const rainRuntime = globalThis.rain;
if (!rainRuntime || !rainRuntime.api || !rainRuntime.api.storage) throw new Error("Discord plugin API unavailable");
const rainStore = rainRuntime.api.storage.createPluginStore("showhiddenchannels", {});
const implementation = (() => {
  "use strict";
  const { metro } = rainRuntime;
  const patcher = rainRuntime.api.patcher;
  const ui = rainRuntime.api.ui;
  const { findByProps, findByStoreName } = metro;
  const { React, ReactNative: RN } = metro.common;

  const BUILD = "v1.0.1";
  const SHEET_KEY = "hidden-channel-info";
  // text, voice, category, announcement, stage, forum, media
  const CHANNEL_TYPES = { 0: "Text channel", 2: "Voice channel", 4: "Category", 5: "Announcement channel", 13: "Stage channel", 15: "Forum", 16: "Media channel" };
  const LOCK_ICONS = ["LockIcon", "ic_lock", "ic_locked"];
  const EXPERIMENT_ID = "2026-02-private-channel-hiding";
  const CHANNEL_PATH = /\/channels\/(?:\d+|@me)\/(\d+)/;

  const unpatches = [];
  const timers = [];
  let ThemeStore;
  let ChannelStore;
  let GuildStore;
  let SelectedGuildStore;
  let PermissionStore;
  let GuildChannelStore;
  let Perms = null;
  let origCan = null;
  let viewPermCache = null;
  let bypassing = false;
  let partsCache = null;
  let loadRequested = false;
  let initialized = false;
  let hydrationUnsubscribe = null;
  let nameFixApplied = false;
  let sheetState = { channelId: null, onOpen: null };

  const cfg = () => rainStore.useStore.getState();
  const setSetting = (key, value) => rainStore.useStore.getState().updateSettings({ [key]: value });
  const toast = (t) => { try { ui.toasts.showToast(t); } catch (_) {} };
  const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

  /* ---- shared settings design kit (same as the other plugins) ---- */
  function palette() {
    let light = false;
    try { ThemeStore = ThemeStore || findByStoreName("ThemeStore"); light = !!ThemeStore && ThemeStore.theme === "light"; } catch (_) {}
    return light
      ? { text: "#060607", sub: "#5C5E66", bg: "#FFFFFF", card: "#F2F3F5", acc: "#5865F2", accPressed: "#4752C4", blurple: "#5865F2", card2: "rgba(0,0,0,0.045)", chip: "rgba(0,0,0,0.07)", press: "rgba(0,0,0,0.06)", divider: "rgba(0,0,0,0.09)", off: "#B5BAC1" }
      : { text: "#FFFFFF", sub: "#B5BAC1", bg: "#1E1F22", card: "#2B2D31", acc: "#5865F2", accPressed: "#4752C4", blurple: "#5865F2", card2: "rgba(255,255,255,0.06)", chip: "rgba(255,255,255,0.10)", press: "rgba(255,255,255,0.07)", divider: "rgba(255,255,255,0.09)", off: "#4E5058" };
}

  /* ---- shared settings design kit (identical in AML / GPL / QT) ---- */
  const KIT_TILES = {
    lang: ["LanguageIcon", "\u6587", "#5865F2"], paint: ["PaintPaletteIcon", "\u25C9", "#EB459E"], time: ["ClockIcon", "\u25F7", "#E58A00"],
    store: ["ClipboardListIcon", "\u25A3", "#3BA55D"], trash: ["TrashIcon", "\u232B", "#ED4245"], edit: ["PencilIcon", "\u270E", "#F07B3E"],
    shield: ["ShieldIcon", "\u2298", "#80848E"], bell: ["BellIcon", "!", "#E58A00"], at: ["BellIcon", "@", "#ED4245"],
    reply: ["ChatMarkUnreadIcon", "\u21A9", "#5865F2"], search: ["CompassIcon", "\u2315", "#1ABC9C"], chat: ["ChatMarkUnreadIcon", "\u25A4", "#5865F2"],
    plus: ["PlusSmallIcon", "+", "#5865F2"], link: ["LinkIcon", "\u2197", "#3498DB"], test: ["WrenchIcon", "\u25B7", "#9B59B6"],
    star: ["StarIcon", "\u2605", "#D99700"], server: ["PinIcon", "\u25C7", "#3498DB"], power: ["SettingsIcon", "\u25CF", "#43B581"],
    text: ["PencilIcon", "Aa", "#F07B3E"], guide: ["ClipboardCheckIcon", "?", "#5865F2"], gear: ["SettingsIcon", "\u2022", "#80848E"],
    lock: ["LockIcon", "\u25C8", "#80848E"]
  };
  const KIT_RULES = [
    [/^(default|red|orange|gold|green|teal|blue|indigo|purple|pink|gray)$/i, null],
    [/^ghost ping logger$/i, "power"], [/color|appearance/, "paint"], [/notify|alert|toast/, "bell"], [/test/, "test"],
    [/button|position|composer/, "plus"], [/clear|remove/, "trash"],
    [/clock|time|history|retention|keep .* for/, "time"], [/quick|favorite|saved/, "star"],
    [/cache|storage|persist|remember|restart|across/, "store"],
    [/deleted|delete/, "trash"], [/edit/, "edit"], [/ignore/, "shield"], [/mention|everyone|ping/, "at"],
    [/reply|replies/, "reply"], [/filter|search/, "search"], [/jump/, "link"],
    [/translate|translation|google|deepl|language/, "lang"], [/word|term/, "text"], [/server|guild/, "server"],
    [/capture|message|channel|dm/, "chat"], [/enabled|logger/, "power"]
  ];
  const kitAssetCache = new Map();
  function kitAsset(name) {
    const hit = kitAssetCache.get(name);
    if (hit && (hit.id || Date.now() - hit.at < 5000)) return hit.id;
    let id = null;
    try { const r = globalThis.rain; id = (r && r.api && r.api.assets && r.api.assets.findAssetId && r.api.assets.findAssetId(name)) || null; } catch (_) { id = null; }
    kitAssetCache.set(name, { id, at: Date.now() });
    return id;
  }
  function hexA(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return hex;
    const n = Math.round(a * 255).toString(16);
    return "#" + m[1] + (n.length < 2 ? "0" + n : n);
  }
  function settingIconForTitle(title) {
    const text = String(title || "").toLowerCase();
    const match = KIT_RULES.find(([pattern]) => pattern.test(text));
    return match ? match[1] : null;
  }
  function kitIconKey(p) {
    if (!p || p.noIcon) return null;
    if (p.icon && KIT_TILES[p.icon]) return p.icon;
    return settingIconForTitle(p.title);
  }
  function KitChevron(p) {
    const h = React.createElement, s = p.size || 8, deg = p.dir === "up" ? "225deg" : p.dir === "right" ? "-45deg" : "45deg";
    return h(RN.View, { style: { width: s, height: s, borderRightWidth: 2, borderBottomWidth: 2, borderColor: p.color, borderRadius: 1, transform: [{ rotate: deg }], marginTop: p.dir === "up" ? 3 : p.dir === "down" ? -3 : 0, marginHorizontal: 3 } });
  }
  function KitTile(p) {
    const h = React.createElement, t = KIT_TILES[p.k] || KIT_TILES.gear, size = p.size || 32, asset = kitAsset(t[0]);
    const inner = Math.round(size * 0.56);
    return h(RN.View, { style: { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: t[2], alignItems: "center", justifyContent: "center", marginRight: p.noMargin ? 0 : 13 } },
      asset ? h(RN.Image, { source: asset, resizeMode: "contain", style: { width: inner, height: inner, tintColor: "#FFFFFF" } })
        : h(RN.Text, { style: { color: "#FFFFFF", fontSize: Math.round(size * 0.5), fontWeight: "700" } }, t[1]));
  }
  function CustomSection(p) {
    const C = palette(), h = React.createElement;
    const kids = React.Children.toArray(p.children);
    const any = kids.some((k) => k && k.type === CustomRow && kitIconKey(k.props));
    const isAction = (k) => !!k && k.type === CustomAction;
    if (kids.length && kids.every(isAction)) {
      return h(RN.View, { style: { marginBottom: p.title ? 24 : 12 } },
        p.title ? h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginHorizontal: 6, marginBottom: 10 } },
          h(RN.View, { style: { width: 3, height: 14, borderRadius: 2, backgroundColor: C.blurple, marginRight: 8 } }),
          h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontSize: 15, fontWeight: "700", flexShrink: 1 } }, p.title)) : null,
        ...kids.map((k, i) => React.cloneElement(k, { top: i === 0 ? 0 : 10 })));
    }
    const out = kids.map((k, i) => isAction(k)
      ? h(RN.View, { key: "act-" + i, style: { paddingHorizontal: 12, paddingTop: i === 0 ? 12 : 0, paddingBottom: 12 } }, React.cloneElement(k, { top: 0 }))
      : (k && k.type === CustomRow && any && !k.props.noIcon && !kitIconKey(k.props)) ? React.cloneElement(k, { __fallbackIcon: true }) : k);
    return h(RN.View, { style: { marginBottom: p.compact ? 14 : 24 } },
      p.title ? h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginHorizontal: 6, marginBottom: 10 } },
        h(RN.View, { style: { width: 3, height: 14, borderRadius: 2, backgroundColor: C.blurple, marginRight: 8 } }),
        h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.1, flexShrink: 1 } }, p.title)) : null,
      h(RN.View, { style: { backgroundColor: C.card, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: C.card2 } }, ...out),
      p.footer ? h(RN.Text, { style: { color: C.sub, fontSize: 12, lineHeight: 17, marginHorizontal: 8, marginTop: 8 } }, p.footer) : null);
  }
  function CustomRow(p) {
    const C = palette(), h = React.createElement;
    const key = p.__fallbackIcon ? (kitIconKey(p) || "gear") : kitIconKey(p);
    const tile = key ? KitTile({ k: key, size: 34 }) : null;
    return h(RN.Pressable, {
      accessibilityRole: p.onPress ? "button" : undefined, onPress: p.onPress, disabled: !p.onPress,
      style: ({ pressed }) => ({ minHeight: 66, paddingHorizontal: 16, paddingVertical: 13, flexDirection: "row", alignItems: "center", backgroundColor: pressed ? C.press : "transparent" })
    },
      tile,
      h(RN.View, { style: { flex: 1, minWidth: 0, paddingRight: 10 } },
        h(RN.Text, { numberOfLines: 2, style: { color: C.text, fontSize: 16, fontWeight: "600", lineHeight: 21 } }, p.title),
        p.subtitle ? h(RN.Text, { numberOfLines: 3, style: { color: C.sub, fontSize: 13, marginTop: 3, lineHeight: 18 } }, p.subtitle) : null),
      p.trailing || null,
      !p.last ? h(RN.View, { style: { position: "absolute", bottom: 0, left: key ? 63 : 16, right: 0, height: 1, backgroundColor: C.card2 } }) : null);
  }
  function CustomSwitch(p) {
    const C = palette(), h = React.createElement, on = !!p.value;
    const pos = React.useRef(new RN.Animated.Value(on ? 1 : 0)).current;
    React.useEffect(() => {
      RN.Animated.spring(pos, { toValue: on ? 1 : 0, speed: 24, bounciness: 5, useNativeDriver: true }).start();
    }, [on]);
    return h(RN.Pressable, { accessibilityRole: "switch", accessibilityState: { checked: on }, onPress: () => p.onChange(!on), hitSlop: 10,
      style: { width: 52, height: 32, borderRadius: 16, padding: 3, justifyContent: "center", backgroundColor: on ? (p.color || C.blurple) : C.off } },
      h(RN.Animated.View, { style: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFFFFF", shadowColor: "#000000", shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2, transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] } }));
  }
  function CustomAction(p) {
    const C = palette(), h = React.createElement, RED_ = "#ED4245";
    const sc = React.useRef(new RN.Animated.Value(1)).current;
    const to = (v) => RN.Animated.spring(sc, { toValue: v, speed: 40, bounciness: 0, useNativeDriver: true }).start();
    const bg = p.danger ? (p.secondary ? hexA(RED_, 0.14) : RED_) : (p.secondary ? C.chip : C.blurple);
    const fg = p.danger && p.secondary ? RED_ : (p.secondary ? C.text : "#FFFFFF");
    return h(RN.Pressable, { onPress: p.onPress, disabled: p.disabled, onPressIn: () => to(0.97), onPressOut: () => to(1), accessibilityRole: "button" },
      h(RN.Animated.View, { style: { minHeight: p.compact ? 42 : 50, borderRadius: 15, alignItems: "center", justifyContent: "center", paddingHorizontal: p.compact ? 12 : 18, marginTop: p.top != null ? p.top : 10, backgroundColor: bg, opacity: p.disabled ? 0.45 : 1, transform: [{ scale: sc }] } },
        h(RN.Text, { numberOfLines: 1, style: { color: fg, fontWeight: "700", fontSize: p.compact ? 15 : 16 } }, p.title)));
  }
  function CustomInput(p) {
    const C = palette(), h = React.createElement;
    const [focused, setFocused] = React.useState(false);
    return h(RN.TextInput, {
      ...p, placeholderTextColor: C.sub, underlineColorAndroid: "transparent", textAlignVertical: p.multiline ? "top" : "center",
      onFocus: (e) => { setFocused(true); if (p.onFocus) p.onFocus(e); },
      onBlur: (e) => { setFocused(false); if (p.onBlur) p.onBlur(e); },
      style: [{ minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: focused ? C.blurple : C.card2, backgroundColor: C.bg, color: C.text, paddingHorizontal: 15, fontSize: 16 }, p.style]
    });
  }
  let kitHeroPlayed = false;
  function KitHero(p) {
    const C = palette(), h = React.createElement, accent = p.accent || C.blurple;
    const stats = (p.stats || []).filter(Boolean);
    const enter = React.useRef(new RN.Animated.Value(kitHeroPlayed ? 1 : 0)).current;
    React.useEffect(() => { if (kitHeroPlayed) return; kitHeroPlayed = true; RN.Animated.spring(enter, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: true }).start(); }, []);
    return h(RN.Animated.View, { style: { borderRadius: 26, backgroundColor: C.card, borderWidth: 1, borderColor: hexA(accent, 0.4), padding: 18, marginBottom: 24, overflow: "hidden", opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] } },
      h(RN.View, { pointerEvents: "none", style: { position: "absolute", top: -60, right: -50, width: 190, height: 190, borderRadius: 95, backgroundColor: hexA(accent, 0.16) } }),
      h(RN.View, { pointerEvents: "none", style: { position: "absolute", bottom: -70, left: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: hexA(accent, 0.08) } }),
      h(RN.View, { style: { flexDirection: "row", alignItems: "center" } },
        KitTile({ k: p.icon, size: 54, noMargin: true }),
        h(RN.View, { style: { flex: 1, marginLeft: 14 } },
          h(RN.Text, { numberOfLines: 2, style: { color: C.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.2 } }, p.title),
          p.subtitle ? h(RN.Text, { numberOfLines: 2, style: { color: C.sub, fontSize: 14, marginTop: 3, lineHeight: 19 } }, p.subtitle) : null)),
      stats.length ? h(RN.View, { style: { flexDirection: "row", marginTop: 16 } }, ...stats.map((s, i) =>
        h(RN.View, { key: "stat-" + i, style: { flex: 1, borderRadius: 15, backgroundColor: C.chip, paddingVertical: 11, paddingHorizontal: 12, marginRight: i === stats.length - 1 ? 0 : 8 } },
          h(RN.Text, { numberOfLines: 1, adjustsFontSizeToFit: true, style: { color: C.text, fontSize: 19, fontWeight: "800" } }, String(s[1])),
          h(RN.Text, { numberOfLines: 1, style: { color: C.sub, fontSize: 12, marginTop: 2, fontWeight: "600" } }, s[0])))) : null);
  }
  function KitGuide(p) {
    const C = palette(), h = React.createElement;
    const [open, setOpen] = React.useState(true);
    const steps = p.steps || [];
    return h(RN.View, { style: { marginTop: 4, marginBottom: 16, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.card2, overflow: "hidden" } },
      h(RN.Pressable, { onPress: () => setOpen(!open), accessibilityRole: "button", accessibilityState: { expanded: open }, style: ({ pressed }) => ({ flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: pressed ? C.press : "transparent" }) },
        KitTile({ k: "guide", size: 34 }),
        h(RN.View, { style: { flex: 1 } },
          h(RN.Text, { style: { color: C.text, fontSize: 17, fontWeight: "800" } }, p.title || "Quick guide"),
          h(RN.Text, { style: { color: C.sub, fontSize: 13, marginTop: 2 } }, steps.length + " short steps")),
        h(RN.View, { style: { width: 24, alignItems: "center", justifyContent: "center" } }, KitChevron({ dir: open ? "up" : "down", color: C.sub, size: 9 }))),
      open ? h(RN.View, { style: { paddingHorizontal: 16, paddingBottom: 6 } }, ...steps.map((s, i) =>
        h(RN.View, { key: "guide-" + i, style: { flexDirection: "row", paddingTop: 12, paddingBottom: 14, borderTopWidth: 1, borderTopColor: C.card2 } },
          h(RN.View, { style: { width: 26, height: 26, borderRadius: 13, backgroundColor: hexA(C.blurple, 0.2), alignItems: "center", justifyContent: "center", marginRight: 13, marginTop: 1 } },
            h(RN.Text, { style: { color: C.blurple, fontSize: 13, fontWeight: "800" } }, String(i + 1))),
          h(RN.View, { style: { flex: 1 } },
            h(RN.Text, { style: { color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 3 } }, s[0]),
            h(RN.Text, { style: { color: C.sub, fontSize: 14, lineHeight: 20 } }, s[1]))))) : null);
  }
  function KitChip(p) {
    const C = palette(), h = React.createElement;
    return h(RN.Pressable, { onPress: p.onPress, accessibilityRole: "button", accessibilityState: { selected: !!p.active }, hitSlop: 4,
      style: ({ pressed }) => ({ height: 34, borderRadius: 17, paddingHorizontal: 14, marginRight: p.flush ? 0 : 8, marginBottom: p.flush ? 0 : 8, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: p.active ? C.blurple : C.chip, opacity: pressed ? 0.8 : 1 }) },
      h(RN.Text, { numberOfLines: 1, style: { color: p.active ? "#FFFFFF" : C.text, fontSize: 14, fontWeight: "600" } }, p.label),
      p.badge ? h(RN.View, { style: { marginLeft: 7, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: p.active ? "rgba(255,255,255,0.28)" : hexA(C.blurple, 0.22), alignItems: "center", justifyContent: "center" } },
        h(RN.Text, { style: { color: p.active ? "#FFFFFF" : C.blurple, fontSize: 12, fontWeight: "800" } }, String(p.badge))) : null);
  }


  /* ---- permissions ---- */
  function loadStores() {
    ChannelStore = ChannelStore || findByStoreName("ChannelStore");
    GuildStore = GuildStore || findByStoreName("GuildStore");
    SelectedGuildStore = SelectedGuildStore || findByStoreName("SelectedGuildStore");
    PermissionStore = PermissionStore || findByStoreName("PermissionStore");
    GuildChannelStore = GuildChannelStore || findByStoreName("GuildChannelStore");
    return !!ChannelStore;
  }
  function viewPermission() {
    if (viewPermCache !== null) return viewPermCache;
    try {
      const c = findByProps("Fonts", "Permissions");
      const v = c && c.Permissions && c.Permissions.VIEW_CHANNEL;
      if (v !== undefined) { viewPermCache = v; return v; }
    } catch (_) {}
    viewPermCache = typeof BigInt === "function" ? BigInt(1024) : 1024;
    return viewPermCache;
  }
  function isViewPerm(p) {
    try { return p === viewPermission() || String(p) === "1024"; } catch (_) { return false; }
  }
  const guildOf = (ch) => ch && (ch.guild_id || ch.guildId) || null;
  const isGuildChannel = (ch) => !!ch && typeof ch === "object" && !!guildOf(ch) && CHANNEL_TYPES[ch.type] !== undefined;
  const getChannel = (id) => { try { return id ? ChannelStore.getChannel(id) : null; } catch (_) { return null; } };
  function isHidden(ch) {
    if (typeof ch === "string") ch = getChannel(ch);
    if (!isGuildChannel(ch) || !origCan) return false;
    try { return !origCan.call(Perms, viewPermission(), ch); } catch (_) { return false; }
  }
  function patchPermissions() {
    try { Perms = findByProps("getChannelPermissions", "can"); } catch (_) { Perms = null; }
    if (!Perms || typeof Perms.can !== "function") return false;
    origCan = Perms.can;
    unpatches.push(patcher.after("can", Perms, (args, res) => {
      try {
        if (!res && args && isViewPerm(args[0]) && isGuildChannel(args[1])) return true;
      } catch (_) {}
      return res;
    }));
    return true;
  }

  /* ---- channel info ---- */
  const p2 = (n) => (n < 10 ? "0" : "") + n;
  const snowflakeTime = (id) => { const n = Number(id); return n > 0 ? Math.floor(n / 4194304) + 1420070400000 : 0; };
  function fmtDate(ms) {
    const d = new Date(ms);
    return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
  }
  function ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    const m = s / 60; if (m < 60) return Math.floor(m) + " min ago";
    const h = m / 60; if (h < 24) return Math.floor(h) + " h ago";
    const d = h / 24; if (d < 30) return Math.floor(d) + " days ago";
    if (d < 365) return Math.floor(d / 30) + " months ago";
    return Math.floor(d / 365) + " years ago";
  }
  const when = (ms) => fmtDate(ms) + " \u00B7 " + ago(ms);
  function channelLabel(ch) {
    if (!ch) return "Unknown channel";
    let guild = null;
    try { guild = GuildStore && GuildStore.getGuild(guildOf(ch)); } catch (_) {}
    const gname = guild && guild.name;
    return (ch.type === 4 ? "" : ch.type === 2 || ch.type === 13 ? "" : "#") + (ch.name || "channel") + (gname ? " \u00B7 " + gname : "");
  }
  function infoRows(ch) {
    const last = ch.lastMessageId || ch.last_message_id;
    const pin = ch.lastPinTimestamp || ch.last_pin_timestamp;
    const created = snowflakeTime(ch.id);
    const pinMs = pin ? new Date(pin).getTime() : 0;
    return [
      ["Topic", ch.topic ? clip(String(ch.topic).replace(/\s+/g, " ").trim(), 220) : "No topic", "text"],
      ["Type", CHANNEL_TYPES[ch.type] || "Channel", "server"],
      ["Created", created ? when(created) : "Unknown", "time"],
      ["Last message", last ? when(snowflakeTime(last)) : "No messages", "chat"],
      ["Last pin", pinMs > 0 ? when(pinMs) : "No pins", "star"],
    ];
  }
  function hiddenIn(guildId) {
    const out = [];
    try {
      const map = guildId && ChannelStore && ChannelStore.getMutableGuildChannelsForGuild ? ChannelStore.getMutableGuildChannelsForGuild(guildId) : null;
      for (const ch of map ? Object.values(map) : []) if (ch && ch.type !== 4 && isHidden(ch)) out.push(ch);
    } catch (_) {}
    out.sort((a, b) => ((a.position || 0) - (b.position || 0)) || String(a.name).localeCompare(String(b.name)));
    return out;
  }
  const currentGuildId = () => { try { return SelectedGuildStore && SelectedGuildStore.getGuildId() || null; } catch (_) { return null; } };
  function serversWithHidden() {
    let n = 0;
    try {
      for (const id of Object.keys(GuildStore.getGuilds())) if (hiddenIn(id).length) n++;
    } catch (_) {}
    return n;
  }

  /* ---- "No Access" names ---- */
  // Discord's private-channel-hiding experiment stops sending the real names of channels you cannot access.
  // Setting it to "Not Eligible" (bucket -1) makes Discord send them again on the next connection.
  function experimentManager() {
    try { const m = findByProps("overrideBucket"); return m && typeof m.overrideBucket === "function" ? m : null; } catch (_) { return null; }
  }
  function applyNameFix(enabled) {
    const m = experimentManager();
    if (!m) return false;
    let done = false;
    for (const kind of ["apex", "user"]) {
      try { m.overrideBucket(kind, EXPERIMENT_ID, enabled ? -1 : null); done = true; } catch (_) {}
    }
    return done;
  }
  const isPlaceholder = (name) => /^no access$/i.test(String(name == null ? "" : name).trim());
  function missingNames() {
    let n = 0;
    try {
      for (const id of Object.keys(GuildStore.getGuilds())) {
        const map = ChannelStore.getMutableGuildChannelsForGuild ? ChannelStore.getMutableGuildChannelsForGuild(id) : null;
        for (const ch of map ? Object.values(map) : []) if (ch && isPlaceholder(ch.name)) n++;
      }
    } catch (_) {}
    return n;
  }

  /* ---- sheet (info card) ---- */
  function sheetParts() {
    if (partsCache && partsCache.ActionSheet) return partsCache;
    let ActionSheet = null, Close = null;
    try { const a = findByProps("ActionSheet"); ActionSheet = a && a.ActionSheet || null; } catch (_) {}
    try { const c = findByProps("ActionSheetCloseButton"); Close = c && c.ActionSheetCloseButton || null; } catch (_) {}
    partsCache = { ActionSheet, Close };
    return partsCache;
  }
  function closeSheet() {
    try { const s = findByProps("openLazy", "hideActionSheet"); s && s.hideActionSheet && s.hideActionSheet(SHEET_KEY); } catch (_) {}
  }
  function openSheet() {
    try {
      const sheets = findByProps("openLazy", "hideActionSheet");
      if (sheets && typeof sheets.openLazy === "function" && sheetParts().ActionSheet) {
        sheets.openLazy(Promise.resolve({ default: HiddenSheet }), SHEET_KEY, {});
        return true;
      }
    } catch (_) {}
    return false;
  }
  function runBypassed(fn) {
    bypassing = true;
    try { fn(); } finally { bypassing = false; }
  }
  function navigateBypass(channelId) {
    try {
      const nav = findByProps("transitionToChannel");
      if (!nav || typeof nav.transitionToChannel !== "function") throw Error();
      runBypassed(() => nav.transitionToChannel(String(channelId), {}));
    } catch (_) { toast("Could not open this channel"); }
  }
  function openAnyway(channelId) {
    const go = sheetState.onOpen || (() => navigateBypass(channelId));
    closeSheet();
    timers.push(setTimeout(() => { try { runBypassed(go); } catch (_) { toast("Could not open this channel"); } }, 220));
  }
  function openInfo(ch, onOpen) {
    sheetState = { channelId: String(ch.id), onOpen };
    return openSheet();
  }
  function HiddenSheet() {
    const C = palette(), h = React.createElement;
    const parts = sheetParts();
    const ch = getChannel(sheetState.channelId);
    const rows = ch ? infoRows(ch) : [["Channel", "This channel is no longer available.", "chat"]];
    const body = h(RN.View, { style: { paddingHorizontal: 16, paddingBottom: 24 } },
      h(RN.View, { style: { flexDirection: "row", alignItems: "center", paddingTop: 4, paddingBottom: 14 } },
        KitTile({ k: "lock", size: 40 }),
        h(RN.View, { style: { flex: 1 } },
          h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontSize: 20, fontWeight: "800" } }, "Hidden channel"),
          h(RN.Text, { numberOfLines: 2, style: { color: C.sub, fontSize: 13, marginTop: 2 } }, channelLabel(ch))),
        parts.Close ? h(parts.Close, { onPress: closeSheet }) : null),
      h(RN.ScrollView, { style: { maxHeight: Math.round(RN.Dimensions.get("window").height * 0.55) }, showsVerticalScrollIndicator: false, nestedScrollEnabled: true },
        h(CustomSection, { key: "info", compact: true, footer: "Discord does not send messages from channels you cannot access, so their content cannot be shown." },
          ...rows.map((r, i) => h(CustomRow, { key: r[0], icon: r[2], title: r[0], subtitle: r[1], last: i === rows.length - 1 })))),
      h(CustomSection, { key: "actions", compact: true },
        ch ? h(CustomAction, { title: "Open anyway", onPress: () => openAnyway(sheetState.channelId) }) : null,
        h(CustomAction, { title: "Close", secondary: true, onPress: closeSheet })));
    return parts.ActionSheet ? h(parts.ActionSheet, null, body) : body;
  }

  /* ---- navigation guard ---- */
  function channelIdFromArgs(args) {
    const a = args && args[0];
    if (typeof a !== "string") return null;
    const m = CHANNEL_PATH.exec(a);
    if (m) return m[1];
    return /^\d+$/.test(a) ? a : null;
  }
  function patchNavigation() {
    const guard = (args, orig) => {
      try {
        if (!bypassing && cfg().showPopup) {
          const id = channelIdFromArgs(args);
          const ch = id ? getChannel(id) : null;
          if (ch && isHidden(ch) && openInfo(ch, () => orig(...args))) return undefined;
        }
      } catch (_) {}
      return orig(...args);
    };
    let n = 0;
    let g = null, c = null;
    try { g = findByProps("transitionToGuild"); } catch (_) {}
    try { c = findByProps("transitionToChannel"); } catch (_) {}
    if (g) for (const key of Object.keys(g)) if (typeof g[key] === "function") { unpatches.push(patcher.instead(key, g, guard)); n++; }
    if (c && c !== g && typeof c.transitionToChannel === "function") { unpatches.push(patcher.instead("transitionToChannel", c, guard)); n++; }
    return n;
  }

  /* ---- lock icon in the channel list ---- */
  function lockAsset() {
    for (const name of LOCK_ICONS) { const id = kitAsset(name); if (id) return id; }
    return null;
  }
  function LockedInfo(p) {
    const h = React.createElement, C = palette(), asset = lockAsset();
    return h(React.Fragment, null,
      asset ? h(RN.Image, { source: asset, style: { width: 16, height: 16, marginRight: 4, tintColor: C.sub } })
        : h(RN.Text, { style: { color: C.sub, marginRight: 4, fontSize: 12 } }, "\uD83D\uDD12"),
      p.original);
  }
  function patchLock() {
    let mod = null;
    try { mod = metro.findByName && metro.findByName("ChannelInfo", false) || null; } catch (_) {}
    const known = mod && mod.default || null;
    const isInfo = (C) => {
      if (!C) return false;
      if (known && C === known) return true;
      if (typeof C !== "function" && typeof C !== "object") return false;
      const inner = C.type || C;
      return (inner && (inner.displayName || inner.name)) === "ChannelInfo";
    };
    let runtime = null;
    try { const r = findByProps("jsx", "jsxs"); if (r && typeof r.jsx === "function") runtime = r; } catch (_) {}
    if (runtime) {
      // Wrap the row title when its element is created, so it also works for rows that are already on screen.
      const wrap = (args, ret) => {
        try {
          if (!ret || ret.type === LockedInfo || !cfg().showIcon || !isInfo(args && args[0])) return ret;
          const props = ret.props || args[1] || {};
          if (!isHidden(props.channel)) return ret;
          const next = { original: ret };
          if (ret.key != null) next.key = ret.key;
          return React.createElement(LockedInfo, next);
        } catch (_) {}
        return ret;
      };
      unpatches.push(patcher.after("jsx", runtime, wrap));
      if (typeof runtime.jsxs === "function") unpatches.push(patcher.after("jsxs", runtime, wrap));
      return true;
    }
    if (mod && typeof mod.default === "function") {
      unpatches.push(patcher.after("default", mod, (args, ret) => {
        try {
          const ch = args && args[0] && args[0].channel;
          if (cfg().showIcon && isHidden(ch)) return React.createElement(LockedInfo, { original: ret });
        } catch (_) {}
        return ret;
      }));
      return true;
    }
    return false;
  }

  /* ---- refresh ---- */
  function nudge() {
    const poke = () => {
      for (const st of [PermissionStore, GuildChannelStore, ChannelStore, GuildStore]) {
        try { st && st.emitChange && st.emitChange(); } catch (_) {}
      }
    };
    poke();
    for (const ms of [600, 1800, 4000]) timers.push(setTimeout(poke, ms));
  }

  /* ---- settings ---- */
  function Settings() {
    rainStore.useStore();
    const [, bump] = React.useState(0);
    const C = palette(), h = React.createElement;
    const s = cfg();
    const toggle = (key, title, subtitle, icon, last, after) => h(CustomRow, { key, title, subtitle, icon, last: !!last,
      trailing: h(CustomSwitch, { value: !!s[key], onChange: (v) => { setSetting(key, v); bump((x) => x + 1); nudge(); if (after) after(v); } }) });
    const guide = h(KitGuide, { key: "guide", title: "Quick guide", steps: [
      ["Hidden channels in the list", "Channels you cannot access now show up in the channel list of every server, marked with a lock."],
      ["Tapping one", "A card shows the topic, type, creation date, last message and last pin. Open anyway tries to open the channel, but Discord does not send its messages, so it will look empty."],
      ["Not showing up?", "If the channels do not appear right after you turn the plugin on, switch to another server and back, or restart Discord once."],
      ["Names say No Access?", "Discord is rolling out a change that stops sending the names of channels you cannot access. The fix below sets that experiment to Not Eligible. Restart Discord after turning it on. If names do not come back, log out and back in once."],
    ] });
    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { padding: 16, paddingBottom: 42 } },
      h(KitHero, { key: "hero", icon: "lock", title: "Show Hidden Channels", subtitle: "See channels you cannot access", stats: [["Servers", serversWithHidden()], ["No Access", missingNames()]] }),
      h(CustomSection, { key: "options", title: "Options" },
        toggle("showIcon", "Show lock icon", "Mark hidden channels with a lock in the channel list.", "lock"),
        toggle("showPopup", "Show info card", "Show topic, creation date and last message before opening a hidden channel.", "guide", true)),
      h(CustomSection, { key: "names", title: "Names", footer: "Needs a restart of Discord. The No Access number above counts channels that still show the placeholder name; it should drop to 0 after the restart." },
        toggle("fixNames", "Fix \"No Access\" names", "Set Discord's private channel hiding experiment to Not Eligible so real names come back.", "shield", true, (v) => {
          const ok = applyNameFix(v);
          nameFixApplied = v && ok;
          toast(ok ? "Restart Discord to apply the change" : "Could not change the experiment");
        })),
      guide,
      h(RN.Text, { style: { color: C.sub, fontSize: 12, textAlign: "center", marginTop: 1, opacity: 0.7 } }, "Show Hidden Channels " + BUILD));
  }

  /* ---- lifecycle ---- */
  function initializeAfterHydration() {
    if (!loadRequested || initialized) return;
    initialized = true;
    const s = cfg();
    const defaults = { showIcon: true, showPopup: true, fixNames: true };
    const missing = {};
    for (const k of Object.keys(defaults)) if (s[k] === undefined) missing[k] = defaults[k];
    if (Object.keys(missing).length) rainStore.useStore.getState().updateSettings(missing);
    if (!loadStores()) { toast("Show Hidden Channels: required Discord modules not found"); return; }
    if (!patchPermissions()) { toast("Show Hidden Channels: permissions module not found"); return; }
    patchNavigation();
    patchLock();
    nudge();
    if (cfg().fixNames !== false) {
      nameFixApplied = applyNameFix(true);
      const missing = missingNames();
      if (nameFixApplied && missing > 0) toast("Restart Discord once to restore " + missing + " channel " + (missing === 1 ? "name" : "names"));
    }
  }

  function onLoad() {
    loadRequested = true;
    const store = rainStore.useStore;
    if (store.getState()._hasHydrated) { initializeAfterHydration(); return; }
    const checkHydration = (state) => {
      if (!loadRequested || !state._hasHydrated) return;
      if (hydrationUnsubscribe) hydrationUnsubscribe();
      hydrationUnsubscribe = null;
      initializeAfterHydration();
    };
    hydrationUnsubscribe = store.subscribe(checkHydration);
    // Recheck after subscribing so hydration cannot finish between the first
    // check and subscription registration.
    checkHydration(store.getState());
  }

  function onUnload() {
    loadRequested = false;
    if (hydrationUnsubscribe) { hydrationUnsubscribe(); hydrationUnsubscribe = null; }
    initialized = false;
    for (const t of timers.splice(0)) clearTimeout(t);
    for (const u of unpatches.splice(0)) { try { u(); } catch (_) {} }
    closeSheet();
    if (nameFixApplied) { applyNameFix(false); nameFixApplied = false; }
    origCan = null;
    Perms = null;
    viewPermCache = null;
    partsCache = null;
    try { for (const st of [PermissionStore, GuildChannelStore, ChannelStore, GuildStore]) st && st.emitChange && st.emitChange(); } catch (_) {}
  }

  return { onLoad, onUnload, settings: Settings };
})();

module.exports = {
  start() { implementation.onLoad(); },
  stop() { implementation.onUnload(); },
  settings: implementation.settings,
};
