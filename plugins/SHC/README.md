# Show Hidden Channels for Valenced

Show hidden channel metadata in the server channel list, using the native Discord interface. Version: **1.0.1-beta**.

## Features

- **Hidden channels in the list**, for supported text, voice, category, announcement, stage, forum and media channels already supplied by Discord.
- **Lock indicators**, with an option to turn them off.
- **Information card** showing only creation, last-message and last-pin dates. Missing dates are labeled **Unknown**.
- **Open anyway** opens the channel view; hidden-channel message history is not loaded. Hidden voice channels cannot be joined through the plugin.
- **Role and member lists**, calculated from original role permissions and channel overrides, including owner and Administrator access.
- **Permission overrides** listing explicit allowed and denied permissions for each role or member.
- **Info card toggle**, plus Discord settings rows and an always-visible quick guide.
- **No Access name handling**, using a best-effort session-only override of the matching client experiment. Persisted experiment preferences are not changed.

## Installation

Add this Repository URL in **Valenced → Plugins → Advanced**:

```text
https://raw.githubusercontent.com/dariussbezy/Show-Hidden-Channels/main/index.json
```

Select **beta**, install **Show Hidden Channels**, enable it and restart Discord. Open its settings to configure **Show lock icon** and **Show info card**.

The current beta targets Valenced 1.3.0 and Discord 352.6 alpha. Display and navigation on a device still need confirmation. The implementation uses JavaScript and React Native; iOS has not been verified.

## Channel information

The plugin displays metadata Discord already makes available to your client. It cannot recover channel names, topics, message contents or other data that Discord does not provide. Missing last-message and pin information is labeled **Unknown** rather than treated as proof that a channel is empty.

Tapping a hidden channel in the current server opens its info card when that option is enabled. Entering a server avoids opening the card automatically for its selected channel. **Open anyway** preserves the original navigation action while leaving history and voice access blocked.

The No Access handling applies only to the matching client experiment in this session. A reconnect may be needed before available metadata changes. Server-redacted names can remain unavailable.

## Access details

The card uses Discord’s BottomSheetScrollView inside its action sheet, with a bounded viewport for longer content. The card uses Discord settings rows and buttons. Open a hidden channel's information card to see **Allowed roles**, **Allowed members** and **Permission overrides**. The sheet opens compactly. Tap an access section to see its first entries, then use **Show more** for additional entries. One access section is visible at a time. Close and reopen the card to reread the current Discord cache.

Visibility is calculated from the original metadata, independently of this plugin's local visibility patch. The calculation applies the @everyone role, base role permissions, @everyone overrides, combined role denies/allows, and finally member overrides. Server owners and roles with Administrator bypass channel restrictions.

Each role is evaluated together with @everyone; combinations of roles and member-specific rules can change a particular person's access. The permission rules section shows explicit channel overrides, with permission names. Unlisted permissions are inherited; the rules are not a complete effective-permission list.

The member list is **partial**: the plugin uses locally available members, available explicit member targets, and the server owner. The general cache scan is capped at 500 members. It does not download a server's full member list. Unknown role data is treated as undetermined rather than falsely denied, and unresolved names fall back to IDs.

## Privacy

Only the two display preferences are saved locally through Valenced. The plugin does not send message content, account tokens or channel metadata to external services, and it does not request hidden-channel message history. Its permission, navigation, rendering and experiment hooks are removed when it stops.
