import AccessPanel from "./access-panel";
import * as React from "react";
import * as RN from "react-native";
import {
  findByProps,
  findByStoreName,
  findAssetId,
  patcher,
  observeComponent,
  observeProps,
  showToast,
  openChannel,
} from "./valenced";
import { createPluginStore } from "./settings-store";
const settingsStore = createPluginStore("showhiddenchannels", {
  showIcon: true,
  showPopup: true,
});
const implementation = (() => {
  const BUILD = "1.0.0-beta";
  const SHEET_KEY = "hidden-channel-info";
  // text, voice, category, announcement, stage, forum, media
  const CHANNEL_TYPES = {
    0: "Text channel",
    2: "Voice channel",
    4: "Category",
    5: "Announcement channel",
    13: "Stage channel",
    15: "Forum",
    16: "Media channel",
  };
  const BLOCKED_PERMISSIONS = new Set(["2048", "65536", "1048576"]);
  const LOCK_ICONS = ["LockIcon", "ic_lock", "ic_locked"];
  const EXPERIMENT_ID = "2026-02-private-channel-hiding";
  const CHANNEL_PATH = /\/channels\/(?:\d+|@me)\/(\d+)/;

  const unpatches = [];
  const timers = [];
  let ThemeStore;
  let ChannelStore;
  let GuildStore;
  let SelectedGuildStore;
  let SelectedChannelStore;
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
  let enteringUntil = 0;
  let sheetState = { channelId: null, onOpen: null };

  const cfg = () => settingsStore.useStore.getState();
  const setSetting = (key, value) =>
    settingsStore.useStore.getState().updateSettings({ [key]: value });
  const toast = (t) => {
    try {
      showToast(t);
    } catch (_) {}
  };

  /* ---- Settings colors ---- */
  function palette() {
    let light = false;
    try {
      ThemeStore = ThemeStore || findByStoreName("ThemeStore");
      light = !!ThemeStore && ThemeStore.theme === "light";
    } catch (_) {}
    return light
      ? {
          text: "#060607",
          sub: "#5C5E66",
          bg: "#FFFFFF",
          card: "#F2F3F5",
          acc: "#5865F2",
          accPressed: "#4752C4",
          blurple: "#5865F2",
          card2: "rgba(0,0,0,0.045)",
          chip: "rgba(0,0,0,0.07)",
          press: "rgba(0,0,0,0.06)",
          divider: "rgba(0,0,0,0.09)",
          off: "#B5BAC1",
        }
      : {
          text: "#FFFFFF",
          sub: "#B5BAC1",
          bg: "#1E1F22",
          card: "#2B2D31",
          acc: "#5865F2",
          accPressed: "#4752C4",
          blurple: "#5865F2",
          card2: "rgba(255,255,255,0.06)",
          chip: "rgba(255,255,255,0.10)",
          press: "rgba(255,255,255,0.07)",
          divider: "rgba(255,255,255,0.09)",
          off: "#4E5058",
        };
  }

  /* ---- Settings components ---- */
  const KIT_TILES = {
    lock: ["LockIcon", "\u25C8", "#80848E"],
    text: ["PencilIcon", "Aa", "#F07B3E"],
    server: ["PinIcon", "\u25C7", "#3498DB"],
    time: ["ClockIcon", "\u25F7", "#E58A00"],
    chat: ["ChatMarkUnreadIcon", "\u25A4", "#5865F2"],
    star: ["StarIcon", "\u2605", "#D99700"],
    guide: ["ClipboardCheckIcon", "?", "#5865F2"],
    gear: ["SettingsIcon", "\u2022", "#80848E"],
  };
  const KIT_RULES = [
    [/lock|hidden/, "lock"],
    [/topic/, "text"],
    [/created|date|time|pin/, "time"],
    [/channel|message/, "chat"],
  ];
  const kitAssetCache = new Map();
  function kitAsset(name) {
    const hit = kitAssetCache.get(name);
    if (hit && (hit.id || Date.now() - hit.at < 5000)) return hit.id;
    let id = null;
    try {
      id = findAssetId(name);
    } catch (_) {
      id = null;
    }
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
    const h = React.createElement,
      s = p.size || 8,
      deg = p.dir === "up" ? "225deg" : p.dir === "right" ? "-45deg" : "45deg";
    return h(RN.View, {
      style: {
        width: s,
        height: s,
        borderRightWidth: 2,
        borderBottomWidth: 2,
        borderColor: p.color,
        borderRadius: 1,
        transform: [{ rotate: deg }],
        marginTop: p.dir === "up" ? 3 : p.dir === "down" ? -3 : 0,
        marginHorizontal: 3,
      },
    });
  }
  function KitTile(p) {
    const h = React.createElement,
      t = KIT_TILES[p.k] || KIT_TILES.gear,
      size = p.size || 32,
      asset = kitAsset(t[0]);
    const inner = Math.round(size * 0.56);
    return h(
      RN.View,
      {
        style: {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          backgroundColor: t[2],
          alignItems: "center",
          justifyContent: "center",
          marginRight: p.noMargin ? 0 : 13,
        },
      },
      asset
        ? h(RN.Image, {
            source: asset,
            resizeMode: "contain",
            style: { width: inner, height: inner, tintColor: "#FFFFFF" },
          })
        : h(
            RN.Text,
            {
              style: {
                color: "#FFFFFF",
                fontSize: Math.round(size * 0.5),
                fontWeight: "700",
              },
            },
            t[1],
          ),
    );
  }
  function CustomSection(p) {
    const C = palette(),
      h = React.createElement;
    const kids = React.Children.toArray(p.children);
    const any = kids.some(
      (k) => k && k.type === CustomRow && kitIconKey(k.props),
    );
    const isAction = (k) => !!k && k.type === CustomAction;
    if (kids.length && kids.every(isAction)) {
      return h(
        RN.View,
        { style: { marginBottom: p.title ? 24 : 12 } },
        p.title
          ? h(
              RN.View,
              {
                style: {
                  flexDirection: "row",
                  alignItems: "center",
                  marginHorizontal: 6,
                  marginBottom: 10,
                },
              },
              h(RN.View, {
                style: {
                  width: 3,
                  height: 14,
                  borderRadius: 2,
                  backgroundColor: C.blurple,
                  marginRight: 8,
                },
              }),
              h(
                RN.Text,
                {
                  numberOfLines: 1,
                  style: {
                    color: C.text,
                    fontSize: 15,
                    fontWeight: "700",
                    flexShrink: 1,
                  },
                },
                p.title,
              ),
            )
          : null,
        ...kids.map((k, i) => React.cloneElement(k, { top: i === 0 ? 0 : 10 })),
      );
    }
    const out = kids.map((k, i) =>
      isAction(k)
        ? h(
            RN.View,
            {
              key: "act-" + i,
              style: {
                paddingHorizontal: 12,
                paddingTop: i === 0 ? 12 : 0,
                paddingBottom: 12,
              },
            },
            React.cloneElement(k, { top: 0 }),
          )
        : k &&
            k.type === CustomRow &&
            any &&
            !k.props.noIcon &&
            !kitIconKey(k.props)
          ? React.cloneElement(k, { __fallbackIcon: true })
          : k,
    );
    return h(
      RN.View,
      { style: { marginBottom: p.compact ? 14 : 24 } },
      p.title
        ? h(
            RN.View,
            {
              style: {
                flexDirection: "row",
                alignItems: "center",
                marginHorizontal: 6,
                marginBottom: 10,
              },
            },
            h(RN.View, {
              style: {
                width: 3,
                height: 14,
                borderRadius: 2,
                backgroundColor: C.blurple,
                marginRight: 8,
              },
            }),
            h(
              RN.Text,
              {
                numberOfLines: 1,
                style: {
                  color: C.text,
                  fontSize: 15,
                  fontWeight: "700",
                  letterSpacing: 0.1,
                  flexShrink: 1,
                },
              },
              p.title,
            ),
          )
        : null,
      h(
        RN.View,
        {
          style: {
            backgroundColor: C.card,
            borderRadius: 20,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: C.card2,
          },
        },
        ...out,
      ),
      p.footer
        ? h(
            RN.Text,
            {
              style: {
                color: C.sub,
                fontSize: 12,
                lineHeight: 17,
                marginHorizontal: 8,
                marginTop: 8,
              },
            },
            p.footer,
          )
        : null,
    );
  }
  function CustomRow(p) {
    const C = palette(),
      h = React.createElement;
    const key = p.__fallbackIcon ? kitIconKey(p) || "gear" : kitIconKey(p);
    const tile = key ? KitTile({ k: key, size: p.dense ? 30 : 34 }) : null;
    return h(
      RN.Pressable,
      {
        accessibilityRole: p.onPress ? "button" : undefined,
        onPress: p.onPress,
        disabled: !p.onPress,
        style: ({ pressed }) => ({
          minHeight: p.dense ? 48 : 66,
          paddingHorizontal: 16,
          paddingVertical: p.dense ? 7 : 13,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: pressed ? C.press : "transparent",
        }),
      },
      tile,
      h(
        RN.View,
        { style: { flex: 1, minWidth: 0, paddingRight: 10 } },
        h(
          RN.Text,
          {
            numberOfLines: 2,
            style: {
              color: C.text,
              fontSize: p.dense ? 14 : 16,
              fontWeight: "600",
              lineHeight: p.dense ? 18 : 21,
            },
          },
          p.title,
        ),
        p.subtitle
          ? h(
              RN.Text,
              {
                numberOfLines: p.subtitleLines ?? (p.dense ? 2 : 3),
                style: {
                  color: C.sub,
                  fontSize: 13,
                  marginTop: p.dense ? 1 : 3,
                  lineHeight: p.dense ? 17 : 18,
                },
              },
              p.subtitle,
            )
          : null,
      ),
      p.trailing || null,
      !p.last
        ? h(RN.View, {
            style: {
              position: "absolute",
              bottom: 0,
              left: key ? (p.dense ? 59 : 63) : 16,
              right: 0,
              height: 1,
              backgroundColor: C.card2,
            },
          })
        : null,
    );
  }
  function CustomSwitch(p) {
    const C = palette(),
      h = React.createElement,
      on = !!p.value;
    const pos = React.useRef(new RN.Animated.Value(on ? 1 : 0)).current;
    React.useEffect(() => {
      RN.Animated.spring(pos, {
        toValue: on ? 1 : 0,
        speed: 24,
        bounciness: 5,
        useNativeDriver: true,
      }).start();
    }, [on]);
    return h(
      RN.Pressable,
      {
        accessibilityRole: "switch",
        accessibilityState: { checked: on },
        onPress: () => p.onChange(!on),
        hitSlop: 10,
        style: {
          width: 52,
          height: 32,
          borderRadius: 16,
          padding: 3,
          justifyContent: "center",
          backgroundColor: on ? p.color || C.blurple : C.off,
        },
      },
      h(RN.Animated.View, {
        style: {
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: "#FFFFFF",
          shadowColor: "#000000",
          shadowOpacity: 0.25,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
          elevation: 2,
          transform: [
            {
              translateX: pos.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 20],
              }),
            },
          ],
        },
      }),
    );
  }
  function CustomAction(p) {
    const C = palette(),
      h = React.createElement,
      RED_ = "#ED4245";
    const sc = React.useRef(new RN.Animated.Value(1)).current;
    const to = (v) =>
      RN.Animated.spring(sc, {
        toValue: v,
        speed: 40,
        bounciness: 0,
        useNativeDriver: true,
      }).start();
    const bg = p.danger
      ? p.secondary
        ? hexA(RED_, 0.14)
        : RED_
      : p.secondary
        ? C.chip
        : C.blurple;
    const fg =
      p.danger && p.secondary ? RED_ : p.secondary ? C.text : "#FFFFFF";
    return h(
      RN.Pressable,
      {
        onPress: p.onPress,
        disabled: p.disabled,
        onPressIn: () => to(0.97),
        onPressOut: () => to(1),
        accessibilityRole: "button",
      },
      h(
        RN.Animated.View,
        {
          style: {
            minHeight: p.compact ? 42 : 50,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: p.compact ? 12 : 18,
            marginTop: p.top != null ? p.top : 10,
            backgroundColor: bg,
            opacity: p.disabled ? 0.45 : 1,
            transform: [{ scale: sc }],
          },
        },
        h(
          RN.Text,
          {
            numberOfLines: 1,
            style: {
              color: fg,
              fontWeight: "700",
              fontSize: p.compact ? 15 : 16,
            },
          },
          p.title,
        ),
      ),
    );
  }
  let kitHeroPlayed = false;
  function KitHero(p) {
    const C = palette(),
      h = React.createElement,
      accent = p.accent || C.blurple;
    const stats = (p.stats || []).filter(Boolean);
    const enter = React.useRef(
      new RN.Animated.Value(kitHeroPlayed ? 1 : 0),
    ).current;
    React.useEffect(() => {
      if (kitHeroPlayed) return;
      kitHeroPlayed = true;
      RN.Animated.spring(enter, {
        toValue: 1,
        speed: 14,
        bounciness: 6,
        useNativeDriver: true,
      }).start();
    }, []);
    return h(
      RN.Animated.View,
      {
        style: {
          borderRadius: 26,
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: hexA(accent, 0.4),
          padding: 18,
          marginBottom: 24,
          overflow: "hidden",
          opacity: enter,
          transform: [
            {
              scale: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [0.96, 1],
              }),
            },
          ],
        },
      },
      h(RN.View, {
        pointerEvents: "none",
        style: {
          position: "absolute",
          top: -60,
          right: -50,
          width: 190,
          height: 190,
          borderRadius: 95,
          backgroundColor: hexA(accent, 0.16),
        },
      }),
      h(RN.View, {
        pointerEvents: "none",
        style: {
          position: "absolute",
          bottom: -70,
          left: -40,
          width: 140,
          height: 140,
          borderRadius: 70,
          backgroundColor: hexA(accent, 0.08),
        },
      }),
      h(
        RN.View,
        { style: { flexDirection: "row", alignItems: "center" } },
        KitTile({ k: p.icon, size: 54, noMargin: true }),
        h(
          RN.View,
          { style: { flex: 1, marginLeft: 14 } },
          h(
            RN.Text,
            {
              numberOfLines: 2,
              style: {
                color: C.text,
                fontSize: 21,
                fontWeight: "800",
                letterSpacing: -0.2,
              },
            },
            p.title,
          ),
          p.subtitle
            ? h(
                RN.Text,
                {
                  numberOfLines: 2,
                  style: {
                    color: C.sub,
                    fontSize: 14,
                    marginTop: 3,
                    lineHeight: 19,
                  },
                },
                p.subtitle,
              )
            : null,
        ),
      ),
      stats.length
        ? h(
            RN.View,
            { style: { flexDirection: "row", marginTop: 16 } },
            ...stats.map((s, i) =>
              h(
                RN.View,
                {
                  key: "stat-" + i,
                  style: {
                    flex: 1,
                    borderRadius: 15,
                    backgroundColor: C.chip,
                    paddingVertical: 11,
                    paddingHorizontal: 12,
                    marginRight: i === stats.length - 1 ? 0 : 8,
                  },
                },
                h(
                  RN.Text,
                  {
                    numberOfLines: 1,
                    adjustsFontSizeToFit: true,
                    style: { color: C.text, fontSize: 19, fontWeight: "800" },
                  },
                  String(s[1]),
                ),
                h(
                  RN.Text,
                  {
                    numberOfLines: 1,
                    style: {
                      color: C.sub,
                      fontSize: 12,
                      marginTop: 2,
                      fontWeight: "600",
                    },
                  },
                  s[0],
                ),
              ),
            ),
          )
        : null,
    );
  }
  function KitGuide(p) {
    const C = palette(),
      h = React.createElement;
    const [open, setOpen] = React.useState(true);
    const steps = p.steps || [];
    return h(
      RN.View,
      {
        style: {
          marginTop: 4,
          marginBottom: 16,
          borderRadius: 20,
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.card2,
          overflow: "hidden",
        },
      },
      h(
        RN.Pressable,
        {
          onPress: () => setOpen(!open),
          accessibilityRole: "button",
          accessibilityState: { expanded: open },
          style: ({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            padding: 16,
            backgroundColor: pressed ? C.press : "transparent",
          }),
        },
        KitTile({ k: "guide", size: 34 }),
        h(
          RN.View,
          { style: { flex: 1 } },
          h(
            RN.Text,
            { style: { color: C.text, fontSize: 17, fontWeight: "800" } },
            p.title || "Quick guide",
          ),
          h(
            RN.Text,
            { style: { color: C.sub, fontSize: 13, marginTop: 2 } },
            steps.length + " short steps",
          ),
        ),
        h(
          RN.View,
          {
            style: {
              width: 24,
              alignItems: "center",
              justifyContent: "center",
            },
          },
          KitChevron({ dir: open ? "up" : "down", color: C.sub, size: 9 }),
        ),
      ),
      open
        ? h(
            RN.View,
            { style: { paddingHorizontal: 16, paddingBottom: 6 } },
            ...steps.map((s, i) =>
              h(
                RN.View,
                {
                  key: "guide-" + i,
                  style: {
                    flexDirection: "row",
                    paddingTop: 12,
                    paddingBottom: 14,
                    borderTopWidth: 1,
                    borderTopColor: C.card2,
                  },
                },
                h(
                  RN.View,
                  {
                    style: {
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: hexA(C.blurple, 0.2),
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 13,
                      marginTop: 1,
                    },
                  },
                  h(
                    RN.Text,
                    {
                      style: {
                        color: C.blurple,
                        fontSize: 13,
                        fontWeight: "800",
                      },
                    },
                    String(i + 1),
                  ),
                ),
                h(
                  RN.View,
                  { style: { flex: 1 } },
                  h(
                    RN.Text,
                    {
                      style: {
                        color: C.text,
                        fontSize: 15,
                        fontWeight: "700",
                        marginBottom: 3,
                      },
                    },
                    s[0],
                  ),
                  h(
                    RN.Text,
                    { style: { color: C.sub, fontSize: 14, lineHeight: 20 } },
                    s[1],
                  ),
                ),
              ),
            ),
          )
        : null,
    );
  }

  /* ---- permissions ---- */
  function loadStores() {
    ChannelStore = ChannelStore || findByStoreName("ChannelStore");
    GuildStore = GuildStore || findByStoreName("GuildStore");
    SelectedGuildStore =
      SelectedGuildStore || findByStoreName("SelectedGuildStore");
    try {
      SelectedChannelStore =
        SelectedChannelStore || findByStoreName("SelectedChannelStore");
    } catch (_) {}
    PermissionStore = PermissionStore || findByStoreName("PermissionStore");
    GuildChannelStore =
      GuildChannelStore || findByStoreName("GuildChannelStore");
    return !!ChannelStore;
  }
  function viewPermission() {
    if (viewPermCache !== null) return viewPermCache;
    try {
      const c = findByProps("Fonts", "Permissions");
      const v = c && c.Permissions && c.Permissions.VIEW_CHANNEL;
      if (v !== undefined) {
        viewPermCache = v;
        return v;
      }
    } catch (_) {}
    viewPermCache = typeof BigInt === "function" ? BigInt(1024) : 1024;
    return viewPermCache;
  }
  function isViewPerm(p) {
    try {
      return p === viewPermission() || String(p) === "1024";
    } catch (_) {
      return false;
    }
  }
  const guildOf = (ch) => (ch && (ch.guild_id || ch.guildId)) || null;
  const isGuildChannel = (ch) =>
    !!ch &&
    typeof ch === "object" &&
    !!guildOf(ch) &&
    CHANNEL_TYPES[ch.type] !== undefined;
  const getChannel = (id) => {
    try {
      return id ? ChannelStore.getChannel(id) : null;
    } catch (_) {
      return null;
    }
  };
  function isHidden(ch) {
    if (typeof ch === "string") ch = getChannel(ch);
    if (!isGuildChannel(ch) || !origCan) return false;
    try {
      return !origCan.call(Perms, viewPermission(), ch);
    } catch (_) {
      return false;
    }
  }
  function patchPermissions() {
    const install = (module) => {
      if (Perms || !loadRequested || typeof module?.can !== "function") return;
      Perms = module;
      origCan = module.can;
      unpatches.push(
        patcher.after("can", Perms, (args, result) => {
          try {
            if (!args || !isGuildChannel(args[1])) return result;
            if (isViewPerm(args[0])) return true;
            if (!result) return result;
            if (BLOCKED_PERMISSIONS.has(String(args[0])) && isHidden(args[1]))
              return false;
          } catch (_) {}
          return result;
        }),
      );
      nudge(true);
    };
    const existing = findByProps("getChannelPermissions", "can");
    if (existing) install(existing);
    unpatches.push(observeProps(["getChannelPermissions", "can"], install));
    return true;
  }

  /* ---- channel info ---- */
  const p2 = (n) => (n < 10 ? "0" : "") + n;
  const snowflakeTime = (id) => {
    const n = Number(id);
    return n > 0 ? Math.floor(n / 4194304) + 1420070400000 : 0;
  };
  function fmtDate(ms) {
    const d = new Date(ms);
    return (
      p2(d.getDate()) +
      "/" +
      p2(d.getMonth() + 1) +
      "/" +
      d.getFullYear() +
      " " +
      p2(d.getHours()) +
      ":" +
      p2(d.getMinutes())
    );
  }
  function channelLabel(ch) {
    if (!ch) return "Unknown channel";
    let guild = null;
    try {
      guild = GuildStore && GuildStore.getGuild(guildOf(ch));
    } catch (_) {}
    const gname = guild && guild.name;
    return (
      (ch.type === 4 ? "" : ch.type === 2 || ch.type === 13 ? "" : "#") +
      (ch.name || "channel") +
      (gname ? " \u00B7 " + gname : "")
    );
  }
  function infoRows(ch) {
    const last = ch.lastMessageId || ch.last_message_id;
    const pin = ch.lastPinTimestamp || ch.last_pin_timestamp;
    const created = snowflakeTime(ch.id);
    const pinMs = pin ? new Date(pin).getTime() : 0;
    const lastMs = last ? snowflakeTime(last) : 0;
    return [
      ["Created", created ? fmtDate(created) : "Unknown", "time"],
      ["Last message", lastMs > 0 ? fmtDate(lastMs) : "Unknown", "chat"],
      ["Last pin", pinMs > 0 ? fmtDate(pinMs) : "Unknown", "star"],
    ];
  }

  function hiddenIn(guildId) {
    const out = [];
    try {
      const map =
        guildId && ChannelStore && ChannelStore.getMutableGuildChannelsForGuild
          ? ChannelStore.getMutableGuildChannelsForGuild(guildId)
          : null;
      for (const ch of map ? Object.values(map) : [])
        if (ch && ch.type !== 4 && isHidden(ch)) out.push(ch);
    } catch (_) {}
    out.sort(
      (a, b) =>
        (a.position || 0) - (b.position || 0) ||
        String(a.name).localeCompare(String(b.name)),
    );
    return out;
  }
  const currentGuildId = () => {
    try {
      return (SelectedGuildStore && SelectedGuildStore.getGuildId()) || null;
    } catch (_) {
      return null;
    }
  };
  function serversWithHidden() {
    let n = 0;
    try {
      for (const id of Object.keys(GuildStore.getGuilds()))
        if (hiddenIn(id).length) n++;
    } catch (_) {}
    return n;
  }

  /* ---- "No Access" names ---- */
  // Discord's private-channel-hiding experiment stops sending the real names of channels you cannot access.
  // A session-only variant override can help on supported client rollouts; server-redacted names remain unavailable.
  function applyNameFix() {
    unpatches.push(
      observeProps(["getExperimentOverrideDescriptor"], (store) => {
        if (!loadRequested) return;
        // Session-only; the original descriptor and persisted preferences stay intact.
        unpatches.push(
          patcher.after(
            "getExperimentOverrideDescriptor",
            store,
            (args, result) =>
              args[0] === EXPERIMENT_ID
                ? { ...(result || {}), variantId: -1 }
                : result,
          ),
        );
      }),
    );
    return true;
  }
  const isPlaceholder = (name) =>
    /^no access$/i.test(String(name == null ? "" : name).trim());
  function missingNames() {
    let n = 0;
    try {
      for (const id of Object.keys(GuildStore.getGuilds())) {
        const map = ChannelStore.getMutableGuildChannelsForGuild
          ? ChannelStore.getMutableGuildChannelsForGuild(id)
          : null;
        for (const ch of map ? Object.values(map) : [])
          if (ch && isPlaceholder(ch.name)) n++;
      }
    } catch (_) {}
    return n;
  }

  /* ---- sheet (info card) ---- */
  function sheetParts() {
    if (partsCache && partsCache.ActionSheet) return partsCache;
    let ActionSheet = null,
      Close = null;
    try {
      const a = findByProps("ActionSheet");
      ActionSheet = (a && a.ActionSheet) || null;
    } catch (_) {}
    try {
      const c = findByProps("ActionSheetCloseButton");
      Close = (c && c.ActionSheetCloseButton) || null;
    } catch (_) {}
    partsCache = { ActionSheet, Close };
    return partsCache;
  }
  function closeSheet() {
    try {
      const s = findByProps("openLazy", "hideActionSheet");
      s && s.hideActionSheet && s.hideActionSheet(SHEET_KEY);
    } catch (_) {}
  }
  function openSheet() {
    try {
      const sheets = findByProps("openLazy", "hideActionSheet");
      if (
        sheets &&
        typeof sheets.openLazy === "function" &&
        sheetParts().ActionSheet
      ) {
        sheets.openLazy(
          Promise.resolve({ default: HiddenSheet }),
          SHEET_KEY,
          {},
        );
        return true;
      }
    } catch (_) {}
    return false;
  }
  function runBypassed(fn) {
    bypassing = true;
    try {
      fn();
    } finally {
      bypassing = false;
    }
  }
  function navigateBypass(channelId) {
    try {
      runBypassed(() => openChannel(String(channelId)));
    } catch (error) {
      console.error("Show Hidden Channels: navigation failed", error);
      toast("Could not open this channel");
    }
  }
  function openAnyway(channelId) {
    const go = sheetState.onOpen || (() => navigateBypass(channelId));
    closeSheet();
    timers.push(
      setTimeout(() => {
        if (!loadRequested) return;
        try {
          runBypassed(go);
        } catch (_) {
          toast("Could not open this channel");
        }
      }, 220),
    );
  }
  function openInfo(ch, onOpen) {
    sheetState = { channelId: String(ch.id), onOpen };
    return openSheet();
  }
  function HiddenSheetContent({ children }) {
    // Resolve inside the sheet, after its provider has initialized the scrollable library.
    const Scroll =
      findByProps("BottomSheetScrollView")?.BottomSheetScrollView ||
      RN.ScrollView;
    return React.createElement(
      Scroll,
      {
        style: {
          height: Math.round(RN.Dimensions.get("window").height * 0.75),
        },
        contentContainerStyle: { paddingBottom: 24 },
        nestedScrollEnabled: true,
        showsVerticalScrollIndicator: true,
        keyboardShouldPersistTaps: "handled",
      },
      children,
    );
  }
  function HiddenSheet() {
    const C = palette(),
      h = React.createElement;
    const parts = sheetParts();
    const ch = getChannel(sheetState.channelId);
    const rows = ch
      ? infoRows(ch)
      : [["Channel", "This channel is no longer available.", "chat"]];
    const body = h(
      RN.View,
      { style: { paddingHorizontal: 16, paddingBottom: 12 } },
      h(
        RN.View,
        {
          style: {
            flexDirection: "row",
            alignItems: "center",
            paddingTop: 2,
            paddingBottom: 10,
          },
        },
        KitTile({ k: "lock", size: 40 }),
        h(
          RN.View,
          { style: { flex: 1 } },
          h(
            RN.Text,
            {
              numberOfLines: 1,
              style: { color: C.text, fontSize: 20, fontWeight: "800" },
            },
            "Hidden channel",
          ),
          h(
            RN.Text,
            {
              numberOfLines: 1,
              style: { color: C.sub, fontSize: 13, marginTop: 2 },
            },
            channelLabel(ch),
          ),
        ),
        parts.Close ? h(parts.Close, { onPress: closeSheet }) : null,
      ),
      h(
        CustomSection,
        { compact: true },
        ...rows.map((r, i) =>
          h(CustomRow, {
            key: r[0],
            title: r[0],
            subtitle: r[1],
            icon: r[2],
            dense: true,
            last: i === rows.length - 1,
          }),
        ),
      ),
      ch
        ? h(AccessPanel, {
            channelId: String(ch.id),
            palette,
            Section: CustomSection,
            Row: CustomRow,
            Action: CustomAction,
          })
        : null,
      ch
        ? h(
            CustomSection,
            { key: "actions", compact: true },
            h(CustomAction, {
              title: "Open anyway",
              compact: true,
              onPress: () => openAnyway(sheetState.channelId),
            }),
          )
        : null,
    );
    return parts.ActionSheet
      ? h(
          parts.ActionSheet,
          {
            scrollable: true,
            startExpanded: true,
            maxHeight: Math.round(RN.Dimensions.get("window").height * 0.9),
          },
          h(HiddenSheetContent, null, body),
        )
      : body;
  }

  /* ---- navigation guard ---- */
  function channelIdFromArgs(args) {
    const a = args && args[0];
    if (typeof a !== "string") return null;
    const m = CHANNEL_PATH.exec(a);
    if (m) return m[1];
    return /^\d+$/.test(a) ? a : null;
  }
  // Entering a server makes Discord open its last/first channel by itself. When that channel is hidden the
  // info card must not pop up: only a tap on a hidden channel inside the current server shows it.
  const ENTER_WINDOW = 1500;
  const markEntering = () => {
    enteringUntil = Date.now() + ENTER_WINDOW;
  };
  const selectedChannelId = () => {
    try {
      return (
        (SelectedChannelStore && SelectedChannelStore.getChannelId()) || null
      );
    } catch (_) {
      return null;
    }
  };
  function isAutoOpen(ch) {
    if (Date.now() < enteringUntil) return true;
    const g = guildOf(ch);
    if (g && String(g) !== String(currentGuildId() || "")) return true;
    return selectedChannelId() === String(ch.id);
  }
  function patchNavigation() {
    let n = 0;
    const guard = (args, original, channelId) => {
      if (!bypassing && cfg().showPopup && channelId) {
        const ch = getChannel(channelId);
        if (
          ch &&
          isHidden(ch) &&
          !isAutoOpen(ch) &&
          openInfo(ch, () => original(...args))
        )
          return;
      }
      return original(...args);
    };
    unpatches.push(
      observeProps(["transitionToGuild", "transitionTo"], (router) => {
        for (const key of ["transitionTo", "replaceWith"]) {
          if (typeof router[key] !== "function") continue;
          unpatches.push(
            patcher.instead(key, router, (args, original) =>
              guard(args, original, channelIdFromArgs(args)),
            ),
          );
        }
        unpatches.push(
          patcher.instead("transitionToGuild", router, (args, original) => {
            if (!args[1]) markEntering();
            return guard(args, original, args[1] ? String(args[1]) : null);
          }),
        );
        n++;
      }),
    );
    unpatches.push(
      observeProps(["transitionToChannel", "transitionToThread"], (nav) => {
        unpatches.push(
          patcher.instead("transitionToChannel", nav, (args, original) =>
            guard(args, original, channelIdFromArgs(args)),
          ),
        );
        n++;
      }),
    );
    if (SelectedGuildStore?.addChangeListener) {
      let last = currentGuildId();
      const changed = () => {
        const next = currentGuildId();
        if (next !== last) {
          last = next;
          markEntering();
        }
      };
      SelectedGuildStore.addChangeListener(changed);
      unpatches.push(() => SelectedGuildStore.removeChangeListener(changed));
    }
    // Hidden channels only expose metadata. Prevent history requests and voice joins.
    unpatches.push(
      observeProps(["fetchMessages", "jumpToMessage"], (actions) => {
        if (typeof actions.fetchMessages !== "function") return;
        unpatches.push(
          patcher.instead("fetchMessages", actions, (args, original) => {
            const id = args[0]?.channelId;
            return id && isHidden(String(id))
              ? Promise.resolve(undefined)
              : original(...args);
          }),
        );
      }),
    );
    unpatches.push(
      observeProps(["selectVoiceChannel"], (voice) => {
        unpatches.push(
          patcher.instead("selectVoiceChannel", voice, (args, original) => {
            const id =
              typeof args[0] === "string" ? args[0] : args[0]?.channelId;
            const ch = id ? getChannel(id) : null;
            if (ch && isHidden(ch)) {
              openInfo(ch, null);
              return;
            }
            return original(...args);
          }),
        );
      }),
    );
    return n;
  }

  /* ---- lock icon in the channel list ---- */
  function lockAsset() {
    for (const name of LOCK_ICONS) {
      const id = kitAsset(name);
      if (id) return id;
    }
    return null;
  }
  function LockedInfo(p) {
    const h = React.createElement,
      C = palette(),
      asset = lockAsset();
    return h(
      React.Fragment,
      null,
      asset
        ? h(RN.Image, {
            source: asset,
            style: { width: 16, height: 16, marginRight: 4, tintColor: C.sub },
          })
        : h(
            RN.Text,
            { style: { color: C.sub, marginRight: 4, fontSize: 12 } },
            "\uD83D\uDD12",
          ),
      p.original,
    );
  }
  function patchLock() {
    unpatches.push(
      observeComponent("ChannelInfo", (props, result) => {
        if (!cfg().showIcon || !props?.channel || !isHidden(props.channel))
          return result;
        return React.createElement(LockedInfo, { original: result });
      }),
    );
    return true;
  }

  /* ---- refresh ---- */
  function nudge(deferUntilIdle = false) {
    const poke = () => {
      if (!loadRequested) return;
      for (const st of [
        PermissionStore,
        GuildChannelStore,
        ChannelStore,
        GuildStore,
      ]) {
        try {
          st && st.emitChange && st.emitChange();
        } catch (_) {}
      }
    };
    if (!deferUntilIdle) {
      poke();
      return;
    }
    timers.push(
      setTimeout(() => {
        if (!loadRequested) return;
        try {
          const manager = RN.InteractionManager;
          if (manager && typeof manager.runAfterInteractions === "function") {
            const task = manager.runAfterInteractions(poke);
            unpatches.push(() => task?.cancel?.());
            return;
          }
        } catch (_) {}
        poke();
      }, 900),
    );
  }

  /* ---- settings ---- */
  function Settings() {
    settingsStore.useStore();
    const [, bump] = React.useState(0);
    const C = palette(),
      h = React.createElement;
    const s = cfg();
    const toggle = (key, title, subtitle, icon, last, after) =>
      h(CustomRow, {
        key,
        title,
        subtitle,
        icon,
        last: !!last,
        trailing: h(CustomSwitch, {
          value: !!s[key],
          onChange: (v) => {
            setSetting(key, v);
            bump((x) => x + 1);
            nudge();
            if (after) after(v);
          },
        }),
      });
    const guide = h(KitGuide, {
      key: "guide",
      title: "Quick guide",
      steps: [
        [
          "Hidden channels in the list",
          "Hidden channels already supplied by Discord appear in the server channel list, marked with a lock.",
        ],
        [
          "Tapping one",
          "A compact card shows creation, last message and last pin dates, plus allowed roles. Expand members or permissions for more details. Open anyway tries to open the channel, but Discord does not send its messages, so it will look empty.",
        ],
        [
          "Not showing up?",
          "If the channels do not appear right after you turn the plugin on, switch to another server and back, or restart Discord once.",
        ],
        [
          "Names say No Access?",
          "Discord is rolling out a change that stops sending the names of channels you cannot access. When supported, the plugin applies a session-only override for that client experiment. Reconnect after enabling it. Names remain unavailable if Discord does not supply them.",
        ],
      ],
    });
    return h(
      RN.ScrollView,
      {
        style: { flex: 1 },
        keyboardShouldPersistTaps: "handled",
        contentContainerStyle: { padding: 16, paddingBottom: 42 },
      },
      h(KitHero, {
        key: "hero",
        icon: "lock",
        title: "Show Hidden Channels",
        subtitle: "See channels you cannot access",
        stats: [
          ["Servers", serversWithHidden()],
          ["No Access", missingNames()],
        ],
      }),
      h(
        CustomSection,
        { key: "options", title: "Options" },
        toggle(
          "showIcon",
          "Show lock icon",
          "Mark hidden channels with a lock in the channel list.",
          "lock",
        ),
        toggle(
          "showPopup",
          "Show info card",
          "Show dates and access details before opening a hidden channel.",
          "guide",
          true,
        ),
      ),
      guide,
      h(
        RN.Text,
        {
          style: {
            color: C.sub,
            fontSize: 12,
            textAlign: "center",
            marginTop: 1,
            opacity: 0.7,
          },
        },
        "Show Hidden Channels " + BUILD,
      ),
    );
  }

  /* ---- lifecycle ---- */
  function initializeAfterHydration() {
    if (!loadRequested || initialized) return;
    initialized = true;
    const s = cfg();
    const defaults = { showIcon: true, showPopup: true };
    const missing = {};
    for (const k of Object.keys(defaults))
      if (s[k] === undefined) missing[k] = defaults[k];
    if (Object.keys(missing).length)
      settingsStore.useStore.getState().updateSettings(missing);
    if (!loadStores()) {
      toast("Show Hidden Channels: required Discord modules not found");
      return;
    }
    if (!patchPermissions()) {
      toast("Show Hidden Channels: permissions module not found");
      return;
    }
    patchNavigation();
    patchLock();
    applyNameFix();
  }

  function onLoad() {
    loadRequested = true;
    const store = settingsStore.useStore;
    if (store.getState()._hasHydrated) {
      initializeAfterHydration();
      return;
    }
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
    if (hydrationUnsubscribe) {
      hydrationUnsubscribe();
      hydrationUnsubscribe = null;
    }
    initialized = false;
    for (const t of timers.splice(0)) clearTimeout(t);
    for (const u of unpatches.splice(0)) {
      try {
        u();
      } catch (_) {}
    }
    closeSheet();
    origCan = null;
    Perms = null;
    viewPermCache = null;
    partsCache = null;
    try {
      for (const st of [
        PermissionStore,
        GuildChannelStore,
        ChannelStore,
        GuildStore,
      ])
        st && st.emitChange && st.emitChange();
    } catch (_) {}
  }

  return { onLoad, onUnload, settings: Settings };
})();
export default implementation;
export const useSettings = settingsStore.useStore;
