import manifest from "../manifest.json";
import { BottomSheet } from "@valenced/externals/gorhom";
import { Design } from "@valenced/discord/design";
import {
  NativeSection as CustomSection,
  NativeRow as CustomRow,
  NativeSwitch as CustomSwitch,
  NativeAction as CustomAction,
  rowIcon,
  settingsContent,
  useSheetBottomPadding,
  NativeGuide as KitGuide,
} from "../../../shared/native-ui";
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
  const BUILD = manifest.version;
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

  const currentGuildId = () => {
    try {
      return (SelectedGuildStore && SelectedGuildStore.getGuildId()) || null;
    } catch (_) {
      return null;
    }
  };

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

  /* ---- sheet (info card) ---- */
  function sheetParts() {
    if (partsCache && partsCache.ActionSheet) return partsCache;
    let ActionSheet = null;
    try {
      const a = findByProps("ActionSheet");
      ActionSheet = (a && a.ActionSheet) || null;
    } catch (_) {}
    partsCache = { ActionSheet };
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
  function HiddenSheet() {
    const h = React.createElement;
    const parts = sheetParts();
    const ch = getChannel(sheetState.channelId);
    const [active, setActive] = React.useState(null);
    const [contentHeight, setContentHeight] = React.useState(360);
    const bottomPadding = useSheetBottomPadding();
    const { height: windowHeight } = RN.useWindowDimensions();
    const cap = Math.round(windowHeight * (active ? 0.8 : 0.58));
    const height = Math.min(contentHeight, cap);
    const rows = ch
      ? infoRows(ch)
      : [["Channel", "This channel is no longer available.", "chat"]];
    const body = h(
      Design.Stack,
      { spacing: 10, style: { paddingBottom: bottomPadding } },
      h(Design.BottomSheetTitleHeader, {
        title: "Hidden channel",
        subtitle: channelLabel(ch),
        leading: rowIcon("lock"),
      }),
      h(
        CustomSection,
        null,
        ...rows.map(([title, value, icon]) => h(CustomRow, {
          key: title,
          title,
          icon,
          trailing: h(Design.TableRow.TrailingText, { text: value }),
        })),
      ),
      ch ? h(AccessPanel, { channelId: String(ch.id), active, onSelect: setActive }) : null,
      ch ? h(CustomAction, {
        title: "Open anyway",
        icon: "link",
        compact: true,
        top: 0,
        onPress: () => openAnyway(sheetState.channelId),
      }) : null,
    );
    return parts.ActionSheet
      ? h(
          parts.ActionSheet,
          {
            scrollable: true,
            startExpanded: false,
            startHeight: height + 24,
            contentHeight: height,
            maxHeight: cap + 24,
          },
          h(BottomSheet.BottomSheetScrollView, {
            style: { height, flexGrow: 0 },
            keyboardShouldPersistTaps: "handled",
            onContentSizeChange: (_width, measured) => {
              if (measured > 0) setContentHeight(Math.ceil(measured));
            },
          }, body),
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
      asset = lockAsset();
    return h(
      React.Fragment,
      null,
      asset
        ? h(RN.Image, {
            source: asset,
            style: { width: 16, height: 16, marginRight: 4 },
          })
        : h(
            Design.Text,
            { color: "text-muted", variant: "text-xs/normal", style: { marginRight: 4 } },
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
    const h = React.createElement;
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
        contentContainerStyle: settingsContent,
      },
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
        Design.Text,
        {
          style: {
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
