# Privacy

English · [简体中文](privacy.zh-CN.md)

## What WorkOffDesk collects

Nothing. There is no account with us, no analytics, no advertising and no tracking. WorkOffDesk is a server
you run on your own Mac and the apps that talk to it; what you do in it stays between your phone and your Mac.

## What stays on your phone

- The address of your Mac and the sign-in it gave the app, in the iPhone keychain.
- For an app published for others: a key that opens its notifications, in the keychain too.
- Settings such as the language and text size, messages not sent yet, and the snippets you keep.
- Copies of the chats you open, so they show at once: those opened in the last 30 days, the newest part of
  each. Settings → Storage shows how much they take, and clears them; signing out removes those of that Mac.

Removing the app removes the settings, drafts, snippets and chat copies. iOS may keep keychain items after the app is
removed; signing out in the app removes its sign-in.

## What goes to your Mac

Everything you see and send in the app: sessions, messages, pictures, files and voice turned into text. Your
Mac keeps them as described in [Configuration](configuration.md). Voice is turned into text by iOS speech
recognition, under Apple's terms.

## What goes anywhere else

- **Notifications.** Your Mac sends them through Apple's push service. For an app published for others, they
  pass through the publisher's relay first, sealed with the key on your phone: the relay sees your device's
  push token, when a notification is sent and how big it is, never what it says. It keeps none of it.
- **App updates.** An app published for others downloads its JavaScript updates from the publisher's server,
  which sees your IP address and the app's version, as any web server does. A build of your own downloads
  them from your Mac.

## Questions

Open an issue in the [repository](https://github.com/workoffdesk/workoffdesk/issues).
