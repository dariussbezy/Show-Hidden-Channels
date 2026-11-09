# Show Hidden Channels for Valenced

Show hidden channel metadata in the server channel list, using the original Show Hidden Channels interface. Version: **1.0.0-beta**.

## Features

- **Hidden channels in the list**, for supported text, voice, category, announcement, stage, forum and media channels already supplied by Discord.
- **Lock indicators**, with an option to turn them off.
- **Information card** showing the topic, channel type, creation date and available last-message/last-pin timestamps.
- **Open anyway** opens the channel view; hidden-channel message history is not loaded. Hidden voice channels cannot be joined through the plugin.
- **Info card toggle**, plus the original settings cards, counters, quick guide and light/dark colors.
- **No Access name handling**, using a best-effort session-only override of the matching client experiment. Persisted experiment preferences are not changed.

## Installation

Add this Repository URL in **Valenced → Plugins → Advanced**:

```text
https://raw.githubusercontent.com/dariussbezy/Show-Hidden-Channels/refs/heads/main/SHC/index.json
```

Select **beta**, install **Show Hidden Channels**, enable it and restart Discord. Open its settings to configure **Show lock icon** and **Show info card**.

The current beta targets Valenced 1.3.0 and Discord 352.6 alpha. Display and navigation on a device still need confirmation. The implementation uses JavaScript and React Native; iOS has not been verified.

## Channel information

The plugin displays metadata Discord already makes available to your client. It cannot recover channel names, topics, message contents or other data that Discord does not provide. Missing last-message and pin information is labeled **Not provided by Discord** rather than treated as proof that a channel is empty.

Tapping a hidden channel in the current server opens its info card when that option is enabled. Entering a server avoids opening the card automatically for its selected channel. **Open anyway** preserves the original navigation action while leaving history and voice access blocked.

The No Access handling applies only to the matching client experiment in this session. A reconnect may be needed before available metadata changes. Server-redacted names can remain unavailable.

## Privacy

Only the two display preferences are saved locally through Valenced. The plugin does not send message content, account tokens or channel metadata to external services, and it does not request hidden-channel message history. Its permission, navigation, rendering and experiment hooks are removed when it stops.
