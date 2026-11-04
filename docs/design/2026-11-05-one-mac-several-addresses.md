# One Mac, several addresses, one account on the phone

## Why

A Mac can be reached at more than one address: `extraOrigins` exists for a second tunnel or a relay. The
fastest one depends on where the phone is. A relay inside one country is quick at home and slow or cut off
abroad; a Cloudflare tunnel is the other way round. Today the app knows one address per account, so the only
way to use the other line is to sign in to it as a second account and switch accounts by hand: the same Mac
shows twice, with two logins and two sets of kept chats.

## The invariant

A signed-in phone reaches its Mac over whichever of the Mac's addresses answers first, without the person
choosing one, and the Mac is one account on the phone.

## What changes

### Server

- `GET /api/addresses` (signed in) answers `{ addresses }`: the origin first, then `extraOrigins`. A token
  is valid at every address of the Mac (the bearer check does not look at the host), so the phone can use
  the one login on each.

### Client (`libs/client`)

- `createRoute` (`base/route.ts`) holds the addresses known for the account in use and the one in use now.
  - `check()` asks every address at once and moves to the first that answers well. Calls made while a check
    runs share it. When none answers, the address in use stays.
  - `failed(at)`: a request at `at` got no answer. If `at` is the address in use, a check runs, at most once
    per `gapMs`, so a dead line is left within one retry of the request that found it.
  - `use(addresses, preferred)` sets the addresses. The address in use stays when it is still among them;
    otherwise `preferred`, if it is among them; otherwise the first.
  - Listeners hear when the address in use changes.
- `createApi` takes `onNoAnswer(base)`: told when a request at `base` got no answer (refused, dropped or
  timed out). A request is retried against `base()` as it is then, so a retry after a move goes to the new
  address.
- `Login` keeps `addresses`. `server` stays the account's identity (what the journal file, notifications and
  `sameAccount` key on); it is always among its addresses, first.
- `learnedAddresses(login, said)` is the login's server followed by every `https://` address the Mac named,
  without repeats. `foldAccounts(accounts, login)` drops any other kept account of the same user whose server
  is among the login's addresses, and hands those back to be signed out on their Mac.

### Phone (`apps/mobile`)

- Every request, socket, picture and video goes to the route's address; the demo is left as it is. A socket
  that closes before it opened is told to the route as a request with no answer.
- Update checks stay on the address signed in to. expo-updates keeps an update in the scope of its URL's
  origin (`docs/design/2026-10-05-mobile-ota-updates-design.md`, row 12). An update URL that followed the
  route would leave the downloaded update unlaunchable after each move, and a cold start would fall back to
  the JS the build carries.
- The addresses are learned from `/api/addresses` on start, after a sign-in or switch, and on coming back to
  the foreground (after a check). A Mac too old to answer leaves the one address.
- The address in use is kept on the device per account, so a cold start begins on the line that worked last.

## Paths that break the invariant, each with a test

| Path | Expected |
| --- | --- |
| The address in use refuses or times out | The next check moves to one that answers; the request's retry goes there |
| Both answer | The first to answer wins |
| None answers | The address in use stays |
| Failures arrive in a burst | One check, not one per failure |
| A failure at an address no longer in use | Nothing happens |
| The Mac names an `http://` address | It is not used |
| The Mac does not know `/api/addresses` (404) | The one address stays; nothing breaks |
| Two kept accounts are the same Mac | They fold into the one in use; the other login is signed out |
| Another user on the same Mac | Not folded |
| The phone starts cold | It begins on the address used last for that account |
| Only one address | No check runs |
| The route moves | The update URL stays on the address signed in to |

## Not in scope

- The web app: a browser is on one origin and signs in by its cookie there.
- Showing which line is in use in Settings.
- Passkeys: they belong to an rpId, and signing in on the phone uses the password and token.
