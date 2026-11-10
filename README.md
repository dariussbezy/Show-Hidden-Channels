# Show Hidden Channels for Valenced

> **Development moved:** all plugins and themes are now maintained in [Valenced Plugins & Themes](https://github.com/dariussbezy/dariussbezy-Valenced-Plugins-Themes). Use the [single repository URL](https://raw.githubusercontent.com/dariussbezy/dariussbezy-Valenced-Plugins-Themes/main/index.json) for installation and updates. This repository remains available for historical links.

Show hidden channel metadata in the server channel list, using the original Show Hidden Channels interface. Version: **1.0.0-beta**.

## Features

- **Hidden channels in the list**, for supported text, voice, category, announcement, stage, forum and media channels already supplied by Discord.
- **Lock indicators**, with an option to turn them off.
- **Information card** showing only creation, last-message and last-pin dates. Missing dates are labeled **Unknown**.
- **Open anyway** opens the channel view; hidden-channel message history is not loaded. Hidden voice channels cannot be joined through the plugin.
- **Compact role and member chips**, laid out side by side and wrapping onto additional lines, calculated from original role permissions and channel overrides, including owner and Administrator access.
- **Permission overrides** listing explicit allowed and denied permissions for each role or member.
- **Info card toggle**, plus the original settings cards, counters, quick guide and light/dark colors.
- **No Access name handling**, using a best-effort session-only override of the matching client experiment. Persisted experiment preferences are not changed.

## Installation

Add this Repository URL in **Valenced → Plugins → Advanced**:

```text
https://raw.githubusercontent.com/dariussbezy/dariussbezy-Valenced-Plugins-Themes/main/index.json
```

Select **beta**, install **Show Hidden Channels**, enable it and restart Discord. Open its settings to configure **Show lock icon** and **Show info card**.

The current beta targets Valenced 1.3.0 and Discord 352.6 alpha. Display and navigation on a device still need confirmation. The implementation uses JavaScript and React Native; iOS has not been verified.

## Channel information

The plugin displays metadata Discord already makes available to your client. It cannot recover channel names, topics, message contents or other data that Discord does not provide. Missing last-message and pin information is labeled **Unknown** rather than treated as proof that a channel is empty.

Tapping a hidden channel in the current server opens its info card when that option is enabled. Entering a server avoids opening the card automatically for its selected channel. **Open anyway** preserves the original navigation action while leaving history and voice access blocked.

The No Access handling applies only to the matching client experiment in this session. A reconnect may be needed before available metadata changes. Server-redacted names can remain unavailable.

## Access details

The card uses Discord’s BottomSheetScrollView inside its action sheet, with a bounded viewport for longer content. Cards and section buttons use the original plugin controls, with padded content inside rounded containers. Open a hidden channel's information card to see **Allowed roles**, **Allowed members** and **Permission overrides**. Roles, members and permission sections start collapsed and can be expanded. Use **Show more** to browse additional entries. Close and reopen the card to reread the current Discord cache.

Visibility is calculated from the original metadata, independently of this plugin's local visibility patch. The calculation applies the @everyone role, base role permissions, @everyone overrides, combined role denies/allows, and finally member overrides. Server owners and roles with Administrator bypass channel restrictions.

Each role is evaluated together with @everyone; combinations of roles and member-specific rules can change a particular person's access. The permission rules section shows explicit channel overrides, with permission names. Unlisted permissions are inherited; the rules are not a complete effective-permission list.

The member list is **partial**: the plugin uses locally available members, available explicit member targets, and the server owner. The general cache scan is capped at 500 members. It does not download a server's full member list. Unknown role data is treated as undetermined rather than falsely denied, and unresolved names fall back to IDs.

## Privacy

Only the two display preferences are saved locally through Valenced. The plugin does not send message content, account tokens or channel metadata to external services, and it does not request hidden-channel message history. Its permission, navigation, rendering and experiment hooks are removed when it stops.

## Repository structure

Sources use the [official Valenced plugin template](https://github.com/Valenced/valenced-plugin-template/tree/9a4f9187137a75d86fe552d0e594889a6e6fd7e5). The implementation is in [`plugins/SHC/js`](plugins/SHC/js), with shared configuration and the official plugin CLI at the repository root. `./gradlew packageAllPlugins` packages the plugin; `npm run publish:local` prepares the pool and both repository indexes. The `SHC/index.json` installation URL remains supported. Artifacts stay on `main` and the beta channel.

Install development dependencies with `bun install --frozen-lockfile` before running the root scripts. The compiler and SDK revisions are pinned in `package.json`.
